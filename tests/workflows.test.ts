import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SUBAGENTS } from "../extensions/subagent/types.js";
import { resolveSubagentTasks } from "../extensions/subagent/workflows.js";

test("resolveSubagentTasks applies defaults and per-agent overrides", () => {
  const resolved = resolveSubagentTasks(
    {
      mode: "parallel",
      cwd: "/repo",
      model: "default-model",
      tools: ["read"],
      systemPrompt: "default prompt",
      agents: [
        { name: "a", task: "task a" },
        {
          name: "b",
          task: "task b",
          cwd: "/other",
          model: "other-model",
          tools: ["read", "bash"],
          systemPrompt: "other prompt",
        },
      ],
    },
    "/fallback",
  );

  assert.equal(resolved.mode, "parallel");
  assert.deepEqual(resolved.tasks, [
    {
      name: "a",
      task: "task a",
      cwd: "/repo",
      model: "default-model",
      tools: ["read"],
      systemPrompt: "default prompt",
    },
    {
      name: "b",
      task: "task b",
      cwd: "/other",
      model: "other-model",
      tools: ["read", "bash"],
      systemPrompt: "other prompt",
    },
  ]);
});

test("resolveSubagentTasks uses only the first agent in single mode", () => {
  const resolved = resolveSubagentTasks(
    {
      mode: "single",
      agents: [{ task: "first" }, { task: "second" }],
    },
    "/repo",
  );

  assert.equal(resolved.mode, "single");
  assert.equal(resolved.tasks.length, 1);
  assert.equal(resolved.tasks[0]?.task, "first");
});

test("resolveSubagentTasks rejects empty calls", () => {
  assert.throws(
    () => resolveSubagentTasks({}, "/repo"),
    /subagent needs either task or agents\[\]\./,
  );
});

test("resolveSubagentTasks rejects too many agents", () => {
  assert.throws(
    () =>
      resolveSubagentTasks(
        {
          mode: "parallel",
          agents: Array.from({ length: MAX_SUBAGENTS + 1 }, (_, index) => ({
            task: `task ${index}`,
          })),
        },
        "/repo",
      ),
    /supports at most/,
  );
});
