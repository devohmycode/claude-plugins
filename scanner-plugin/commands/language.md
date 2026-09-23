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
report written by the agents, and to the summaries you give the user. It is per project;
`CLAUDE_PLUGINS_LANGUAGE` sets it for every plugin of the marketplace when the project sets
none. Changing it changes the profile fingerprint: the next scan will warn that the profile
changed since the previous one.
