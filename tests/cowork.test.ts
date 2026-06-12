import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, expect, test } from "vitest";
import { registerCoworkCommand } from "../extensions/cowork/command.js";
import { CoworkScheduler, computeNextRunAt, isJobDue, parseIntervalMs } from "../extensions/cowork/scheduler.js";
import { getCoworkStorePaths, listRunResults, loadJobs, loadState, saveJobs, saveRunResult, saveState } from "../extensions/cowork/store.js";
import type { CoworkJob } from "../extensions/cowork/types.js";

const tempDirs: string[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

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
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function registerCoworkForTest(agentDir: string) {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  let handler: ((args: string, ctx: { cwd: string; ui: { notify: (message: string, level?: string) => void } }) => Promise<void>) | undefined;
  const messages: Array<{ message: string; level?: string }> = [];

  registerCoworkCommand({
    registerCommand: (_name: string, options: { handler: typeof handler }) => {
      handler = options.handler;
    },
  } as never);

  return {
    messages,
    async run(args: string, cwd = agentDir) {
      if (!handler) throw new Error("cowork command was not registered");
      await handler(args, {
        cwd,
        ui: {
          notify: (message, level) => messages.push({ message, ...(level ? { level } : {}) }),
        },
      });
      return messages.at(-1)?.message ?? "";
    },
  };
}

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

test("cowork command adds, shows, and edits jobs", async () => {
  const agentDir = makeTempDir();
  const command = registerCoworkForTest(agentDir);

  await command.run('add review every=1h cwd=. model=sonnet:high tools=read,grep prompt="Review local changes" runOnStart=true');
  let jobs = await loadJobs(getCoworkStorePaths(path.join(agentDir, "cowork")));
  expect(jobs[0]).toMatchObject({
    id: "review",
    every: "1h",
    model: "sonnet:high",
    tools: ["read", "grep"],
    prompt: "Review local changes",
    runOnStart: true,
  });

  const showBefore = await command.run("show review");
  expect(showBefore).toContain("Model: sonnet:high");
  expect(showBefore).toContain("Prompt:\nReview local changes");

  await command.run('edit review every=2h model=default tools=read,find prompt="New prompt" enabled=false');
  jobs = await loadJobs(getCoworkStorePaths(path.join(agentDir, "cowork")));
  expect(jobs[0]).toMatchObject({ every: "2h", tools: ["read", "find"], prompt: "New prompt", enabled: false });
  expect(jobs[0]?.model).toBeUndefined();
});

test("cowork command validates jobs and reports failures", async () => {
  const agentDir = makeTempDir();
  const paths = getCoworkStorePaths(path.join(agentDir, "cowork"));
  const command = registerCoworkForTest(agentDir);

  await saveJobs(
    [
      makeJob({ id: "valid", cwd: agentDir, tools: ["read"] }),
      makeJob({ id: "broken", cwd: path.join(agentDir, "missing"), every: "bad", prompt: "", tools: [] }),
    ],
    paths,
  );
  await saveState(
    {
      jobs: {
        broken: {
          consecutiveFailures: 2,
          lastExitCode: 1,
          lastError: "Boom",
          lastRunAt: "2026-06-12T10:00:00.000Z",
        },
      },
    },
    paths,
  );

  const validation = await command.run("validate");
  expect(validation).toContain("✓ valid: valid");
  expect(validation).toContain("✗ broken");
  expect(validation).toContain("Invalid interval");
  expect(validation).toContain("cwd does not exist");

  const failures = await command.run("failures");
  expect(failures).toContain("broken: failures=2");
  expect(failures).toContain("error=Boom");
});

test("cowork status includes failure and next-due details", async () => {
  const agentDir = makeTempDir();
  const paths = getCoworkStorePaths(path.join(agentDir, "cowork"));
  const command = registerCoworkForTest(agentDir);

  await saveJobs([makeJob({ id: "review", cwd: agentDir })], paths);
  await saveState(
    {
      jobs: {
        review: {
          consecutiveFailures: 1,
          lastError: "Failed",
          nextRunAt: "2026-06-12T11:00:00.000Z",
        },
      },
    },
    paths,
  );

  const status = await command.run("status");
  expect(status).toContain("Jobs: 1 (1 enabled, 0 disabled)");
  expect(status).toContain("Failures: review(1)");
  expect(status).toContain("Next due: review=2026-06-12T11:00:00.000Z");
});

test("cowork command cleans up old runs", async () => {
  const agentDir = makeTempDir();
  const paths = getCoworkStorePaths(path.join(agentDir, "cowork"));
  const command = registerCoworkForTest(agentDir);

  await saveJobs([makeJob({ id: "review" })], paths);
  for (const startedAt of [
    "2026-06-12T09:00:00.000Z",
    "2026-06-12T10:00:00.000Z",
    "2026-06-12T11:00:00.000Z",
  ]) {
    await saveRunResult(
      {
        jobId: "review",
        startedAt,
        finishedAt: startedAt,
        durationMs: 1,
        exitCode: 0,
        output: startedAt,
        stderr: "",
        cwd: "/repo",
        tools: ["read"],
      },
      paths,
    );
  }

  const dryRun = await command.run("cleanup review keep=1 dryRun=true");
  expect(dryRun).toContain("Would delete 2 run(s)");
  expect(await listRunResults("review", paths)).toHaveLength(3);

  const cleanup = await command.run("cleanup review keep=1");
  expect(cleanup).toContain("Deleted 2 run(s)");
  const remaining = await listRunResults("review", paths);
  expect(remaining).toHaveLength(1);
  expect(remaining[0]?.startedAt).toBe("2026-06-12T11:00:00.000Z");
});

test("cowork command lists runs and latest run", async () => {
  const agentDir = makeTempDir();
  const paths = getCoworkStorePaths(path.join(agentDir, "cowork"));
  const command = registerCoworkForTest(agentDir);

  await saveJobs([makeJob({ id: "review" })], paths);
  await saveRunResult(
    {
      jobId: "review",
      startedAt: "2026-06-12T10:00:00.000Z",
      finishedAt: "2026-06-12T10:00:01.000Z",
      durationMs: 1000,
      exitCode: 0,
      output: "First.",
      stderr: "",
      cwd: "/repo",
      tools: ["read"],
    },
    paths,
  );
  await saveRunResult(
    {
      jobId: "review",
      startedAt: "2026-06-12T11:00:00.000Z",
      finishedAt: "2026-06-12T11:00:02.000Z",
      durationMs: 2000,
      exitCode: 1,
      output: "Second.",
      stderr: "Failed.",
      cwd: "/repo",
      model: "sonnet:high",
      tools: ["read"],
    },
    paths,
  );

  const runs = await command.run("runs review");
  expect(runs.split("\n")[0]).toContain("2026-06-12T11:00:00.000Z");
  expect(runs).toContain("exit=1");

  const last = await command.run("last review");
  expect(last).toContain("Second.");
  expect(last).toContain("Failed.");
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
