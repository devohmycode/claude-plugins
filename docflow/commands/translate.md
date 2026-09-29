---
description: Update the translations of the documents (docs/<NAME>-FR.md, -ES, -DE) — only the English sections that changed are sent to the translator, then spliced into each twin
argument-hint: '[prd|architecture|specs|tasks] [--lang fr|es|de]'
allowed-tools: Bash(node:*), Agent
---

Below, `DOCFLOW` is `node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs"`. The script decides
what to translate from fingerprints; you never compare texts yourself, and you never open
the documents or their twins.

1. Run `DOCFLOW translate plan $ARGUMENTS`. `LANGS=` empty: no translation is configured —
   relay the `# ` line and stop. Otherwise each line `DOC=<doc> LANG=<l> CHANGED=<ids>
   REMOVED=<ids> [SOURCE=<file> TARGET=<file>]` describes one twin; `TOTAL=0`: everything is
   up to date — say so and stop. `AGENT=` and `MODEL=` name the translator to launch.
2. For each line with a `SOURCE`, launch the Agent tool with `subagent_type` = `AGENT` and,
   unless `MODEL=inherit`, `model` = `MODEL`. The prompt holds only `SOURCE` and `TARGET`
   (as absolute paths under the project root) and `LANGUAGE` (French, Spanish or German for
   `fr`, `es`, `de`). Launch the agents of all lines in one message: they run in parallel.
3. When they are done, for each line run `DOCFLOW translate apply <doc> <lang>` (also for a
   line with only `REMOVED` ids: it drops those sections). It prints `UPDATED=` and
   `REMOVED=`. Exit code 2:
   - `ERROR=missing` — the agent skipped sections: launch it once more for that line, then
     apply again;
   - `ERROR=invalid` — a heading lost its number: same.
4. Run `DOCFLOW check <doc>` for the documents touched and relay `ISSUES=` in one line.

Report per twin: the sections updated and removed. Never edit a twin by hand: the next plan
would not know about it.
