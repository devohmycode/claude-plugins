---
description: Mirror the tasks of TASKS.md as GitHub issues (push), or report the issues closed or reopened by hand and follow them (pull) — TASKS.md stays the source of truth
argument-hint: 'push | pull [--apply]'
allowed-tools: Bash(node:*), Bash(gh auth status:*), AskUserQuestion
---

Below, `DOCFLOW` is `node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs"`. The script lists,
creates and edits the issues through `gh` and writes `TASKS.md` itself; you never open
`TASKS.md`, never run `gh issue` yourself and never close an issue: a run's draft pull
request closes the issues of the tasks it ticks, once the user merges it.

Each task and each sprint acceptance becomes one issue titled `S2-T3 <title>`, labelled
`docflow` and `sprint:S2` (`acceptance` for an acceptance test), whose body ends with the key
`<!-- tracker:key=id:docflow-S2-T3 -->` — the key the tracker plugin reads. The key, not the
title, finds an issue again: running `push` twice creates nothing twice.

## push

Run `DOCFLOW issues push`. It prints `CREATED=` and `UPDATED=` (entry ids), `UNCHANGED=` and
`NUMBERED=` (issue numbers written after the ids in `TASKS.md` and its twins, e.g.
`**S2-T3** (#42)`). Relay it in two lines; when `NUMBERED` is not 0, add that the numbers are
committed with the documents at the next `/docflow:do` — they do not change the approval.

## pull

1. Run `DOCFLOW issues pull`. `CLOSED=` lists the entries whose issue was closed while the box
   is not ticked; `REOPENED=` those whose issue is open again while the box is ticked; the
   `# ` lines name each issue. Both empty: say everything matches, and stop.
2. Otherwise show that list and **ask** with `AskUserQuestion` whether `TASKS.md` should
   follow the issues (tick the closed, untick the reopened), or be left as it is. A closed
   issue is not proof the work is done: say so when an acceptance test is among them.
3. On yes only: `DOCFLOW issues pull --apply`, then relay `APPLIED=1`.

With `--apply` already in `$ARGUMENTS`, still show the list and ask before step 3.

## When it stops

- `ERROR=issues-off` (exit 1): the mirror is off. **Ask** whether to turn it on for this
  project; on yes, `DOCFLOW config issues mirror`, then run the same command again.
- `ERROR=run-active`: a run is in progress and owns `TASKS.md`. Say so: finish it with
  `/docflow:do --resume` first.
- Exit 3 with a `REPO=` line: follow `${CLAUDE_PLUGIN_ROOT}/recipes/repo.md` — show
  `repo plan`, **ask** with `AskUserQuestion`, create the repository (or the GitHub one) only
  on that answer, then run the command again.
- `ERROR=git` with a failing `gh` command: run `gh auth status`. Not logged in: ask the user
  to run `! gh auth login` and try again. Logged in: the remote is probably not a GitHub
  repository, or the account cannot write issues there — relay the `# ` lines and stop.
  Issues created before the failure already have their number in `TASKS.md`; the next
  `push` finds them by their key and creates nothing twice.
- Exit 2 (`ERROR=missing`): there is no `docs/TASKS.md` yet — `/docflow:tasks` writes it.

Report in the user's language, in a few lines. Never edit `TASKS.md` by hand.
