---
description: Fix open issues in batches — grouped by area of the code, one branch and one worktree per batch, one fixer per issue or per batch and one commit per issue, the project's checks, then a draft pull request once you have seen the branch
argument-hint: '<triage:<run> | 12 15 | priority:P1 | axis:security | label:<name> | all> [--per-batch 5] [--group area|axis|none] [--max 30] [--fixer issue|batch] [--model …] [--effort …]'
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
   [--max n] [--fixer issue|batch]`. Batches group the issues by area of the code (first two
   path segments of their location) so that one branch touches one region; a group larger
   than `--per-batch` is cut; the most urgent batch comes first. Note `RUN=`, `BASE=`,
   `BATCHES=`, `FIXER_SCOPE=` and `AGENTS=`. Each issue carries the last triage that found
   it holding, when there is one: the fixer starts from its evidence. Nothing has changed
   yet. A `DROPPED=` line means the selection matched more than `--max`: the issues
   it lists are not in the plan — say so, with their numbers.
3. Show the batches (id, area, issues with priority and location). **Ask** with
   `AskUserQuestion` which batches to fix now — one, several, or none — and whether the base
   `BASE=` is right. Say the cost: relay the `Cost:` line — `--fixer batch` (or
   `batch.fixer`) gives one fixer per batch instead of one per issue: the batch's code is
   read once.
4. For each chosen batch, **one batch at a time** (the guard protects one at a time):
   1. `TRACKER batch start <RUN> <B…> [--fixer issue|batch] [--model …] [--effort …]` —
      creates the branch from the base in a worktree under `.tracker/worktrees/` (the user's
      working tree does not move), runs the project's setup commands there, and arms the
      guard: denied paths and commands, no commit on a protected branch, no push, no write to
      GitHub. Note `DIR=`, `BRANCH=`, `WORKTREE=`, `ISSUES=`, `FIXER_SCOPE=`, `LANG=`,
      `FIXER=`, `FIXER_MODEL=`. A failed setup command is shown: say it, the fixers may still
      work without it.
   2. `FIXER_SCOPE=issue`: for each number of `ISSUES=`, **one after the other** — they commit
      on the same branch — one agent with `ISSUES=<that number>`. `FIXER_SCOPE=batch`: a
      single agent with `ISSUES=<the ISSUES= value>`; it takes them in order, one commit each.
      Either way, an agent of type `FIXER=`, with the Agent tool's `model` set to
      `FIXER_MODEL=` (omitted when `inherit`) and **without** `isolation` (the worktree
      exists), with this prompt:

      ```
      DIR=<the DIR= value>
      ISSUES=<number, or the whole ISSUES= value>
      WORKTREE=<the WORKTREE= value>
      BRANCH=<the BRANCH= value>
      LANG=<the LANG= value>
      ```

      Wait for each agent before launching the next. A skipped or failed issue does not stop the
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

## Not a git repository yet

Whenever a `tracker.mjs` command exits with code 3 and prints a `REPO=` line, this section
applies instead of stopping on the error. The tracker works on the project's GitHub
repository through the GitHub CLI, and on its history. Below, `TRACKER` is
`node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs"`.

- `REPO=no-git`: git is not installed or not on the PATH. Say so, and stop.
- `REPO=none` (no repository) or `REPO=empty` (a repository without a commit):
  1. `TRACKER repo plan` — it creates nothing. Show its lines: how many files a first commit
     would hold (the `.gitignore` applies) and the flagged ones (`.env`, keys,
     `node_modules/`, build output, large files).
  2. **Ask** with `AskUserQuestion`, saying the folder is not a git repository yet and that
     the command needs one:
     - "Create the repository and commit these files" → `TRACKER repo init --commit`;
     - "Create the repository only — I will commit myself" → `TRACKER repo init`, then stop;
     - "Cancel" → stop.

     If files were flagged, name them in the question and suggest adding a `.gitignore`
     first (then run `repo plan` again). **Never create a repository, and never commit,
     without that answer.**
  3. Then run the command that failed again: it may now stop on `REPO=no-remote`.
- `REPO=no-remote`: the repository has no remote, so there are no GitHub issues to work on.
  **Ask** with `AskUserQuestion`:
  - "Create a private GitHub repository and push the code" → `TRACKER repo github`;
  - "I will add a remote myself" (`git remote add origin <url>`, then push) → stop;
  - "Cancel" → stop.

  Creating the GitHub repository **publishes the code** (privately, under the account `gh`
  is logged in with): say it in the question, and never run `repo github` without that
  explicit answer — nor with `--public` unless the user asked for a public repository.
  Then run the command that failed again.
