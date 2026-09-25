---
description: Where the issues stand — open issues by priority, how many carry a finding key, recent triage and batch runs, the guard
allowed-tools: Bash(node:*), AskUserQuestion
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" status` and relay its output. Then say
in one or two sentences what deserves attention first: open P0 / P1 issues, a triage whose
actions were not applied, a batch started but not finished, a guard still armed.

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
