# scanner — local, profile-driven repository scans

A Claude Code plugin that does, inside the repository and on the working tree, what a hosted
code scanner does: one **profile** per scan type, a parallel investigation, an adversarial
triage, an HTML or Markdown report, finding tracking from one scan to the next, and guarded remediation.

Because it reads the working tree, it never scans a stale snapshot or the wrong repository.

## Built-in profiles

| Type            | Axis                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `security`      | Authorization and data exposure first, then injection, secrets, sessions, abuse controls, fail-closed robustness |
| `performance`   | Round trips on the critical path, N+1 queries, caching, client bundle weight, rendering mode                     |
| `accessibility` | WCAG 2.2 AA from the source: keyboard and focus, names and roles, alternatives, contrast, motion, forms          |
| `dead-code`     | Unreferenced files and exports, unused dependencies, dead flags and env vars, leftovers of removed libraries     |
| `test-coverage` | Invariants nothing protects: denied-path tests, pure modules, cross-file mirrors, tests that prove nothing       |

Profiles live in `profiles/<type>.md`, one `## ` section per field, following the layout of
Devin's code-scan profiles: `Description`, `Threat model` (optional), `Investigation`,
`Triage` (with the **never report** list), `Report`, `Remediation`, `Exclusions` (one glob
per line). `profiles/_common-remediation.md` applies to every type.

## Project overlays

The built-in profiles are generic. A project sharpens them without forking the plugin by
adding `.scanner/profiles/<type>.md`, in the same format:

- text before the first `## ` becomes the project context;
- each section is **appended** to the built-in one, under a `PROJECT-SPECIFIC` marker that
  the agents are told takes precedence;
- `## Exclusions` adds globs, one per line, inside a fenced code block (Markdown formatters
  such as Prettier rewrite `**` outside of one).

This is where the project names its access-control primitives, its deliberate decisions (the
never-report list that makes reports readable), its generated files and its conventions. A
file with a new name (`.scanner/profiles/i18n.md`) defines a new scan type. See
`examples/overlay-security.md`.

## Install

```
/plugin marketplace add devohmycode/claude-plugins
/plugin install scanner@devohmycode-plugins
```

To try a local checkout instead: `claude --plugin-dir ./scanner-plugin`.
Requirements: Node 18+ and git.

In the scanned repository, add to `.gitignore`:

```gitignore
.scanner/runs/
.scanner/state.json
```

`.scanner/config.json`, `.scanner/profiles/` and `.scanner/history/` are meant to be
committed.

**A folder that is not a git repository yet.** A scan works on the repository: its tracked
files, its commit, its fix branches. On a plain folder (or a repository without a commit),
`/scanner:scan`, `scan-all`, `remediate` and `check` say so instead of failing, show what a
first commit would hold — flagging `.env`, keys, `node_modules/`, build output and large
files — and **ask** whether to create the repository and commit, create it only, or cancel.
Nothing is created without that answer. From the script: `scanner.mjs repo plan`,
`scanner.mjs repo init [--commit]`.

## Commands

| Command                                                      | Role                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `/scanner:check`                                             | Checks profiles, overlays and config against the repository. Run it before scanning.      |
| `/scanner:scan <type> [--scope full\|diff\|<path>] [--deep] [--mode …]` | One scan. `diff`: files changed since `diffBase`. `--deep` doubles the number of batches. `--mode`: see [Scan modes](#scan-modes). `--model`, `--effort`: see [Agents](#agents-model-and-effort). |
| `/scanner:scan-all [--scope …] [--mode …]`                   | Check, then one scan per type, sequentially.                                              |
| `/scanner:remediate <run> <selection>`                       | Fixes the selected findings on one new fix branch, in a worktree; commits, never pushes.  |
| `/scanner:guard [status\|off]`                               | Shows or lifts the guard (after an interrupted scan).                                     |
| `/scanner:language [en\|fr\|es\|de]`                         | Shows or sets the plugin language (see below).                                            |
| `/scanner:model [<type>\|all] [--model …] [--effort …]`     | Shows or sets the model and effort of each type's agents: see [Agents](#agents-model-and-effort). |

## How a scan runs

1. **`scanner.mjs prepare`** builds the effective profile, lists the tracked files in scope
   minus exclusions, splits them into balanced batches, and **arms the guard**.
2. **`investigator` agents**, one per batch, in parallel → `findings-B*.json`.
3. **`scanner.mjs consolidate`** validates the schema (existing file, known severity…) and
   deduplicates by **fingerprint** (type + rule + file + snippet — not the line number, which
   moves).
4. **`triager` agents**, in parallel, each trying to **refute** its findings against the code
   and the never-report list → `verdicts-T*.json`.
5. **`scanner.mjs finalize`** applies the verdicts, downgrades to `info` a finding without a
   reachability path when the type requires one, compares with the last full scan (**new /
   persisting / resolved**), and archives the result.
6. **`reporter` agent**: the report — a self-contained HTML page or a Markdown file, see
   [Report format](#report-format) — following the profile's `Report` section.
7. Guard lifted.
8. Depending on the [mode](#scan-modes): the findings to fix are chosen, then fixed on a new
   branch.

Whatever can be counted goes through the script; agents only judge and fix.

## Scan modes

What a scan ends with:

| Mode               | Report | Fixes                                                                  |
| ------------------ | ------ | ---------------------------------------------------------------------- |
| `report` (default) | yes    | none — `/scanner:remediate` stays available afterwards                 |
| `fix`              | no     | every retained finding down to `fixMinSeverity`, without asking        |
| `review`           | yes    | the ones **you pick** once the report is written; the scan waits for you |

First match wins:

1. for one run: `--mode fix` on `/scanner:scan` or `/scanner:scan-all`;
2. per project: `"mode": "review"` in `.scanner/config.json`;
3. for you, in every project: the **Scan mode** row of the scanner in `/config`;
4. `report`.

In `review` mode the scan lists the retained findings and asks which to fix: all (except
`info`), critical and high only, none, or your own selection. A **selection** is one or more
tokens: an id (`F3`), a severity (`high`), a severity and above (`>=medium` or `medium+`),
`all`, `none` — the same grammar as `/scanner:remediate <run> <selection>`. `/scanner:scan-all`
asks once every scan is done, one question per type.

Fixes go to **one branch per run** — `<branchPrefix>scan-<type>-<YYYYMMDD>`, suffixed if it
already exists — created from `remediationBase` in a worktree under `.scanner/worktrees/<run>`
(ignored by git), so your working tree never switches branches. One `remediator` agent per
finding, one after the other, one commit each; `scanner.mjs fix-status <run>` tells which
were fixed, declined (with the reason), failed or not reached. Nothing is pushed. Remove the
worktree once the branch is merged: `git worktree remove .scanner/worktrees/<run>`.

## Agents: model and effort

Each scan type has its own **model** and **reasoning effort**, used by all of its agents:
investigators, triagers, reporter and remediators. `inherit` (the default) imposes nothing:
the agents run with the session's model and effort.

- model: `inherit`, `haiku`, `sonnet`, `opus`, `fable`;
- effort: `inherit`, `low`, `medium`, `high`, `xhigh`, `max`.

First match wins, per type and per setting:

1. for one run: `--model opus --effort high` on `/scanner:scan`, `/scanner:scan-all` or
   `/scanner:remediate` (a scan's fixes otherwise keep the scan's own values);
2. per project and per type: `types.<type>.model` / `types.<type>.effort` in
   `.scanner/config.json` — `/scanner:model security --model opus --effort high` writes them;
3. per project, every type: top-level `model` / `effort` — `/scanner:model all --model sonnet`;
4. for you, in every project: the **Model — <type>** and **Effort — <type>** rows of the
   scanner in `/config` (built-in types only; an overlay-only type uses 1 to 3);
5. `inherit`.

`/scanner:model` without options shows every type's values and where they come from;
`/scanner:check` shows them too and flags an unsupported value with `✗`.

The model is passed to each agent when it is launched. The effort cannot be — Claude Code
reads it from the agent's definition only — so every agent also ships in one variant per
effort (`agents/investigator-high.md`…), which the scan launches instead of the base agent.
These variants and the `/config` rows are **generated**: edit `agents/<agent>.md` or add a
profile, then run `node scanner-plugin/scripts/generate.mjs` (CI runs it with `--check`).

## External investigators (agent bridges)

A scan can hand some investigation batches to other coding agents — Codex, Grok Build,
Cursor, Devin, GitHub Copilot, Antigravity, Warp Oz — through the plugins of the
[agent-bridges](https://github.com/devohmycode/agent-bridges-cc) marketplace. Several models
looking at the same code miss different things; triage stays with the plugin's own agents,
so every external finding is cross-examined by Claude before it is kept.

```text
/plugin marketplace add devohmycode/agent-bridges-cc
/plugin install codex@agent-bridges        # or cursor-bridge, devin-bridge…
/scanner:scan security --via claude,codex
```

- `--via` lists the investigators; batches are dealt out in turn (`claude,codex` with four
  batches: B1 and B3 to Claude, B2 and B4 to Codex). Without `--via`: `investigators` in
  `types.<type>` or at the top of `.scanner/config.json`, else `claude` alone.
- `prepare` checks that each bridge is installed and prints `BATCHES=` (Claude's) and
  `EXTERNAL=` (`B2:codex,…`). `investigate-external <run>` then runs those batches side by
  side: it writes the prompt (`prompts/external-investigator.md`, the investigator's contract)
  to `prompt-B2.md`, calls the bridge **read-only**, extracts the JSON array from the answer
  and writes `findings-B2.json` itself. `external-B2.json` and `external-B2.txt` keep what
  happened and the raw answer.
- A batch fails without failing the scan when the agent times out
  (`externalTimeoutMinutes`, 30), answers without a JSON array, or modifies the working tree.
- `external.<engine>.model` / `.effort` in the config are passed to that bridge as they are:
  they are the agent's own names (`gpt-5.5`, `high`…), not the scanner's.
- Each kept finding carries `engine` (`codex`…) when an external agent found it.

**What does not apply to them.** External agents run outside Claude Code: the guard never sees
what they read, so the profile's exclusions are only an instruction in their prompt, and the
code they read is sent to their provider. `consolidate` drops any finding on an excluded
file, but cannot unsend it: keep secrets out of scanned trees, or do not use `--via` there.

## The guard (hooks)

`hooks/hooks.json` wires `scripts/guard.mjs` to `PreToolUse` and `PostToolUse`. Outside a
scan or a remediation it does nothing.

- **During a scan**: reading a file excluded by the profile is denied; writing outside the run
  directory and the reports is denied; commands that would modify the repository (`git
commit`, `rm`, `sed -i`, redirections…) are denied.
- **During a remediation**: writes to `guard.writeDenied` are denied, commands matching
  `guard.commandsDenied` are denied, commit and push on `guard.protectedBranches` are denied.
- **After a `git commit`**: if the message matches `commits.forbiddenTrailers`, the agent is
  asked to amend it (during a remediation, or always if `commits.checkOutsideScan`).

Known limits: Bash is a full language, so the list of mutating commands stops mistakes, not
malice; a failing guard lets calls through rather than blocking the session; the guard holds
one scan at a time, hence the sequential `scan-all`. It expires after `guard.ttlHours` (6).

## Files produced

```
.scanner/state.json               guard state (ignored)
.scanner/runs/<type>-<timestamp>/ profile, batches, findings, verdicts, final.json,
                                  remediation*.json (ignored)
.scanner/worktrees/<run>/         the fix branch's worktree (ignored by its own .gitignore)
.scanner/history/<run>.json       result of full-scope scans (committed)
<reports>/<reportName>            the report (.html or .md)
```

`final.json` follows the **findings contract** shared by the plugins of this marketplace
(`scripts/findings.mjs`, a copy of `shared/findings/findings.mjs`): the
[tracker](../tracker-plugin/) plugin reads it to open GitHub issues for the findings, keep them
in line with the next scans (a finding `resolved` by a full scan closes its issue) and fix them
in batches.

## Language

English by default; French, Spanish and German are also available. The language covers the
script and guard messages, the findings, verdicts and report written by the agents, and
the summaries given in the conversation. Machine lines (`RUN=`, `DIR=`, `REPORT=`…), severity
and verdict identifiers in the JSON files, and rule slugs stay in English, so fingerprints do
not depend on the language.

First match wins:

1. per project: `/scanner:language fr`, or `"language": "fr"` in `.scanner/config.json`
   (a code, or a name such as `French` / `Français`) — committed, so the team's reports share
   one language;
2. for every plugin of this marketplace at once: the `CLAUDE_PLUGINS_LANGUAGE` environment
   variable;
3. for you, in every project: the **Language** row of the scanner in `/config` (Claude Code
   v2.1.271 or later), stored in your user `settings.json`;
4. English.

`/scanner:language` and `/scanner:check` say which source applies. An unsupported value falls
back to English, and `/scanner:check` flags it with `✗`.

Messages live in `locales/<code>.json`; `scripts/i18n.mjs` is a copy of the repository's
shared engine (`shared/i18n/`), not to be edited here.

## Report format

`html` by default: one self-contained page (inline CSS, light and dark mode). `md` gives a
GitHub-flavored Markdown file instead, readable raw, rendered on GitHub, and easy to diff when
reports are committed. First match wins:

1. per project: `"reportFormat": "md"` in `.scanner/config.json`;
2. for you, in every project: the **Report format** row of the scanner in `/config` (Claude
   Code v2.1.271 or later);
3. `html`.

The extension follows the format: `{ext}` in `reportName` becomes `html` or `md`, and a
`reportName` written with a fixed extension (`….html`) gets it replaced. `/scanner:check`
shows the format in use and where it comes from, and flags an unsupported value with `✗`.

## Configuration — `.scanner/config.json` (optional)

See `examples/config.json`. Keys:

- `language` — `en` (default), `fr`, `es` or `de`: see [Language](#language);
- `mode` — `report` (default), `fix` or `review`: see [Scan modes](#scan-modes);
  `fixMinSeverity` (`low`) — the lowest severity that `all` selects;
- `reportFormat` — `html` (default) or `md`: see [Report format](#report-format);
- `model`, `effort` — for every type: see [Agents](#agents-model-and-effort);
- `reports`, `reportName` (`{type}`, `{YYYYMMDD}`, `{DDMMYYYY}`, `{ext}`), `history`,
  `reportInstructions` (passed to the reporter);
- `reportAccess` — `read` / `write` globs opened to the reporter once the scan is finalized,
  even if the profile excludes them. The `reports` directory is always readable then, so the
  reporter can follow the existing reports' layout; add e.g. `"read": ["docs/**"]` for a
  style guide, `"write": ["docs/index.html"]` to let it register the report;
- `investigators` (`["claude"]`), `external.<engine>.model` / `.effort`,
  `externalTimeoutMinutes` (30): see [External investigators](#external-investigators-agent-bridges);
- `batches` (4), `diffBase` (for `--scope diff`), `remediationBase`, `branchPrefix`;
- `types.<type>`: `enabled`, `model`, `effort`, `investigators`, `requireReachability` (default: `security` only),
  `exclusions.add` / `exclusions.remove`;
- `check`: `constants` (names that must still exist in code), `libraries.present` /
  `libraries.absent` (checked in `package.json`), `counts` (`label`, `glob`, `expected`),
  `ignore`;
- `guard`: `ttlHours`, `writeDenied` (globs), `commandsDenied` (regexes), `protectedBranches`;
- `commits`: `forbiddenTrailers` (regexes), `checkOutsideScan`.
