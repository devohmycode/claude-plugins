# Demo — Tasks

| | |
|---|---|
| Status | Draft v0.1 |
| Date | 28 September 2026 |

French version: [TASKS-FR.md](TASKS-FR.md).
Chain: [PRD](PRD.md) → [ARCHITECTURE](ARCHITECTURE.md) → [SPECS](SPECS.md) → **TASKS**.

## How to work on this file

- One sprint at a time, in order, each on its own branch, through `/docflow:do`.
- Before a task, read only the sections in its `Refs` (`/docflow:do` extracts them).
- After a task, the project's checks must pass; docflow then ticks the task here and in
  the translations, and commits code and tick together as `<id>: <title>`.
- A sprint's acceptance box is ticked last, only when its test passed, with its result
  written under it.
- Each run ends with a **draft** pull request; nobody merges it without a review.
- Never tick, untick or renumber by hand: the grammar below is read by a script.

## S1 — First sprint

<!-- docflow:todo Rename the sprint, then list its tasks in this exact grammar, one sprint per step of ARCHITECTURE's delivery plan, each ending with its acceptance test:
- [ ] **S1-T1** <title>. Refs: SPECS § <n>, ARCHITECTURE § <n>.
  *Done when* <observable condition>.
- [ ] **S1 acceptance** — <an end-to-end test anyone can run>.
Continuation lines start with two spaces. Refs name sections that exist. -->
