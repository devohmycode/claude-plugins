---
description: Show or lift the tracker guard (useful after an interrupted triage or batch)
argument-hint: '[status|off]'
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" guard $ARGUMENTS` (without argument: the status) and show its
output.

While armed, the guard refuses: during a triage, any write outside the run directory, any
mutating command and any write to GitHub; during a batch, the paths and commands the project
denies, commits on a protected branch, `git push` and any write to GitHub. It expires by
itself after `guard.ttlHours` (6 by default). Lift it only when the triage or batch it
protects is over or abandoned.
