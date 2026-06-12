import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CoworkScheduler, parseIntervalMs } from "./scheduler.js";
import {
  formatRunSummary,
  getCoworkStorePaths,
  listRunResults,
  loadJobs,
  loadLatestRunResult,
  loadState,
  saveJobs,
} from "./store.js";
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
        if (action === "show") {
          const id = requireId(tokens, "show");
          ctx.ui.notify(await showJob(id), "info");
          return;
        }
        if (action === "edit") {
          const id = requireId(tokens, "edit");
          await editJob(id, tokens.slice(1), ctx.cwd);
          ctx.ui.notify(`Updated cowork job ${id}`, "info");
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
        if (action === "runs") {
          const id = requireId(tokens, "runs");
          ctx.ui.notify(await listRuns(id), "info");
          return;
        }
        if (action === "last") {
          const id = requireId(tokens, "last");
          ctx.ui.notify(await lastRun(id), "info");
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

  async function showJob(id: string) {
    const jobs = await loadJobs(paths);
    const job = findJob(jobs, id);
    const state = (await loadState(paths)).jobs[id];
    return [
      `Job: ${job.id}`,
      `Enabled: ${job.enabled}`,
      `Every: ${job.every}`,
      `CWD: ${job.cwd}`,
      `Model: ${job.model ?? "default"}`,
      `Tools: ${(job.tools ?? DEFAULT_COWORK_TOOLS).join(",")}`,
      `Timeout: ${job.timeoutMs ?? DEFAULT_COWORK_TIMEOUT_MS} ms`,
      `Run on start: ${job.runOnStart === true}`,
      `Concurrency: ${job.concurrency ?? "skip"}`,
      `Created: ${job.createdAt}`,
      `Updated: ${job.updatedAt}`,
      `Last run: ${state?.lastRunAt ?? "never"}`,
      `Next run: ${state?.nextRunAt ?? "unknown"}`,
      `Last exit: ${state?.lastExitCode ?? "n/a"}`,
      `Failures: ${state?.consecutiveFailures ?? 0}`,
      `Last error: ${state?.lastError ?? "none"}`,
      "",
      "Prompt:",
      job.prompt,
    ].join("\n");
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

  async function editJob(id: string, tokens: string[], defaultCwd: string) {
    if (tokens.length === 0) {
      throw new Error('Usage: /cowork edit <id> every=1h prompt="..." [model=...] [tools=read,bash]');
    }

    const values = parseKeyValues(tokens);
    const jobs = await loadJobs(paths);
    const job = findJob(jobs, id);
    applyJobValues(job, values, defaultCwd);
    job.updatedAt = new Date().toISOString();
    await saveJobs(jobs, paths);
  }

  async function setEnabled(id: string, enabled: boolean) {
    const jobs = await loadJobs(paths);
    const job = findJob(jobs, id);
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

  async function listRuns(id: string) {
    findJob(await loadJobs(paths), id);
    const runs = await listRunResults(id, paths);
    if (runs.length === 0) return `No runs recorded for cowork job ${id}.`;
    return runs
      .slice(0, 10)
      .map((run) => `${run.startedAt} | exit=${run.exitCode} | duration=${run.durationMs}ms | model=${run.model ?? "default"}`)
      .join("\n");
  }

  async function lastRun(id: string) {
    findJob(await loadJobs(paths), id);
    const run = await loadLatestRunResult(id, paths);
    if (!run) return `No runs recorded for cowork job ${id}.`;
    return formatRunSummary(run);
  }
}

function findJob(jobs: CoworkJob[], id: string) {
  const job = jobs.find((candidate) => candidate.id === id);
  if (!job) throw new Error(`Unknown cowork job "${id}".`);
  return job;
}

function applyJobValues(job: CoworkJob, values: Map<string, string>, defaultCwd: string) {
  for (const key of values.keys()) {
    if (!["enabled", "every", "prompt", "cwd", "model", "tools", "timeoutMs", "runOnStart", "concurrency"].includes(key)) {
      throw new Error(`Unsupported cowork job field "${key}".`);
    }
  }

  const every = values.get("every");
  if (every !== undefined) {
    parseIntervalMs(every);
    job.every = every;
  }
  const prompt = values.get("prompt");
  if (prompt !== undefined) {
    if (!prompt.trim()) throw new Error("prompt must not be empty.");
    job.prompt = prompt;
  }
  const cwd = values.get("cwd");
  if (cwd !== undefined) job.cwd = path.resolve(defaultCwd, cwd);
  const model = values.get("model");
  if (model !== undefined) {
    if (model === "" || model === "default" || model === "none") delete job.model;
    else job.model = model;
  }
  const tools = values.get("tools");
  if (tools !== undefined) {
    const parsed = splitList(tools);
    if (parsed.length === 0) throw new Error("tools must contain at least one tool.");
    job.tools = parsed;
  }
  const timeoutMs = values.get("timeoutMs");
  if (timeoutMs !== undefined) {
    const parsed = Number(timeoutMs);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("timeoutMs must be a positive number.");
    job.timeoutMs = parsed;
  }
  const enabled = values.get("enabled");
  if (enabled !== undefined) job.enabled = parseBoolean(enabled, "enabled");
  const runOnStart = values.get("runOnStart");
  if (runOnStart !== undefined) job.runOnStart = parseBoolean(runOnStart, "runOnStart");
  const concurrency = values.get("concurrency");
  if (concurrency !== undefined && concurrency !== "skip") {
    throw new Error('MVP only supports concurrency="skip".');
  }
  if (concurrency === "skip") job.concurrency = "skip";
}

function parseBoolean(value: string, field: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${field} must be true or false.`);
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
    "/cowork show <id>",
    '/cowork add <id> every=1h prompt="..." [cwd=.] [tools=read,grep,find,ls] [model=...] [runOnStart=true]',
    '/cowork edit <id> every=1h prompt="..." [cwd=.] [tools=read,grep,find,ls] [model=...]',
    "/cowork run <id>",
    "/cowork runs <id>",
    "/cowork last <id>",
    "/cowork enable <id>",
    "/cowork disable <id>",
    "/cowork remove <id>",
    "/cowork start",
    "/cowork stop",
    "/cowork status",
  ].join("\n");
}
