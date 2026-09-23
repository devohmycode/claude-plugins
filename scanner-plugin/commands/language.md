---
description: Show or set the plugin language (English by default; French, Spanish, German)
argument-hint: [en|fr|es|de]
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs" language $ARGUMENTS` and show its output.

- Without argument it prints the current language and the supported ones.
- With a code (`en`, `fr`, `es`, `de`) or a language name (`French`, `Français`…) it writes
  `language` into `.scanner/config.json`, creating the file if needed and keeping its other
  keys.

The language applies to the script and guard messages, to the findings, verdicts and HTML
report written by the agents, and to the summaries you give the user. The output says where
the language comes from. Precedence: this per-project value, then `CLAUDE_PLUGINS_LANGUAGE`
(every plugin of the marketplace), then the scanner's **Language** row in `/config` (the
user's own choice, all projects), then English. If the user wants a personal setting rather
than a project one, point them to `/config` instead of writing the project file.

Changing the language changes the profile fingerprint: the next scan will warn that the
profile changed since the previous one.
