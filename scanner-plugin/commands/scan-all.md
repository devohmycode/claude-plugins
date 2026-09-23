---
description: Run every available scan type, one after the other, after checking the profiles
argument-hint: [--scope full|diff|<path>]
allowed-tools: Bash(node:*), Read, Agent
---

# All scans: $ARGUMENTS

A profile is valid for one scan type only: "scan everything" therefore means one scan per
type.

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs" check`. If it fails, show the `✗` lines
   and **stop**: a stale overlay or config would send the scanners after things that no longer
   exist. The user fixes it, or reruns knowingly.
2. `node "${CLAUDE_PLUGIN_ROOT}/scripts/scanner.mjs" types` for the list of types.
3. For each type, **one after the other** (the guard holds one scan at a time, each with its
   own exclusions), follow exactly the `/scanner:scan` procedure with `<type> $ARGUMENTS`:
   prepare, investigate in parallel, consolidate, triage in parallel, finalize, report, guard
   off.
4. Final summary, in the language of the `LANG=` line printed by `prepare`: a type × severity table, new and resolved findings per type, the report
   paths.

Before starting, announce the number of types and batches planned: it is the order of
magnitude of the cost.
