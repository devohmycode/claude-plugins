# tracker — the life cycle of audit findings in GitHub issues

A Claude Code plugin that takes over where an audit stops. The
[scanner](../scanner-plugin/) plugin — or any tool that writes a findings file — says what is
wrong; the tracker turns it into GitHub issues, keeps them in line with the next scans,
re-checks them against the code as it moves, and fixes them in batches.

```
 scan / audit ──► open ──► sync ──► triage ──► batch ──► pull request ──► closed on merge
```

Every step that writes to GitHub shows a plan first and waits for your agreement. Agents
judge; a script counts, compares and writes. A guard (hooks) keeps the agents inside their
role.

## Commands

| Command                        | What it does                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `/tracker:open <source…>`      | Opens the issues missing for a scan or an audit, deduplicated by key; links findings to existing issues   |
| `/tracker:sync [<source…>]`    | Closes the issues whose finding is gone from a full scan, reopens those whose finding came back           |
| `/tracker:triage <selection>`  | One triager per issue in parallel, a skeptic on each "fixed" claim, a decision table, then the actions    |
| `/tracker:batch <selection>`   | Batches by area of the code: branch + worktree, one fixer and one commit per issue, checks, draft PR     |
| `/tracker:status`              | Open issues by priority, how many carry a finding key, recent runs, the guard                             |
| `/tracker:check`               | Config, label templates, GitHub CLI, sources, findings files, agent settings                              |
| `/tracker:language [code]`     | Shows or sets the plugin language                                                                         |
| `/tracker:model [role]`        | Shows or sets the model and effort of the triager, skeptic and fixer agents                               |
| `/tracker:guard [status\|off]` | Shows or lifts the guard after an interrupted triage or batch                                             |

A **selection** is one or more tokens: issue numbers (`12`, `#12`), `priority:P1`,
`severity:high`, `axis:security`, `label:<name>`, `triage:<run>` (the issues a finalized triage
found still holding) or `all`.

## Install

```
/plugin marketplace add devohmycode/claude-plugins
/plugin install tracker@devohmycode-plugins
```

To try a local checkout: `claude --plugin-dir ./tracker-plugin`. Requirements: Node 18+, git
and the [GitHub CLI](https://cli.github.com), authenticated (`gh auth login`).

In the repository, add to `.gitignore`:

```gitignore
.tracker/runs/
.tracker/state.json
.tracker/worktrees/
```

`.tracker/config.json` is meant to be committed.

## Findings files

The tracker reads one format, the **findings contract** shared by the plugins of this
marketplace (`shared/findings/findings.mjs`, copied into each plugin as
`scripts/findings.mjs`):

- **a scan** — the `final.json` the scanner writes in `.scanner/runs/<run>/`, and its full-scope
  copies in `.scanner/history/`;
- **an audit** — a file any other producer writes next to its report, named after it with the
  configured suffix (`.findings.json` by default):

```json
{
  "kind": "audit",
  "agent": "repo-auditor",
  "report": "docs/reports/audit-2026-09-24.html",
  "commit": "2fd7aaf5",
  "branch": "main",
  "finished": "2026-09-24T14:30:00Z",
  "findings": [
    {
      "id": "SEC-48",
      "title": "The /api/x route answers 403 instead of 404 for a private record",
      "severity": "high",
      "file": "app/api/x/route.ts",
      "line": 42,
      "description": "What is wrong, and why it is a defect.",
      "reachability": "Who reaches it, by which path.",
      "evidence": "The measure that proves it.",
      "remediation": "The suggested fix."
    }
  ]
}
```

`severity` is `critical`, `high`, `medium`, `low` or `info` (`info` never becomes an issue).
Optional: `axis`, `priority` (`P0`–`P3`), `status` (`done` once fixed: the finding no longer
becomes an issue, and `sync` closes its issue), `verdict` (`refuted` never becomes an issue).

### The key

Each finding has a key, stable from one audit to the next: `fp:<fingerprint>` when it carries
one (the scanner computes it from type, rule, file and snippet — the line is left out, it
moves), `id:<ID>` otherwise — and the id must then be unique across audits, a series
identifier such as `SEC-48`, never `F1`.

The key is written into every issue the tracker opens, twice: an HTML comment
(`<!-- tracker:key=fp:… -->`) and a visible line (`fingerprint \`…\``, in the plugin's
language). Both are read back, in every supported language — issues written by hand with
such a line are recognized too. This is what makes `open` **idempotent** and `sync`
possible: never remove the Source line of an issue.

An issue that tracks a finding without its key (written by hand, by another tool, grouping
several findings) is linked with `--link security/F8=285`: the key is appended to issue
#285, and the finding will not come back. Scanner ids restart at `F1` with each run, so
findings are named `<type>/<id>` (`security/F8`); audit findings by their id.

## Triage

`/tracker:triage priority:P1` prepares a run, then launches **triagers in parallel**. A
triager re-measures the issue against the code as it is now and says `holds`,
`fixed`, `obsolete` or `unclear`, with evidence. Every `fixed` or `obsolete` claim goes to a
**skeptic**, whose role is to show the defect is still there — in a sibling route, the other
code path, the function's copy. An issue is proposed for closing only when a skeptic agreed;
a disagreement turns it back into `holds`. A `holds` whose stakes changed can be relabeled.
The decision table is shown, and nothing is written to GitHub until you agree.

### What it costs, and how to spend less

Each agent starts from nothing: its instructions, the issue, the report, the code around it.
The triage keeps that count down:

- **Unchanged issues need no agent.** When the file an issue points to has not changed since
  the last triage that found it holding — else since the commit the finding was measured at,
  else since the issue was opened — and has no uncommitted edit, the script decides `holds`
  itself. The limit: a fix made elsewhere (a middleware upstream) goes unseen; `--full`, or
  `triage.skipUnchanged: false`, has every issue re-examined.
- **Several issues per triager.** `--per-agent 3` (or `triage.perAgent`) hands up to three
  issues of the same area to one triager, which reads their shared code once and still gives
  one verdict per issue. Skeptics stay one per issue: they guard the closings.
- **A lighter model for the triager.** By default the triager runs on `sonnet` at `medium`
  effort; the skeptic and the fixer keep the session's model. See `/tracker:model`.

The script prints the number of agents before any is launched.

## Batches

`/tracker:batch triage:<run>` groups the issues that still hold by **area of the code** (the
first two path segments of their location), so that one branch touches one region, and cuts
groups larger than `batch.perBatch`. For each batch you pick:

1. a branch from the base, in a worktree under `.tracker/worktrees/` — your working tree does
   not move — and the project's `batch.setup` commands;
2. one **fixer** per issue, one after the other — or, with `--fixer batch` (`batch.fixer`),
   one fixer for the whole batch, which reads the batch's code once and still makes one
   commit per issue. It starts from the evidence of the last triage that found the issue
   holding, when there is one, instead of searching again. It follows the project's conventions
   (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`), re-measures before fixing, adds a test when it
   can, and makes **one commit** ending with `Closes #n`;
3. the project's `batch.checks` in the worktree;
4. once you have seen the branch: push, and a **draft** pull request whose body lists
   `Closes #n` for the fixed issues and `Refs #n` for the others. Issues close when it
   reaches the default branch. The tracker never merges.

## The guard (hooks)

| While…     | Refused                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| a triage   | any write outside the run directory, mutating commands, any write to GitHub                              |
| a batch    | the paths and commands the project denies, commits on a protected branch, `git push`, any write to GitHub |
| always     | after a commit: the trailers listed in `commits.forbiddenTrailers` are reported                          |

Writing to GitHub is the script's job, after your agreement, outside an armed guard. The guard
expires by itself after `guard.ttlHours`; `/tracker:guard off` lifts it after an interruption.

## Files produced

```
.tracker/config.json                      project configuration (committed)
.tracker/state.json                       the armed guard
.tracker/runs/triage-<ts>/                issue-<n>.json, verdict-<n>.json, check-<n>.json, final.json
.tracker/runs/batch-<ts>/                 plan.json, issue-<n>.json, batch-<B>.json, outcome-<n>.json
.tracker/worktrees/<run>-<B>/             one worktree per started batch
```

## Configuration — `.tracker/config.json` (optional)

Everything has a default; the file only holds what differs. `examples/config.json` is a
complete project configuration (French labels).

- `language` — `en`, `fr`, `es`, `de` (see `/tracker:language`).
- `sources` — `scannerRuns`, `scannerHistory`, `reports` (where findings files live) and
  `suffix` (`.findings.json`).
- `minSeverity` — lowest severity that becomes an issue (`low`).
- `labels` — templates: `axis` (`axis: {axis}`), `severity`, `priority`, `source.scan` and
  `source.audit` (`{YYYY}`, `{MM}`, `{DD}`), `extra` (added to every issue). Missing labels are
  created on first use, in the color of their family.
- `names.axis`, `names.severity` — what an axis or a severity becomes in a label
  (`"security": "sécurité"`); read back when selecting and triaging.
- `axisBySeries` — audit id prefix → axis (`SEC` → `security`…).
- `priority.default`, `priority.byAxis.<axis>` — severity → `P0`–`P3`. By default only
  security reaches P0.
- `title` — `template` (`{prefix}: {ref}{title}`), `prefixByAxis`, `defaultPrefix`,
  `lowercaseFirst`, `maxLength`.
- `triage` — `max`, `relabel`, `commentOnHolds`, `skipUnchanged` (`true`), `perAgent` (`1`).
- `batch` — `base`, `prBase`, `branchPrefix`, `perBatch`, `max`, `groupBy`
  (`area`, `axis`, `none`), `fixer` (`issue`, `batch`), `setup`, `checks`, `checkTimeoutMinutes`, `draft`.
- `guard` — `ttlHours`, `writeDenied` (globs), `commandsDenied` (regexes),
  `protectedBranches`.
- `commits.forbiddenTrailers` — regexes checked after each commit.
- `model`, `effort`, `roles.<triager|skeptic|fixer>.model|effort` — see `/tracker:model`.

## Agents: model and effort

Three roles — `triager`, `skeptic`, `fixer` — each with a **Model** and an **Effort** row in
`/config`. The Agent tool takes a model per call but no effort, so each agent ships one variant
per effort (`tracker:fixer-high`…), generated by `scripts/generate.mjs`; the commands pick the
variant. Precedence: command arguments, the role in the project config, the project's
top-level value, `/config`, the role's default — `sonnet` at `medium` for the triager —
then inherit (the session's model and effort).

A `/config` row saved while `inherit` was the default still reads `inherit`, and wins over
the new default: set it again (`/tracker:model triager --model sonnet --effort medium`, or
the row in `/config`) to take it.

## Language

English by default; French, Spanish and German on request — the script's messages, issue
bodies, comments, pull requests and what the agents write. See
[the marketplace rules](../CLAUDE.md#languages-mandatory-for-every-plugin-existing-or-new).
