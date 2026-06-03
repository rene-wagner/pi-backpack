import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SubagentParamsSchema, type WorkflowResult } from "./types.js";
import { resolveSubagentTasks, runSubagentWorkflow } from "./workflows.js";

function formatSummary(results: WorkflowResult) {
  return results.results
    .map((result) => {
      const body = result.output || result.stderr || "(no output)";
      return `## ${result.name}\nExit code: ${result.exitCode}\n\n${body}`;
    })
    .join("\n\n");
}

export function registerSubagentTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Spawn one or more isolated Pi Coding Agent processes. Supports single, parallel, and chained execution.",
    promptSnippet:
      "Spawn isolated Pi subagents for one-off, parallel, or chained delegated tasks.",
    promptGuidelines: [
      "Use subagent when a task benefits from an isolated context window or independent investigation.",
      "Use subagent mode=parallel for independent investigations that can run at the same time.",
      "Use subagent mode=chain when each agent should build on previous subagent outputs.",
      "Keep subagent tasks self-contained and include role, goal, scope, constraints, and expected output.",
      "Prefer least-privilege, read-only tools for review tasks; do not delegate edits unless the user explicitly requested delegated implementation.",
    ],
    parameters: SubagentParamsSchema,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const { mode, tasks } = resolveSubagentTasks(params, ctx.cwd);
      const workflow = await runSubagentWorkflow({
        mode,
        tasks,
        ...(signal ? { signal } : {}),
        ...(onUpdate ? { onUpdate } : {}),
      });
      const hasErrors = workflow.results.some(
        (result) => result.exitCode !== 0,
      );

      return {
        content: [{ type: "text", text: formatSummary(workflow) }],
        details: workflow,
        ...(hasErrors ? { isError: true } : {}),
      };
    },
  });
}
