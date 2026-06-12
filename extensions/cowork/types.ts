export type CoworkConcurrency = "skip" | "queue" | "parallel";

export interface CoworkJob {
  id: string;
  enabled: boolean;
  cwd: string;
  every: string;
  prompt: string;
  model?: string;
  tools?: string[];
  timeoutMs?: number;
  runOnStart?: boolean;
  concurrency?: CoworkConcurrency;
  createdAt: string;
  updatedAt: string;
}

export interface CoworkJobState {
  lastRunAt?: string;
  nextRunAt?: string;
  lastExitCode?: number;
  lastError?: string;
  consecutiveFailures: number;
  running?: boolean;
  runningStartedAt?: string;
}

export interface CoworkState {
  jobs: Record<string, CoworkJobState>;
}

export interface CoworkRunResult {
  jobId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  output: string;
  stderr: string;
  cwd: string;
  model?: string;
  tools: string[];
}

export interface CoworkStorePaths {
  rootDir: string;
  jobsFile: string;
  stateFile: string;
  runsDir: string;
}

export interface CoworkRunOptions {
  signal?: AbortSignal;
  onUpdate?: (text: string) => void;
}

export interface CoworkSchedulerOptions {
  tickMs?: number;
  onLog?: (message: string) => void;
  runJob?: (job: CoworkJob) => Promise<CoworkRunResult>;
}

export const DEFAULT_COWORK_TOOLS = ["read", "grep", "find", "ls"];
export const DEFAULT_COWORK_TIMEOUT_MS = 30 * 60 * 1000;
