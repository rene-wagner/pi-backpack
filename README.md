# pi-subagent

A Pi package that provides a subagent orchestration skill and extension.

## Contents

- `skills/subagent-orchestration/SKILL.md` — guides when and how to use `single`, `parallel`, and `chain` subagents.
- `extensions/subagent/` — registers the `subagent` tool.

## Prerequisites

- Node.js `>=22.19.0`
- Pi Coding Agent compatible with `@earendil-works/pi-coding-agent@^0.78.0`
- npm for local development

For development, install dependencies first:

```bash
npm install
npm run check-types
```

## Install locally

From this repository's parent directory:

```bash
pi install ./pi-subagent
```

Or use it temporarily:

```bash
pi -e ./pi-subagent
```

Smoke test after installation:

```text
Use subagent orchestration: run one read-only subagent to summarize this repository's README.
```

## Subagent extension

The extension registers one tool, `subagent`, that spawns isolated `pi --mode json -p --no-session` processes.

Supported modes:

- `single` — one delegated task; default mode when `mode` is omitted
- `parallel` — independent subagents run concurrently
- `chain` — subagents run sequentially and receive previous outputs

### Tool parameters

| Parameter | Required | Description |
| --- | --- | --- |
| `mode` | No | `single`, `parallel`, or `chain`. Defaults to `single`. |
| `task` | Required for simple `single` calls unless `agents[]` is provided | Task text for a one-off subagent. |
| `agents` | Required for `parallel`/`chain` | Array of subagent definitions. In `single`, the first agent is used if `task` is omitted. |
| `systemPrompt` | No | Default extra system prompt inherited by agents without their own `systemPrompt`. |
| `model` | No | Default Pi model id inherited by agents without their own `model`. |
| `tools` | No | Default enabled tools inherited by agents without their own `tools`. Prefer the smallest read-only set needed. |
| `cwd` | No | Default working directory inherited by agents without their own `cwd`. Defaults to the caller context cwd. |

Each `agents[]` entry supports `name`, `task`, `systemPrompt`, `model`, `tools`, and `cwd`.

### Examples

Single investigation:

```json
{
  "mode": "single",
  "task": "Review README.md for missing setup steps. Do not edit files.",
  "tools": ["read"]
}
```

Parallel review:

```json
{
  "mode": "parallel",
  "agents": [
    {
      "name": "types-review",
      "task": "Review package.json, tsconfig.json, and extensions/subagent for TypeScript issues. Return concise findings with file paths."
    },
    {
      "name": "docs-review",
      "task": "Review README.md and skills/subagent-orchestration/SKILL.md for documentation gaps. Return concrete improvements."
    }
  ],
  "tools": ["read", "bash"]
}
```

Chained workflow:

```json
{
  "mode": "chain",
  "agents": [
    {
      "name": "analyzer",
      "task": "Identify likely causes of the reported bug. Return evidence and uncertainties."
    },
    {
      "name": "planner",
      "task": "Using previous outputs, propose the smallest safe fix and verification steps."
    },
    {
      "name": "reviewer",
      "task": "Critique the proposed fix for overengineering and missing checks."
    }
  ],
  "tools": ["read", "bash"]
}
```

### Behavior and failure handling

- `parallel` uses concurrent subagent processes.
- `chain` appends previous subagent outputs to later tasks and stops after the first non-zero exit code.
- The final tool response includes each subagent name, exit code, and output or stderr.
- If any subagent exits non-zero, the tool result is marked as an error.

### Troubleshooting

- **`pi` not found**: ensure the Pi CLI is installed and available in `PATH`.
- **Wrong files inspected**: set `cwd` explicitly for the subagent or agent entry.
- **Unknown model**: remove `model` or use a model id configured in your Pi installation.
- **Missing tools**: pass only tool ids available in the current Pi environment.
- **No useful output**: make the subagent task self-contained and specify the expected output format.

## Subagent orchestration skill

The `subagent-orchestration` skill teaches Pi how to decompose work before calling the `subagent` tool:

- use subagents only when isolation, independent reasoning, or parallelism adds value
- use `single` for one isolated investigation
- use `parallel` for independent work streams
- use `chain` for workflows where later agents build on earlier outputs
- keep subagent tasks self-contained with role, goal, scope, constraints, and output format
- prefer least-privilege tool access and do not delegate edits unless the user explicitly asked for delegated implementation
- synthesize subagent outputs into one final answer instead of pasting raw results
