---
description: Open the GitHub issues that are missing for the findings of a scan or an audit — deduplicated by a key written into each issue, plan first, your agreement before anything is written
argument-hint: '<scanner run | findings file | report …> [--min-severity medium] [--only security/F8] [--link security/F8=285]'
allowed-tools: Bash(node:*), Bash(gh issue list:*), Bash(gh issue view:*), Read, AskUserQuestion
---

# Open issues: $ARGUMENTS

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs"` (below: `TRACKER`). It never
writes to GitHub without `--apply`.

1. Without arguments: `TRACKER sources`, show the list, ask which source(s), stop.
2. **The plan**: `TRACKER open <sources> [options]`. It sorts every finding into: without an
   issue (to create), already tracked (open or closed issue carrying its key), left out
   (refuted, done, below the threshold). It flags **reappeared** findings — tracked by an issue
   closed before the source ran: incomplete fix or regression.
3. **Look for issues that track a finding without its key** — written by hand, or by another
   tool. For each finding without an issue, search by file and two or three words of its
   title:
   `gh issue list --state all --search "<words> in:title,body" --json number,title,state --limit 5`.
   Link only when the **defect** is the same, not merely the subject: two defects of the same
   file stay two issues. A link becomes `--link <ref>=<number>`: the key is appended to that
   issue, and the finding will not come back.
4. **Ask** with `AskUserQuestion`, after a short table (priority, severity, title) of what
   would be created, the links you propose and why, the reappeared findings: create all,
   create a selection (`--only`), or nothing. Opening an issue publishes it: never skip this
   step.
5. **Apply**: the same call plus `--apply` (and `--only` / `--link` as agreed). The script is
   idempotent: on an error halfway, run the same call again, it recreates nothing.
6. Report in the language of the script's messages: issues created (numbers), links made,
   reappeared findings to decide on. Suggest `/tracker:triage` if the sources are more than a
   few days old.

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
