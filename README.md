# DevOhMyCode — Claude Code plugins

A [Claude Code](https://code.claude.com) plugin marketplace.

## Install

```
/plugin marketplace add devohmycode/claude-plugins
/plugin install scanner@devohmycode-plugins
/plugin install tracker@devohmycode-plugins
```

Update later with `/plugin marketplace update devohmycode-plugins`.

## Plugins

| Plugin | Version | Description |
| --- | --- | --- |
| [scanner](scanner-plugin/) | 0.5.2 | Local, profile-driven repository scans (security, performance, accessibility, dead code, test coverage): parallel investigation, adversarial triage, HTML or Markdown report, finding tracking across scans, and guarded remediation. |
| [tracker](tracker-plugin/) | 0.2.1 | The life cycle of audit findings in GitHub issues: open the missing issues from scanner runs or any findings file (deduplicated by a key written into each issue), sync them with later scans, triage them against the current code with a skeptic counter-check, and fix them in batches — one branch, one worktree and one draft pull request per batch. |

## Layout

```
.claude-plugin/marketplace.json   the catalogue
<name>-plugin/                    one directory per plugin, each with its own
  .claude-plugin/plugin.json      manifest, commands, agents, hooks…
  locales/{en,fr,es,de}.json      the plugin's messages
  scripts/i18n.mjs                generated copy of shared/i18n/i18n.mjs
shared/i18n/i18n.mjs              language engine shared by every plugin
shared/findings/findings.mjs      findings contract: what the scanner writes and the tracker reads
tests/                            node --test suites (node --test tests/tracker/*.test.mjs)
scripts/sync-shared.mjs           copies shared modules into the plugins, checks catalogs
```

## Languages

Every plugin speaks English by default, and French, Spanish or German on request. Pick the
language in Claude Code's `/config` panel (each plugin has a **Language** row), per project
through the plugin's own `language` option, or for all plugins at once with the
`CLAUDE_PLUGINS_LANGUAGE` environment variable (`en`, `fr`, `es`, `de`). See [CLAUDE.md](CLAUDE.md) for the rules a
new plugin follows, and run `node scripts/sync-shared.mjs --check` before committing.

## Releasing a new version

1. Bump `version` in the plugin's `.claude-plugin/plugin.json` **and** in its entry of
   `.claude-plugin/marketplace.json` — the two must match.
2. Run `node scripts/sync-shared.mjs --check`, `claude plugin validate <plugin-dir>` and
   `claude plugin validate .`.
3. Commit, tag (`scanner-v0.1.1`), push.

## License

MIT — see [LICENSE](LICENSE).
