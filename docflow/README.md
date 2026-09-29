# docflow — from an idea to merged code, through linked documents

French version: [README-FR.md](README-FR.md).

docflow writes a fixed chain of documents — PRD, technical design, specifications, tasks
and a `CLAUDE.md` block — one command per document, each approved at a checkpoint. Then it
implements the plan task by task or sprint by sprint: one branch per unit, the project's
checks after each task, `TASKS.md` ticked by the script, and a **draft** pull request that
you merge yourself.

```text
PRD ──► ARCHITECTURE ──► SPECS ──► TASKS ──► CLAUDE.md ──► /docflow:do
what      how            exact      sprints    rules for     branch · checks ·
and why   (modules)      values     & tasks    every agent   tick · commit · draft PR
```

Scripts do the mechanical work (skeletons, links, state, branches, checks, ticks, commits,
pushes, pull requests); the model only writes documents and code.

## Install

```
/plugin marketplace add devohmycode/claude-plugins
/plugin install docflow@devohmycode-plugins
```

Requires git and Node 18+; the GitHub CLI (`gh`, logged in) for pull requests
and the issues mirror.

## The flow

1. **Documents.** `/docflow:run` runs the next stage of the chain and stops at its
   checkpoint; run it again after each approval. Or call the stages one by one:
   `/docflow:prd "<idea>"` (a short interview), `/docflow:architecture`, `/docflow:specs`,
   `/docflow:tasks`, then `/docflow:claude-md`. Each document links to the others, and
   `/docflow:approve <doc>` records it — changing an approved document later marks the
   following ones *stale*, and `/docflow:status` says which to redo.
2. **Implementation.** `/docflow:do next` takes the next unit of `docs/TASKS.md` — a sprint
   by default — creates `docflow/S2-<slug>`, and for each task reads only the task line and
   the SPECS sections it cites, writes the code, runs the checks, and lets the script tick
   and commit. A sprint ends with its acceptance test, recorded under it. Then a draft pull
   request. A failed check stops the run with its branch kept; `/docflow:do --resume`
   continues, from the same session or another.
3. **Review.** You read the draft and merge it. The next `/docflow:do next` starts after it
   — stacked on the pending branch while that one is not merged.

An existing code base? `/docflow:prd --adopt` starts from a summary of its layout instead
of an empty page, and `/docflow:tasks --adopt` marks the first sprint as done.

## Commands

| Command | Does |
| --- | --- |
| `/docflow:prd [idea] [--adopt]` | Writes `docs/PRD.md` from a short interview |
| `/docflow:architecture [--adopt]` | Writes `docs/ARCHITECTURE.md` from the approved PRD |
| `/docflow:specs` | Writes `docs/SPECS.md`: the exact values the design relies on |
| `/docflow:tasks [--adopt]` | Writes `docs/TASKS.md`: sprints, tasks citing SPECS sections, acceptance tests |
| `/docflow:claude-md` | Writes or refreshes the docflow block of `CLAUDE.md` (≤ 40 lines) |
| `/docflow:approve <doc>` | Checks and approves a document; marks the following ones stale when it changed |
| `/docflow:run [--through <doc>]` | Runs the next pending stage of the chain |
| `/docflow:status` | The chain, the sprint progress, the run in progress, the next command |
| `/docflow:do <next\|S<n>\|S<n>-T<m>>` | Implements a unit (`--resume`, `--unit`, `--implementer`, `--worktree`, `--in-place`) |
| `/docflow:translate [doc] [--lang fr\|es\|de]` | Updates the translated twins, section by section |
| `/docflow:check [doc]` | Missing or unfilled sections, broken links, `TASKS.md` grammar, twins |
| `/docflow:issues push\|pull [--apply]` | Mirrors the tasks as GitHub issues, or reports the ones closed by hand |
| `/docflow:language [en\|fr\|es\|de\|default]` | The language of the plugin's messages |

## Options

Set them in `/config` (the docflow rows), per project with
`node <plugin>/scripts/docflow.mjs config <key> <value>` (saved in `.docflow/config.json`,
committed), or as a command argument. An argument wins over the project, which wins over
`/config`, which wins over the default.

| Option | Values | Default |
| --- | --- | --- |
| `language` | `en`, `fr`, `es`, `de` | `en` |
| `doc_languages` | twins to keep, e.g. `fr` or `fr,de` | none |
| `unit` | `task`, `sprint` — what `/docflow:do next` takes | `sprint` |
| `implementer` | `session`, `task` (a fresh agent per task), `sprint` (one agent per sprint) | `session` |
| `worktree` | `on` (a separate checkout per run), `off` (your checkout switches branch) | `off` |
| `issues` | `off`, `mirror` | `off` |
| `checks` | the command that tests the project; detected from `Cargo.toml`, `package.json`, `pyproject.toml`, `go.mod`, else asked once | detected |
| `branch_prefix` | text ending with `/` | `docflow/` |
| `<agent>_model` | `inherit`, `haiku`, `sonnet`, `opus`, `fable` — for `writer`, `translator`, `implementer`, `acceptance` | `inherit`; `haiku` for the translator, `sonnet` for acceptance |
| `<agent>_effort` | `inherit`, `low` … `max` | `inherit` |

## The guard

While a run is active — in the session that started it, in its repository only — a hook
refuses a push to the default branch, a forced push, a commit on the default branch,
`gh pr merge`, and any edit of an approved document or of `TASKS.md` other than the
script's. When the session stops, another hook checks that the current task was either
committed or reported as failed. docflow never merges.

## Translations

With `doc_languages: fr`, each document has a twin (`docs/PRD-FR.md`…). The script
fingerprints every English section; `/docflow:translate` sends only the sections that
changed to a small-model translator and splices them back. Ticks and results are written
into every twin of `TASKS.md` by the script.

## Issues mirror

With `issues: mirror`, `/docflow:issues push` opens one issue per unticked task and per
acceptance test (`S2-T3 <title>`, labels `docflow` and `sprint:S2`), writes its number
after the id in `TASKS.md` (`**S2-T3** (#42)`), and never opens it twice: the body carries
the key `<!-- tracker:key=id:docflow-S2-T3 -->`, which the
[tracker](../tracker-plugin/) plugin reads too. The pull request of a run lists
`Closes #42` for each task it ticks. `/docflow:issues pull` reports issues closed or
reopened by hand, and follows them once you agree. `TASKS.md` stays the source of truth.

## Spending fewer tokens

- Let the scripts answer: `/docflow:status` reads no document, and a failed check shows
  only the last 60 lines of its log.
- Keep tasks small and cite SPECS sections (`Refs: SPECS § 3.2`): the implementer reads
  those sections, never whole documents.
- `implementer: session` (default) reuses the code already loaded; switch to
  `implementer: task` when a sprint is long, so each task starts from a clean context.
- Leave the translator on `haiku` and acceptance on `sonnet`; set `writer_model` only if
  the documents need it.
- Translate after the English is settled: an unchanged section is never re-sent.

## Files

| Path | Content | In git |
| --- | --- | --- |
| `docs/PRD.md`, `ARCHITECTURE.md`, `SPECS.md`, `TASKS.md` (+ twins) | The document chain | yes |
| `CLAUDE.md` | The docflow block, between markers | yes |
| `.docflow/config.json` | Project options | yes |
| `.docflow/state.json` | Approvals, fingerprints, lock, run | no |
| `.docflow/logs/` | The full log of each checks run | no |

## Language

English by default; French, Spanish or German with `/docflow:language`, the **Language**
row of `/config`, or `CLAUDE_PLUGINS_LANGUAGE` for every plugin of this marketplace.
Documents are written in English; their twins follow `doc_languages`.

## Design

The plugin follows its own chain: [PRD](docs/PRD.md) → [architecture](docs/ARCHITECTURE.md)
→ [specifications](docs/SPECS.md) → [tasks](docs/TASKS.md).
