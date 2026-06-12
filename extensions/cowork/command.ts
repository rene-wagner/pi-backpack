import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CoworkScheduler, computeNextRunAt, parseIntervalMs } from "./scheduler.js";
import {
  cleanupRunResults,
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
  type CoworkJobState,
  type CoworkNotify,
  type CoworkRunResult,
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
        if (action === "validate") {
          const id = tokens[0];
          ctx.ui.notify(await validateJobs(id), "info");
          return;
        }
        if (action === "failures") {
          ctx.ui.notify(await failuresText(), "info");
          return;
        }
        if (action === "cleanup") {
          ctx.ui.notify(await cleanupRuns(tokens), "info");
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
      onRunComplete: (job, result, state) => sendRunNotification(job, result, state),
      onRunError: (job, error, state) => sendRunErrorNotification(job, error, state),
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
      `Retry after: ${job.retryAfter ?? "default interval"}`,
      `Max failures: ${job.maxFailures ?? "unlimited"}`,
      `Notify: ${job.notify ?? "never"}`,
      `Run on start: ${job.runOnStart === true}`,
      `Concurrency: ${job.concurrency ?? "skip"}`,
      `Created: ${job.createdAt}`,
      `Updated: ${job.updatedAt}`,
      `Last run: ${state?.lastRunAt ?? "never"}`,
      `Next run: ${state?.nextRunAt ?? "unknown"}`,
      `Last exit: ${state?.lastExitCode ?? "n/a"}`,
      `Running: ${state?.running === true ? `yes since ${state.runningStartedAt ?? "unknown"}` : "no"}`,
      `Failures: ${state?.consecutiveFailures ?? 0}`,
      `Last error: ${state?.lastError ?? "none"}`,
      "",
      "Prompt:",
      job.prompt,
    ].join("\n");
  }

  async function statusText() {
    const jobs = await loadJobs(paths);
    const state = await loadState(paths);
    const runningIds = scheduler?.getRunningJobIds() ?? [];
    const enabledJobs = jobs.filter((job) => job.enabled);
    const failedJobs = jobs.filter((job) => (state.jobs[job.id]?.consecutiveFailures ?? 0) > 0);
    const nextJobs = jobs
      .filter((job) => job.enabled)
      .map((job) => {
        try {
          const nextRunAt = state.jobs[job.id]?.nextRunAt ?? computeSafeNextRunAt(job, state.jobs[job.id]);
          return { id: job.id, nextRunAt };
        } catch {
          return { id: job.id, nextRunAt: "invalid" };
        }
      })
      .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))
      .slice(0, 5);

    return [
      `Cowork scheduler: ${scheduler?.isRunning() ? "running" : "stopped"}`,
      `Jobs: ${jobs.length} (${enabledJobs.length} enabled, ${jobs.length - enabledJobs.length} disabled)`,
      `Running: ${runningIds.length ? runningIds.join(", ") : "none"}`,
      `Failures: ${failedJobs.length ? failedJobs.map((job) => `${job.id}(${state.jobs[job.id]?.consecutiveFailures ?? 0})`).join(", ") : "none"}`,
      `Next due: ${nextJobs.length ? nextJobs.map((job) => `${job.id}=${job.nextRunAt}`).join(", ") : "none"}`,
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
    const retryAfter = values.get("retryAfter");
    if (retryAfter !== undefined) parseIntervalMs(retryAfter);
    const maxFailures = values.has("maxFailures") ? Number(values.get("maxFailures")) : undefined;
    if (maxFailures !== undefined && (!Number.isSafeInteger(maxFailures) || maxFailures <= 0)) {
      throw new Error("maxFailures must be a positive integer.");
    }

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
      ...(retryAfter !== undefined ? { retryAfter } : {}),
      ...(maxFailures !== undefined ? { maxFailures } : {}),
      notify: parseNotify(values.get("notify") ?? "never"),
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

  async function validateJobs(id: string | undefined) {
    const jobs = await loadJobs(paths);
    const selected = id ? [findJob(jobs, id)] : jobs;
    if (selected.length === 0) return "No cowork jobs configured.";

    const lines = await Promise.all(
      selected.map(async (job) => {
        const issues = await validateJob(job);
        if (issues.length === 0) return `✓ ${job.id}: valid`;
        return [`✗ ${job.id}: ${issues.length} issue(s)`, ...issues.map((issue) => `  - ${issue}`)].join("\n");
      }),
    );
    return lines.join("\n");
  }

  async function failuresText() {
    const jobs = await loadJobs(paths);
    const state = await loadState(paths);
    const failures = jobs.filter((job) => (state.jobs[job.id]?.consecutiveFailures ?? 0) > 0 || state.jobs[job.id]?.lastError);
    if (failures.length === 0) return "No cowork job failures recorded.";
    return failures
      .map((job) => {
        const jobState = state.jobs[job.id];
        return [
          `${job.id}: failures=${jobState?.consecutiveFailures ?? 0}`,
          `lastRun=${jobState?.lastRunAt ?? "never"}`,
          `exit=${jobState?.lastExitCode ?? "n/a"}`,
          `error=${jobState?.lastError ?? "none"}`,
        ].join(" | ");
      })
      .join("\n");
  }

  async function cleanupRuns(tokens: string[]) {
    const target = tokens.shift();
    if (!target) throw new Error("Usage: /cowork cleanup <id>|--all keep=20 [olderThan=30d] [dryRun=true]");
    const values = parseKeyValues(tokens);
    const keep = values.has("keep") ? Number(values.get("keep")) : undefined;
    if (keep !== undefined && (!Number.isSafeInteger(keep) || keep < 0)) {
      throw new Error("keep must be a non-negative integer.");
    }
    const olderThanMs = values.has("olderThan") ? parseIntervalMs(values.get("olderThan")!) : undefined;
    if (keep === undefined && olderThanMs === undefined) {
      throw new Error("cleanup requires keep=<count>, olderThan=<interval>, or both.");
    }
    const dryRun = values.has("dryRun") ? parseBoolean(values.get("dryRun")!, "dryRun") : false;

    const jobs = await loadJobs(paths);
    const selected = target === "--all" ? jobs : [findJob(jobs, target)];
    if (selected.length === 0) return "No cowork jobs configured.";

    const results = await Promise.all(
      selected.map((job) => cleanupRunResults(job.id, { ...(keep !== undefined ? { keep } : {}), ...(olderThanMs !== undefined ? { olderThanMs } : {}), dryRun }, paths)),
    );
    const deletedRuns = results.reduce((sum, result) => sum + result.deletedRuns, 0);
    const deletedFiles = results.reduce((sum, result) => sum + result.deletedFiles, 0);
    return [
      `${dryRun ? "Would delete" : "Deleted"} ${deletedRuns} run(s) and ${deletedFiles} file(s).`,
      ...results.map((result) => `${result.jobId}: deleted=${result.deletedRuns}, kept=${result.keptRuns}`),
    ].join("\n");
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

  function sendRunNotification(job: CoworkJob, result: CoworkRunResult, state: CoworkJobState) {
    if (!shouldNotify(job, result.exitCode !== 0)) return;
    const status = result.exitCode === 0 ? "succeeded" : "failed";
    const disabled = job.enabled ? "" : " Job was disabled.";
    pi.sendMessage(
      {
        customType: "cowork-notification",
        content: `Cowork job ${job.id} ${status} with exit code ${result.exitCode}.${disabled}`,
        display: true,
        details: {
          jobId: job.id,
          exitCode: result.exitCode,
          consecutiveFailures: state.consecutiveFailures,
          lastError: state.lastError,
          nextRunAt: state.nextRunAt,
        },
      },
      { deliverAs: "nextTurn" },
    );
  }

  function sendRunErrorNotification(job: CoworkJob, error: Error, state: CoworkJobState) {
    if (!shouldNotify(job, true)) return;
    pi.sendMessage(
      {
        customType: "cowork-notification",
        content: `Cowork job ${job.id} failed: ${error.message}`,
        display: true,
        details: {
          jobId: job.id,
          consecutiveFailures: state.consecutiveFailures,
          lastError: state.lastError,
          nextRunAt: state.nextRunAt,
        },
      },
      { deliverAs: "nextTurn" },
    );
  }
}

function findJob(jobs: CoworkJob[], id: string) {
  const job = jobs.find((candidate) => candidate.id === id);
  if (!job) throw new Error(`Unknown cowork job "${id}".`);
  return job;
}

function computeSafeNextRunAt(job: CoworkJob, state: Parameters<typeof computeNextRunAt>[1]) {
  return computeNextRunAt(job, state);
}

async function validateJob(job: CoworkJob) {
  const issues: string[] = [];

  if (!job.id.trim()) issues.push("id must not be empty");
  try {
    parseIntervalMs(job.every);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (!job.prompt.trim()) issues.push("prompt must not be empty");
  if (!Array.isArray(job.tools) || job.tools.length === 0) issues.push("tools must contain at least one tool");
  if (job.timeoutMs !== undefined && (!Number.isFinite(job.timeoutMs) || job.timeoutMs <= 0)) {
    issues.push("timeoutMs must be a positive number");
  }
  if (job.retryAfter !== undefined) {
    try {
      parseIntervalMs(job.retryAfter);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (job.maxFailures !== undefined && (!Number.isSafeInteger(job.maxFailures) || job.maxFailures <= 0)) {
    issues.push("maxFailures must be a positive integer");
  }
  if (!isNotifyValue(job.notify ?? "never")) issues.push('notify must be one of: never, failures, always');
  if ((job.concurrency ?? "skip") !== "skip") issues.push('MVP only supports concurrency="skip"');

  try {
    const stat = await fs.promises.stat(job.cwd);
    if (!stat.isDirectory()) issues.push(`cwd is not a directory: ${job.cwd}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    issues.push(code === "ENOENT" ? `cwd does not exist: ${job.cwd}` : `cwd is not accessible: ${job.cwd}`);
  }

  return issues;
}

function applyJobValues(job: CoworkJob, values: Map<string, string>, defaultCwd: string) {
  for (const key of values.keys()) {
    if (!["enabled", "every", "prompt", "cwd", "model", "tools", "timeoutMs", "retryAfter", "maxFailures", "notify", "runOnStart", "concurrency"].includes(key)) {
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
  const retryAfter = values.get("retryAfter");
  if (retryAfter !== undefined) {
    if (retryAfter === "" || retryAfter === "default" || retryAfter === "none") delete job.retryAfter;
    else {
      parseIntervalMs(retryAfter);
      job.retryAfter = retryAfter;
    }
  }
  const maxFailures = values.get("maxFailures");
  if (maxFailures !== undefined) {
    if (maxFailures === "" || maxFailures === "unlimited" || maxFailures === "none") delete job.maxFailures;
    else {
      const parsed = Number(maxFailures);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("maxFailures must be a positive integer.");
      job.maxFailures = parsed;
    }
  }
  const notify = values.get("notify");
  if (notify !== undefined) job.notify = parseNotify(notify);
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

function shouldNotify(job: CoworkJob, failed: boolean) {
  const notify = job.notify ?? "never";
  return notify === "always" || (notify === "failures" && failed);
}

function isNotifyValue(value: string): value is CoworkNotify {
  return value === "never" || value === "failures" || value === "always";
}

function parseNotify(value: string): CoworkNotify {
  if (isNotifyValue(value)) return value;
  throw new Error('notify must be one of: never, failures, always.');
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
    '/cowork add <id> every=1h prompt="..." [cwd=.] [tools=read,grep,find,ls] [model=...] [retryAfter=10m] [maxFailures=5] [notify=failures] [runOnStart=true]',
    '/cowork edit <id> every=1h prompt="..." [cwd=.] [tools=read,grep,find,ls] [model=...] [retryAfter=10m] [maxFailures=5] [notify=always]',
    "/cowork validate [id]",
    "/cowork failures",
    "/cowork cleanup <id>|--all keep=20 [olderThan=30d] [dryRun=true]",
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
