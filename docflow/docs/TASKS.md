# docflow — Tasks

| | |
|---|---|
| Status | Draft v0.1 |
| Date | 28 September 2026 |

French version: [TASKS-FR.md](TASKS-FR.md). Backlog of the [PRD](PRD.md),
following the delivery plan of the [architecture](ARCHITECTURE.md) § 10 and
the values of the [specifications](SPECS.md). Each sprint ends with an
acceptance test and is validated only when it passes.

## How to work on this file

- One sprint at a time, in order, on a branch `docflow/S<n>-<slug>` from
  `main` (or `docflow/S<n>-T<m>-<slug>` for a single task).
- Before a task, read the sections in its `Refs`. After it, run
  `node --test tests/docflow` and `node scripts/sync-shared.mjs --check`, then
  tick the task in this file **and** in TASKS-FR.md in the same commit.
- Commit messages: `<id>: <title>`, no attribution trailer.
- Tick a sprint's acceptance box last, with its result written under it.
- Open a **draft** pull request to `main` per sprint; never merge it.
- Until S4 exists, these steps are done by hand; from S4 on, use
  `/docflow:do` on this repository.

## S1 — Scaffold

- [x] **S1-T1** Create `docflow/` with `.claude-plugin/plugin.json` (name,
  version 0.1.0, author, license, keywords) and list it in
  `.claude-plugin/marketplace.json` with `"source": "./docflow"`.
  Refs: ARCHITECTURE § 3, PRD § 6.7.
- [x] **S1-T2** Run `node scripts/sync-shared.mjs`: shared copies, empty
  locales, `userConfig.language`. Add the other `userConfig` options.
  Refs: SPECS § 3. *Done when* `sync-shared.mjs --check` passes.
- [x] **S1-T3** `lib/config.mjs`: option precedence and checks detection.
  Refs: SPECS § 3. *Done when* unit tests cover each level and each detector.
- [x] **S1-T4** `lib/state.mjs`: schema 1, atomic writes, lock with expiry.
  Refs: SPECS § 4, ARCHITECTURE § 8.
- [x] **S1-T5** `scripts/docflow.mjs` entry with `KEY=value` output, exit codes,
  i18n messages, and the `status` verb. Refs: SPECS § 5.
- [x] **S1-T6** `/docflow:status` and `/docflow:language` commands;
  `locales/en.json` and its three translations. Refs: PRD § 6.7.
- [x] **S1-T7** Test harness `tests/docflow/` with temporary repositories and
  fake `git`/`gh` runners. Refs: ARCHITECTURE § 11.

- [x] **S1 acceptance** — After installing the marketplace locally,
  `/docflow:status` on an empty repository prints every document as `missing`
  and `NEXT=/docflow:prd`; `node --test tests/docflow` and
  `sync-shared.mjs --check` pass; the messages follow `/docflow:language fr`.
  *Result (2026-09-28): passed — claude -p --plugin-dir docflow on an empty repository: /docflow:status printed the four documents as missing and NEXT=/docflow:prd; after /docflow:language fr the status message came in French; node --test tests/docflow/*.test.mjs 43/43, sync-shared.mjs --check and claude plugin validate pass.*

## S2 — Document chain

- [x] **S2-T1** Templates for the four documents in English, with required
  sections and link lines. Refs: SPECS § 2.
- [x] **S2-T2** `lib/docs.mjs`: skeleton, section index, `section`, links,
  fingerprints, `check`. Refs: SPECS § 2, § 4.
- [x] **S2-T3** Verbs `stage`, `section`, `check`, `approve` with the gate and
  staleness. Refs: SPECS § 5, PRD § 6.1 (D-3, D-4).
- [x] **S2-T4** `lib/claudemd.mjs` and the `claude-md` verb. Refs: SPECS § 7.
- [x] **S2-T5** Commands `prd` (with the interview), `architecture`, `specs`,
  `tasks`, `claude-md`, `approve`, `check`, `run`. Refs: ARCHITECTURE § 5.1–5.2.
- [x] **S2-T6** Adopt mode for an existing code base (`--adopt`): layout
  summary by script, S1 of `TASKS.md` pre-ticked. Refs: PRD § 6.1 (D-5).
- [x] **S2-T7** `writer` agent. Refs: ARCHITECTURE § 6.

- [x] **S2 acceptance** — On an empty repository, `/docflow:run` repeated with
  approvals produces the four documents and the `CLAUDE.md` block; every
  document links to its neighbours; `/docflow:check` reports nothing; editing
  the approved PRD marks the others stale in `/docflow:status`.
  *Result (2026-09-28): passed — claude -p --plugin-dir docflow (sonnet) on an empty repository: five /docflow:run with approvals produced PRD, ARCHITECTURE, SPECS, TASKS (17 entries) and a 13-line CLAUDE.md block; each document links to the three others; docflow check reported ISSUES=0; after editing the approved PRD, status showed PRD draft and ARCHITECTURE, SPECS, TASKS stale.*

## S3 — Translations

- [x] **S3-T1** Section fingerprints per twin in the state; `translate plan`.
  Refs: SPECS § 4, PRD § 6.2.
- [x] **S3-T2** `translate apply`: splice sections, rewrite link lines, record
  fingerprints. Refs: SPECS § 2, § 5.
- [x] **S3-T3** Templates in French, Spanish and German. Refs: SPECS § 2.
- [x] **S3-T4** `translator` agent and `/docflow:translate`; identifiers, code
  and paths untouched. Refs: ARCHITECTURE § 5.4, § 6.
- [x] **S3-T5** `check` covers twins: missing, extra or outdated sections.
  Refs: PRD § 6.2 (L-4).

- [x] **S3 acceptance** — With `doc_languages: fr`, the chain of S2 produces
  French twins; changing one English section and running `/docflow:translate`
  sends only that section; `/docflow:check` reports nothing afterwards.
  *Result (2026-09-28): passed — claude -p --plugin-dir docflow on the S2 acceptance project with doc_languages fr: /docflow:translate wrote PRD-FR, ARCHITECTURE-FR, SPECS-FR and TASKS-FR through haiku translator agents (ids, grammar and paths kept); after one sentence was added to SPECS § 3, /docflow:translate specs sent a source file holding that section only; docflow check reported ISSUES=0 before and after.*

## S4 — Implementation engine

- [x] **S4-T1** `lib/tasks.mjs`: parser, `next` unit, tick in twins, results,
  issue numbers. Refs: SPECS § 6. *Done when* golden-file tests pass.
- [x] **S4-T2** `lib/run.mjs`: base branch, branch naming, worktree or in
  place, checks with log tail, commit, push, draft pull request, restore.
  Refs: SPECS § 8, ARCHITECTURE § 5.3.
- [x] **S4-T3** Verbs `task show`, `do start|check|commit|acceptance|result|finish`
  and `--resume`. Refs: SPECS § 5.
- [x] **S4-T4** `/docflow:do` command for `session`, `task` and `sprint`
  implementers; `implementer` and `acceptance` agents. Refs: PRD § 6.4.
- [x] **S4-T5** Hooks: guard (`PreToolUse`) and completeness (`Stop`,
  `SubagentStop`) scoped with `scope.mjs`. Refs: SPECS § 8, ARCHITECTURE § 7.

- [x] **S4 acceptance** — On a sample project with a two-task sprint:
  `/docflow:do next` implements the sprint on `docflow/S1-…`, runs the checks,
  ticks both tasks and the acceptance in `TASKS.md` and its twin, opens a draft
  pull request; `main` is unchanged; during the run `git push origin main` and
  `gh pr merge` are refused; a forced check failure stops the run and
  `--resume` completes it.
  *Result (2026-09-28): passed — claude -p --plugin-dir docflow (sonnet) on a sample Node project with a two-task sprint, a French twin of TASKS.md, a bare origin and a fake gh: /docflow:do next with checks forced to fail stopped at S1-T1 (RUN=failed:S1, branch kept); in the same session git push origin main and gh pr merge 1 were refused by the hook; /docflow:do --resume in a new session implemented both tasks on docflow/S1-adding, ticked them and the acceptance in TASKS.md and TASKS-FR.md, and opened a draft pull request against main; main and origin/main unchanged.*

## S5 — Issues mirror

- [x] **S5-T1** `lib/issues.mjs` and `issues push`: create, update, never
  duplicate; tracker key comment. Refs: SPECS § 8, PRD § 6.8.
- [x] **S5-T2** Issue numbers in `TASKS.md`; `Closes #` in draft pull requests.
  Refs: PRD § 6.8 (S-2).
- [x] **S5-T3** `issues pull` and `--apply`. Refs: PRD § 6.8 (S-3).
- [x] **S5-T4** `/docflow:issues` command with the repository and GitHub
  checks. Refs: PRD § 6.7 (M-2).

- [x] **S5 acceptance** — With `issues: mirror`, `/docflow:issues push` twice
  creates each issue once; `/tracker:open`-style key detection finds them; a
  sprint's draft pull request closes its tasks' issues when merged by hand; an
  issue closed by hand is reported by `/docflow:issues pull`.
  *Result (2026-09-28): passed — claude -p --plugin-dir docflow (sonnet) on a sample project with issues mirror, a French twin of TASKS.md, a bare origin and a fake gh: /docflow:issues push created five issues (#1 to #5: two sprints, their acceptance tests labelled acceptance) and wrote their numbers in TASKS.md and TASKS-FR.md; a second push created nothing (UNCHANGED=5); the tracker plugin keysInBody read id:docflow-<id> on each of them; the S1 run opened a draft pull request listing Closes #1, #2 and #3 and not #4; after S1 was merged by hand and its issues closed, #4 closed by hand was the only one /docflow:issues pull reported, and the command asked before applying.*

## S6 — Documentation and dogfooding

- [x] **S6-T1** `docflow/README.md` (and `README-FR.md`): install, options,
  commands, the flow, token tips.
- [ ] **S6-T2** Marketplace release 0.1.0: versions in `plugin.json` and
  `marketplace.json`, root README entry.
- [ ] **S6-T3** Apply docflow to Taskbar Hub with `--adopt` and run one sprint
  through `/docflow:do`.
- [ ] **S6-T4** Measure SPECS § 10 budgets and PRD § 11 token checks; record
  them.

- [ ] **S6 acceptance** — Every PRD § 11 acceptance criterion passes on a fresh
  install from the marketplace; the Taskbar Hub sprint produced a draft pull
  request with ticked tasks and no manual edit of `TASKS.md`.
