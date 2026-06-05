import { expect, test } from "vitest";
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

  expect(resolved.mode).toBe("parallel");
  expect(resolved.tasks).toEqual([
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

  expect(resolved.mode).toBe("single");
  expect(resolved.tasks).toHaveLength(1);
  expect(resolved.tasks[0]?.task).toBe("first");
});

test("resolveSubagentTasks rejects empty calls", () => {
  expect(() => resolveSubagentTasks({}, "/repo")).toThrow(
    /subagent needs either task or agents\[\]\./,
  );
});

test("resolveSubagentTasks rejects too many agents", () => {
  expect(() =>
    resolveSubagentTasks(
      {
        mode: "parallel",
        agents: Array.from({ length: MAX_SUBAGENTS + 1 }, (_, index) => ({
          task: `task ${index}`,
        })),
      },
      "/repo",
    ),
  ).toThrow(/supports at most/);
});
