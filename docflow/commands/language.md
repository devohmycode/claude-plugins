---
description: Show or set the plugin language (English by default; French, Spanish, German)
argument-hint: '[en|fr|es|de|default]'
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs" language $ARGUMENTS` and show its
output.

- Without argument it prints the current language (`LANGUAGE=`), where it comes from
  (`SOURCE=`) and the supported ones.
- With a code (`en`, `fr`, `es`, `de`) or a language name it writes `language` into
  `.docflow/config.json`, keeping the file's other keys; `default` removes it.

The language applies to the script's messages and to what you say to the user while running
a docflow command. It does not choose the language of the documents: they are written in
English, and their translations come from the `doc_languages` option (`/docflow:translate`).
Precedence: this per-project value, then `CLAUDE_PLUGINS_LANGUAGE`, then the plugin's
**Language** row in `/config`, then English.
