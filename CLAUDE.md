# claude-plugins — rules for every plugin of this marketplace

## Languages (mandatory for every plugin, existing or new)

Every plugin speaks **English by default, and French, Spanish and German on request**.
The mechanism is shared; do not reinvent it in a plugin.

- **Engine**: `shared/i18n/i18n.mjs` is the only source. Each plugin ships a generated copy in
  `<plugin>/scripts/i18n.mjs` (a plugin is installed alone and cannot import from outside its
  directory). Never edit a copy: edit the source, then run `node scripts/sync-shared.mjs`.
- **Messages**: `<plugin>/locales/en.json` is the reference; `fr.json`, `es.json` and `de.json`
  carry exactly the same keys and the same `{placeholders}`. No user-facing string is written
  inline in a script: it goes through `t('key', { … })`.
- **Option**: the language is chosen, first match wins, from
  1. the plugin's per-project `language` option, default `null`, passed to
     `createI18n({ localesDir, language })`;
  2. `CLAUDE_PLUGINS_LANGUAGE` (every plugin at once);
  3. the plugin's **Language** row in Claude Code's `/config` panel: `userConfig.language` in
     `.claude-plugin/plugin.json`, which `sync-shared.mjs` writes and `--check` enforces. The
     engine reads it itself (hook environment, else the user `settings.json`);
  4. English.

  A plugin with a user-facing command also offers a command to show or set the per-project
  value (see `scanner-plugin/commands/language.md`).

- **Agents and prompts**: hand the agents `i18n.englishName` (e.g. `French`) and tell them to
  write their prose in it; generated HTML uses `i18n.code` for `<html lang>`. Identifiers that
  other code compares (JSON enum values, slugs, fingerprints, `KEY=value` machine lines) stay
  in English.
- **Instruction files** (`commands/*.md`, `agents/*.md`, profiles) stay in English: they are
  addressed to the model, not to the user.

### Adding a plugin

1. Create `<name>-plugin/` and list it in `.claude-plugin/marketplace.json`.
2. `node scripts/sync-shared.mjs` — copies the shared modules (the i18n engine, the findings
   contract `shared/findings/findings.mjs` and the repository checks `shared/git/repo.mjs`),
   creates empty `locales/*.json` and declares `userConfig.language` in the manifest.
3. Fill `locales/en.json`, then its three translations (correct accents and typography:
   `« … »` in French, `«…»` in Spanish, `„…“` in German).
4. `node scripts/sync-shared.mjs --check` must pass (CI runs it on every push and pull
   request).

## Git repository (every command that needs one)

A command that reads the history, the tracked files, commits, opens worktrees or calls the
GitHub CLI must not fail on a folder that is not a repository yet. The mechanism is shared:

- **Script**: before running such a command, check `missingFor(repoState(root), needs)` from
  `scripts/repo.mjs` (`needs`: `commit`, `remote`); when something is missing, print
  `REPO=none|empty|no-remote|no-git`, a message from the catalog, and exit `REPO_EXIT` (3).
  Offer `repo plan` and `repo init [--commit]` (and `repo github` when the plugin works on
  GitHub), as `scanner.mjs` and `tracker.mjs` do.
- **Command**: end the command file with a "Not a git repository yet" section: on `REPO=`,
  show `repo plan`, **ask** with `AskUserQuestion`, create only on that answer, then run the
  failed command again. Creating a GitHub repository publishes the code: its own question.

## Releasing

Bump `version` in the plugin's `.claude-plugin/plugin.json` **and** in its marketplace entry.
