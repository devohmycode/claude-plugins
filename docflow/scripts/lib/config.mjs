// Options of docflow (SPECS § 3), first match wins:
//   argument (a command's `--key value`) > project (.docflow/config.json) >
//   user (the plugin's row in /config, read with `userOption`) > default.
// `language` stops at the project level here: the shared i18n engine applies the rest
// of its own precedence (CLAUDE_PLUGINS_LANGUAGE, then /config, then English).
//
// An invalid value is skipped (the next level applies) and reported in `problems`.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { userOption } from '../i18n.mjs'
import { readJson, writeAtomic } from './util.mjs'

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const CONFIG_FILE = '.docflow/config.json'

export const DOC_LANGUAGES = ['fr', 'es', 'de']
export const MODELS = ['inherit', 'haiku', 'sonnet', 'opus', 'fable']
export const EFFORTS = ['inherit', 'low', 'medium', 'high', 'xhigh', 'max']
export const AGENTS = ['writer', 'translator', 'implementer', 'acceptance']
export const AGENT_DEFAULTS = {
  writer: { model: 'inherit', effort: 'inherit' },
  translator: { model: 'haiku', effort: 'inherit' },
  implementer: { model: 'inherit', effort: 'inherit' },
  acceptance: { model: 'sonnet', effort: 'inherit' },
}

const oneOf = (values) => (v) => (values.includes(String(v).trim().toLowerCase()) ? String(v).trim().toLowerCase() : undefined)
const text = (v) => (typeof v === 'string' ? v.trim() : undefined)

/** `fr,es` / `["fr","es"]` / `none` / `` → a list of codes; undefined when one is not supported. */
function languageList(v) {
  if (v == null) return undefined
  const items = (Array.isArray(v) ? v : String(v).split(/[\s,]+/))
    .map((x) => String(x).trim().toLowerCase())
    .filter((x) => x && x !== 'none')
  if (items.some((x) => !DOC_LANGUAGES.includes(x))) return undefined
  return DOC_LANGUAGES.filter((c) => items.includes(c))
}

/** Every option: its parser (raw value → value, or undefined when invalid) and its default. */
export const OPTIONS = {
  language: { parse: text, default: null, projectOnly: true },
  doc_languages: { parse: languageList, default: [] },
  unit: { parse: oneOf(['task', 'sprint']), default: 'sprint' },
  implementer: { parse: oneOf(['task', 'sprint', 'session']), default: 'session' },
  worktree: { parse: oneOf(['on', 'off']), default: 'off' },
  issues: { parse: oneOf(['off', 'mirror']), default: 'off' },
  checks: { parse: text, default: '' },
  branch_prefix: { parse: (v) => (typeof v === 'string' && /^[\w./-]*\/$/.test(v.trim()) ? v.trim() : undefined), default: 'docflow/' },
  ...Object.fromEntries(
    AGENTS.flatMap((agent) => [
      [`${agent}_model`, { parse: oneOf(MODELS), default: AGENT_DEFAULTS[agent].model }],
      [`${agent}_effort`, { parse: oneOf(EFFORTS), default: AGENT_DEFAULTS[agent].effort }],
    ])
  ),
}

export const readProjectConfig = (root) => readJson(path.join(root, CONFIG_FILE), {}) ?? {}

/**
 * Resolves every option. `args` holds the command's arguments (`{ unit: 'task' }`),
 * `pluginDir` the plugin root whose /config rows are read, `env` the environment.
 * Returns `{ values, sources, problems }`; `sources[key]` is argument | project | user | default.
 */
export function loadConfig(root, args = {}, { pluginDir = PLUGIN_ROOT, env = process.env } = {}) {
  let own = {}
  const problems = []
  try {
    own = readProjectConfig(root)
  } catch (e) {
    problems.push({ key: CONFIG_FILE, value: e.message, source: 'project' })
  }
  const values = {}
  const sources = {}
  for (const [key, option] of Object.entries(OPTIONS)) {
    const candidates = [
      ['argument', args[key]],
      ['project', own[key]],
      ['user', option.projectOnly ? null : userOption(pluginDir, key, env)],
    ]
    let found = false
    for (const [source, raw] of candidates) {
      if (raw == null || (typeof raw === 'string' && raw.trim() === '' && key !== 'doc_languages')) continue
      const value = option.parse(raw)
      if (value === undefined) {
        problems.push({ key, value: String(raw), source })
        continue
      }
      values[key] = value
      sources[key] = source
      found = true
      break
    }
    if (!found) {
      values[key] = Array.isArray(option.default) ? [...option.default] : option.default
      sources[key] = 'default'
    }
  }
  return { values, sources, problems }
}

/** Sets (or, with `null`, removes) one key of .docflow/config.json, keeping the others. */
export function saveProjectOption(root, key, value) {
  const file = path.join(root, CONFIG_FILE)
  const own = readProjectConfig(root)
  if (value == null) delete own[key]
  else own[key] = value
  writeAtomic(file, JSON.stringify(own, null, 2) + '\n')
  return file
}

/** Checks detection, first match wins (SPECS § 3). */
export const DETECTORS = [
  { file: 'Cargo.toml', command: 'cargo test --locked' },
  {
    file: 'package.json',
    command: 'npm test',
    when: (content) => {
      try {
        const test = JSON.parse(content).scripts?.test
        return typeof test === 'string' && test.trim() !== '' && !/no test specified/.test(test)
      } catch {
        return false
      }
    },
  },
  { file: 'pyproject.toml', command: 'pytest -q' },
  { file: 'pytest.ini', command: 'pytest -q' },
  { file: 'go.mod', command: 'go test ./...' },
]

/** The project's checks command detected from its files, or null. */
export function detectChecks(root) {
  for (const d of DETECTORS) {
    const file = path.join(root, d.file)
    if (!existsSync(file)) continue
    if (d.when && !d.when(readFileSync(file, 'utf8'))) continue
    return { command: d.command, source: `detected:${d.file}` }
  }
  return null
}

/** The checks command a run uses: the option, else the detected one; `command` is null when neither. */
export function checksOf(values, root) {
  if (values.checks) return { command: values.checks, source: 'config' }
  return detectChecks(root) ?? { command: null, source: null }
}

/** The agent type, model and effort of a role: `docflow:implementer-high`, `sonnet`, `high`. */
export function agentOf(values, agent) {
  const model = values[`${agent}_model`] ?? 'inherit'
  const effort = values[`${agent}_effort`] ?? 'inherit'
  return { type: `docflow:${agent}${effort === 'inherit' ? '' : `-${effort}`}`, model, effort }
}
