---
description: Run the next pending stage of the document chain (PRD → architecture → specs → tasks → CLAUDE.md) from the saved state, then stop at its checkpoint
argument-hint: '[--through prd|architecture|specs|tasks]'
allowed-tools: Bash(node:*), Read, Edit, Agent, AskUserQuestion
---

Below, `DOCFLOW` is `node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs"`. Always start from the
state, never from what this conversation remembers: a run may resume a chain started in
another session.

1. Run `DOCFLOW status`. Read `NEXT`, `APPROVED_ONCE` and the `DOC_<NAME>` lines.
2. Act on `NEXT`:
   - `/docflow:<stage>` (`prd`, `architecture`, `specs`, `tasks`): read
     `${CLAUDE_PLUGIN_ROOT}/recipes/stage.md` and follow it with that `STAGE`, together with
     the notes of `${CLAUDE_PLUGIN_ROOT}/commands/<stage>.md`;
   - `/docflow:approve <stage>`: the document is complete but not approved — go straight to
     the recipe's checkpoint (step 7) for it;
   - `/docflow:claude-md`: run `DOCFLOW claude-md` and relay `CLAUDE_MD=`;
   - `/docflow:do next` or `/docflow:do --resume`: the chain is done. Say so and name that
     command; do not start implementing from here;
   - `none`: everything is approved and ticked. Say so.
3. Stop after that one stage and its checkpoint, with the next command (`NEXT=` of
   `approve`).

## `--through <stage>`

With `--through`, continue across stages instead of stopping, up to and including the named
stage, but only through documents the user already approved once (`APPROVED_ONCE`): those
are refreshes. For such a document, when `DOCFLOW check <stage>` reports nothing, approve it
without asking and go on with the next `NEXT`. A document never approved before, a check
that keeps failing, or any amendment the user must decide, stops at the normal checkpoint.
Report at the end which documents were refreshed and approved.

## Not a git repository yet

On exit code 3 with a `REPO=` line, follow `${CLAUDE_PLUGIN_ROOT}/recipes/repo.md`: show
`repo plan`, **ask** with `AskUserQuestion`, create the repository (or the GitHub one) only
on that answer, then run the stage again.
