---
description: Show or set the plugin language (English by default; French, Spanish, German)
argument-hint: [en|fr|es|de]
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" language $ARGUMENTS` and show its output.

- Without argument it prints the current language, where it comes from, and the supported ones.
- With a code (`en`, `fr`, `es`, `de`) or a language name it writes `language` into
  `.tracker/config.json`, keeping the file's other keys.

The language applies to the script's messages, to the issue bodies, comments and pull
requests it writes, and to what the agents write. The key lines of an issue body are read
back in every supported language, so changing the language does not break deduplication.
Precedence: this per-project value, then `CLAUDE_PLUGINS_LANGUAGE`, then the plugin's
**Language** row in `/config`, then English.
