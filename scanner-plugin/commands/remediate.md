---
description: Fix one or several findings of a scan on a new fix branch, in an isolated worktree, following the profile's remediation guidance
argument-hint: <run> <F3 | F1,F4 | high | >=medium | all> [--model <model>] [--effort <effort>]
allowed-tools: Bash(node:*), Bash(git:*), Read, Agent
---

# Remediate: $ARGUMENTS

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs"` (below: `SCANNER`).

A **selection** is one or more tokens separated by commas or spaces: an id (`F3`), a severity
(`high`), a severity and above (`>=medium` or `medium+`), `all` (every finding down to
`fixMinSeverity`, `low` by default) or `none`.

1. Without arguments: list the directories of `.scanner/runs/` that contain a `final.json`,
   with their counts, and stop. With a run only: `SCANNER select <run>` and stop.
2. `SCANNER fix <run> <selection>` — creates **one fix branch for the run**
   (`<branchPrefix>scan-<type>-<date>`, suffixed if it exists) from `remediationBase` (default:
   the current branch), in a worktree under `.scanner/worktrees/<run>` — the user's working
   tree does not switch branches — and arms the remediation guard: denied paths and
   commands from `.scanner/config.json`, no commit or push on a protected branch. Note
   `BRANCH=`, `WORKTREE=`, `FINDINGS=`, `MODEL=` and `REMEDIATOR=`. If it fails, show the
   error and stop. The model and effort are the scan's own unless `--model` / `--effort` are
   given.
3. For each id of `FINDINGS=`, **one after the other** — they commit on the same branch —
   launch one agent of type `REMEDIATOR=` (`scanner:remediator` or one of its effort
   variants), with the Agent tool's `model` parameter set to `MODEL=` — omitted when
   `MODEL=inherit` — and **without** `isolation` (the worktree already exists):

   ```
   RUN_DIR=<absolute path of .scanner/runs/<run>>
   FINDING_ID=<F…>
   WORKTREE=<the WORKTREE= value>
   BRANCH=<the BRANCH= value>
   ```

   Wait for each before launching the next. A failed or declined finding does not stop the
   others.
4. `SCANNER fix-status <run>` — per finding: fixed, not fixed (and why), failed, not
   reached; commits on the branch.
5. `SCANNER guard off` — **always**, even if an agent failed.
6. Relay, in the profile's language (`language` in `profile.json`): the branch, the
   `fix-status` lines, what could not be verified, and the worktree path (to remove it once
   merged: `git worktree remove <path>`). **Do not push and do not open a pull request**:
   only offer to.
