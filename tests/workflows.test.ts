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

test("resolveSubagentTasks applies custom agent defaults", () => {
  const resolved = resolveSubagentTasks(
    {
      agent: "reviewer",
      task: "review this",
    },
    "/repo",
    [
      {
        name: "reviewer",
        description: "Reviews code.",
        tools: ["read"],
        model: "agent-model",
        cwd: "/agent-cwd",
        systemPrompt: "agent prompt",
        filePath: "/repo/.pi/agents/reviewer.md",
      },
    ],
  );

  expect(resolved.tasks).toEqual([
    {
      name: "reviewer",
      agent: "reviewer",
      task: "review this",
      cwd: "/agent-cwd",
      model: "agent-model",
      tools: ["read"],
      systemPrompt: "agent prompt",
    },
  ]);
});

test("resolveSubagentTasks lets explicit values override custom agent defaults", () => {
  const resolved = resolveSubagentTasks(
    {
      agents: [
        {
          name: "explicit-name",
          agent: "reviewer",
          task: "review this",
          cwd: "/explicit-cwd",
          model: "explicit-model",
          tools: ["read", "bash"],
          systemPrompt: "extra prompt",
        },
      ],
    },
    "/repo",
    [
      {
        name: "reviewer",
        description: "Reviews code.",
        tools: ["read"],
        model: "agent-model",
        cwd: "/agent-cwd",
        systemPrompt: "agent prompt",
        filePath: "/repo/.pi/agents/reviewer.md",
      },
    ],
  );

  expect(resolved.tasks[0]).toEqual({
    name: "explicit-name",
    agent: "reviewer",
    task: "review this",
    cwd: "/explicit-cwd",
    model: "explicit-model",
    tools: ["read", "bash"],
    systemPrompt: "agent prompt\n\nextra prompt",
  });
});

test("resolveSubagentTasks rejects unknown custom agents", () => {
  expect(() =>
    resolveSubagentTasks({ agent: "missing", task: "work" }, "/repo", []),
  ).toThrow(/Unknown custom agent "missing"/);
});
