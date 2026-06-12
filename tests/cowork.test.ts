import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, expect, test } from "vitest";
import { CoworkScheduler, computeNextRunAt, isJobDue, parseIntervalMs } from "../extensions/cowork/scheduler.js";
import { getCoworkStorePaths, loadJobs, loadState, saveJobs, saveRunResult, saveState } from "../extensions/cowork/store.js";
import type { CoworkJob } from "../extensions/cowork/types.js";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cowork-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeJob(overrides: Partial<CoworkJob> = {}): CoworkJob {
  return {
    id: "daily-review",
    enabled: true,
    cwd: "/repo",
    every: "1h",
    prompt: "Review this repo.",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseIntervalMs accepts supported intervals", () => {
  expect(parseIntervalMs("30s")).toBe(30_000);
  expect(parseIntervalMs("5m")).toBe(300_000);
  expect(parseIntervalMs("1h")).toBe(3_600_000);
  expect(parseIntervalMs("2d")).toBe(172_800_000);
});

test("parseIntervalMs rejects invalid intervals", () => {
  expect(() => parseIntervalMs("0m")).toThrow(/positive/);
  expect(() => parseIntervalMs("5 minutes")).toThrow(/Invalid interval/);
  expect(() => parseIntervalMs("1w")).toThrow(/Invalid interval/);
});

test("computeNextRunAt uses last run when present", () => {
  expect(
    computeNextRunAt(makeJob(), {
      lastRunAt: "2026-06-12T12:00:00.000Z",
      consecutiveFailures: 0,
    }),
  ).toBe("2026-06-12T13:00:00.000Z");
});

test("isJobDue handles new jobs and runOnStart", () => {
  const now = new Date("2026-06-12T10:10:00.000Z");
  expect(isJobDue(makeJob(), undefined, now)).toBe(false);
  expect(isJobDue(makeJob({ runOnStart: true }), undefined, now)).toBe(true);
});

test("isJobDue returns true after nextRunAt", () => {
  const job = makeJob();
  expect(isJobDue(job, undefined, new Date("2026-06-12T10:59:00.000Z"))).toBe(false);
  expect(isJobDue(job, undefined, new Date("2026-06-12T11:00:00.000Z"))).toBe(true);
});

test("store roundtrips jobs and state", async () => {
  const paths = getCoworkStorePaths(makeTempDir());
  const jobs = [makeJob()];
  const state = { jobs: { "daily-review": { consecutiveFailures: 1, lastExitCode: 1 } } };

  await saveJobs(jobs, paths);
  await saveState(state, paths);

  expect(await loadJobs(paths)).toEqual(jobs);
  expect(await loadState(paths)).toEqual(state);
});

test("scheduler records invalid jobs without throwing", async () => {
  const paths = getCoworkStorePaths(makeTempDir());
  await saveJobs([makeJob({ every: "bad" })], paths);

  const scheduler = new CoworkScheduler(paths, { tickMs: 10 });
  await expect(scheduler.tick()).resolves.toBeUndefined();

  const state = await loadState(paths);
  expect(state.jobs["daily-review"]?.lastExitCode).toBe(1);
  expect(state.jobs["daily-review"]?.lastError).toMatch(/Invalid interval/);
});

test("saveRunResult writes json and markdown summary", async () => {
  const paths = getCoworkStorePaths(makeTempDir());
  const files = await saveRunResult(
    {
      jobId: "daily-review",
      startedAt: "2026-06-12T10:00:00.000Z",
      finishedAt: "2026-06-12T10:00:01.000Z",
      durationMs: 1000,
      exitCode: 0,
      output: "Done.",
      stderr: "",
      cwd: "/repo",
      tools: ["read"],
    },
    paths,
  );

  expect(JSON.parse(fs.readFileSync(files.jsonFile, "utf8"))).toMatchObject({ jobId: "daily-review", exitCode: 0 });
  expect(fs.readFileSync(files.summaryFile, "utf8")).toContain("Done.");
});
