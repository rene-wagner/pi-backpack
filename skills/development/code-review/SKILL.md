---
name: code-review
description: Performs structured code reviews for Gitea pull requests or local changes against main. Use this skill when the user asks for a code review, optionally provides a Gitea pull request ID, and wants findings categorized as suggestion, todo, issue, nitpick, question, note, thought, discussion, or typo.
license: MIT
---

# Code Review

Use this skill for code reviews in this project context. Do not edit files, do not create commits, and do not run destructive Git commands. For Gitea pull request reviews, checking out the pull request branch locally is expected, but only when the working tree is clean.

## Project Context

Pay special attention to these technologies and project conventions:

- PNPM
- Docker
- Renovate
- Woodpecker
- Helm
- Monorepo
- Vue 2 and Vue 3
- Bootstrap 4 and 5
- JavaScript and TypeScript
- SCSS

## Review Modes

### 1. Gitea Pull Request Code Review

If the user provides a Gitea pull request ID, review the changes in that pull request.

Workflow:

1. Inspect repository context:

```bash
git rev-parse --show-toplevel
git status --short --branch
git remote -v
```

2. Use the Gitea MCP server to collect pull request context before reviewing code:

   - Search for and connect to the available Gitea MCP server/tools via the `mcp` gateway.
   - Fetch pull request metadata for `<PR_ID>`:
     - title, description/body, state, draft status
     - source branch/repository and target branch/repository
     - author, assignees, reviewers, labels, milestone
     - commits, changed files, additions/deletions, and merge status if available
   - Fetch already written conversation comments, issue comments, review comments, inline code review annotations, and their author/timestamp/resolved state if available.
   - Use existing comments and review annotations as context: avoid duplicate findings, reference already discussed issues when relevant, and distinguish new findings from existing discussions.
   - If MCP is unavailable or lacks required tools/data, state this limitation and continue with Git-based inspection. Do not silently ignore missing Gitea context.

3. Before checking out the pull request branch, verify that the local working tree is clean:

```bash
git status --porcelain
```

If this command prints any local changes, abort the Gitea pull request review immediately. Do not stash, reset, discard, overwrite, or auto-commit anything. Tell the user that the PR branch cannot be checked out until local changes are committed, stashed, or otherwise handled by the user.

4. Fetch the current remote state without overwriting local changes:

```bash
git fetch --all --prune
```

5. Determine the pull request branch from Gitea MCP metadata whenever possible. Prefer the source branch and target branch reported by Gitea. If needed, fetch the PR ref as a fallback:

```bash
git fetch origin pull/<PR_ID>/head:refs/remotes/origin/pr/<PR_ID>
```

If the branch cannot be determined from MCP metadata or Gitea refs, ask the user for the missing source/target branch information. Use tokens only through MCP or API calls and never print them.

6. Check out the pull request branch locally. Prefer a local review branch that points at the fetched PR ref:

```bash
git switch -C review/pr-<PR_ID> origin/pr/<PR_ID>
```

If Gitea MCP metadata identifies a reliable source branch ref, use that ref instead of `origin/pr/<PR_ID>`. After checkout, verify the branch and status:

```bash
git status --short --branch
```

If checkout fails for any reason, abort and report the failure. Do not force checkout and do not discard local changes.

7. Determine the base branch from Gitea MCP metadata. If it is not known, use `main` as the target branch.
8. Inspect the diff and changed files from the checked-out pull request branch:

```bash
git diff --name-status origin/main...HEAD
git diff --stat origin/main...HEAD
git diff --find-renames origin/main...HEAD
```

Replace `origin/main` with the target branch from Gitea metadata.

### 2. Local Code Review

If no Gitea pull request ID was provided, review local changes against `main`.

Workflow:

1. Inspect repository context:

```bash
git rev-parse --show-toplevel
git status --short --branch
git remote -v
```

2. Update `main` if it is safe to do so:

```bash
git fetch origin main --prune
```

3. Inspect the diff against `main`:

```bash
git diff --name-status origin/main...HEAD
git diff --stat origin/main...HEAD
git diff --find-renames origin/main...HEAD
```

4. Also include uncommitted changes:

```bash
git diff --name-status
git diff --stat
git diff
git diff --cached --name-status
git diff --cached --stat
git diff --cached
```

If `origin/main` does not exist, use `main`. If `main` does not exist, ask for the correct base branch.

## Review Focus

Prioritize checking:

- Correctness, data flow, edge cases, and error handling
- Security risks, secret leaks, injection risks, authentication and authorization checks
- TypeScript/JavaScript typing, null/undefined cases, async and concurrency issues
- Vue 2/Vue 3 compatibility, lifecycle usage, reactivity, Composition/Options API, template bindings
- Bootstrap 4/Bootstrap 5 differences, responsive behavior, and accessibility
- SCSS scope, variables, specificity, and layout regression risks
- Monorepo impact, package boundaries, and PNPM workspace dependencies
- Docker, Helm, Woodpecker, and Renovate configuration changes
- Tests, missing coverage, and useful verification steps
- Backward compatibility, migrations, and rollout risks

## Categories

Use exactly these categories for findings:

| Icon | Label | Meaning |
| --- | --- | --- |
| 💡 | suggestion | Non-blocking improvement suggestion with clear benefit. |
| 🛠️ | todo | Small, simple, but necessary change. |
| 🚨 | issue | Concrete problem that must be fixed. |
| 🤏 | nitpick | Trivial, usually taste-based comment. |
| ❓ | question | Clarifying question about a possible problem. |
| ℹ️ | note | Noteworthy observation without required action. |
| 💭 | thought | Follow-up idea or thought from the review. |
| 💬 | discussion | Topic that needs input from multiple participants. |
| 🖋️ | typo | Spelling or typing mistake; blocking depends on context. |

## Finding Rules

- Report only concrete, evidence-backed findings. Avoid generic style comments.
- For Gitea pull request reviews, compare potential findings against existing PR comments and review annotations before reporting them.
- Every finding needs a file, line or diff context, category, impact, and concrete recommendation.
- Prefer `🚨 issue` or `🛠️ todo` for blocking findings.
- Use `❓ question` only when clarification is genuinely needed and there is a possible underlying problem.
- Use `🤏 nitpick` sparingly.
- If no relevant problems were found, say so clearly and briefly state what was checked.
- Distinguish confirmed problems from risks or assumptions.
- Suggest tests or commands for verification, but run expensive or mutating commands only after approval.

## Output Format

Respond in English and use this structure:

```markdown
## Code Review

Scope: <Gitea PR #ID against target-branch | local changes against main>
Reviewed: <short list of the most important files/areas>
Existing PR context: <summarize relevant existing comments/review annotations, or state unavailable/not applicable>

### Findings

1. 🚨 issue — <short title>
   - Location: `path/file.ext:<line>`
   - Problem: <concrete description>
   - Impact: <why this matters>
   - Recommendation: <concrete fix>

2. 💡 suggestion — <short title>
   - Location: `path/file.ext:<line>`
   - Problem: <concrete description>
   - Impact: <why this matters>
   - Recommendation: <concrete fix>

### Verification

- <useful checks/tests, e.g. pnpm test, pnpm lint, Docker/Helm dry-run>

### Notes

- <assumptions, limitations, areas not checked>
```

If there are no findings:

```markdown
## Code Review

Scope: <...>
Reviewed: <...>

No blocking findings found.

### Verification

- <recommended checks>

### Notes

- <limitations/assumptions>
```
