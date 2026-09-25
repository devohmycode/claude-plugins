---
description: Run every available scan type, one after the other, after checking the profiles
argument-hint: [--scope full|diff|<path>] [--mode report|fix|review] [--model <model>] [--effort <effort>]
allowed-tools: Bash(node:*), Bash(git:*), Read, Agent, AskUserQuestion
---

# All scans: $ARGUMENTS

A profile is valid for one scan type only: "scan everything" therefore means one scan per
type.

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs" check`. If it fails, show the `✗` lines
   and **stop**: a stale overlay or config would send the scanners after things that no longer
   exist. The user fixes it, or reruns knowingly. Its `scan mode` line says which mode applies
   when `--mode` is not given.
2. `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs" types` for the list of types.
3. For each type, **one after the other** (the guard holds one scan at a time, each with its
   own exclusions), follow the `/scanner:scan` procedure with `<type> $ARGUMENTS`, steps 1 to 7:
   prepare, investigate in parallel, consolidate, triage in parallel, finalize, report
   (unless `MODE=fix`), guard off. Each type has its own model and effort (the `MODEL=` and
   agent-name lines of its `prepare`), unless `--model` / `--effort` set them for all.
4. Then, by mode (the `MODE=` line, identical for every type):
   - `report`: nothing more.
   - `fix`: for each type with retained findings, one after the other, steps 8 and 9 of
     `/scanner:scan` with the selection `all` — **one fix branch per type**.
   - `review`: **once every scan is done**, show each type's list (`select <RUN>`) and ask
     with a single `AskUserQuestion` call, one question per type that has findings (at most
     four per call; ask again for the rest), same options as `/scanner:scan` step 8. Wait
     for the answers, then run step 9 for each type whose answer is not `none`, one after the
     other — one fix branch per type.
5. Final summary, in the language of the `LANG=` line printed by `prepare`: a type × severity
   table, new and resolved findings per type, the report paths, and for each fix branch its
   `fix-status` counts and worktree. Never push, never open a pull request: only offer to.

Before starting, announce the number of types and batches planned, the mode, and each
type's model and effort (`node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs" model`): it is the
order of magnitude of the cost — in mode `fix` or `review`, each fixed finding adds one
agent.

## Not a git repository yet

Whenever a `scanner.mjs` command exits with code 3 and prints a `REPO=` line, this section
applies instead of stopping on the error. A scan works on the repository: its tracked files,
its commit, its fix branches. Below, `SCANNER` is
`node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs"`.

- `REPO=no-git`: git is not installed or not on the PATH. Say so, and stop.
- `REPO=none` (no repository) or `REPO=empty` (a repository without a commit):
  1. `SCANNER repo plan` — it creates nothing. Show its lines: how many files a first commit
     would hold (the `.gitignore` applies) and the flagged ones (`.env`, keys,
     `node_modules/`, build output, large files).
  2. **Ask** with `AskUserQuestion`, saying the folder is not a git repository yet and that
     the command needs one:
     - "Create the repository and commit these files" → `SCANNER repo init --commit`;
     - "Create the repository only — I will commit myself" → `SCANNER repo init`, then stop:
       the command needs a commit;
     - "Cancel" → stop.

     If files were flagged, name them in the question and suggest adding a `.gitignore`
     first (then run `repo plan` again). **Never create a repository, and never commit,
     without that answer.**
  3. After a first commit, run the command that failed again, and go on.
