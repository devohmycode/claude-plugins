---
description: Run a local scan with a profile (parallel investigation, adversarial triage, HTML or Markdown report)
argument-hint: <type> [--scope full|diff|<path>] [--deep]
allowed-tools: Bash(node:*), Read, Agent
---

# Scan: $ARGUMENTS

You orchestrate a scan. **Steps that count go through the script, never through you**; steps
that judge go through the plugin's agents. You do not read the code yourself and you fix
nothing.

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs"` (below: `SCANNER`).

## 1. Prepare

If `$ARGUMENTS` names no type, run `SCANNER types`, show the list and stop.

Otherwise: `SCANNER prepare $ARGUMENTS`.

- The script builds the effective profile (built-in profile + the project's optional overlay
  in `.scanner/profiles/`), splits the scope into batches and **arms the guard**: during the
  scan, files excluded by the profile are unreadable and writes are limited to the run
  directory and the reports.
- Note `RUN=`, `DIR=` and `LANG=` in its output. Everything you say to the user from now on
  is in the language `LANG=` names (`en`, `fr`, `es`, `de`). If it fails, show the error and stop.

## 2. Investigate — in parallel

In **a single message**, launch one `scanner:investigator` agent per batch listed, with this
prompt:

```
DIR=<run directory>
BATCH=<B1, B2…>
```

Wait for all of them. A failed agent does not fail the scan: note it for the summary.

## 3. Consolidate

`SCANNER consolidate <RUN>` — deduplicates by fingerprint, validates the schema, writes the
triage batches. Note `TRIAGE_BATCHES=`. If it is empty, go to step 5.

## 4. Triage — in parallel

In a single message, launch one `scanner:triager` agent per triage batch:

```
DIR=<run directory>
BATCH=<T1, T2…>
```

## 5. Finalize

`SCANNER finalize <RUN>` — applies the verdicts, compares with the previous scan (new,
persisting, resolved), archives the result. Note `FORMAT=` (`html` or `md`) and `REPORT=`.

## 6. Report

Launch a `scanner:reporter` agent:

```
DIR=<run directory>
FORMAT=<format noted above>
REPORT=<path noted above>
INSTRUCTIONS=<the reportInstructions field of .scanner/config.json, if any>
```

## 7. Lift the guard — always

`SCANNER guard off`, **even if a step failed**: a forgotten guard would block writes for the
rest of the session. (It also expires on its own after a few hours.)

## Summary for the user

A few lines: counts per severity, new / resolved since the previous scan, the three most
severe findings (`file:line` and title), the report path, what could not be examined. Suggest
`/scanner:remediate <RUN> <id>` for a finding, and recall any `reportInstructions` still to do
(registering the report, committing it) — **without doing them**.
