---
description: Bring the issues in line with the latest scans and audits — close those whose finding is gone, reopen those whose finding came back; plan first, your agreement before anything is written
argument-hint: '[<scanner run | history file | findings file …>] [--close-only | --reopen-only]'
allowed-tools: Bash(node:*), Bash(gh issue view:*), AskUserQuestion
---

# Sync issues: $ARGUMENTS

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs"` (below: `TRACKER`).

1. **The plan**: `TRACKER sync [sources] [--close-only|--reopen-only]`. Without sources it
   reads the latest full-scope scan of each type in the scanner's history, and every findings
   file of the reports directory. It proposes:
   - to **close** an open issue whose finding a full scan no longer reports (`resolved`), or
     that an audit file marks done — never when another source still reports it;
   - to **reopen** a closed issue whose finding shows up in a source that ran after the
     closing.
2. Say what the sources are worth before asking: a scan run on a working branch says the
   defect is gone **there**, not in production. If the user merges through a default branch,
   say so.
3. **Ask** with `AskUserQuestion`: apply all, a selection (`--only 12,15`), or nothing.
4. **Apply**: the same call plus `--apply`. Each closing or reopening carries a comment that
   names the source and its commit.
5. Report: issues closed, reopened, and what was left as is.
