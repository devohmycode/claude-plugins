# docflow — Technical design

| | |
|---|---|
| Status | Draft v0.1 |
| Date | 28 September 2026 |
| Implements | [PRD](PRD.md) v0.2 |

French version: [ARCHITECTURE-FR.md](ARCHITECTURE-FR.md). Exact values
(files, schemas, commands, outputs, exit codes) are fixed in the
[specifications](SPECS.md); progress is tracked in [TASKS.md](TASKS.md).

## 1. Principles

1. **Scripts do, the model writes.** Every command file is a short recipe:
   call the script, read its `KEY=value` lines, write prose or code only where
   the script says so, call the script again (PRD § 7, T-1, T-2).
2. **The repository is the state.** Documents, `TASKS.md` and
   `.docflow/state.json` hold everything; no step relies on the conversation,
   so any step resumes in a new session (C-2).
3. **Read the least.** The script extracts sections and task lines; a command
   never loads a whole document it does not rewrite (T-3).
4. **One engine, no dependency on other plugins** (PRD § 12, decision 2), but
   the marketplace's shared modules are used as every plugin does.

## 2. Overview

```text
 user ──► /docflow:<command>  (commands/*.md, English instructions)
              │
              │  node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs" <verb> …
              ▼
        docflow.mjs ──► lib/config · state · docs · tasks · run · issues · claudemd
              │             │
              │             └─ shared copies: i18n · repo · scope · findings
              ▼
        KEY=value lines + exit code ──► the command decides the next step
              │
              ├─► the session writes a section / implements a task   (default)
              └─► Agent: writer · translator · implementer · acceptance

 hooks/hooks.json ──► scripts/hook.mjs   PreToolUse guard · Stop / SubagentStop check
```

## 3. Plugin layout

```text
docflow/
  .claude-plugin/plugin.json   manifest, userConfig options (SPECS § 3)
  commands/                    prd, architecture, specs, tasks, claude-md, approve,
                               run, do, status, translate, check, issues, language
  agents/                      writer, translator, implementer, acceptance
  hooks/hooks.json             PreToolUse, Stop, SubagentStop → scripts/hook.mjs
  templates/<lang>/            prd.md, architecture.md, specs.md, tasks.md skeletons
  locales/                     en.json (reference), fr.json, es.json, de.json
  scripts/
    docflow.mjs                command-line entry: parses the verb, prints KEY=value
    hook.mjs                   hook entry
    lib/config.mjs             options: arguments > project > /config > defaults
    lib/state.mjs              .docflow/state.json read/write, lock
    lib/docs.mjs               skeletons, links, section index, fingerprints, checks
    lib/tasks.mjs              TASKS.md parser and editor (tick, result, issue numbers)
    lib/run.mjs                branches, worktrees, checks, commits, push, pull requests
    lib/issues.mjs             GitHub issues mirror through `gh`
    lib/claudemd.mjs           the CLAUDE.md block
    i18n.mjs repo.mjs scope.mjs findings.mjs   generated copies (sync-shared.mjs)
  docs/                        PRD, ARCHITECTURE, SPECS, TASKS (+ -FR twins)
  README.md
tests/docflow/                 node:test suites, run by the marketplace CI
```

The plugin is listed in the marketplace with `"source": "./docflow"`;
`scripts/sync-shared.mjs` finds it there and keeps its shared copies and its
`userConfig.language` field in sync.

## 4. Script modules

| Module | Responsibility | Key functions |
|---|---|---|
| `config` | Resolve every option with precedence *argument > `.docflow/config.json` > `/config` (`userOption`) > default*; detect the checks command | `loadConfig(root, args)` |
| `state` | Load, validate and atomically save the state; approvals, staleness, lock with owner session and expiry | `readState`, `writeState`, `approve`, `markStale`, `acquireLock`, `releaseLock` |
| `docs` | Write a skeleton from a template; index numbered sections; extract one section; fingerprint sections; list links; check twins and links | `skeleton`, `indexSections`, `section`, `fingerprints`, `checkDocs` |
| `tasks` | Parse `TASKS.md` into sprints, tasks, acceptance entries; tick or untick; write results and issue numbers; mirror ticks into twins | `parseTasks`, `nextUnit`, `tick`, `recordResult`, `setIssue` |
| `run` | Plan and execute a run: base branch, branch name, optional worktree, checks, commit, push, draft pull request, restore | `startRun`, `runChecks`, `commitTask`, `finishRun`, `resumeRun` |
| `issues` | Push tasks as issues, pull closed/reopened states, keep keys and labels | `pushIssues`, `pullIssues` |
| `claudemd` | Write or refresh the marked block of `CLAUDE.md` | `writeBlock` |
| `hook` | Decide on a tool call (guard) and on stopping (completeness) | `preToolUse`, `onStop` |

Each module is a set of pure functions over inputs plus a thin I/O layer,
so tests run on temporary directories and fake `git`/`gh` runners.

## 5. Command recipes

A command file follows the same pattern; the script is written below as
`DOCFLOW`.

### 5.1 Document stage (`prd`, `architecture`, `specs`, `tasks`)

1. `DOCFLOW stage <doc>` → gate check (predecessor approved), repository check,
   skeleton written if missing; prints `DOC=`, `INPUTS=` (section references to
   read), `SECTIONS=` (sections to fill), `LANGS=`.
2. The model reads only `INPUTS` (via `DOCFLOW section <ref>`), asks the user
   the questions the stage needs (PRD interview), and fills the listed sections
   in place with `Edit`.
3. `DOCFLOW check <doc>` → missing sections, broken links; the model fixes only
   what is reported.
4. If `LANGS` is not empty: `/docflow:translate <doc>` (§ 5.4).
5. Checkpoint: show the open questions; on approval `DOCFLOW approve <doc>`,
   which also refreshes the `CLAUDE.md` block.

### 5.2 Chaining (`run`, `status`)

`DOCFLOW status` computes, from the state and file fingerprints only, each
document's status and the next command. `/docflow:run` runs that command and
stops at its checkpoint; `--through <doc>` skips checkpoints already passed
once.

### 5.3 Implementation (`do`)

```text
DOCFLOW do start <S2|S2-T3|next>      lock, base, branch, worktree → UNIT=, TASKS=, WORKDIR=
  for each task in TASKS:
    DOCFLOW task show <id>            task line + referenced sections (extracted)
    implement (session | agent)
    DOCFLOW do check <id>             runs the checks → CHECKS=pass|fail, LOG= (tail on fail)
    DOCFLOW do commit <id>            tick (+ twins), commit code and tick together
  DOCFLOW do acceptance <S2>          prints the test; result recorded by `do result`
DOCFLOW do finish                      push, draft pull request, restore, release lock → PR=
```

A failing check leaves the branch and the lock with the run state set to
`failed`; `DOCFLOW do start --resume` continues from the first unticked task.

### 5.4 Translation (`translate`)

`DOCFLOW translate plan <doc>` compares the fingerprints of the English
sections with those recorded for each twin and prints the changed section ids.
The translator agent receives only those sections and returns them;
`DOCFLOW translate apply <doc> <lang>` splices them into the twin, rewrites its
links and records the new fingerprints.

### 5.5 Issues (`issues`)

`DOCFLOW issues push` lists existing issues carrying a docflow key through
`gh`, creates the missing ones, updates changed titles and bodies, and writes
issue numbers into `TASKS.md`. `DOCFLOW issues pull` reports divergences; the
command asks before `DOCFLOW issues pull --apply`.

## 6. Agents

| Agent | Receives | Returns | Default model |
|---|---|---|---|
| `writer` | Section ids to fill, extracted inputs, the user's answers | Filled sections, written in place | inherit |
| `translator` | Changed English sections, target language, glossary of identifiers | Translated sections as text | haiku |
| `implementer` | One task or one sprint: task lines, referenced sections, `WORKDIR` | Code changes; never ticks or commits (the script does) | inherit |
| `acceptance` | The acceptance test text and the run's `WORKDIR` | `RESULT=passed|failed` and a one-line evidence | sonnet |

With the defaults (`unit: sprint`, `implementer: session`) the session itself
plays `writer` and `implementer`; agents are used when the option or argument
asks for them, and always for translation.

## 7. Hooks and guard

- The guard is armed by `do start` in `.docflow/state.json` (session id, root,
  worktree) and disarmed by `do finish`; `scope.mjs` limits it to that session
  and repository.
- `PreToolUse` (`Bash`, `Edit`, `Write`): refuse pushes to the default branch,
  force pushes, `gh pr merge`, commits on the default branch, and edits of
  approved documents other than `TASKS.md` ticks and results (SPECS § 8).
- `Stop` / `SubagentStop`: while a run is active, refuse to stop when the
  current task is neither ticked nor recorded as failed.
- Outside a run the hooks allow everything and cost one state read.

## 8. Data

- `.docflow/state.json`: approvals with fingerprints, stale marks, lock, run
  (unit, branch, worktree, current task, status), translation fingerprints.
  Committed files are the documents and `TASKS.md`; `.docflow/` is ignored by
  git except `config.json`.
- `.docflow/config.json`: project options (SPECS § 3).
- Documents follow the formats of PRD § 9; section numbers are the anchors of
  every reference.

## 9. Error handling

- Every verb prints `OK=1` or `ERROR=<code>` with a translated message and a
  stable exit code (SPECS § 5); commands branch on exit codes, never on prose.
- Git and `gh` failures are reported with the failing command and the last 20
  lines of its output only.
- State writes are atomic (write to a temporary file, then rename).

## 10. Delivery plan

| Step | Content |
|---|---|
| 1 | Scaffold: manifest, marketplace entry, locales, shared copies, `config`, `state`, `docflow.mjs` with `status`, test harness. |
| 2 | Document chain: templates, `docs`, `stage`, `section`, `check`, `approve`, `claudemd`, `run`; commands `prd` to `claude-md`, `approve`, `run`, `status`, `check`. |
| 3 | Translations: fingerprints, `translate plan/apply`, `translator` agent, `translate` command. |
| 4 | Implementation engine: `tasks`, `run`, `do` verbs, `implementer` and `acceptance` agents, hooks and guard. |
| 5 | Issues mirror: `issues` module and command, `Closes #` in pull requests. |
| 6 | Documentation and dogfooding: README, marketplace release, docflow applied to a real project (Taskbar Hub `--adopt`). |

## 11. Testing

- Unit tests per module on temporary repositories; `git` and `gh` behind
  injectable runners so pull requests and issues are faked.
- Golden files for skeletons, `TASKS.md` edits and the `CLAUDE.md` block.
- `node scripts/sync-shared.mjs --check` and the locale catalog check in CI.
- Token checks of PRD § 11 measured by counting the files each recipe reads.

## 12. Decisions

1. Node.js scripts only, like the other plugins; no build step.
2. `TASKS.md` is edited by the script, never by the model, so its grammar stays
   parseable.
3. The session is the default writer and implementer (PRD decision 4); agents
   are opt-in, except the translator.
4. Issue keys reuse the shared `findings.mjs` key comment, so `tracker`
   recognises docflow issues without change.
