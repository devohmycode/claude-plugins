---
description: Write the technical design (docs/ARCHITECTURE.md) from the approved PRD — principles, overview, modules, contracts, data, delivery plan, testing, decisions
argument-hint: '[--adopt] [--agent]'
allowed-tools: Bash(node:*), Read, Edit, Grep, Glob, Agent, AskUserQuestion
---

Read `${CLAUDE_PLUGIN_ROOT}/recipes/stage.md` and follow it with `STAGE=architecture`. The
user's arguments: `$ARGUMENTS` — pass them on to `stage`.

## Notes for this stage

- Input: the PRD (`INPUTS=PRD`), and in adopt mode the `LAYOUT` summary. In adopt mode the
  first section, **Starting point**, describes the code as it is — facts from the layout and
  from the few files it points to (entry points, manifests) — before any target design.
- Ask only about choices the PRD leaves open **and** that change the design (a stack, a
  storage, a hosting constraint): at most three questions, with `AskUserQuestion` and
  concrete options, your recommendation first.
- Tie each principle to the PRD requirement it serves (`PRD § 5.2`, `F-3`).
- The **delivery plan** becomes the sprints of `TASKS.md`: a table of steps in the order they
  can be built and tested, each usable on its own. In adopt mode, step 1 is what exists.
- Put exact values (formats, limits, names) in SPECS, not here: refer to them.

## Not a git repository yet

On exit code 3 with a `REPO=` line, follow `${CLAUDE_PLUGIN_ROOT}/recipes/repo.md`: show
`repo plan`, **ask** with `AskUserQuestion`, create the repository (or the GitHub one) only
on that answer, then run the stage again.
