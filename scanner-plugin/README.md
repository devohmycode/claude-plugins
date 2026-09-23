# scanner — local, profile-driven repository scans

A Claude Code plugin that does, inside the repository and on the working tree, what a hosted
code scanner does: one **profile** per scan type, a parallel investigation, an adversarial
triage, an HTML report, finding tracking from one scan to the next, and guarded remediation.

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

## Commands

| Command                                                      | Role                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `/scanner:check`                                             | Checks profiles, overlays and config against the repository. Run it before scanning.      |
| `/scanner:scan <type> [--scope full\|diff\|<path>] [--deep]` | One scan. `diff`: files changed since `diffBase`. `--deep` doubles the number of batches. |
| `/scanner:scan-all [--scope …]`                              | Check, then one scan per type, sequentially.                                              |
| `/scanner:remediate <run> <id>`                              | Fixes one finding in an isolated worktree; commits, never pushes.                         |
| `/scanner:guard [status\|off]`                               | Shows or lifts the guard (after an interrupted scan).                                     |
| `/scanner:language [en\|fr\|es\|de]`                         | Shows or sets the plugin language (see below).                                            |

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
6. **`reporter` agent**: a self-contained HTML report following the profile's `Report`
   section.
7. Guard lifted.

Whatever can be counted goes through the script; agents only judge.

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
.scanner/runs/<type>-<timestamp>/ profile, batches, findings, verdicts, final.json (ignored)
.scanner/history/<run>.json       result of full-scope scans (committed)
<reports>/<reportName>            the HTML report
```

## Language

English by default; French, Spanish and German are also available. The language covers the
script and guard messages, the findings, verdicts and HTML report written by the agents, and
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

## Configuration — `.scanner/config.json` (optional)

See `examples/config.json`. Keys:

- `language` — `en` (default), `fr`, `es` or `de`: see [Language](#language);
- `reports`, `reportName` (`{type}`, `{YYYYMMDD}`, `{DDMMYYYY}`), `history`,
  `reportInstructions` (passed to the reporter);
- `batches` (4), `diffBase` (for `--scope diff`), `remediationBase`, `branchPrefix`;
- `types.<type>`: `enabled`, `requireReachability` (default: `security` only),
  `exclusions.add` / `exclusions.remove`;
- `check`: `constants` (names that must still exist in code), `libraries.present` /
  `libraries.absent` (checked in `package.json`), `counts` (`label`, `glob`, `expected`),
  `ignore`;
- `guard`: `ttlHours`, `writeDenied` (globs), `commandsDenied` (regexes), `protectedBranches`;
- `commits`: `forbiddenTrailers` (regexes), `checkOutsideScan`.
