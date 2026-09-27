---
description: Show or set the model and reasoning effort of the scan agents, per scan type or for the triager and the reporter
argument-hint: [<type>|all|triager|reporter] [--model type|inherit|haiku|sonnet|opus|fable] [--effort type|inherit|low|medium|high|xhigh|max]
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs" model $ARGUMENTS` and show its output.

- Without `--model` or `--effort` it prints, for every scan type (or the one named), the model
  and effort its agents run with — investigators, triagers, reporter and remediators — and
  where each value comes from; then the triager's and the reporter's own values, if any.
- With `<type> --model … --effort …` it writes `types.<type>.model` / `types.<type>.effort`
  into `.scanner/config.json`; with `all`, the top-level `model` / `effort`, which apply to
  every type that has no value of its own. The file is created if needed and its other keys
  are kept. `inherit` removes the value, so the next source applies.
- With `triager` or `reporter` it writes `roles.<role>.model` / `.effort`: that role's agents
  use them in every scan type, over the type's values. `type` removes the value (the role
  follows the scan type again); `inherit` is kept (the session's, whatever the type says).

If the user names a model or an effort in words ("opus", "high effort for security", "haiku
for the report"), turn it into these arguments; ask only if the target is unclear.

Precedence, first match wins: the `--model` / `--effort` arguments of `/scanner:scan` (every
role); for the triager and the reporter, their own value in `.scanner/config.json`, then
their **Model — <role>** / **Effort — <role>** rows of the scanner in `/config`; then the
per-type value in `.scanner/config.json`, its top-level value, the type's **Model** /
**Effort** rows in `/config` (the user's own choice, all projects), then `inherit` — the
session's model and effort. If the user wants a personal setting rather than a project one,
point them to `/config` instead of writing the project file.
