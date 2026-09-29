---
description: Write the PRD (docs/PRD.md) from a short interview — vision, problem, goals, users, requirements, acceptance criteria — then ask for its approval
argument-hint: '[idea] [--adopt] [--agent]'
allowed-tools: Bash(node:*), Read, Edit, Agent, AskUserQuestion
---

Read `${CLAUDE_PLUGIN_ROOT}/recipes/stage.md` and follow it with `STAGE=prd`. The user's
arguments: `$ARGUMENTS` — pass `--adopt` and `--agent` on to `stage`; the rest is the idea.

## Notes for this stage

The PRD is the first document: it has no input but the user (and, in adopt mode, the
`LAYOUT` summary of the existing code). Before writing, interview the user in **one**
message, asking only what the idea does not already answer:

1. **Goal** — what the product must achieve, and how success is recognised;
2. **Users** — who uses it, in which situation;
3. **Scope** — what is in the first version, and what is explicitly out;
4. **Constraints** — platforms, stack imposed or excluded, data, privacy, deadlines.

Wait for the answers; one short follow-up at most if an answer leaves the scope unclear.
In adopt mode, first say in three lines what the layout shows the code does, and ask the
user to confirm or correct it along with the questions above.

Write requirements with stable ids (`F-1`, `N-1`) so that later documents and tasks can
cite them; acceptance criteria must each be observable. The last section keeps the open
questions — with the options considered — or, once settled, the decisions.

## Not a git repository yet

On exit code 3 with a `REPO=` line, follow `${CLAUDE_PLUGIN_ROOT}/recipes/repo.md`: show
`repo plan`, **ask** with `AskUserQuestion`, create the repository (or the GitHub one) only
on that answer, then run the stage again.
