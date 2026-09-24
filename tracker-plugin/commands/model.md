---
description: Show or set the model and reasoning effort of the tracker's agents (triager, skeptic, fixer)
argument-hint: '[triager|skeptic|fixer|all] [--model inherit|haiku|sonnet|opus|fable] [--effort inherit|low|medium|high|xhigh|max]'
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" model $ARGUMENTS` and show its output.

- Without `--model` / `--effort` it prints, per role, the model and effort in use and where
  they come from.
- With them it writes `roles.<role>.model` / `.effort` (or the top-level `model` / `effort`
  for `all`) into `.tracker/config.json`; `inherit` removes the key.

Precedence, first match wins: the `--model` / `--effort` arguments of a command, the role's
value in the project config, the project's top-level value, the role's rows in `/config`,
inherit (the session's own). A triage is many short agents: a lighter model often suffices
for triagers; fixers write code.
