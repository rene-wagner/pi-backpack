import type { CoworkJob, CoworkJobState, CoworkSchedulerOptions, CoworkState, CoworkStorePaths } from "./types.js";
import { loadJobs, loadState, saveJobs, saveRunResult, saveState } from "./store.js";
import { runCoworkJob } from "./runner.js";

const DEFAULT_TICK_MS = 30_000;

export function parseIntervalMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Invalid interval "${value}". Use e.g. 30s, 5m, 1h, or 2d.`);

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`Invalid interval "${value}". Amount must be positive.`);
  }

  const unit = match[2];
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

export function computeNextRunAt(job: CoworkJob, state: CoworkJobState | undefined): string {
  const intervalMs = parseIntervalMs(job.every);
  const base = state?.lastRunAt ? Date.parse(state.lastRunAt) : Date.parse(job.createdAt);
  return new Date(base + intervalMs).toISOString();
}

export function isJobDue(job: CoworkJob, state: CoworkJobState | undefined, now = new Date()): boolean {
  if (!job.enabled) return false;
  if (!state?.lastRunAt && job.runOnStart) return true;
  const nextRunAt = state?.nextRunAt ?? computeNextRunAt(job, state);
  return Date.parse(nextRunAt) <= now.getTime();
}

export class CoworkScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private runningJobs = new Set<string>();

  constructor(
    private readonly paths: CoworkStorePaths,
    private readonly options: CoworkSchedulerOptions = {},
  ) {}

  isRunning() {
    return Boolean(this.timer);
  }

  getRunningJobIds() {
    return [...this.runningJobs];
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => this.logError("Cowork scheduler tick failed", error));
    }, this.options.tickMs ?? DEFAULT_TICK_MS);
    this.timer.unref();
    void this.tick().catch((error: unknown) => this.logError("Cowork scheduler tick failed", error));
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick() {
    const jobs = await loadJobs(this.paths);
    const state = await loadState(this.paths);
    let changed = false;

    for (const job of jobs) {
      try {
        const jobState = ensureJobState(state, job.id);
        const nextRunAt = computeNextRunAt(job, jobState);
        const hasRetryNextRun = Boolean(job.retryAfter && jobState.consecutiveFailures > 0 && jobState.nextRunAt);
        if (!hasRetryNextRun && jobState.nextRunAt !== nextRunAt && !jobState.running) {
          jobState.nextRunAt = nextRunAt;
          changed = true;
        }

        if (!isJobDue(job, jobState)) continue;
        if (this.runningJobs.has(job.id)) {
          this.options.onLog?.(`Skipping ${job.id}; already running.`);
          continue;
        }

        changed = true;
        void this.runJob(job, state).catch((error: unknown) => this.logError(`Cowork job ${job.id} failed`, error));
      } catch (error) {
        changed = true;
        const jobState = ensureJobState(state, job.id);
        jobState.lastExitCode = 1;
        jobState.lastError = error instanceof Error ? error.message : String(error);
        jobState.consecutiveFailures += 1;
        this.logError(`Skipping invalid cowork job ${job.id}`, error);
      }
    }

    if (changed) await saveState(state, this.paths);
  }

  async runNow(jobId: string) {
    const jobs = await loadJobs(this.paths);
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new Error(`Unknown cowork job "${jobId}".`);
    const state = await loadState(this.paths);
    return this.runJob(job, state);
  }

  private async runJob(job: CoworkJob, state: CoworkState) {
    if (this.runningJobs.has(job.id)) {
      throw new Error(`Cowork job "${job.id}" is already running.`);
    }

    this.runningJobs.add(job.id);
    const jobState = ensureJobState(state, job.id);
    jobState.running = true;
    jobState.runningStartedAt = new Date().toISOString();
    await saveState(state, this.paths);
    this.options.onLog?.(`Running cowork job ${job.id}...`);

    try {
      const result = await (this.options.runJob ?? runCoworkJob)(job);
      await saveRunResult(result, this.paths);

      jobState.lastRunAt = result.finishedAt;
      jobState.lastExitCode = result.exitCode;
      if (result.exitCode === 0) {
        delete jobState.lastError;
        jobState.consecutiveFailures = 0;
        jobState.nextRunAt = computeNextRunAt(job, jobState);
      } else {
        jobState.lastError = result.stderr || `Exit code ${result.exitCode}`;
        jobState.consecutiveFailures += 1;
        await applyFailurePolicy(job, jobState, this.paths, result.finishedAt);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      jobState.lastRunAt = new Date().toISOString();
      jobState.lastExitCode = 1;
      jobState.lastError = message;
      jobState.consecutiveFailures += 1;
      await applyFailurePolicy(job, jobState, this.paths, jobState.lastRunAt);
      throw error;
    } finally {
      jobState.running = false;
      delete jobState.runningStartedAt;
      this.runningJobs.delete(job.id);
      await saveState(state, this.paths);
    }
  }

  private logError(prefix: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.options.onLog?.(`${prefix}: ${message}`);
  }
}

async function applyFailurePolicy(
  job: CoworkJob,
  jobState: CoworkJobState,
  paths: CoworkStorePaths,
  failedAt: string,
) {
  if (job.retryAfter) {
    jobState.nextRunAt = new Date(Date.parse(failedAt) + parseIntervalMs(job.retryAfter)).toISOString();
  } else {
    jobState.nextRunAt = computeNextRunAt(job, jobState);
  }

  if (job.maxFailures !== undefined && jobState.consecutiveFailures >= job.maxFailures) {
    job.enabled = false;
    job.updatedAt = new Date().toISOString();
    jobState.lastError = `Disabled after ${jobState.consecutiveFailures} consecutive failures. Last error: ${jobState.lastError ?? "unknown"}`;
    const jobs = await loadJobs(paths);
    const stored = jobs.find((candidate) => candidate.id === job.id);
    if (stored) {
      stored.enabled = false;
      stored.updatedAt = job.updatedAt;
      await saveJobs(jobs, paths);
    }
  }
}

function ensureJobState(state: CoworkState, jobId: string): CoworkJobState {
  state.jobs[jobId] ??= { consecutiveFailures: 0 };
  return state.jobs[jobId]!;
}
