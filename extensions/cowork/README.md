# Cowork Extension

The Cowork extension adds a `/cowork` command for recurring Pi agent jobs.

Jobs are stored under:

```text
~/.pi/agent/cowork/
```

Runs are executed as isolated one-shot Pi processes:

```bash
pi --mode json -p --no-session ...
```

## Current status

This is the foreground MVP. The scheduler only runs while the current Pi session is open and `/cowork start` has been called.

## Commands

```text
/cowork status
/cowork list
/cowork add <id> every=<interval> prompt="..." [cwd=.] [tools=read,grep,find,ls] [model=...] [runOnStart=true]
/cowork run <id>
/cowork start
/cowork stop
/cowork enable <id>
/cowork disable <id>
/cowork remove <id>
```

## Add a job

Example:

```text
/cowork add readme-summary every=30s cwd=. tools=read,grep,find,ls prompt="Summarize the README in one short paragraph."
```

With a specific model:

```text
/cowork add daily-review every=24h cwd=. model=google/gemma-4-26b-a4b-it tools=read,grep,find,bash prompt="Review local changes and summarize risks."
```

The `model` value is passed to Pi as `--model <value>`, so model patterns such as `sonnet:high` can be used if they are valid in your Pi installation.

## Run a job manually

```text
/cowork run readme-summary
```

## Start the scheduler

```text
/cowork start
```

The scheduler checks for due jobs periodically. Stop it with:

```text
/cowork stop
```

## Storage layout

```text
~/.pi/agent/cowork/jobs.json
~/.pi/agent/cowork/state.json
~/.pi/agent/cowork/runs/<job-id>/<timestamp>.json
~/.pi/agent/cowork/runs/<job-id>/<timestamp>.summary.md
```

## Defaults

- `tools`: `read,grep,find,ls`
- `timeoutMs`: 30 minutes
- `concurrency`: `skip`
- `runOnStart`: `false`

Only `concurrency="skip"` is supported in the MVP.

## Intervals

Supported interval formats:

```text
30s
5m
1h
2d
```

## Notes

- Jobs are user-local for now.
- Project-local job files are not implemented yet.
- A headless daemon/CLI is planned as a follow-up.
