---
description: Fix one lot of the committed plan — the lock shared by every agent first (one lot at a time), then a branch and a worktree, the fixers, the project's checks and a draft pull request; the lot is marked done and the lock released
argument-hint: '<id | next> [--wait] [--fixer issue|batch|session] [--in-place|--worktree] [--model …] [--effort …] | status | lock | release [<id>] | sync'
allowed-tools: Bash(node:*), Bash(git:*), Read, Agent, AskUserQuestion
---

# Lot: $ARGUMENTS

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs"` (below: `TRACKER`). A plan
comes from `/tracker:plan`; `--plan <file>` names one, else the newest of `plan.dir`.

## Other forms

- `status`: `TRACKER lot status` — the lots, done, in progress (and by whom), waiting;
  `NEXT=` and `LOCK=`. Report them. Stop.
- `lock`: `TRACKER lot lock`. Stop.
- `release [<id>]`: `TRACKER lot release [<id>]`. A lot held by another agent is released only
  with `--force`, and only on the user's explicit answer. Stop.
- `sync`: `TRACKER lot sync` — pull requests merged or closed since they were marked. When
  something changed, **ask**, then `TRACKER lot sync --apply` and offer `TRACKER lot commit`.
  Stop.

## A lot

1. Without arguments: run `TRACKER lot status`, show it, and ask which lot (`next` is usual).
   Stop.
2. **The lock, before anything else**: `TRACKER lot start <id|next> --agent claude-code
   [--wait] [--fixer issue|batch|session]`.
   - Exit `75` (`LOCK=busy`): another agent is fixing another lot. Say who, and **change
     nothing**. If the user wants to wait, do not re-run the command by hand: watch the
     lock in the background with the Monitor tool when it is available (`ToolSearch`
     `select:Monitor`), a loop that prints only when the lock changes and ends when it is
     no longer held:

     ```bash
     prev=""; while :; do s=$(TRACKER lot lock | grep -E '^(LOCK|LOT)=' | tr '\n' ' ')
       [ "$s" != "$prev" ] && echo "$s"; prev=$s
       case "$s" in *LOCK=held*) sleep 60 ;; *) break ;; esac; done
     ```

     Without Monitor, run `TRACKER lot start … --wait` in the background (Bash
     `run_in_background`): its end wakes you up. Either way, once the lock is `free` or
     `stale`, run the **same `lot start` command** again in the foreground — another agent
     may have taken it first, and `75` then starts the wait over. Stop if the user prefers.
     Never release someone else's lock.
   - Exit `2`: no such lot, or already done — relay the message. Stop.
   - `LOT=none`: nothing left to take (lots waiting for a deployment are skipped; say so).
     Stop.
   - Otherwise note `LOT=`, `TITLE=`, `ISSUES=`, `PLAN=`, `BASE=`, `RUN=`, `FIXER_SCOPE=`,
     `AGENTS=`, and relay any warning (the lot waits for a deployment, or is not a diff of
     the repository — then **ask** before going on: such a lot is usually applied by hand,
     then marked with `TRACKER lot mark`).
3. Follow `/tracker:batch` from its step 4 on, with `<RUN>` and the batch `B1`: `batch start
   [--in-place|--worktree]` (branch `fix/lot-<id>-…`, in a worktree or in the checkout, guard
   armed), the fixers one after the other — or, with `FIXER_SCOPE=session`, this session
   fixing the issues itself —, `batch checks`, `guard off` — always —, `batch status`.
4. **The pull request**: show the branch and **ask**, as `/tracker:batch` does: push and open a
   draft pull request, push only, or leave it local. With the pull request, `batch finish`
   marks the lot done in the plan (JSON and HTML regenerated) and **releases the lock**
   (`MARKED=`). Without it the lock stays held: say so, and that `TRACKER lot mark <id> --pr
   <n>` or `TRACKER lot release <id>` gives it back.
5. **The plan is committed on its base branch**, never on the lot's branch (each fix branch
   would conflict with the next one): when the current branch of the repository is `BASE=`,
   **ask**, then `TRACKER lot commit`; otherwise say that `lot commit` is to run on `BASE=`.
6. Report in `LANG`: the lot, its branch and pull request, the issues fixed and not fixed
   (why), the checks, the worktree to remove once merged, and the next lot (`TRACKER lot
   status` → `NEXT=`). **Never merge.**

## Not a git repository yet

Whenever a `tracker.mjs` command exits with code 3 and prints a `REPO=` line, this section
applies instead of stopping on the error.

- `REPO=no-git`: git is not installed or not on the PATH. Say so, and stop.
- `REPO=none` or `REPO=empty`: run `TRACKER repo plan` and show what a first commit would
  hold, flagged files first. **Ask** with `AskUserQuestion`: create the repository and
  commit (`TRACKER repo init --commit`), create it only (`TRACKER repo init`), or cancel.
- `REPO=no-remote`: a lot reads its issues and opens its pull request on GitHub. **Ask**:
  create a **private** GitHub repository and push (`TRACKER repo github`), add a remote
  yourself, or cancel. Publishing is never done without that answer.

Then run the command that failed again.
