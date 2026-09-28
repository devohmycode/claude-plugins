---
description: Cut the open issues into numbered lots — a planner agent proposes, the script checks and writes the committed plan (JSON for agents, HTML for readers), then the protocol goes into CLAUDE.md and AGENTS.md so that any agent fixes one lot at a time
argument-hint: '<all | priority:P1 | axis:security | label:<name> | 12 15 …> [--max 200] [--name <name>] | import <file>'
allowed-tools: Bash(node:*), Bash(git:*), Read, Agent, AskUserQuestion
---

# Plan: $ARGUMENTS

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs"` (below: `TRACKER`).

A **plan** is the durable form of a batch run: two twin files in the repository
(`plan.dir` in the config, `docs/issues` by default), numbered lots, marked as they are
done, read by every agent — Claude Code, Codex, a shell. `/tracker:lot` fixes them one at a
time.

## A plan of the previous format

With `import <file>`: `TRACKER plan import <file>` shows the converted lots (done lots keep
their pull request). **Ask** with `AskUserQuestion` whether to convert it in place (or under
another `--name`), then `TRACKER plan import <file> --apply [--name <name>]`. Go on at
**Instructions** below. Stop there.

## A new plan

1. Without arguments: ask which issues to plan (`all` is usual after `/tracker:open`), and
   suggest `/tracker:triage` first when many issues may already be fixed. Stop.
2. `TRACKER plan draft <selection> [--max n]` — reads the issues and writes the planner's
   input; the guard makes the working tree read-only. Note `RUN=`, `DIR=`, `BASE=`,
   `ISSUES=`, `LANG=`, `PLANNER=`, `PLANNER_MODEL=`. A `DROPPED=` line means the selection
   matched more than `--max`: say so.
3. **One** agent of type `PLANNER=`, with the Agent tool's `model` set to `PLANNER_MODEL=`
   (omitted when `inherit`), and this prompt:

   ```
   DIR=<the DIR= value>
   LANG=<the LANG= value>
   ```

4. `TRACKER plan write <RUN> [--name <name>]` — always, even if the agent failed: it lifts the
   guard. It checks the proposal (every issue in exactly one lot or unassigned) and prints
   the lots, the unassigned issues, the conflicts and `TARGET=`. A refused proposal lists its
   problems: relaunch the planner once with them appended to its prompt, then run this step
   again.
5. Show the plan (lots in order, their issues, the flags, the conflicts) and **ask** with
   `AskUserQuestion`: write it, or stop. When `TARGET=` exists, ask whether to replace it
   (`--replace`) or choose another `--name`.
6. `TRACKER plan write <RUN> [--name <name>] [--replace] --apply` → `PLAN=`.

## Instructions

7. `TRACKER instructions` — shows whether `CLAUDE.md`, `AGENTS.md`… (`plan.instructionFiles`)
   carry the protocol block, between `<!-- tracker:lots:start -->` and `<!-- tracker:lots:end -->`.
   When one would change, show the block and **ask**; then `TRACKER instructions --apply`
   (`--create` to create a missing file).
8. Agents outside Claude Code call the script by `plan.cli` (default
   `node .tracker/bin/scripts/tracker.mjs`). When `.tracker/bin/` does not exist or is older
   than the plugin, offer `TRACKER vendor` then `TRACKER vendor --apply`; relay a warning that
   the directory is ignored by git.
9. **Ask** whether to commit the plan now: it is committed on its base branch (`BASE=`),
   never on a fix branch — `TRACKER lot commit` refuses another branch. Commit the
   instruction files and `.tracker/bin/` by name, with the user's agreement, in the same
   commit or right after.
10. Report in `LANG`: the plan file, the number of lots, the first lot, the conflicts, and the
    next step: `/tracker:lot next` (or `<cli> lot take next --agent <name> --wait` for another
    agent).

## Not a git repository yet

Whenever a `tracker.mjs` command exits with code 3 and prints a `REPO=` line, this section
applies instead of stopping on the error.

- `REPO=no-git`: git is not installed or not on the PATH. Say so, and stop.
- `REPO=none` or `REPO=empty`: run `TRACKER repo plan` and show what a first commit would
  hold, flagged files first. **Ask** with `AskUserQuestion`: create the repository and
  commit (`TRACKER repo init --commit`), create it only (`TRACKER repo init`), or cancel.
- `REPO=no-remote`: the plan reads the issues on GitHub. **Ask**: create a **private**
  GitHub repository and push (`TRACKER repo github`), add a remote yourself, or cancel.
  Publishing is never done without that answer.

Then run the command that failed again.
