---
description: Check scan profiles, project overlays and config against the repository
allowed-tools: Bash(node:*), AskUserQuestion
---

# Check the profiles

A project overlay goes stale silently: it keeps sending the scanner after a library that was
removed or a function that was renamed, and nothing says so.

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs" check` and show its output.

- `✗`: something is wrong — a profile section missing, a constant listed in the config that no
  longer exists in the code, a library present or absent contrary to what the config states.
- `≠`: a count (routes, migrations…) moved since the config recorded it; it is a scale, not an
  error, but the number should be updated.

For each `✗`, point at the place to fix (overlay file or `.scanner/config.json`, found with
`Grep` on the name at fault). Do not edit anything unless the user asks.

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
