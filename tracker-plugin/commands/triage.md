---
description: Triage open issues against the current code — unchanged issues decided by the script, triagers in parallel for the rest, a skeptic on every claim that an issue was fixed or became obsolete, then a decision table; nothing is written to GitHub without your agreement
argument-hint: '<12 15 | priority:P1 | severity:high | axis:security | label:<name> | all> [--max 15] [--per-agent n] [--full] [--model …] [--effort …]'
allowed-tools: Bash(node:*), Read, Agent, AskUserQuestion
---

# Triage: $ARGUMENTS

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs"` (below: `TRACKER`). You do not
judge the issues yourself: the agents do, and the script turns their verdicts into decisions.

A **selection** is one or more tokens: issue numbers (`12`, `#12`), `priority:P1`,
`severity:high`, `axis:security` (turned into labels through the project's templates),
`label:<name>`, or `all` (every open issue). Tokens combine (all must match). `--max` bounds
the count (`triage.max` of the config, 15 by default); past it, the script prints a
`DROPPED=` line with the issues left out — tell the user which ones.

1. Without arguments: ask what to triage, stop.
2. `TRACKER triage prepare <selection> [--max n] [--per-agent n] [--full] [--model …]
   [--effort …]` — writes one `issue-<n>.json` per issue in the run directory and arms the
   guard (read-only tree, no write to GitHub). An issue whose file has not changed since it
   was opened, or since a triage found it holding, is decided `holds` by the script itself,
   without an agent (`UNCHANGED=`); `--full` turns that off. Note `RUN=`, `DIR=`, `COMMIT=`,
   `LANG=`, `ISSUES=`, `UNCHANGED=`, the `GROUP=` lines, `AGENTS=`, `TRIAGER=`,
   `TRIAGER_MODEL=`, `SKEPTIC=`, `SKEPTIC_MODEL=`. If it fails, show the error and stop.
   Relay the `Cost:` line as it is.
3. **Triagers, in parallel**: for each `GROUP=` line (issues of one area, `--per-agent` or
   `triage.perAgent` of them at most, one by default), one agent of type `TRIAGER=`, with the
   Agent tool's `model` parameter set to `TRIAGER_MODEL=` — omitted when it is `inherit` —
   all in a single message, with this prompt:

   ```
   DIR=<the DIR= value>
   ISSUES=<the GROUP= value>
   COMMIT=<the COMMIT= value>
   LANG=<the LANG= value>
   ```

   `AGENTS=0` (every issue unchanged): no triager, go on.

4. `TRACKER triage verify <RUN>` — counts the verdicts, names the issues without one, and
   prints `VERIFY=`: the issues claimed `fixed` or `obsolete`.
5. **Skeptics, in parallel**: for each number of `VERIFY=`, one agent of type `SKEPTIC=` (model
   `SKEPTIC_MODEL=`), same prompt with `ISSUE=<number>` in place of `ISSUES=`. An issue is
   never proposed for closing without a skeptic who agreed.
6. `TRACKER triage finalize <RUN>` — decisions and proposed actions (close, relabel the
   priority, comment), and the guard is lifted. Nothing has been written to GitHub.
7. Show the decision table: issue, verdict, reason in one line, proposed action. Then **ask**
   with `AskUserQuestion`: apply all the actions, a selection (`--only 12,15`), or none.
8. **Apply**: `TRACKER triage apply <RUN> [--only …]`. Each closing carries a comment that
   gives the reason, the commit and the run; the command can be run again safely (actions
   already applied are skipped).
9. If the triage was interrupted: `TRACKER guard off`, always.
10. Report in `LANG`: counts per verdict (and how many were decided unchanged, without an
    agent), what was closed or relabeled, the issues left `unclear` and what would settle them.
    Suggest `/tracker:batch triage:<RUN>` to fix the issues that still hold.
