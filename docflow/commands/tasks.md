---
description: Write the task list (docs/TASKS.md) — sprints from the architecture's delivery plan, tasks citing SPECS sections, one acceptance test per sprint
argument-hint: '[--adopt] [--agent]'
allowed-tools: Bash(node:*), Read, Edit, Agent, AskUserQuestion
---

Read `${CLAUDE_PLUGIN_ROOT}/recipes/stage.md` and follow it with `STAGE=tasks`. The user's
arguments: `$ARGUMENTS` — pass them on to `stage`.

## Notes for this stage

- Inputs: the architecture's delivery plan (`ARCHITECTURE § <n>`) and the SPECS headings
  (`SPECS headings`) — not the whole SPECS: the headings are enough to cite sections.
- One sprint per step of the delivery plan, `## S<n> — <title>`, in order. Keep the section
  "How to work on this file" as the skeleton wrote it. In adopt mode, S1 is already ticked
  for the existing code: leave it, and start the plan at S2.
- The grammar is read by a script — follow it exactly, one entry per line, continuation
  lines indented by two spaces:

  ```text
  - [ ] **S2-T1** <title, imperative>. Refs: SPECS § 3.2, ARCHITECTURE § 4.
    *Done when* <an observable condition>.
  - [ ] **S2 acceptance** — <an end-to-end test anyone can run, and what proves it passed>.
  ```

- A task is one commit's worth of work, testable by the project's checks; three to eight
  tasks per sprint. `Refs` name sections that exist (`check` verifies them). An acceptance
  test that needs a person (a device, a visual check) says so: "(manual)".
- Nothing to ask the user in general; ask only if the delivery plan leaves the order open.

## Not a git repository yet

On exit code 3 with a `REPO=` line, follow `${CLAUDE_PLUGIN_ROOT}/recipes/repo.md`: show
`repo plan`, **ask** with `AskUserQuestion`, create the repository (or the GitHub one) only
on that answer, then run the stage again.
