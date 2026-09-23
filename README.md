# DevOhMyCode — Claude Code plugins

A [Claude Code](https://code.claude.com) plugin marketplace.

## Install

```
/plugin marketplace add devohmycode/claude-plugins
/plugin install scanner@devohmycode-plugins
```

Update later with `/plugin marketplace update devohmycode-plugins`.

## Plugins

| Plugin | Version | Description |
| --- | --- | --- |
| [scanner](scanner-plugin/) | 0.1.0 | Local, profile-driven repository scans (security, performance, accessibility, dead code, test coverage): parallel investigation, adversarial triage, HTML report, finding tracking across scans, and guarded remediation. |

## Layout

```
.claude-plugin/marketplace.json   the catalogue
<name>-plugin/                    one directory per plugin, each with its own
  .claude-plugin/plugin.json      manifest, commands, agents, hooks…
```

## Releasing a new version

1. Bump `version` in the plugin's `.claude-plugin/plugin.json` **and** in its entry of
   `.claude-plugin/marketplace.json` — the two must match.
2. Run `claude plugin validate <plugin-dir>` and `claude plugin validate .`.
3. Commit, tag (`scanner-v0.1.1`), push.

## License

MIT — see [LICENSE](LICENSE).
