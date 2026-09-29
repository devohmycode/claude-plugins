# docflow — Specifications

| | |
|---|---|
| Status | Draft v0.1 |
| Date | 28 September 2026 |
| Applies to | Version 0.1 |

French version: [SPECS-FR.md](SPECS-FR.md). This document fixes the exact
values the [architecture](ARCHITECTURE.md) relies on; requirements come from
the [PRD](PRD.md); work is tracked in [TASKS.md](TASKS.md).

## 1. Files

| Path (project) | Content | In git |
|---|---|---|
| `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/SPECS.md`, `docs/TASKS.md` | The document chain | yes |
| `docs/<NAME>-FR.md`, `-ES.md`, `-DE.md` | Translations | yes |
| `CLAUDE.md` | docflow block between markers (§ 7) | yes |
| `.docflow/config.json` | Project options (§ 3) | yes |
| `.docflow/state.json` | State (§ 4) | no |
| `.docflow/.gitignore` | `*` then `!config.json` then `!.gitignore` | yes |

## 2. Document format

- First line `# <Project> — <Title>`, where titles are `Product Requirements
  Document`, `Technical design`, `Specifications`, `Tasks`.
- Then a two-column table with at least `Status` and `Date`.
- Then the link line: `French version: [PRD-FR.md](PRD-FR.md).` in English
  documents, `Version anglaise : [PRD.md](PRD.md).` in French ones (Spanish:
  `Versión en inglés:`, German: `Englische Fassung:`), followed by links to the
  neighbouring documents.
- Sections are numbered `## <n>. <Title>` and `### <n>.<m> <Title>`; a
  reference `SPECS § 3.2` resolves to the heading whose number is `3.2`. A
  section extends to the next heading of the same or a higher level.
- Required sections (the skeleton writes them; `check` reports missing ones):

| Document | Required top-level sections |
|---|---|
| PRD | Vision · Problem · Goals and non-goals · Users · Functional requirements · Non-functional requirements · Acceptance criteria · Open questions (or Decisions) |
| ARCHITECTURE | Principles (or Starting point) · Overview · Layout (or Modules) · Delivery plan · Testing · Decisions |
| SPECS | at least one numbered section; the last one lists budgets or limits |
| TASKS | How to work on this file · one section per sprint `## S<n> — <title>` |

## 3. Options

Precedence: command argument > `.docflow/config.json` > `/config`
(`userConfig`, read with `userOption`) > default.

| Key | `userConfig` type | Values | Default |
|---|---|---|---|
| `language` | string, options | `en`, `fr`, `es`, `de` | `en` |
| `doc_languages` | string | comma-separated subset of `fr,es,de`, or empty | empty |
| `unit` | string, options | `task`, `sprint` | `sprint` |
| `implementer` | string, options | `task`, `sprint`, `session` | `session` |
| `worktree` | string, options | `on`, `off` | `off` |
| `issues` | string, options | `off`, `mirror` | `off` |
| `checks` | string | shell command, or empty to detect | empty |
| `branch_prefix` | string | text ending with `/` | `docflow/` |
| `writer_model`, `implementer_model` | string, options | `inherit`, `haiku`, `sonnet`, `opus`, `fable` | `inherit` |
| `translator_model` | same | same | `haiku` |
| `acceptance_model` | same | same | `sonnet` |
| `<agent>_effort` | string, options | `inherit`, `low`, `medium`, `high`, `xhigh`, `max` | `inherit` |

Checks detection, first match: `Cargo.toml` → `cargo test --locked`;
`package.json` with a `test` script → `npm test`; `pyproject.toml` or
`pytest.ini` → `pytest -q`; `go.mod` → `go test ./...`; otherwise the command
asks the user once and saves the answer in `.docflow/config.json`.

## 4. State

```json
{
  "schema": 1,
  "docs": {
    "PRD": { "approved": "2026-09-28T13:44:00Z", "fingerprint": "3f9a0c2b1d4e", "stale": false }
  },
  "translations": {
    "PRD": { "fr": { "1": "a1b2c3d4e5f6", "2": "0f1e2d3c4b5a" } }
  },
  "lock": { "session": "<CLAUDE_CODE_SESSION_ID>", "since": "2026-09-28T14:00:00Z", "expires": "2026-09-28T18:00:00Z" },
  "run": {
    "unit": "S2", "tasks": ["S2-T1", "S2-T2"], "done": ["S2-T1"], "status": "running",
    "base": "main", "branch": "docflow/S2-placement", "worktree": null, "origin_branch": "main"
  },
  "guard": { "session": "<id>", "root": "C:/repo", "worktree": null }
}
```

- `fingerprint`: first 12 hex digits of SHA-256 over the text with line endings
  normalised to `\n` and trailing spaces removed; section fingerprints hash the
  section body without its heading line.
- A lock older than `expires` (4 hours after `since`) may be taken over after
  asking the user.
- `run.status`: `running`, `failed`, `finishing`.

## 5. Script interface

`node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs" <verb> [args]`. Output is one
`KEY=value` per line (values without newlines; lists comma-separated), then any
human message on lines starting with `# `.

| Verb | Prints | Exit codes |
|---|---|---|
| `status` | `DOC_<NAME>=approved\|stale\|draft\|missing`, `SPRINT=`, `DONE=`, `TOTAL=`, `NEXT=` (a command) | 0 |
| `stage <doc> [--adopt]` | `DOC=`, `INPUTS=`, `SECTIONS=`, `LANGS=` | 0, 3, 4 |
| `section <DOC> <n[.m]>` | the section text (raw) | 0, 2 |
| `check [doc]` | `ISSUES=<n>`, then `# <file>:<line> <problem>` | 0 (no issue), 1 |
| `approve <doc>` | `APPROVED=`, `STALE=` (following documents marked stale) | 0, 1 |
| `claude-md` | `CLAUDE_MD=created\|updated\|unchanged`, `LINES=` | 0 |
| `translate plan <doc>` | `LANG=<l> CHANGED=<section ids>` per language | 0 |
| `translate apply <doc> <lang> <file>` | `UPDATED=<section ids>` | 0, 2 |
| `task show <id>` | the task line, then each referenced section | 0, 2 |
| `do start <unit\|next> [--resume] [--worktree\|--in-place]` | `UNIT=`, `TASKS=`, `BRANCH=`, `WORKDIR=`, `IMPLEMENTER=` | 0, 2, 3, 4, 75 |
| `do check <id>` | `CHECKS=pass\|fail`, `LOG=<file>` on failure | 0, 5 |
| `do commit <id>` | `COMMIT=<sha>`, `TICKED=<id>` | 0, 1 |
| `do acceptance <sprint>` | `TEST=` (text), `MANUAL=0\|1` | 0, 2 |
| `do result <sprint> passed\|failed "<evidence>"` | `RECORDED=`, `TICKED=0\|1` | 0 |
| `do finish` | `PR=<url>`, `RESTORED=<branch>` | 0, 1 |
| `issues push` | `CREATED=`, `UPDATED=`, `UNCHANGED=` | 0, 3 |
| `issues pull [--apply]` | `CLOSED=`, `REOPENED=`, `APPLIED=0\|1` | 0, 3 |

| Exit | Meaning |
|---|---|
| 0 | Success |
| 1 | Nothing to do or a reported problem (`check`), or a git step failed |
| 2 | Unknown document, section, task or sprint |
| 3 | Repository missing or without commit or remote (`REPO=` contract) |
| 4 | Gate: predecessor document not approved |
| 5 | Checks failed |
| 75 | Lock held by another session |

## 6. TASKS.md grammar

```text
## S<n> — <title>
- [ ] **S<n>-T<m>** [(#<issue>)] <title>. [Refs: <DOC> § <n[.m]>[, …].]
  [*Done when* <condition>.]
- [ ] **S<n> acceptance** [(#<issue>)] — <test>.
  [*Result (<YYYY-MM-DD>): passed|failed — <evidence>.*]
```

- Regex of a task line: `^- \[( |x)\] \*\*(S\d+-T\d+)\*\*(?: \(#(\d+)\))? (.+)$`.
- Continuation lines start with two spaces. A task's references are every
  `<DOC> § <n>` in its line and continuation lines.
- Ticking changes only `[ ]` to `[x]` in `TASKS.md` and in each twin, matched by
  id, never by text.
- Unit order: `next` in `task` mode is the first unticked task; in `sprint` mode
  the first sprint with an unticked task or acceptance.

## 7. CLAUDE.md block

```markdown
<!-- docflow:start -->
## docflow

This project follows docflow. Read, in order: [PRD](docs/PRD.md) →
[ARCHITECTURE](docs/ARCHITECTURE.md) → [SPECS](docs/SPECS.md) →
[TASKS](docs/TASKS.md).

- Work only through `/docflow:do`; one sprint (or task) per branch.
- Run the checks, let docflow tick `docs/TASKS.md`, never tick by hand.
- Pull requests are drafts; never merge, never push to `main`.
- Documents are approved; change them through their `/docflow:<doc>` command.
- Next: `/docflow:do next` — <next unit and title>.
<!-- docflow:end -->
```

At most 40 lines; the block is inserted at the end of `CLAUDE.md` when absent,
replaced when present, and the file is created when missing. Translated links
are added when `doc_languages` is set.

## 8. Git and GitHub

| Item | Format |
|---|---|
| Branch | `<branch_prefix><unit>-<slug>`: `docflow/S2-placement`, `docflow/S2-T3-drop-rules`; slug = title in lower case ASCII, words joined by `-`, at most 40 characters |
| Worktree | `<repo>/../<repo-name>.docflow/<unit>` |
| Commit | `<id>: <task title>`, body `Refs: <references>`; no attribution trailer |
| Pull request | Draft; title `<unit>: <sprint or task title>`; body: ticked tasks, `Checks: <command> — passed`, acceptance result, `Closes #<n>` per mirrored issue |
| Issue | Title `<id> <title>`; labels `docflow`, `sprint:S<n>` (and `acceptance`); body: the task line, references, then `<!-- tracker:key=id:docflow-<id> -->` |

Guard refusals (`PreToolUse`, while a run is active in this session and
repository):

| Tool call | Refused when |
|---|---|
| `git push` | target is the default branch, or `--force` / `-f` / `--force-with-lease` |
| `git commit` | current branch is the default branch |
| `gh pr merge` | always |
| `Edit` / `Write` | target is an approved document, except `docs/TASKS*.md` edits made by the script |

## 9. Commands

| Command | Arguments |
|---|---|
| `/docflow:prd` | `[idea] [--adopt]` |
| `/docflow:architecture`, `/docflow:specs`, `/docflow:tasks` | `[--adopt]` |
| `/docflow:claude-md` | — |
| `/docflow:approve` | `<prd\|architecture\|specs\|tasks>` |
| `/docflow:run` | `[--through <doc>]` |
| `/docflow:status` | — |
| `/docflow:do` | `<next\|S<n>\|S<n>-T<m>> [--resume] [--unit task\|sprint] [--implementer task\|sprint\|session] [--worktree\|--in-place]` |
| `/docflow:translate` | `[doc] [--lang fr\|es\|de]` |
| `/docflow:check` | `[doc]` |
| `/docflow:issues` | `push\|pull [--apply]` |
| `/docflow:language` | `[en\|fr\|es\|de\|default]` |

## 10. Budgets

| Measure | Limit |
|---|---|
| Any script verb except `do check`, `do finish` and `issues` | < 1 s on a repository of 5,000 files |
| Hook decision | < 100 ms |
| `CLAUDE.md` block | ≤ 40 lines |
| Command file | ≤ 120 lines |
| Output of a verb on success | ≤ 20 lines |
| Log shown after failed checks | last 60 lines |
