---
description: Run a local scan with a profile (parallel investigation, adversarial triage, then a report, fixes on a new branch, or both with your confirmation in between)
argument-hint: <type> [--scope full|diff|<path>] [--deep] [--mode report|fix|review]
allowed-tools: Bash(node:*), Bash(git:*), Read, Agent, AskUserQuestion
---

# Scan: $ARGUMENTS

You orchestrate a scan. **Steps that count go through the script, never through you**; steps
that judge or fix go through the plugin's agents. You do not read the code yourself and you
fix nothing yourself.

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs"` (below: `SCANNER`).

## 1. Prepare

If `$ARGUMENTS` names no type, run `SCANNER types`, show the list and stop.

Otherwise: `SCANNER prepare $ARGUMENTS`.

- The script builds the effective profile (built-in profile + the project's optional overlay
  in `.scanner/profiles/`), splits the scope into batches and **arms the guard**: during the
  scan, files excluded by the profile are unreadable and writes are limited to the run
  directory and the reports.
- Note `RUN=`, `DIR=`, `LANG=` and `MODE=` in its output. Everything you say to the user from
  now on is in the language `LANG=` names (`en`, `fr`, `es`, `de`). If it fails, show the
  error and stop.
- `MODE=` decides how the scan ends (the `--mode` argument, else `mode` in
  `.scanner/config.json`, else the **Scan mode** row of `/config`, else `report`):
  - `report` — the report, nothing else;
  - `fix` — no report: every retained finding is fixed on a new branch;
  - `review` — the report, then **the user chooses** the findings to fix, then they are fixed
    on a new branch.

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

## 6. Report — modes `report` and `review` only

In mode `fix`, skip this step: no report is written.

Launch a `scanner:reporter` agent:

```
DIR=<run directory>
FORMAT=<format noted above>
REPORT=<path noted above>
INSTRUCTIONS=<the reportInstructions field of .scanner/config.json, if any>
```

## 7. Lift the scan guard — always

`SCANNER guard off`, **even if a step failed**: a forgotten guard would block writes for the
rest of the session. (It also expires on its own after a few hours.)

In mode `report`, go to the summary.

## 8. Choose the findings — modes `fix` and `review`

`SCANNER select <RUN>` lists the retained findings (`id [severity] title — file:line`) and
prints `ALL=` — every finding down to `fixMinSeverity` (`low` by default, so `info` is left
out). If `ALL=` is empty and nothing else is listed, say there is nothing to fix and go to the
summary.

- Mode `fix`: the selection is `all`. Do not ask.
- Mode `review`: show the list and the report path, then **ask** with `AskUserQuestion`
  (single question, `multiSelect: false`), for example:
  - "All (except info)" → `all`
  - "Critical and high only" → `>=high` (offer it only if such findings exist)
  - "None — keep the report only" → `none`

  The user can answer "Other" with ids and severities (`F1 F4`, `F2,medium`, `>=medium`…).
  **Wait for the answer; never choose in their place.** `none` (or an empty answer) ends
  here: go to the summary.

  If `AskUserQuestion` is unavailable (non-interactive run), do not fix anything: end with the
  list and tell the user to run `/scanner:remediate <RUN> <selection>` once they have chosen.

## 9. Fix — modes `fix` and `review`

Follow the `/scanner:remediate` procedure from its step 2 with `<RUN> <selection>`: one fix
branch for the run, one worktree, one `scanner:remediator` per finding **one after the
other**, one commit per finding, then `fix-status` and `guard off`.

## Summary for the user

A few lines: counts per severity, new / resolved since the previous scan, the three most
severe findings (`file:line` and title), the report path (modes `report` and `review`), what
could not be examined. If fixes ran: the branch, the worktree, the `fix-status` counts, and
what could not be verified. Otherwise suggest `/scanner:remediate <RUN> <selection>`.

Recall any `reportInstructions` still to do (registering the report, committing it) —
**without doing them**. Never push and never open a pull request: only offer to.
