---
description: Show or lift the scanner guard (useful after an interrupted scan)
argument-hint: [status|off]
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs" guard <action>`, where `<action>` is
`$ARGUMENTS`, or `status` when empty. Show the output. If the guard is armed while no scan or
remediation is running in this session, suggest `/scanner:guard off`.
