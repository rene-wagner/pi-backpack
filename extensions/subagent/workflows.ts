import type { CustomAgentConfig } from "./agents.js";
import { runSubagent } from "./runner.js";
import { MAX_PARALLEL_SUBAGENTS, MAX_SUBAGENTS } from "./types.js";
import type {
  ResolvedSubagentTask,
  RunSubagentResult,
  SubagentTask,
  SubagentMode,
  SubagentParams,
  SubagentUpdate,
  WorkflowResult,
} from "./types.js";

export function resolveSubagentTasks(
  params: SubagentParams,
  defaultCwd: string,
  customAgents: CustomAgentConfig[] = [],
): { mode: SubagentMode; tasks: ResolvedSubagentTask[] } {
  const mode = params.mode ?? "single";
  const rawTasks: SubagentTask[] = params.agents?.length
    ? params.agents
    : "task" in params && params.task
      ? [{ task: params.task, ...(params.agent ? { agent: params.agent } : {}) }]
      : [];

  const agentsByName = new Map(
    customAgents.map((agent) => [agent.name, agent] as const),
  );

  const tasks = rawTasks.map((task, index) => {
    const customAgentName = task.agent;
    const customAgent = customAgentName
      ? agentsByName.get(customAgentName)
      : undefined;

    if (customAgentName && !customAgent) {
      const available = customAgents.map((agent) => agent.name).join(", ") || "none";
      throw new Error(
        `Unknown custom agent "${customAgentName}". Available custom agents: ${available}.`,
      );
    }

    const extraSystemPrompt = task.systemPrompt ?? params.systemPrompt;
    const systemPrompt = customAgent?.systemPrompt
      ? extraSystemPrompt
        ? `${customAgent.systemPrompt}\n\n${extraSystemPrompt}`
        : customAgent.systemPrompt
      : extraSystemPrompt;

    const model = task.model ?? params.model ?? customAgent?.model;
    const tools = task.tools ?? params.tools ?? customAgent?.tools;

    return {
      name: task.name ?? customAgent?.name ?? `agent-${index + 1}`,
      task: task.task,
      cwd: task.cwd ?? params.cwd ?? customAgent?.cwd ?? defaultCwd,
      ...(customAgentName ? { agent: customAgentName } : {}),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(model ? { model } : {}),
      ...(tools ? { tools } : {}),
    };
  });

  if (tasks.length === 0) {
    throw new Error("subagent needs either task or agents[].");
  }
  if (tasks.length > MAX_SUBAGENTS) {
    throw new Error(
      `subagent supports at most ${MAX_SUBAGENTS} agents per call.`,
    );
  }
  if (mode === "single" && tasks.length > 1) {
    return { mode, tasks: [tasks[0]!] };
  }

  return { mode, tasks };
}

export async function runSubagentWorkflow(options: {
  mode: SubagentMode;
  tasks: ResolvedSubagentTask[];
  signal?: AbortSignal;
  onUpdate?: SubagentUpdate;
}): Promise<WorkflowResult> {
  if (options.mode === "parallel") {
    return runParallelSubagents(options);
  }
  if (options.mode === "chain") {
    return runChainedSubagents(options);
  }

  const result = await runOne(options.tasks[0]!, options);
  return { mode: options.mode, results: [result] };
}

function emitStatus(
  onUpdate: SubagentUpdate | undefined,
  mode: SubagentMode,
  text: string,
) {
  onUpdate?.({
    content: [{ type: "text", text }],
    details: { mode, results: [] },
  });
}

async function runOne(
  task: ResolvedSubagentTask,
  options: {
    mode: SubagentMode;
    signal?: AbortSignal;
    onUpdate?: SubagentUpdate;
  },
): Promise<RunSubagentResult> {
  emitStatus(
    options.onUpdate,
    options.mode,
    `Spawning subagent ${task.name}...`,
  );
  try {
    return await runSubagent({
      ...task,
      ...(options.signal ? { signal: options.signal } : {}),
      onUpdate: (text) =>
        emitStatus(
          options.onUpdate,
          options.mode,
          `## ${task.name}\n\n${text}`,
        ),
    });
  } catch (error) {
    return {
      name: task.name,
      output: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
      messages: [],
    };
  }
}

async function runParallelSubagents(options: {
  mode: SubagentMode;
  tasks: ResolvedSubagentTask[];
  signal?: AbortSignal;
  onUpdate?: SubagentUpdate;
}): Promise<WorkflowResult> {
  const results = new Array<RunSubagentResult>(options.tasks.length);
  let nextTaskIndex = 0;

  async function worker() {
    while (nextTaskIndex < options.tasks.length) {
      const index = nextTaskIndex;
      nextTaskIndex += 1;
      results[index] = await runOne(options.tasks[index]!, options);
    }
  }

  const workerCount = Math.min(MAX_PARALLEL_SUBAGENTS, options.tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { mode: options.mode, results };
}

async function runChainedSubagents(options: {
  mode: SubagentMode;
  tasks: ResolvedSubagentTask[];
  signal?: AbortSignal;
  onUpdate?: SubagentUpdate;
}): Promise<WorkflowResult> {
  const results: RunSubagentResult[] = [];

  for (const task of options.tasks) {
    const taskWithContext = {
      ...task,
      task: appendPreviousOutputs(task.task, results),
    };
    const result = await runOne(taskWithContext, options);
    results.push(result);
    if (result.exitCode !== 0) break;
  }

  return { mode: options.mode, results };
}

function appendPreviousOutputs(
  task: string,
  previousResults: RunSubagentResult[],
): string {
  if (previousResults.length === 0) return task;

  const previousOutputs = previousResults
    .map(
      (result) =>
        `## ${result.name}\nExit code: ${result.exitCode}\n\n${result.output || result.stderr || "(no output)"}`,
    )
    .join("\n\n");

  return `${task}\n\nPrevious subagent outputs:\n\n${previousOutputs}`;
}
