import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  discoverCustomAgents,
  formatCustomAgentsForPrompt,
} from "./agents.js";
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

function isProjectTrusted(ctx: object): boolean {
  const maybeTrusted = (ctx as { isProjectTrusted?: () => boolean }).isProjectTrusted;
  return typeof maybeTrusted === "function" ? maybeTrusted() : true;
}

function hasRequestedCustomAgent(params: { agent?: string; agents?: Array<{ agent?: string }> }) {
  return Boolean(
    params.agent || params.agents?.some((agent) => Boolean(agent.agent)),
  );
}

export function registerSubagentTool(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    if (!isProjectTrusted(ctx)) return;

    const { agents } = discoverCustomAgents(ctx.cwd);
    if (agents.length === 0) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n## Available Custom Subagents\n\nUse the \`subagent\` tool with \`agent: "<name>"\` when a task matches one of these trusted project-local agents from \`.pi/agents/\`:\n\n${formatCustomAgentsForPrompt(agents)}\n`,
    };
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Spawn one or more isolated Pi Coding Agent processes. Supports single, parallel, chained execution, and trusted project custom agents from .pi/agents/.",
    promptSnippet:
      "Spawn isolated Pi subagents for one-off, parallel, or chained delegated tasks.",
    promptGuidelines: [
      "Use subagent when a task benefits from an isolated context window or independent investigation.",
      "Use subagent with agent=<name> when a trusted project custom agent from .pi/agents matches the delegated task.",
      "Use subagent mode=parallel for independent investigations that can run at the same time.",
      "Use subagent mode=chain when each agent should build on previous subagent outputs.",
      "Keep subagent tasks self-contained and include role, goal, scope, constraints, and expected output.",
      "Prefer least-privilege, read-only tools for review tasks; do not delegate edits unless the user explicitly requested delegated implementation.",
    ],
    parameters: SubagentParamsSchema,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const trusted = isProjectTrusted(ctx);
      if (!trusted && hasRequestedCustomAgent(params)) {
        throw new Error(
          "Project custom agents from .pi/agents are only available for trusted projects.",
        );
      }

      const customAgents = trusted ? discoverCustomAgents(ctx.cwd).agents : [];
      const { mode, tasks } = resolveSubagentTasks(
        params,
        ctx.cwd,
        customAgents,
      );
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
