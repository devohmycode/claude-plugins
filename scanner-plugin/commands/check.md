---
description: Check scan profiles, project overlays and config against the repository
allowed-tools: Bash(node:*)
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
