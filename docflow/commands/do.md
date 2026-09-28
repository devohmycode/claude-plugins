---
description: Implement the next unit of TASKS.md — a sprint or a task — on its own branch, with the project's checks after each task, the task ticked and committed by the script, the sprint's acceptance test, and a draft pull request
argument-hint: '<next|S<n>|S<n>-T<m>> [--resume] [--unit task|sprint] [--implementer task|sprint|session] [--worktree|--in-place]'
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Agent, AskUserQuestion
---

Below, `DOCFLOW` is `node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs"`. The script does all
the mechanics — lock, branch, worktree, checks, ticks, commits, push, pull request — and a
guard refuses, during the run, pushes to the default branch, `gh pr merge` and edits of the
approved documents. You write code; you never tick `TASKS.md`, commit, push or merge yourself.

## 1. Start

Run `DOCFLOW do start <unit>` with the user's arguments (`$ARGUMENTS`; the unit defaults to
`next`; `--resume` alone continues the current run). On a non-zero exit:

- `ERROR=docs-uncommitted` (`UNCOMMITTED=` lists them): **ask** whether to commit the
  documents on the current branch now; on yes, run the same command with `--commit-docs`.
- `ERROR=dirty`: tracked files have changes. Ask: commit or stash them yourself, or run in a
  separate worktree (`--worktree`).
- Exit 4 (`GATE=TASKS`): TASKS.md is not approved — relay the message, stop.
- `ERROR=nothing`: every task is ticked or waits in a draft pull request — say so, stop.
- `ERROR=run-active`: a run is already in progress — offer `/docflow:do --resume`.
- Exit 75: `lock-busy` — another session runs docflow here; relay, stop. `lock-expired` —
  **ask** whether to take the lock over; on yes, run again with `--takeover`.
- Exit 3 (`REPO=`): the section "Not a git repository yet" below.

Then read `UNIT`, `KIND`, `TASKS` (still to do, in order), `ACCEPTANCE` (1: a sprint's test
to run at the end), `BRANCH`, `WORKDIR`, `IMPLEMENTER`, `AGENT`, `MODEL` and `CHECKS`. When
`CHECKS` is empty, **ask** the user for the command that tests the project, then
`DOCFLOW config checks "<command>"` (saved for the next runs).

## 2. Each task of `TASKS`, in order

With `IMPLEMENTER=session` (the default — the code you read stays loaded):

1. `DOCFLOW task show <id>` prints the task and the sections its `Refs` point to: that is the
   whole specification of the task; do not open the documents.
2. Implement it in `WORKDIR`: absolute paths for Read/Edit/Write, `cd "<WORKDIR>" &&` before
   each command. Follow the project's `CLAUDE.md`. Change only what the task needs.
3. `DOCFLOW do check <id>`. `CHECKS=fail` (exit 5) prints the end of the log: fix the cause,
   check again — at most three attempts. Still failing: `DOCFLOW do fail <id> "<reason>"`,
   report what fails, and stop — the branch stays; `/docflow:do --resume` continues later.
4. `DOCFLOW do commit <id>` ticks the task in `TASKS.md` and its translations and commits
   code and tick together. `ERROR=changed`: files changed since the check — check again.

With `IMPLEMENTER=task`: for each task, launch the Agent tool with `subagent_type` = `AGENT`
(and `model` = `MODEL` unless `inherit`), one at a time, with the prompt: `ID=<id>`,
`WORKDIR`, `DOCFLOW` (the full command, with the plugin path). The agent does steps 1 to 4
itself and answers `RESULT=committed|failed`. Keep only its result line; on `failed`, stop
as in step 3. With `IMPLEMENTER=sprint`: one such agent with `IDS=<TASKS>` for the sprint.

## 3. Acceptance (when `ACCEPTANCE=1`)

`DOCFLOW do acceptance <UNIT>` prints `TEST`, `MANUAL`, `AGENT`, `MODEL`.

- `MANUAL=1`: the test needs a person. Show it, and **ask** with `AskUserQuestion` whether it
  passed, and what they observed.
- `MANUAL=0`: launch the Agent tool with `subagent_type` = `AGENT` (and `model` = `MODEL`
  unless `inherit`), prompt `TEST=<text>`, `WORKDIR`. It answers `RESULT=passed|failed` and
  `EVIDENCE=<one line>`.

Record it: `DOCFLOW do result <UNIT> passed|failed "<evidence>"` — the box is ticked only on
`passed`. On `failed`, **ask**: fix it (implement, `do check`, then run the test again, as a
follow-up commit — `DOCFLOW do check <last task id>` then commit it the same way), open the
pull request anyway with the failure recorded, or stop here.

## 4. Finish

`DOCFLOW do finish` pushes the branch, opens the **draft** pull request (tasks, checks,
acceptance, `Closes #n` for mirrored issues), restores the checkout, releases the lock and
refreshes the `CLAUDE.md` block. Relay `PR=` and `RESTORED=`. The user reviews and merges;
never merge, never mark the pull request ready.

If the user asks to give the run up: `DOCFLOW do abort` (the branch is kept).

## Not a git repository yet

On exit code 3 with a `REPO=` line, follow `${CLAUDE_PLUGIN_ROOT}/recipes/repo.md`: show
`repo plan`, **ask** with `AskUserQuestion`, create the repository (or the GitHub one) only
on that answer, then run `do start` again. `do finish` needs a remote: the same applies.
