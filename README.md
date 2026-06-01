# pi-subagent

A Pi package that provides a subagent orchestration skill and extension.

## Contents

- `skills/subagent-orchestration/SKILL.md` — guides when and how to use `single`, `parallel`, and `chain` subagents.
- `extensions/subagent/` — registers the `subagent` tool.

## Subagent extension

The extension registers one tool, `subagent`, that spawns isolated `pi --mode json -p --no-session` processes.

Supported modes:

- `single` — one delegated task
- `parallel` — independent subagents run concurrently
- `chain` — subagents run sequentially and receive previous outputs

Tool parameters:

- `mode`
- `task`
- `agents`
- `systemPrompt`
- `model`
- `tools`
- `cwd`

## Subagent orchestration skill

The `subagent-orchestration` skill teaches Pi how to decompose work before calling the `subagent` tool:

- use `single` for one isolated investigation
- use `parallel` for independent work streams
- use `chain` for workflows where later agents build on earlier outputs
- synthesize subagent outputs into a final answer

## Install locally

From this repository's parent directory:

```bash
pi install ./pi-subagent
```

Or use it temporarily:

```bash
pi -e ./pi-subagent
```
