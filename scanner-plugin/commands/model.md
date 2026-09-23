---
description: Show or set the model and reasoning effort of the scan agents, per scan type
argument-hint: [<type>|all] [--model inherit|haiku|sonnet|opus|fable] [--effort inherit|low|medium|high|xhigh|max]
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs" model $ARGUMENTS` and show its output.

- Without `--model` or `--effort` it prints, for every scan type (or the one named), the model
  and effort its agents run with — investigators, triagers, reporter and remediators — and
  where each value comes from.
- With `<type> --model … --effort …` it writes `types.<type>.model` / `types.<type>.effort`
  into `.scanner/config.json`; with `all`, the top-level `model` / `effort`, which apply to
  every type that has no value of its own. The file is created if needed and its other keys
  are kept. `inherit` removes the value, so the next source applies.

If the user names a model or an effort in words ("opus", "high effort for security"), turn it
into these arguments; ask only if the type is unclear.

Precedence, first match wins: the `--model` / `--effort` arguments of `/scanner:scan`, the
per-type value in `.scanner/config.json`, its top-level value, the type's **Model** /
**Effort** rows of the scanner in `/config` (the user's own choice, all projects), then
`inherit` — the session's model and effort. If the user wants a personal setting rather
than a project one, point them to `/config` instead of writing the project file.
