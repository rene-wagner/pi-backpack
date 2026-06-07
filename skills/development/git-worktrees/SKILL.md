---
name: git-worktrees
description: Helps with Git worktree workflows for creating, listing, inspecting, moving, removing, pruning, syncing, and troubleshooting worktrees. Use when the user wants a separate checkout for a branch, parallel feature work, review or testing in another tree, cleanup of stale worktrees, or help with Git worktree errors.
license: MIT
---

# Git Worktrees

Use this skill when working with Git worktrees. The goal is to isolate branch work safely without losing local changes or corrupting Git's worktree metadata.

## Core Rules

- Start by establishing context before changing anything:
  - repository root: `git rev-parse --show-toplevel`
  - current branch/status: `git status --short --branch`
  - all worktrees: `git worktree list --porcelain`
- Preserve uncommitted work. Never discard, overwrite, remove, prune, force-remove, force-reset, or delete branches unless the user explicitly confirms the exact target.
- Prefer explicit paths and branches. If branch, base branch, or target path is ambiguous, ask the user via `ask_user`.
- Use `git -C <path> ...` when inspecting a specific worktree.
- Quote paths in shell commands.
- Prefer a sibling directory for new worktrees when no path is specified: `../<repo>-<branch-slug>`.
- After every create/move/remove operation, verify with `git worktree list --porcelain` and `git -C <path> status --short --branch` when the path still exists.

## Standard Workflow

1. Inspect current state:

```bash
git rev-parse --show-toplevel
git status --short --branch
git worktree list --porcelain
```

2. Clarify missing inputs:
   - target action: create, list, inspect, move, remove, prune, repair, sync
   - branch name
   - base commit/branch (`main`, `master`, current branch, or remote branch)
   - target path
   - whether dependency installation or tests should run in the new worktree

3. Execute the smallest safe command.
4. Verify and report the resulting path, branch, and status.

## Creating Worktrees

### New branch from a base

Use when the user wants a new isolated branch:

```bash
git fetch --prune
git worktree add -b <new-branch> "<path>" <base-branch-or-commit>
git -C "<path>" status --short --branch
```

### Existing local branch

Use only if that branch is not already checked out in another worktree:

```bash
git worktree add "<path>" <branch>
git -C "<path>" status --short --branch
```

If Git reports that the branch is already checked out elsewhere, do not force anything. Offer one of:

- use the existing worktree path
- create a new branch from that branch: `git worktree add -b <new-branch> "<path>" <branch>`
- create a detached worktree for read-only inspection: `git worktree add --detach "<path>" <branch>`

### Remote branch

After fetching, create a local tracking branch if needed:

```bash
git fetch --prune
git worktree add --track -b <local-branch> "<path>" origin/<remote-branch>
git -C "<path>" status --short --branch
```

If the local branch already exists and is not checked out elsewhere, use `git worktree add "<path>" <local-branch>` instead.

## Inspecting and Syncing

Useful checks:

```bash
git worktree list --porcelain
git -C "<path>" status --short --branch
git -C "<path>" branch --show-current
git -C "<path>" log --oneline --decorate -n 10
git -C "<path>" remote -v
```

For updates, prefer the repository's normal workflow. If no project-specific instructions exist:

```bash
git -C "<path>" fetch --prune
git -C "<path>" pull --ff-only
```

Use rebase, merge, or reset only when the user asks for that strategy.

## Moving Worktrees

Use Git's metadata-aware move command instead of moving directories manually:

```bash
git worktree move "<old-path>" "<new-path>"
git worktree list --porcelain
git -C "<new-path>" status --short --branch
```

If a worktree was moved manually and Git metadata is broken, try:

```bash
git worktree repair "<path>"
git worktree list --porcelain
```

## Removing and Cleaning Up

Before removing any worktree:

```bash
git -C "<path>" status --short --branch
git worktree list --porcelain
```

If the target has uncommitted or untracked changes, stop and ask the user what to do: commit, stash, keep, or remove anyway. Do not decide silently.

Safe removal for a clean target:

```bash
git worktree remove "<path>"
git worktree list --porcelain
```

Only use force after explicit confirmation and after reporting exactly what will be lost:

```bash
git worktree remove --force "<path>"
```

Prune stale administrative entries only after a dry run:

```bash
git worktree prune --dry-run
git worktree prune
```

Deleting the associated branch is a separate action. Confirm it explicitly:

```bash
git branch -d <branch>
```

Use `git branch -D <branch>` only if the user explicitly accepts deleting an unmerged branch.

## Locking Long-Lived Worktrees

For worktrees on removable drives or long-lived environments:

```bash
git worktree lock --reason "<reason>" "<path>"
git worktree unlock "<path>"
```

Mention locks when cleanup/prune does not affect a worktree.

## Troubleshooting Patterns

- **Branch already checked out**: inspect `git worktree list --porcelain`; use the existing worktree or create a new branch/detached worktree.
- **Stale path in list**: run `git worktree prune --dry-run`; only prune after confirming it is stale.
- **Metadata mismatch after manual move**: run `git worktree repair "<path>"`.
- **Dirty worktree blocks removal**: show `git -C "<path>" status --short --branch`; ask whether to commit, stash, keep, or force-remove.
- **Wrong base branch**: stop before creating; ask the user to choose the base.

## Reporting Format

When finished, respond with:

- worktree path
- branch/commit
- status summary
- commands run, especially destructive or structural Git commands
- any remaining manual steps, such as installing dependencies or running tests in the new worktree
