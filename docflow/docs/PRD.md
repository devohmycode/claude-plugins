# docflow — Product Requirements Document

| | |
|---|---|
| Status | Draft v0.2 — decisions of § 12 recorded |
| Date | 28 September 2026 |
| Kind | Claude Code plugin, marketplace `devohmycode-plugins` |

French version: [PRD-FR.md](PRD-FR.md). Next documents: the
[architecture](ARCHITECTURE.md), the [specifications](SPECS.md) and the
[tasks](TASKS.md).

## 1. Vision

docflow takes a project from an idea to merged code through a fixed chain of
documents, then lets an agent implement the plan task by task or sprint by
sprint, on branches, with tests, a ticked task list and draft pull requests.

```text
PRD ──► ARCHITECTURE ──► SPECS ──► TASKS ──► CLAUDE.md ──► implementation
 what      how            exact      sprints     rules for      branch · checks ·
 and why   (modules)      values     & tasks     every agent    tick · commit · draft PR
```

Every document links to the others, so any agent that opens one of them finds
the whole frame and follows it exactly. The plugin spends model tokens only on
writing and coding; everything mechanical is done by scripts.

## 2. Problem

- Asking an agent to "build the app" gives work with no traceable intent: no
  requirement to check it against, no plan to resume from.
- Writing the frame by hand is long, and keeping four documents, their
  translations and a task list consistent is error-prone.
- Long agent sessions accumulate context: the same files are re-read, the
  history grows, and cost climbs with every task.
- Without a guard, an agent commits on `main`, forgets the tests, leaves the
  task list stale or opens a pull request that is merged unseen.

## 3. Goals and non-goals

### Goals

1. One command per document, in a fixed order, each reading only what it needs.
2. Optional chaining of the whole chain, with a human checkpoint after each
   document and resumable state.
3. Implementation by task or by sprint, each on its own branch, closed by the
   project's checks, a ticked `TASKS.md`, a commit and a **draft** pull request.
4. Optional document translations (`<NAME>-FR.md`, and Spanish or German),
   updated incrementally.
5. A token budget treated as a requirement (§ 7).

### Non-goals

- No merge: docflow never merges a pull request and never pushes to the default
  branch.
- No project management service: `TASKS.md` in the repository stays the
  single source of truth; GitHub issues are only an optional mirror (§ 6.8).
- No code generation outside the task being implemented.

## 4. Users

- A developer starting a project who wants a documented frame before code.
- A developer taking over an existing code base who wants the same frame
  written from the code (§ 6.1, adopt mode).
- An agent resuming work in a later session: it reads `CLAUDE.md`, then
  `TASKS.md`, and knows exactly what to do next.

## 5. Concepts

| Term | Definition |
|---|---|
| **Document chain** | `docs/PRD.md` → `docs/ARCHITECTURE.md` → `docs/SPECS.md` → `docs/TASKS.md` → `CLAUDE.md`. Each document may only be written once its predecessor is approved. |
| **Translation** | `docs/<NAME>-<LANG>.md` (`FR`, `ES`, `DE`) next to each English document, same structure, linked both ways. |
| **Task** | A line of `TASKS.md`: checkbox, id `S<n>-T<m>`, title, references (`SPECS § 3.2`), optional *Done when* condition. |
| **Sprint** | A group of tasks `S<n>` ending with an **acceptance test**; validated only when it passes. |
| **Run** | One implementation of a task or a sprint: a branch, optional worktree, checks, commit(s), a draft pull request. |
| **State** | `.docflow/state.json`: approved documents, current stage, the lock and the running run. |

## 6. Functional requirements

### 6.1 Documents

| Command | Reads | Writes |
|---|---|---|
| `/docflow:prd [idea]` | The user's answers to a short interview (goal, users, scope, constraints) | `docs/PRD.md` |
| `/docflow:architecture` | PRD; for an existing code base, a script-made summary of its layout | `docs/ARCHITECTURE.md` |
| `/docflow:specs` | PRD, architecture | `docs/SPECS.md` |
| `/docflow:tasks` | Architecture delivery plan, SPECS headings | `docs/TASKS.md` |
| `/docflow:claude-md` | State only (script) | `CLAUDE.md` section between markers |

- **D-1** A script writes each document's skeleton first: title table (status,
  date), the translation link, the links to the neighbouring documents, and the
  required section headings. The model fills the sections only.
- **D-2** Required sections: PRD (vision, problem, goals and non-goals, users,
  functional and non-functional requirements, acceptance criteria, open
  questions); ARCHITECTURE (starting point, overview, modules, contracts, data,
  delivery plan, testing, decisions); SPECS (exact values: settings, formats,
  limits, identifiers, budgets); TASKS (how to work, sprints, acceptance tests).
- **D-3** Every document ends with its open questions or decisions; approving
  it (`/docflow:approve <doc>`) records it in the state. A later document
  refuses to start until its predecessor is approved.
- **D-4** Editing an approved document marks the following ones as *stale*;
  `/docflow:status` lists them and the command to refresh each.
- **D-5** Adopt mode (`--adopt`): for an existing code base, the architecture
  describes the current code before the target, and `TASKS.md` may start with
  a sprint S1 already ticked for what exists.
- **D-6** `CLAUDE.md`: docflow owns only the block between
  `<!-- docflow:start -->` and `<!-- docflow:end -->`, at most 40 lines: the
  document chain with links, the working rules (branch, checks, tick, draft
  pull request, no merge) and the next command to run. The rest of the file is
  never touched.

### 6.2 Translations

- **L-1** Option `doc_languages` (none by default; any of `fr`, `es`, `de`). For
  each, every document gets its `-FR`, `-ES` or `-DE` twin.
- **L-2** The English document is the reference. A script fingerprints each
  English section; only sections whose fingerprint changed are sent for
  translation, then spliced into the twin.
- **L-3** Translation runs in a dedicated agent on a small model by default;
  code, identifiers, commands and paths are never translated.
- **L-4** A check (`docflow check docs`) reports twins with missing, extra or
  outdated sections and broken links; it runs before each approval.

### 6.3 Chaining

- **C-1** `/docflow:run` runs the next pending stage of the chain, then stops
  at the checkpoint (show the document, ask to approve, amend or stop).
  `--through <stage>` continues across checkpoints only for stages the user
  already approved once.
- **C-2** The state makes any stage resumable in a new session: `/docflow:run`
  always starts from the state, never from memory.
- **C-3** `/docflow:status` prints, from the script alone, the chain (approved,
  stale, missing), the sprint progress and the next command.

### 6.4 Implementation

- **I-1** `/docflow:do <task|sprint|next>`: `next` takes the first unticked
  task, or the current sprint in sprint mode (option `unit`: `task` or
  `sprint`).
- **I-2** The lock comes first: one run at a time per repository; a busy lock
  exits with a clear message and changes nothing. docflow has its own lock,
  branch and pull-request engine and does not depend on `tracker`.
- **I-3** The script creates the branch `docflow/<S1-T3>-<slug>` or
  `docflow/<S2>-<slug>` from the default branch, in a worktree when
  `worktree` is on, and prints the task lines and the referenced sections.
- **I-4** Who implements (option `implementer`): `task` (one fresh agent per
  task), `sprint` (one agent for the sprint) or `session` (the current session,
  no agent — fewest tokens when the code is already loaded).
- **I-5** After each task: the project's check command (option `checks`,
  e.g. `cargo test --locked`) must pass; the script ticks the task in
  `TASKS.md` (and in its twins) and commits code and tick together, with a
  message built from the task id and title.
- **I-6** End of a sprint: the acceptance test is run (by the agent, or listed
  for the user when it is manual); its result is written under the acceptance
  box, which is ticked only on success.
- **I-7** The script pushes the branch and opens a **draft** pull request whose
  body lists the ticked tasks, the checks and the acceptance result, then
  releases the lock. It never merges.
- **I-8** A failing check stops the run with the branch kept and the task
  unticked; `/docflow:do --resume` continues from there.

### 6.5 Guard

- **G-1** While a run holds the lock, hooks refuse: commits and pushes on the
  default branch, force pushes, `gh pr merge`, and edits to approved documents
  other than ticking `TASKS.md`. The guard is scoped to the session and the
  repository, as the marketplace's shared guard.
- **G-2** A `Stop` hook refuses to end a run whose last task is neither ticked
  nor reported as failed.

### 6.6 Options

Set in `/config` (`userConfig`), overridable per project in
`.docflow/config.json`, overridable per command by arguments.

| Option | Values | Default |
|---|---|---|
| `language` | `en`, `fr`, `es`, `de` (plugin messages) | `en` |
| `doc_languages` | list of `fr`, `es`, `de` | none |
| `unit` | `task`, `sprint` | `sprint` |
| `implementer` | `task`, `sprint`, `session` | `session` |
| `issues` | `off`, `mirror` | `off` |
| `worktree` | `true`, `false` | `false` |
| `checks` | shell command | detected from the project (`cargo`, `npm`, `pytest`…) |
| `branch_prefix` | string | `docflow/` |
| `<stage>_model`, `<stage>_effort` | per stage: `writer`, `translator`, `implementer`, `acceptance` | `writer` inherit · `translator` haiku · `implementer` inherit · `acceptance` sonnet |

### 6.7 Marketplace rules

- **M-1** Messages in English, French, Spanish and German through the shared
  i18n engine; instruction files in English.
- **M-2** Commands that need git check the repository state with the shared
  `repo.mjs` and offer to create it (`REPO=` contract), asking before creating
  a GitHub repository.
- **M-3** The plugin lives in `docflow/` and is listed in
  `.claude-plugin/marketplace.json`. This deliberately departs from the
  `<name>-plugin/` naming of the other plugins (decision of § 12).

### 6.8 GitHub issues mirror

With `issues: mirror`, tasks are mirrored as GitHub issues so that `tracker` or
a person can pick them up; `TASKS.md` stays the source of truth.

- **S-1** `/docflow:issues push` creates one issue per unticked task, titled
  `S2-T3 <title>`, labelled `docflow` and `sprint:S2`, its body holding the task
  line, its references and a deduplication key `docflow:<task id>`, written in
  the key format `tracker` recognises. Running it again creates nothing twice
  and updates changed titles or references.
- **S-2** A task's issue number is written after its id in `TASKS.md`
  (`**S2-T3** (#42)`); the draft pull request of a run lists `Closes #42` for
  each task it ticks.
- **S-3** `/docflow:issues pull` reports issues closed or reopened outside
  docflow and, after asking, ticks or unticks the matching tasks.
- **S-4** Sprint acceptance tests are mirrored as issues too, labelled
  `acceptance`, and closed only when their box is ticked.

## 7. Token economy

Treated as requirements, checked in the acceptance tests.

| Id | Requirement |
|---|---|
| **T-1** | Mechanical work is done by scripts, never by the model: skeletons, links, state, branches, worktrees, checks, ticking, commits, pushes, pull requests. |
| **T-2** | Scripts answer in short `KEY=value` lines and exit codes; the model reads no logs unless a step failed, then only the failing part. |
| **T-3** | Each stage reads only its inputs (§ 6.1). Implementation reads the task line and the sections it references, extracted by `docflow section SPECS 3.2`, never whole documents. |
| **T-4** | The default `implementer: session` reuses the code already loaded in the session; `implementer: task` starts a fresh agent per task when the session grows large, keeping only ids and results in the orchestrator. |
| **T-5** | Model per stage: translation and acceptance summaries on small models by default. |
| **T-6** | Translation is incremental (§ 6.2); an unchanged section is never re-sent. |
| **T-7** | The `CLAUDE.md` block stays under 40 lines, since it is loaded in every session. |
| **T-8** | No command re-reads a file it has just written; the script reports what changed. |

## 8. Plugin components

| Component | Content |
|---|---|
| Commands | `prd`, `architecture`, `specs`, `tasks`, `claude-md`, `approve`, `run`, `do`, `status`, `translate`, `check`, `issues`, `language` |
| Agents | `writer` (a document section set), `translator` (sections), `implementer` (one task or sprint), `acceptance` (runs and reports an acceptance test) |
| Scripts | `docflow.mjs` (state, skeletons, links, sections, fingerprints, lock, branches, checks, ticks, commits, pull requests), shared `i18n.mjs`, `repo.mjs`, `guard.mjs` |
| Hooks | `PreToolUse` (guard), `Stop` / `SubagentStop` (run completeness) |
| Templates | One skeleton per document and per language |

## 9. Document formats

- Title table, then a translation line and neighbour links, then numbered
  sections (`## 1. …`) so references like `SPECS § 3.2` resolve by script.
- `TASKS.md` grammar, parsed by the script:

  ```text
  ## S2 — <sprint title>
  - [ ] **S2-T3** <title>. Refs: SPECS § 2.2, ARCHITECTURE § 5.1.
    *Done when* <condition>.
  - [ ] **S2 acceptance** — <test>.
    *Result (<date>): <passed|failed> — <evidence>.*
  ```

## 10. Non-functional requirements

- **N-1** Node.js only (as the other plugins); Windows, macOS and Linux paths.
- **N-2** No network access except `git` and `gh`.
- **N-3** Every script step is idempotent and resumable after an interruption.
- **N-4** A run never leaves the checkout on another branch without saying so;
  with `worktree: off` the original branch is restored after the pull request.
- **N-5** Unit tests for the script (parsing, fingerprints, state, lock, git
  plans) in the marketplace's test suite; `sync-shared.mjs --check` passes.

## 11. Acceptance criteria

1. On an empty repository, `/docflow:run` five times with approvals produces the
   five documents, each linked to its neighbours and to its French twin when
   `doc_languages` includes `fr`; `docflow check docs` reports nothing.
2. Changing one section of the English SPECS and running `/docflow:translate`
   re-sends only that section.
3. `/docflow:do next` on a task implements it on its own branch, runs the
   checks, ticks it in `TASKS.md` and its twin, commits, and opens a draft pull
   request; the default branch is unchanged.
4. `/docflow:do S2` with the default `unit: sprint` does the same for every
   task of S2, records the acceptance result and ticks it only on success.
5. While a run is active, a `git push` to the default branch and a
   `gh pr merge` are refused by the guard.
6. A new session opened on the repository reads `CLAUDE.md`, and
   `/docflow:status` names the next command without reading any document.
7. Token check: implementing a task with `implementer: task` loads, in the
   agent, only the task line, its referenced sections and the code it edits.
8. With `issues: mirror`, `/docflow:issues push` run twice creates each task's
   issue once; the draft pull request of a sprint closes the issues of its
   ticked tasks; an issue closed by hand is reported by
   `/docflow:issues pull`.

## 12. Decisions

Recorded on 28 September 2026.

1. The plugin lives in `docflow/`, not `docflow-plugin/` (§ 6.7, M-3).
2. docflow keeps its own lock, branch and pull-request engine; it does not
   reuse `tracker`'s (§ 6.4, I-2).
3. Tasks can be mirrored as GitHub issues that `tracker` can take over
   (§ 6.8).
4. Defaults are `unit: sprint` and `implementer: session`: fewer tokens, at the
   cost of a larger session context (§ 6.6).
