---
description: Fix one finding of a scan in an isolated worktree, following the profile's remediation guidance
argument-hint: <run> <finding-id>
allowed-tools: Bash(node:*), Bash(git:*), Read, Agent
---

# Remediate: $ARGUMENTS

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs"` (below: `SCANNER`).

1. Without arguments: list the directories of `.scanner/runs/` that contain a `final.json`,
   with their counts, and stop. With a run only: list its findings (id, severity, title,
   `file:line`) and stop.
2. `SCANNER guard remediate <run> <id>` — arms the remediation guard and prints the finding.
   The guard now refuses writes to the paths denied by `.scanner/config.json`, its denied
   commands, and any commit or push on a protected branch.
3. Choose `BRANCH`: `<branchPrefix from the config, default fix/><slug of the title>`, and
   `BASE_BRANCH`: `remediationBase` from the config (default: the current branch).
4. Launch a `scanner:remediator` agent **with `isolation: "worktree"`** — the user's working
   tree must not switch branches under their feet:

   ```
   FINDING=<the JSON printed at step 2>
   PROFILE=<absolute path of .scanner/runs/<run>/profile.json>
   BASE_BRANCH=<…>
   BRANCH=<…>
   ```

5. `SCANNER guard off` — **always**, even if the agent failed.
6. Relay the agent's account, in the profile's language (`language` in `profile.json`): branch, commit, checks, what could not be verified, and the
   worktree path. **Do not push and do not open a pull request**: only offer to.
