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
- **Option**: the plugin exposes a `language` option in its own project config (code `en` /
  `fr` / `es` / `de`, or a language name), default `null`, passed to
  `createI18n({ localesDir, language })`. When it is unset, `CLAUDE_PLUGINS_LANGUAGE` applies,
  then English. A plugin with a user-facing command also offers a command to show or set it
  (see `scanner-plugin/commands/language.md`).
- **Agents and prompts**: hand the agents `i18n.englishName` (e.g. `French`) and tell them to
  write their prose in it; generated HTML uses `i18n.code` for `<html lang>`. Identifiers that
  other code compares (JSON enum values, slugs, fingerprints, `KEY=value` machine lines) stay
  in English.
- **Instruction files** (`commands/*.md`, `agents/*.md`, profiles) stay in English: they are
  addressed to the model, not to the user.

### Adding a plugin

1. Create `<name>-plugin/` and list it in `.claude-plugin/marketplace.json`.
2. `node scripts/sync-shared.mjs` — copies the engine and creates empty `locales/*.json`.
3. Fill `locales/en.json`, then its three translations (correct accents and typography:
   `« … »` in French, `«…»` in Spanish, `„…“` in German).
4. `node scripts/sync-shared.mjs --check` must pass (CI runs it on every push and pull
   request).

## Releasing

Bump `version` in the plugin's `.claude-plugin/plugin.json` **and** in its marketplace entry.
