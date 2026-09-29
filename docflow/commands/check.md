---
description: Check the documents — required sections, sections left to fill, broken links, TASKS.md grammar and references, translations
argument-hint: '[prd|architecture|specs|tasks]'
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs" check $ARGUMENTS` and relay the
result. Without argument every existing document is checked.

- `ISSUES=0` (exit 0): say that nothing was found, in one line.
- Otherwise (exit 1): list the `# ` lines as they are — file, line, problem — grouped by
  document, then name for each document the command that fixes it (`/docflow:<doc>` for a
  section to fill or a broken reference, `/docflow:translate` for a translation). Do not fix
  anything here unless the user asks; when they do, change only the reported lines, then run
  the check again.
