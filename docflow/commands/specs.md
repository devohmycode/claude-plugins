---
description: Write the specifications (docs/SPECS.md) — the exact values the design relies on — from the approved PRD and architecture
argument-hint: '[--agent]'
allowed-tools: Bash(node:*), Read, Edit, Agent, AskUserQuestion
---

Read `${CLAUDE_PLUGIN_ROOT}/recipes/stage.md` and follow it with `STAGE=specs`. The user's
arguments: `$ARGUMENTS` — pass them on to `stage`.

## Notes for this stage

- Inputs: the PRD and the architecture (`INPUTS=PRD,ARCHITECTURE`).
- SPECS holds **exact values only**: files and paths, schemas and grammars with an example,
  settings with type, values, default and precedence, command or API signatures with their
  outputs and error codes, identifiers and naming rules. Tables over prose.
- Number every section and subsection: tasks cite them (`SPECS § 3.2`), and the script
  resolves those references.
- The last section lists the budgets and limits the implementation must meet (sizes,
  timings, counts): `check` requires it.
- Ask the user only for a value that cannot be derived from the inputs and that matters
  (a limit, a naming convention): with `AskUserQuestion`, concrete options.

## Not a git repository yet

On exit code 3 with a `REPO=` line, follow `${CLAUDE_PLUGIN_ROOT}/recipes/repo.md`: show
`repo plan`, **ask** with `AskUserQuestion`, create the repository (or the GitHub one) only
on that answer, then run the stage again.
