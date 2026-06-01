import { runSubagent } from "./runner.js";
import type {
  ResolvedSubagentTask,
  RunSubagentResult,
  SubagentMode,
  SubagentParams,
  SubagentUpdate,
  WorkflowResult,
} from "./types.js";

export function resolveSubagentTasks(
  params: SubagentParams,
  defaultCwd: string,
): { mode: SubagentMode; tasks: ResolvedSubagentTask[] } {
  const mode = params.mode ?? "single";
  const rawTasks = params.agents?.length
    ? params.agents
    : params.task
      ? [{ task: params.task }]
      : [];

  const tasks = rawTasks.map((task, index) => ({
    name: task.name ?? `agent-${index + 1}`,
    task: task.task,
    cwd: task.cwd ?? params.cwd ?? defaultCwd,
    ...(task.systemPrompt ?? params.systemPrompt
      ? { systemPrompt: task.systemPrompt ?? params.systemPrompt }
      : {}),
    ...(task.model ?? params.model ? { model: task.model ?? params.model } : {}),
    ...(task.tools ?? params.tools ? { tools: task.tools ?? params.tools } : {}),
  }));

  if (tasks.length === 0) {
    throw new Error("subagent needs either task or agents[].");
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
  onUpdate?.({ content: [{ type: "text", text }], details: { mode, results: [] } });
}

async function runOne(
  task: ResolvedSubagentTask,
  options: { mode: SubagentMode; signal?: AbortSignal; onUpdate?: SubagentUpdate },
): Promise<RunSubagentResult> {
  emitStatus(options.onUpdate, options.mode, `Spawning subagent ${task.name}...`);
  return runSubagent({
    ...task,
    ...(options.signal ? { signal: options.signal } : {}),
    onUpdate: (text) =>
      emitStatus(options.onUpdate, options.mode, `## ${task.name}\n\n${text}`),
  });
}

async function runParallelSubagents(options: {
  mode: SubagentMode;
  tasks: ResolvedSubagentTask[];
  signal?: AbortSignal;
  onUpdate?: SubagentUpdate;
}): Promise<WorkflowResult> {
  const results = await Promise.all(
    options.tasks.map((task) => runOne(task, options)),
  );
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
