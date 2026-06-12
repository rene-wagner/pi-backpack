import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CoworkJob, CoworkRunResult, CoworkState, CoworkStorePaths } from "./types.js";

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

export async function saveRunResult(
  result: CoworkRunResult,
  paths = getCoworkStorePaths(),
): Promise<{ jsonFile: string; summaryFile: string }> {
  const runDir = path.join(paths.runsDir, safeFilePart(result.jobId));
  await fs.promises.mkdir(runDir, { recursive: true });
  const stamp = safeFilePart(result.startedAt);
  const jsonFile = path.join(runDir, `${stamp}.json`);
  const summaryFile = path.join(runDir, `${stamp}.summary.md`);

  await writeJson(jsonFile, result);
  await fs.promises.writeFile(summaryFile, formatRunSummary(result), "utf8");
  return { jsonFile, summaryFile };
}

function formatRunSummary(result: CoworkRunResult) {
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
