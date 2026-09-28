---
description: Approve a document of the chain (prd, architecture, specs, tasks) — checked first; the following documents become stale when it changed
argument-hint: '<prd|architecture|specs|tasks>'
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs" approve $ARGUMENTS` — the user asked
for this approval, run it without asking again — and relay the result briefly.

- Exit 0: `APPROVED=` the document; `STALE=` the documents now to refresh, in order (each
  through its own command); `CLAUDE_MD=` whether the docflow block was refreshed; `NEXT=`
  the command to run next, which the `# ` line explains.
- Exit 1 with `ISSUES=`: the document has problems (the `# ` lines, with file and line); it
  is not approved. Relay them and name the command that completes the document
  (`/docflow:<doc>`). Do not fix them here unless the user asks.
- Exit 2: unknown document (the list is in the message). Exit 4 (`GATE=`): the previous
  document must be approved first.
