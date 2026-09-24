---
description: Check the tracker's configuration against the repository — config file, label templates, GitHub CLI, sources, findings files, agent settings
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" check` and relay its output. For each
problem, say how to fix it: `.tracker/config.json` for the templates and settings (see the
plugin README), `gh auth login` for the CLI, the producer of a findings file for its shape.
