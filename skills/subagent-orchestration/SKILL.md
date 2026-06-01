---
name: subagent-orchestration
description: Guides the agent in decomposing tasks into single, parallel, or chained subagent executions using the subagent tool. Use when a task benefits from delegation, independent investigation, isolated context, or multi-step agent workflows.
license: MIT
---

# Subagent Orchestration

Use this skill when the task can benefit from isolated Pi subagents via the `subagent` tool.

The `subagent` tool is for delegation strategy. Keep the main agent responsible for deciding the workflow, merging results, and communicating the final answer.

## Core Rules

- Use subagents only when isolation, parallelism, or independent reasoning is useful.
- Keep each subagent task self-contained: include relevant files, goals, constraints, and expected output.
- Prefer a small number of focused subagents over many vague ones.
- Do not ask subagents to modify files unless the user explicitly wants delegated implementation.
- After subagents finish, synthesize their outputs. Do not simply paste raw results unless that is requested.
- If a subagent fails, report the failed agent and continue with available results when possible.

## Choosing a Mode

### `single`

Use `single` for one isolated task:

- independent investigation
- second opinion
- focused code review
- summarizing a large topic without polluting the main context
- exploring one possible solution path

Shape:

```json
{
  "mode": "single",
  "task": "Investigate ...",
  "systemPrompt": "Optional specialist instructions",
  "tools": ["read", "grep", "find", "ls"]
}
```

### `parallel`

Use `parallel` when sub-tasks are independent and can run concurrently:

- inspect different code areas
- compare multiple implementation approaches
- gather evidence from separate sources
- review from different perspectives, e.g. security, tests, architecture

Shape:

```json
{
  "mode": "parallel",
  "agents": [
    {
      "name": "api-review",
      "task": "Review the API layer for correctness and edge cases. Return concise findings with file paths."
    },
    {
      "name": "test-review",
      "task": "Review test coverage. Identify missing tests and risky untested behavior."
    }
  ],
  "tools": ["read", "grep", "find", "ls"]
}
```

### `chain`

Use `chain` when each step should build on previous outputs:

- analyze → plan → review
- diagnose → propose fix → critique fix
- research → evaluate → summarize
- broad scan → targeted deep dive → final recommendation

In chain mode, previous subagent outputs are appended to later subagent tasks automatically. Still make each task's role explicit.

Shape:

```json
{
  "mode": "chain",
  "agents": [
    {
      "name": "analyzer",
      "task": "Analyze the problem and identify likely causes. Return evidence and uncertainties."
    },
    {
      "name": "planner",
      "task": "Using previous outputs, propose a minimal implementation plan. Include risks."
    },
    {
      "name": "reviewer",
      "task": "Critically review the proposed plan. Look for overengineering and missing verification."
    }
  ]
}
```

## Task Prompt Template

When creating a subagent task, include:

1. Role: what perspective the subagent should take.
2. Goal: what question it must answer.
3. Scope: files, directories, or concepts to inspect.
4. Constraints: what not to change, assumptions, style requirements.
5. Output format: concise findings, plan, checklist, or recommendation.

Example:

```text
Role: test reviewer.
Goal: identify missing tests for the new subagent extension.
Scope: extensions/subagent and package scripts.
Constraints: do not edit files; only inspect. Prefer minimal test recommendations.
Output: bullet list with file paths and concrete verification steps.
```

## Synthesis Pattern

After subagents return:

1. Read all outputs.
2. Group agreements, conflicts, and unique findings.
3. Resolve conflicts using evidence from files or commands when needed.
4. Present a concise final answer or plan.
5. Mention limitations if subagents lacked context or tools.

## Anti-Patterns

Avoid using subagents when:

- the task is trivial or faster to solve directly
- the subagent would need extensive unstated context
- results must be tightly coordinated step-by-step by the main agent
- the user asked for a direct immediate answer
- parallel agents would duplicate the same work

Avoid vague tasks like:

```text
Look at the code and tell me what you think.
```

Prefer specific tasks like:

```text
Review extensions/subagent/workflows.ts for correctness of parallel and chain execution. Return only bugs, edge cases, and verification suggestions.
```
