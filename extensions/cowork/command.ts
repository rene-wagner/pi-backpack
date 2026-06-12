import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CoworkScheduler, parseIntervalMs } from "./scheduler.js";
import { getCoworkStorePaths, loadJobs, loadState, saveJobs } from "./store.js";
import {
  DEFAULT_COWORK_TIMEOUT_MS,
  DEFAULT_COWORK_TOOLS,
  type CoworkJob,
} from "./types.js";

let scheduler: CoworkScheduler | undefined;

export function registerCoworkCommand(pi: ExtensionAPI) {
  const paths = getCoworkStorePaths();

  pi.registerCommand("cowork", {
    description: "Manage recurring Pi agent jobs",
    handler: async (args, ctx) => {
      const tokens = tokenize(args);
      const action = tokens.shift() ?? "status";

      try {
        if (action === "list") {
          ctx.ui.notify(await listJobs(), "info");
          return;
        }
        if (action === "add") {
          const job = await addJob(tokens, ctx.cwd);
          ctx.ui.notify(`Added cowork job ${job.id}`, "info");
          return;
        }
        if (action === "run") {
          const id = requireId(tokens, "run");
          const active = ensureScheduler();
          const result = await active.runNow(id);
          ctx.ui.notify(
            `Cowork job ${id} finished with exit code ${result.exitCode}`,
            result.exitCode === 0 ? "info" : "warning",
          );
          return;
        }
        if (action === "enable" || action === "disable") {
          const id = requireId(tokens, action);
          await setEnabled(id, action === "enable");
          ctx.ui.notify(
            `${action === "enable" ? "Enabled" : "Disabled"} cowork job ${id}`,
            "info",
          );
          return;
        }
        if (action === "remove") {
          const id = requireId(tokens, "remove");
          await removeJob(id);
          ctx.ui.notify(`Removed cowork job ${id}`, "info");
          return;
        }
        if (action === "start") {
          ensureScheduler().start();
          ctx.ui.notify("Cowork scheduler started", "info");
          return;
        }
        if (action === "stop") {
          scheduler?.stop();
          ctx.ui.notify("Cowork scheduler stopped", "info");
          return;
        }
        if (action === "status") {
          ctx.ui.notify(await statusText(), "info");
          return;
        }

        ctx.ui.notify(helpText(), "warning");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(message, "error");
      }
    },
  });

  function ensureScheduler() {
    scheduler ??= new CoworkScheduler(paths, {
      onLog: (message) => undefined,
    });
    return scheduler;
  }

  async function listJobs() {
    const jobs = await loadJobs(paths);
    const state = await loadState(paths);
    if (jobs.length === 0) return "No cowork jobs configured.";

    return jobs
      .map((job) => {
        const jobState = state.jobs[job.id];
        return [
          `${job.enabled ? "✓" : "-"} ${job.id}`,
          `every=${job.every}`,
          `cwd=${job.cwd}`,
          `last=${jobState?.lastRunAt ?? "never"}`,
          `next=${jobState?.nextRunAt ?? "unknown"}`,
          `exit=${jobState?.lastExitCode ?? "n/a"}`,
        ].join(" | ");
      })
      .join("\n");
  }

  async function statusText() {
    const jobs = await loadJobs(paths);
    const runningIds = scheduler?.getRunningJobIds() ?? [];
    return [
      `Cowork scheduler: ${scheduler?.isRunning() ? "running" : "stopped"}`,
      `Jobs: ${jobs.length}`,
      `Running: ${runningIds.length ? runningIds.join(", ") : "none"}`,
      `Store: ${paths.rootDir}`,
    ].join("\n");
  }

  async function addJob(tokens: string[], defaultCwd: string) {
    const id = tokens.shift();
    if (!id)
      throw new Error(
        'Usage: /cowork add <id> every=1h prompt="..." [cwd=.] [tools=read,bash] [model=...] [runOnStart=true]',
      );

    const values = parseKeyValues(tokens);
    const every = values.get("every");
    const prompt = values.get("prompt");
    if (!every) throw new Error("Missing every=<interval>.");
    parseIntervalMs(every);
    if (!prompt) throw new Error("Missing prompt=<text>.");
    const concurrency = values.get("concurrency") ?? "skip";
    if (concurrency !== "skip")
      throw new Error('MVP only supports concurrency="skip".');

    const now = new Date().toISOString();
    const cwd = path.resolve(defaultCwd, values.get("cwd") ?? ".");
    const timeoutMs = values.has("timeoutMs")
      ? Number(values.get("timeoutMs"))
      : DEFAULT_COWORK_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error("timeoutMs must be a positive number.");

    const job: CoworkJob = {
      id,
      enabled: values.get("enabled") !== "false",
      cwd,
      every,
      prompt,
      ...(values.has("model") ? { model: values.get("model")! } : {}),
      tools: values.has("tools")
        ? splitList(values.get("tools")!)
        : DEFAULT_COWORK_TOOLS,
      timeoutMs,
      runOnStart: values.get("runOnStart") === "true",
      concurrency: "skip",
      createdAt: now,
      updatedAt: now,
    };

    const jobs = await loadJobs(paths);
    if (jobs.some((candidate) => candidate.id === id)) {
      throw new Error(`Cowork job "${id}" already exists.`);
    }
    jobs.push(job);
    await saveJobs(jobs, paths);
    return job;
  }

  async function setEnabled(id: string, enabled: boolean) {
    const jobs = await loadJobs(paths);
    const job = jobs.find((candidate) => candidate.id === id);
    if (!job) throw new Error(`Unknown cowork job "${id}".`);
    job.enabled = enabled;
    job.updatedAt = new Date().toISOString();
    await saveJobs(jobs, paths);
  }

  async function removeJob(id: string) {
    const jobs = await loadJobs(paths);
    const next = jobs.filter((job) => job.id !== id);
    if (next.length === jobs.length)
      throw new Error(`Unknown cowork job "${id}".`);
    await saveJobs(next, paths);
  }
}

function requireId(tokens: string[], command: string) {
  const id = tokens[0];
  if (!id) throw new Error(`Usage: /cowork ${command} <id>`);
  return id;
}

function tokenize(input: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  for (const char of input) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) throw new Error("Unclosed quote in /cowork arguments.");
  if (current) tokens.push(current);
  return tokens;
}

function parseKeyValues(tokens: string[]) {
  const values = new Map<string, string>();
  for (const token of tokens) {
    const index = token.indexOf("=");
    if (index <= 0) throw new Error(`Expected key=value, got "${token}".`);
    values.set(token.slice(0, index), token.slice(index + 1));
  }
  return values;
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function helpText() {
  return [
    "Usage:",
    "/cowork list",
    '/cowork add <id> every=1h prompt="..." [cwd=.] [tools=read,grep,find,ls] [model=...] [runOnStart=true]',
    "/cowork run <id>",
    "/cowork enable <id>",
    "/cowork disable <id>",
    "/cowork remove <id>",
    "/cowork start",
    "/cowork stop",
    "/cowork status",
  ].join("\n");
}
