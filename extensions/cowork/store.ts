import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CoworkJob,
  CoworkRunResult,
  CoworkState,
  CoworkStorePaths,
} from "./types.js";

function agentDir() {
  return process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

export function getCoworkStorePaths(rootDir = path.join(agentDir(), "cowork")): CoworkStorePaths {
  return {
    rootDir,
    jobsFile: path.join(rootDir, "jobs.json"),
    stateFile: path.join(rootDir, "state.json"),
    runsDir: path.join(rootDir, "runs"),
  };
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadJobs(paths = getCoworkStorePaths()): Promise<CoworkJob[]> {
  return readJson<CoworkJob[]>(paths.jobsFile, []);
}

export async function saveJobs(jobs: CoworkJob[], paths = getCoworkStorePaths()) {
  await writeJson(paths.jobsFile, jobs);
}

export async function loadState(paths = getCoworkStorePaths()): Promise<CoworkState> {
  return readJson<CoworkState>(paths.stateFile, { jobs: {} });
}

export async function saveState(state: CoworkState, paths = getCoworkStorePaths()) {
  await writeJson(paths.stateFile, state);
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function runDirForJob(jobId: string, paths: CoworkStorePaths) {
  return path.join(paths.runsDir, safeFilePart(jobId));
}

export async function saveRunResult(
  result: CoworkRunResult,
  paths = getCoworkStorePaths(),
): Promise<{ jsonFile: string; summaryFile: string }> {
  const runDir = runDirForJob(result.jobId, paths);
  await fs.promises.mkdir(runDir, { recursive: true });
  const stamp = safeFilePart(result.startedAt);
  const jsonFile = path.join(runDir, `${stamp}.json`);
  const summaryFile = path.join(runDir, `${stamp}.summary.md`);

  await writeJson(jsonFile, result);
  await fs.promises.writeFile(summaryFile, formatRunSummary(result), "utf8");
  return { jsonFile, summaryFile };
}

async function listRunFiles(jobId: string, paths: CoworkStorePaths) {
  const runDir = runDirForJob(jobId, paths);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(runDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const runs = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const jsonFile = path.join(runDir, entry);
        const result = await readJson<CoworkRunResult>(jsonFile, undefined as never);
        const baseName = entry.slice(0, -".json".length);
        return {
          result,
          jsonFile,
          summaryFile: path.join(runDir, `${baseName}.summary.md`),
        };
      }),
  );

  return runs.sort((a, b) => Date.parse(b.result.startedAt) - Date.parse(a.result.startedAt));
}

export async function listRunResults(
  jobId: string,
  paths = getCoworkStorePaths(),
): Promise<CoworkRunResult[]> {
  return (await listRunFiles(jobId, paths)).map((run) => run.result);
}

export async function loadLatestRunResult(
  jobId: string,
  paths = getCoworkStorePaths(),
): Promise<CoworkRunResult | undefined> {
  return (await listRunResults(jobId, paths))[0];
}

export interface CleanupRunResultsOptions {
  keep?: number;
  olderThanMs?: number;
  now?: Date;
  dryRun?: boolean;
}

export interface CleanupRunResultsResult {
  jobId: string;
  keptRuns: number;
  deletedRuns: number;
  deletedFiles: number;
  dryRun: boolean;
}

export async function cleanupRunResults(
  jobId: string,
  options: CleanupRunResultsOptions,
  paths = getCoworkStorePaths(),
): Promise<CleanupRunResultsResult> {
  const runs = await listRunFiles(jobId, paths);
  const cutoff = options.olderThanMs === undefined
    ? undefined
    : (options.now ?? new Date()).getTime() - options.olderThanMs;
  const keep = options.keep ?? Number.POSITIVE_INFINITY;
  const dryRun = options.dryRun === true;

  const candidates = runs.filter((run, index) => {
    const beyondKeep = index >= keep;
    const olderThanCutoff = cutoff !== undefined && Date.parse(run.result.startedAt) < cutoff;
    return beyondKeep || olderThanCutoff;
  });

  let deletedFiles = 0;
  if (!dryRun) {
    for (const run of candidates) {
      for (const file of [run.jsonFile, run.summaryFile]) {
        try {
          await fs.promises.rm(file, { force: true });
          deletedFiles += 1;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
  } else {
    deletedFiles = candidates.length * 2;
  }

  return {
    jobId,
    keptRuns: runs.length - candidates.length,
    deletedRuns: candidates.length,
    deletedFiles,
    dryRun,
  };
}

export function formatRunSummary(result: CoworkRunResult) {
  return `# Cowork Run: ${result.jobId}\n\n` +
    `- Started: ${result.startedAt}\n` +
    `- Finished: ${result.finishedAt}\n` +
    `- Duration: ${result.durationMs} ms\n` +
    `- Exit code: ${result.exitCode}\n` +
    `- CWD: ${result.cwd}\n` +
    `- Model: ${result.model ?? "default"}\n` +
    `- Tools: ${result.tools.join(", ")}\n\n` +
    `## Output\n\n${result.output || "(no output)"}\n\n` +
    `## Stderr\n\n${result.stderr || "(none)"}\n`;
}
