# pi-backpack

A Pi package that provides reusable Pi skills and extensions.

## Contents

- `skills/subagent-orchestration/SKILL.md` — guides when and how to use `single`, `parallel`, and `chain` subagents.
- `skills/git-worktrees/SKILL.md` — guides safe Git worktree creation, inspection, syncing, cleanup, and troubleshooting.
- `skills/code-review/SKILL.md` — guides structured code reviews for Gitea pull requests or local changes against `main`.
- `extensions/subagent/` — registers the `subagent` tool.
- `extensions/cowork/` — registers the `/cowork` command for recurring Pi agent jobs.

## Prerequisites

- Node.js `>=22.19.0`
- Pi Coding Agent compatible with `@earendil-works/pi-coding-agent@^0.78.0`
- npm for local development

For development, install dependencies first:

```bash
npm install
npm run check-types
npm test
```

## Install locally

From this repository's parent directory:

```bash
pi install ./pi-backpack
```

Or use it temporarily:

```bash
pi -e ./pi-backpack
```

Smoke tests after installation:

```text
Use subagent orchestration: run one read-only subagent to summarize this repository's README.
Use git worktrees: list this repository's worktrees and summarize the current status.
Use code review: review local changes against main.
/cowork status
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
| `agent` | No | Custom agent name from the trusted project `.pi/agents/` directory for simple `single` calls. |
| `mode` | No | `single`, `parallel`, or `chain`. Defaults to `single`. |
| `task` | Required for simple `single` calls unless `agents[]` is provided | Task text for a one-off subagent. |
| `agents` | Required for `parallel`/`chain` | Array of subagent definitions. In `single`, the first agent is used if `task` is omitted. Each entry can set `agent` to use a custom agent profile. |
| `systemPrompt` | No | Default extra system prompt inherited by agents without their own `systemPrompt`. |
| `model` | No | Default Pi model id inherited by agents without their own `model`. |
| `tools` | No | Default enabled tools inherited by agents without their own `tools`. Prefer the smallest read-only set needed. |
| `cwd` | No | Default working directory inherited by agents without their own `cwd`. Defaults to the caller context cwd. |

Each `agents[]` entry supports `name`, `agent`, `task`, `systemPrompt`, `model`, `tools`, and `cwd`.

### Project custom agents

Trusted projects can define reusable subagent profiles as Markdown files in `.pi/agents/*.md`:

```md
---
name: code-reviewer
description: Reviews TypeScript changes for bugs, edge cases, and missing tests.
tools: [read, bash]
model: anthropic/claude-sonnet-4-5
---

You are a strict code reviewer.
Do not edit files.
Return concise findings with file paths.
```

The extension lists available custom agents in the main agent's system prompt. Use them with `agent`:

```json
{
  "agent": "code-reviewer",
  "task": "Review extensions/subagent for correctness and missing tests."
}
```

Custom agent frontmatter fields:

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Tool-call name for the custom agent. |
| `description` | Yes | Routing hint shown to the main agent. |
| `tools` | No | Enabled tools for the subagent, as YAML array or comma-separated string. |
| `model` | No | Pi model id for the subagent. |
| `cwd` | No | Default working directory for the subagent. |

Explicit tool-call values override custom agent defaults. If both a custom agent prompt and an explicit `systemPrompt` are present, the explicit prompt is appended to the custom agent prompt.

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

- A call accepts at most 8 subagents.
- `parallel` runs at most 4 subagent processes concurrently.
- Project custom agents are discovered from the nearest `.pi/agents/` directory.
- Subagent stdout/stderr and assistant output are capped to avoid unbounded tool results.
- Spawn, cwd, abort, and other subprocess failures are returned as that subagent's result instead of dropping all sibling results.
- `chain` appends previous subagent outputs to later tasks and stops after the first non-zero exit code.
- The final tool response includes each subagent name, exit code, and output or stderr.
- If any subagent exits non-zero, the tool result is marked as an error.

### Troubleshooting

- **`pi` not found**: ensure the Pi CLI is installed and available in `PATH`.
- **Wrong files inspected**: set `cwd` explicitly for the subagent or agent entry.
- **Unknown custom agent**: check `.pi/agents/*.md` frontmatter has both `name` and `description`, and use the exact `name` value.
- **Unknown model**: remove `model` or use a model id configured in your Pi installation.
- **Missing tools**: pass only tool ids available in the current Pi environment.
- **No useful output**: make the subagent task self-contained and specify the expected output format.

## Cowork extension

The cowork extension registers `/cowork` to manage recurring Pi agent jobs. Jobs are stored under `~/.pi/agent/cowork/` and run isolated `pi --mode json -p --no-session` processes.

Initial commands:

```text
/cowork status
/cowork list
/cowork show daily-review
/cowork add daily-review every=24h cwd=. tools=read,grep,find,bash prompt="Review local changes and summarize risks."
/cowork edit daily-review model=sonnet:high every=1h
/cowork validate daily-review
/cowork failures
/cowork run daily-review
/cowork runs daily-review
/cowork last daily-review
/cowork start
/cowork stop
/cowork enable daily-review
/cowork disable daily-review
/cowork remove daily-review
```

The MVP scheduler runs in the foreground while the current Pi session is open. See `cowork-design.md` for the planned headless daemon follow-up.

## Code review skill

The `code-review` skill teaches Pi how to perform structured reviews in two modes:

- Gitea pull request review when the user provides a PR ID
- local review against `main` when no PR ID is provided

Findings are categorized as suggestion, todo, issue, nitpick, question, note, thought, discussion, or typo, and the skill includes review focus for PNPM, Docker, Renovate, Woodpecker, Helm, monorepos, Vue 2/3, Bootstrap 4/5, JavaScript/TypeScript, and SCSS.

## Git worktrees skill

The `git-worktrees` skill teaches Pi how to manage Git worktrees safely:

- inspect repository, branch, and worktree state before changing anything
- create isolated worktrees for new, existing, or remote branches
- inspect, sync, move, repair, remove, and prune worktrees
- protect uncommitted work and require explicit confirmation for destructive operations

## Subagent orchestration skill

The `subagent-orchestration` skill teaches Pi how to decompose work before calling the `subagent` tool:

- use subagents only when isolation, independent reasoning, or parallelism adds value
- use `single` for one isolated investigation
- use `parallel` for independent work streams
- use `chain` for workflows where later agents build on earlier outputs
- keep subagent tasks self-contained with role, goal, scope, constraints, and output format
- prefer least-privilege tool access and do not delegate edits unless the user explicitly asked for delegated implementation
- synthesize subagent outputs into one final answer instead of pasting raw results
