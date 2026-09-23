// GENERATED from shared/i18n/i18n.mjs by scripts/sync-shared.mjs — do not edit this copy.
// Shared i18n engine for every plugin of this repository.
//
// Canonical copy: shared/i18n/i18n.mjs. Each plugin ships its own copy in
// <plugin>/scripts/i18n.mjs (a plugin is installed alone, so it cannot import
// from outside its directory) — run `node scripts/sync-shared.mjs` at the
// repository root after editing this file, never edit the copies.
//
// The engine holds no message: each plugin keeps its catalogs in
// <plugin>/locales/<code>.json, `en.json` being the reference.
//
// Language choice, first match wins:
//   1. the value the plugin passes (its own `language` option);
//   2. the CLAUDE_PLUGINS_LANGUAGE environment variable (all plugins at once);
//   3. English.
// A value is a code (`en`, `fr`, `es`, `de`, `fr-FR`…) or a language name in
// English, French, Spanish or German (`French`, `Français`, `francés`…).
// An unsupported value falls back to English and is reported as `known: false`.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const DEFAULT_LANGUAGE = 'en'
export const ENV_VAR = 'CLAUDE_PLUGINS_LANGUAGE'

/** Per code: English name (for agents and prompts), native name (for the user), aliases. */
export const LANGUAGES = {
  en: {
    english: 'English',
    native: 'English',
    aliases: ['english', 'anglais', 'inglés', 'ingles', 'englisch'],
  },
  fr: {
    english: 'French',
    native: 'Français',
    aliases: ['french', 'français', 'francais', 'francés', 'frances', 'französisch'],
  },
  es: {
    english: 'Spanish',
    native: 'Español',
    aliases: ['spanish', 'español', 'espanol', 'espagnol', 'spanisch'],
  },
  de: {
    english: 'German',
    native: 'Deutsch',
    aliases: ['german', 'deutsch', 'allemand', 'alemán', 'aleman'],
  },
}

export const SUPPORTED = Object.keys(LANGUAGES)

/** Resolves one value to a supported code; `known` is false when it fell back to English. */
export function resolveLanguage(value) {
  if (value == null || String(value).trim() === '') return { code: DEFAULT_LANGUAGE, known: true }
  const raw = String(value).trim().toLowerCase()
  const code = raw.split(/[-_]/)[0]
  if (LANGUAGES[code]) return { code, known: true }
  for (const [c, { aliases }] of Object.entries(LANGUAGES))
    if (aliases.includes(raw)) return { code: c, known: true }
  return { code: DEFAULT_LANGUAGE, known: false }
}

/** Applies the precedence above: the plugin's own value, then the environment, then English. */
export function pickLanguage(own, env = process.env) {
  const value = own ?? env[ENV_VAR] ?? null
  return { value, ...resolveLanguage(value) }
}

const catalogCache = new Map()

function readCatalog(localesDir, code) {
  const key = `${localesDir}|${code}`
  if (!catalogCache.has(key)) {
    const file = path.join(localesDir, `${code}.json`)
    let catalog = {}
    try {
      if (existsSync(file)) catalog = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      catalog = {}
    }
    catalogCache.set(key, catalog)
  }
  return catalogCache.get(key)
}

/**
 * Builds the i18n of a plugin.
 *
 *   const i18n = createI18n({ localesDir, language: config.language })
 *   i18n.t('key', { name: 'value' })   // placeholders are {name}
 *   i18n.code / i18n.name / i18n.englishName / i18n.known / i18n.value
 *
 * A key missing from the chosen catalog falls back to English, then to the key
 * itself. Values are inserted in a single pass: braces inside a value are kept.
 */
export function createI18n({ localesDir, language } = {}) {
  const picked = pickLanguage(language)
  const catalog = readCatalog(localesDir, picked.code)
  const reference = readCatalog(localesDir, DEFAULT_LANGUAGE)
  const t = (key, vars = {}) =>
    String(catalog[key] ?? reference[key] ?? key).replace(/\{(\w+)\}/g, (m, name) =>
      name in vars ? String(vars[name]) : m
    )
  return {
    ...picked,
    name: LANGUAGES[picked.code].native,
    englishName: LANGUAGES[picked.code].english,
    supported: SUPPORTED,
    t,
  }
}

/**
 * Checks a plugin's catalogs against `en.json`: every supported language has a
 * file, no key is missing or extra, and every placeholder of the English message
 * appears in the translation. Returns a list of problems (empty when all is well).
 */
export function checkCatalogs(localesDir) {
  const problems = []
  if (!existsSync(localesDir)) return ['directory missing']
  const files = readdirSync(localesDir).filter((f) => f.endsWith('.json'))
  for (const f of files)
    if (!SUPPORTED.includes(f.slice(0, -5))) problems.push(`${f}: not a supported language`)
  const parse = (code) => {
    try {
      return JSON.parse(readFileSync(path.join(localesDir, `${code}.json`), 'utf8'))
    } catch (e) {
      problems.push(
        `${code}.json: ${existsSync(path.join(localesDir, `${code}.json`)) ? e.message : 'missing'}`
      )
      return null
    }
  }
  const en = parse(DEFAULT_LANGUAGE)
  if (!en) return problems
  const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  for (const code of SUPPORTED.filter((c) => c !== DEFAULT_LANGUAGE)) {
    const other = parse(code)
    if (!other) continue
    for (const key of Object.keys(en)) {
      if (!(key in other)) problems.push(`${code}.json: missing key "${key}"`)
      else if (placeholders(en[key]).join() !== placeholders(other[key]).join())
        problems.push(`${code}.json: placeholders of "${key}" differ from en.json`)
    }
    for (const key of Object.keys(other))
      if (!(key in en)) problems.push(`${code}.json: extra key "${key}" (not in en.json)`)
  }
  return problems
}
