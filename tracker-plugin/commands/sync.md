---
description: Bring the issues in line with the latest scans and audits — close those whose finding is gone, reopen those whose finding came back; plan first, your agreement before anything is written
argument-hint: '[<scanner run | history file | findings file …>] [--close-only | --reopen-only]'
allowed-tools: Bash(node:*), Bash(gh issue view:*), AskUserQuestion
---

# Sync issues: $ARGUMENTS

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs"` (below: `TRACKER`).

1. **The plan**: `TRACKER sync [sources] [--close-only|--reopen-only]`. Without sources it
   reads the latest full-scope scan of each type in the scanner's history, and every findings
   file of the reports directory. It proposes:
   - to **close** an open issue whose finding a full scan no longer reports (`resolved`), or
     that an audit file marks done — never when another source still reports it;
   - to **reopen** a closed issue whose finding shows up in a source that ran after the
     closing.
2. Say what the sources are worth before asking: a scan run on a working branch says the
   defect is gone **there**, not in production. If the user merges through a default branch,
   say so.
3. **Ask** with `AskUserQuestion`: apply all, a selection (`--only 12,15`), or nothing.
4. **Apply**: the same call plus `--apply`. Each closing or reopening carries a comment that
   names the source and its commit.
5. Report: issues closed, reopened, and what was left as is.

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
