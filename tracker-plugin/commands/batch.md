---
description: Fix open issues in batches — grouped by area of the code, one branch and one worktree per batch, one fixer and one commit per issue, the project's checks, then a draft pull request once you have seen the branch
argument-hint: '<triage:<run> | 12 15 | priority:P1 | axis:security | label:<name> | all> [--per-batch 5] [--group area|axis|none] [--max 30] [--model …] [--effort …]'
allowed-tools: Bash(node:*), Bash(git:*), Read, Agent, AskUserQuestion
---

# Batch: $ARGUMENTS

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs"` (below: `TRACKER`).

The selection takes the same tokens as `/tracker:triage`, plus `triage:<run>`: the issues a
finalized triage found still holding. **Prefer it**: fixing an issue that was already fixed
costs a whole agent for nothing.

1. Without arguments: ask what to fix, and suggest `/tracker:triage` first if no recent triage
   covers it. Stop.
2. **The plan**: `TRACKER batch plan <selection> [--per-batch n] [--group area|axis|none]
   [--max n]`. Batches group the issues by area of the code (first two path segments of their
   location) so that one branch touches one region; a group larger than `--per-batch` is cut;
   the most urgent batch comes first. Note `RUN=`, `BASE=` and `BATCHES=`. Nothing has
   changed yet.
3. Show the batches (id, area, issues with priority and location). **Ask** with
   `AskUserQuestion` which batches to fix now — one, several, or none — and whether the base
   `BASE=` is right. Say the cost: one agent per issue, one after the other within a batch.
4. For each chosen batch, **one batch at a time** (the guard protects one at a time):
   1. `TRACKER batch start <RUN> <B…> [--model …] [--effort …]` — creates the branch from the
      base in a worktree under `.tracker/worktrees/` (the user's working tree does not move),
      runs the project's setup commands there, and arms the guard: denied paths and commands,
      no commit on a protected branch, no push, no write to GitHub. Note `DIR=`, `BRANCH=`,
      `WORKTREE=`, `ISSUES=`, `LANG=`, `FIXER=`, `FIXER_MODEL=`. A failed setup command is
      shown: say it, the fixers may still work without it.
   2. For each number of `ISSUES=`, **one after the other** — they commit on the same branch —
      one agent of type `FIXER=`, with the Agent tool's `model` set to `FIXER_MODEL=` (omitted
      when `inherit`) and **without** `isolation` (the worktree exists), with this prompt:

      ```
      DIR=<the DIR= value>
      ISSUE=<number>
      WORKTREE=<the WORKTREE= value>
      BRANCH=<the BRANCH= value>
      LANG=<the LANG= value>
      ```

      Wait for each before launching the next. A skipped or failed issue does not stop the
      others.
   3. `TRACKER batch checks <RUN> <B…>` — the project's checks (`batch.checks`) in the
      worktree. `CHECKS=fail`: show the failing output; propose a fixer pass on the cause, or
      to leave the batch for the user.
   4. `TRACKER guard off` — **always**, even if an agent failed.
   5. `TRACKER batch status <RUN> <B…>` — per issue: fixed, not fixed and why, failed; commits;
      checks.
5. **The pull request**: for each batch with commits, show the branch (`git -C <WORKTREE> log
   --oneline <BASE>..<BRANCH>`, and the diff stat), then **ask** with `AskUserQuestion`: push
   and open a draft pull request, push only, or leave the branch local. Pushing publishes the
   branch; never skip this step.
6. `TRACKER batch finish <RUN> <B…> --push --pr` (or `--push` alone). The pull request goes to
   `batch.prBase` (default: the base), as a draft when `batch.draft` is set; its body lists
   `Closes #n` for the fixed issues and `Refs #n` for the others, and the checks. The issues
   close when the pull request reaches the default branch — not before.
7. Report in `LANG`: per batch, the branch, the pull request, the issues fixed and not fixed
   (why), the checks, what could not be verified, and the worktree path (to remove once
   merged: `git worktree remove <path>`). **Never merge.**
