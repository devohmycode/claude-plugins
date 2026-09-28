# Not a git repository yet

Followed by every docflow command whose script exits with code 3 and prints a `REPO=` line.
`${CLAUDE_PLUGIN_ROOT}` stands for the plugin directory this file was read from; `DOCFLOW` is
`node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs"`.

- `REPO=no-git`: git is not installed or not on the PATH. Say so, and stop.
- `REPO=none` (no repository) or `REPO=empty` (a repository without a commit):
  1. `DOCFLOW repo plan` — it creates nothing. Show its lines: how many files a first
     commit would hold (the `.gitignore` applies) and the flagged ones (`.env`, keys,
     `node_modules/`, build output, large files).
  2. **Ask** with `AskUserQuestion`, saying the folder is not a git repository yet (or has
     no commit) and that the command needs one:
     - "Create the repository and commit these files" → `DOCFLOW repo init --commit`;
     - "Create the repository only — I will commit myself" → `DOCFLOW repo init`, then stop
       if the command needs a commit;
     - "Cancel" → stop.

     If files were flagged, name them in the question and suggest adding a `.gitignore`
     first (then `repo plan` again). **Never create a repository, and never commit, without
     that answer.**
  3. Run the command that failed again: it may now stop on `REPO=no-remote`.
- `REPO=no-remote`: the repository has no remote, so no branch can be pushed and no pull
  request opened. **Ask** with `AskUserQuestion`:
  - "Create a private GitHub repository and push the code" → `DOCFLOW repo github`;
  - "I will add a remote myself" (`git remote add origin <url>`, then push) → stop;
  - "Cancel" → stop.

  Creating the GitHub repository **publishes the code** (privately, under the account `gh`
  is logged in with): say it in the question, and never run `repo github` without that
  explicit answer — nor with `--public` unless the user asked for a public repository.
  Then run the command that failed again.
