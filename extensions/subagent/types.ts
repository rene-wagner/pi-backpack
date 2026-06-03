import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

export const SubagentModeSchema = Type.Union([
  Type.Literal("single"),
  Type.Literal("parallel"),
  Type.Literal("chain"),
]);

export const MAX_SUBAGENTS = 8;
export const MAX_PARALLEL_SUBAGENTS = 4;
export const MAX_OUTPUT_CHARS = 20_000;
export const MAX_STDERR_CHARS = 8_000;
export const MAX_BUFFER_CHARS = 65_536;
export const MAX_MESSAGES = 20;

export const SubagentTaskSchema = Type.Object({
  name: Type.Optional(
    Type.String({
      description: "Optional human-readable name for this subagent.",
    }),
  ),
  task: Type.String({ description: "Task for this subagent." }),
  systemPrompt: Type.Optional(
    Type.String({
      description: "Optional extra system prompt for this subagent.",
    }),
  ),
  model: Type.Optional(
    Type.String({ description: "Optional Pi model id for this subagent." }),
  ),
  tools: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional list of tools enabled for this subagent.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Optional working directory for this subagent.",
    }),
  ),
});

export const SubagentParamsSchema = Type.Object({
  mode: Type.Optional(
    Type.Union(
      [Type.Literal("single"), Type.Literal("parallel"), Type.Literal("chain")],
      {
        description:
          "Execution mode. Defaults to single. parallel and chain require agents[].",
      },
    ),
  ),
  task: Type.Optional(
    Type.String({
      description:
        "Task for a single subagent. Required unless agents[] is provided.",
    }),
  ),
  agents: Type.Optional(
    Type.Array(SubagentTaskSchema, {
      minItems: 1,
      maxItems: MAX_SUBAGENTS,
      description:
        "Agents to run for parallel or chain mode. In single mode the first entry is used if task is omitted.",
    }),
  ),
  systemPrompt: Type.Optional(
    Type.String({ description: "Default extra system prompt for subagents." }),
  ),
  model: Type.Optional(
    Type.String({ description: "Default Pi model id for subagents." }),
  ),
  tools: Type.Optional(
    Type.Array(Type.String(), {
      description: "Default list of tools enabled for subagents.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Default working directory for subagents." }),
  ),
});

export type SubagentMode = Static<typeof SubagentModeSchema>;
export type SubagentTask = Static<typeof SubagentTaskSchema>;
export type SubagentParams = Static<typeof SubagentParamsSchema>;

export interface ResolvedSubagentTask {
  name: string;
  task: string;
  cwd: string;
  systemPrompt?: string;
  model?: string;
  tools?: string[];
}

export interface RunSubagentInput extends ResolvedSubagentTask {
  signal?: AbortSignal;
  onUpdate?: (text: string) => void;
}

export interface RunSubagentResult {
  name: string;
  output: string;
  stderr: string;
  exitCode: number;
  messages: unknown[];
}

export interface WorkflowResult {
  mode: SubagentMode;
  results: RunSubagentResult[];
}

export type SubagentUpdate = AgentToolUpdateCallback<WorkflowResult>;
