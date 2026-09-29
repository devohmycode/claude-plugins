---
description: Where the project stands — each document of the chain (approved, stale, draft, missing), the sprint progress, the running run and the next command
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs" status` and relay its output in a few
lines. Do not open any document: the script computes everything from `.docflow/state.json`
and the files' fingerprints.

- `DOC_<NAME>`: `approved`, `stale` (a preceding document changed since its approval),
  `draft` (never approved, or edited since) or `missing`.
- `CLAUDE_MD`: whether the docflow block of `CLAUDE.md` exists.
- `SPRINT`, `DONE`, `TOTAL`: the current sprint and the tasks ticked out of all tasks.
- `RUN`: `none`, or `<status>:<unit>` for a run in progress.
- `NEXT`: the command to run next; the `# ` line says why.

End with the next command, as the script names it. Do not run it unless the user asks.
