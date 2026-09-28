---
description: Write or refresh the docflow block of CLAUDE.md — the document chain, the working rules and the next command — without touching the rest of the file
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs" claude-md` and relay its result in one
line: `CLAUDE_MD=created|updated|unchanged` and `LINES=` (the block stays under 40 lines).

The script owns only the lines between `<!-- docflow:start -->` and `<!-- docflow:end -->`;
it appends the block when absent and creates `CLAUDE.md` when missing. Do not open or edit
`CLAUDE.md` yourself. The block is also refreshed by `/docflow:approve` and at the end of each
`/docflow:do` run, so that its "Next" line stays true.
