// Helpers shared by tracker.mjs (orchestration) and guard.mjs (hooks).
// No dependencies: Node 18+, git and the GitHub CLI (`gh`) only.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRIORITIES, SEVERITIES, keyComment } from './findings.mjs'
import { createI18n, userOption } from './i18n.mjs'

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const STATE_DIR = '.tracker'
export const CONFIG_FILE = `${STATE_DIR}/config.json`
export const LOCALES_DIR = path.join(PLUGIN_ROOT, 'locales')

/** The agents of the plugin, whose model and effort can be set. */
export const ROLES = ['triager', 'skeptic', 'fixer']

/**
 * What a role runs on when nothing sets it: a triager re-measures one issue, a job a
 * lighter model does well; the skeptic, who guards every closing, and the fixer, who
 * writes code, keep the session's.
 */
export const ROLE_DEFAULTS = {
  triager: { model: 'sonnet', effort: 'medium' },
}

export const AGENT_SETTINGS = {
  model: {
    values: ['inherit', 'haiku', 'sonnet', 'opus', 'fable'],
    aliases: { default: 'inherit', session: 'inherit' },
  },
  effort: {
    values: ['inherit', 'low', 'medium', 'high', 'xhigh', 'max'],
    aliases: { default: 'inherit', session: 'inherit', 'extra-high': 'xhigh', med: 'medium' },
  },
}

export const DEFAULT_CONFIG = {
  // null: CLAUDE_PLUGINS_LANGUAGE, then the Language row of /config, then English.
  language: null,
  // Where findings files come from.
  sources: {
    // The scanner plugin's runs (final.json) and history (full-scope scans).
    scannerRuns: '.scanner/runs',
    scannerHistory: '.scanner/history',
    // Findings files written by other producers, next to their reports.
    reports: 'docs/reports',
    suffix: '.findings.json',
  },
  // Lowest severity that becomes an issue; `info` never does.
  minSeverity: 'low',
  // How many issues are read to find the ones that already carry a finding.
  issueLimit: 2000,
  labels: {
    // `{axis}`, `{severity}`, `{priority}`; dates: `{YYYY}`, `{MM}`, `{DD}`.
    axis: 'axis: {axis}',
    severity: 'severity: {severity}',
    priority: 'priority: {priority}',
    source: { scan: 'scan {YYYY}-{MM}-{DD}', audit: 'audit {YYYY}-{MM}-{DD}' },
    // Extra labels added to every issue the plugin opens.
    extra: [],
  },
  // What `{axis}` and `{severity}` become in a label: identity by default.
  names: { axis: {}, severity: {} },
  // Audit identifiers → axis, by series prefix (`SEC-48` → security).
  axisBySeries: {
    SEC: 'security',
    STA: 'stability',
    PER: 'performance',
    FON: 'features',
    FEA: 'features',
    INF: 'ci-deploy',
    BDD: 'data',
    DAT: 'data',
    SAV: 'backups',
    A11Y: 'accessibility',
  },
  priority: {
    default: { critical: 'P1', high: 'P1', medium: 'P2', low: 'P3', info: 'P3' },
    byAxis: { security: { critical: 'P0', high: 'P1', medium: 'P1', low: 'P2', info: 'P3' } },
  },
  title: {
    // `{prefix}`, `{ref}` (the audit id followed by " — ", empty for a scan), `{title}`.
    template: '{prefix}: {ref}{title}',
    prefixByAxis: {
      security: 'fix(security)',
      performance: 'perf',
      accessibility: 'a11y',
      architecture: 'chore(dead-code)',
      tests: 'test',
      'ci-deploy': 'ci',
    },
    defaultPrefix: 'fix',
    // "The list leaks…" → "the list leaks…" (a leading acronym is kept).
    lowercaseFirst: false,
    maxLength: 250,
  },
  triage: {
    max: 15,
    // Propose to relabel an issue whose triaged priority differs from its label.
    relabel: true,
    // Comment "still holds at <commit>" on the issues that still hold.
    commentOnHolds: false,
    // An issue whose file has not changed since it was opened (or since a triage found
    // it holding) is decided `holds` by the script, without an agent. --full overrides.
    skipUnchanged: true,
    // Issues per triager agent, grouped by area of the code: above 1, the code they
    // share is read once. Skeptics stay one per issue.
    perAgent: 1,
  },
  batch: {
    // null: the current branch.
    base: null,
    // null: the base.
    prBase: null,
    branchPrefix: 'fix/',
    perBatch: 5,
    max: 30,
    // area (first two path segments of the location), axis, or none.
    groupBy: 'area',
    // issue: one fixer agent per issue; batch: one fixer for the whole batch, still
    // one commit per issue — the batch's code is read once.
    fixer: 'issue',
    // Run in the batch worktree before the fixers (e.g. a frozen install).
    setup: [],
    // Run in the batch worktree once the fixers are done.
    checks: [],
    checkTimeoutMinutes: 15,
    draft: true,
  },
  guard: {
    ttlHours: 6,
    writeDenied: [],
    commandsDenied: [],
    protectedBranches: ['main', 'master'],
  },
  commits: { forbiddenTrailers: [] },
  model: null,
  effort: null,
  roles: {},
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)

/** Deep merge of plain objects; arrays and scalars of `own` replace the default. */
export function merge(base, own) {
  if (!isObject(own)) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(own)) out[k] = isObject(v) && isObject(base[k]) ? merge(base[k], v) : v
  return out
}

export function projectRoot(start = process.cwd()) {
  if (process.env.CLAUDE_PROJECT_DIR) return path.resolve(process.env.CLAUDE_PROJECT_DIR)
  try {
    return path.resolve(git(['rev-parse', '--show-toplevel'], start).trim())
  } catch {
    return path.resolve(start)
  }
}

export function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

/** The GitHub CLI, run in the project; `input` goes to stdin (`--body-file -`). */
export function gh(args, { cwd, input } = {}) {
  try {
    return execFileSync('gh', args, {
      cwd,
      encoding: 'utf8',
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (e) {
    const detail = String(e.stderr || e.message || e).trim()
    throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${detail}`)
  }
}

export function readConfig(root) {
  const file = path.join(root, CONFIG_FILE)
  const own = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  return { ...merge(DEFAULT_CONFIG, own), _hasFile: existsSync(file) }
}

export function i18nFor(configOrLanguage) {
  const language =
    configOrLanguage && typeof configOrLanguage === 'object'
      ? configOrLanguage.language
      : configOrLanguage
  return createI18n({ localesDir: LOCALES_DIR, language })
}

/** The /config row of a role's setting: `fixer_model`, `triager_effort`… */
export const agentOptionKey = (role, setting) => `${role}_${setting}`

/**
 * Model or effort of a role's agents, first match wins: the argument,
 * `roles.<role>.<setting>` in the project config, `<setting>` in the project config,
 * the role's row in /config, the role's default (`ROLE_DEFAULTS`), inherit.
 */
export function agentSettingFor(config, role, setting, override = null) {
  const { values, aliases } = AGENT_SETTINGS[setting]
  const candidates = [
    ['arg', override],
    ['project', config.roles?.[role]?.[setting]],
    ['project', config[setting]],
    ['user', userOption(PLUGIN_ROOT, agentOptionKey(role, setting))],
    ['default', ROLE_DEFAULTS[role]?.[setting]],
  ]
  const [source, value] = candidates.find(([, v]) => v != null && String(v).trim() !== '') ?? [
    'default',
    null,
  ]
  if (value == null) return { value: 'inherit', source, raw: value, known: true }
  const raw = String(value).trim().toLowerCase()
  const resolved = values.includes(raw) ? raw : aliases[raw]
  return resolved
    ? { value: resolved, source, raw: value, known: true }
    : { value: 'inherit', source, raw: value, known: false }
}

/** `MODEL=` and the agent type (`tracker:fixer` or its effort variant) of a role. */
export function agentOf(config, role, overrides = {}) {
  const model = agentSettingFor(config, role, 'model', overrides.model)
  const effort = agentSettingFor(config, role, 'effort', overrides.effort)
  return {
    model,
    effort,
    type: effort.value === 'inherit' ? `tracker:${role}` : `tracker:${role}-${effort.value}`,
  }
}

export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

export const toPosix = (p) => p.split(path.sep).join('/')

/** Forward-slash path relative to `root`, or null when it lies outside. */
export function relativeTo(root, target) {
  if (!target) return null
  const rel = path.relative(root, path.resolve(root, target))
  if (rel === '') return ''
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

// ─── State (read by the guard) ──────────────────────────────────────────────

export const stateFile = (root) => path.join(root, STATE_DIR, 'state.json')

export function readState(root) {
  const file = stateFile(root)
  if (!existsSync(file)) return null
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'))
    if (!state.mode || (state.expires && Date.parse(state.expires) < Date.now())) return null
    return state
  } catch {
    return null
  }
}

export const expiry = (config) =>
  new Date(Date.now() + (config.guard.ttlHours ?? 6) * 3600_000).toISOString()

// ─── Dates ──────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0')

export function timestamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** Date tokens of an ISO timestamp (local time). */
export function dateTokens(iso = new Date().toISOString()) {
  const d = new Date(iso)
  const ok = !Number.isNaN(d.getTime())
  const x = ok ? d : new Date()
  return { YYYY: String(x.getFullYear()), MM: pad(x.getMonth() + 1), DD: pad(x.getDate()) }
}

/** A date for people, in the plugin's language. */
export function humanDate(iso, code) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso ?? '?')
  return d.toLocaleDateString(code, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export const fill = (template, vars) =>
  String(template).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))

// ─── Globs (guard) ──────────────────────────────────────────────────────────

const globCache = new Map()
const escapeRegex = (s) => s.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')

export function globToRegex(glob) {
  if (globCache.has(glob)) return globCache.get(glob)
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?'
        i += 2
      } else {
        source += '.*'
        i += 1
      }
    } else if (c === '*') source += '[^/]*'
    else if (c === '?') source += '[^/]'
    else source += escapeRegex(c)
  }
  if (glob.endsWith('/**')) source = `(?:${source}|${escapeRegex(glob.slice(0, -3))})`
  const regex = new RegExp(`^${source}$`, process.platform === 'win32' ? 'i' : '')
  globCache.set(glob, regex)
  return regex
}

export const matchGlob = (relPath, globs) => globs.find((g) => globToRegex(g).test(relPath)) ?? null

/** For a path that may live in a worktree: every suffix at a directory boundary. */
export function matchGlobSuffix(absPath, globs) {
  const segments = absPath.split(/[\\/]+/).filter(Boolean)
  for (let i = 0; i < segments.length; i++) {
    const found = matchGlob(segments.slice(i).join('/'), globs)
    if (found) return found
  }
  return null
}

// ─── From a finding to an issue ─────────────────────────────────────────────

/** The axis of a normalized finding: its own, its series', or `other`. */
export function axisOf(config, finding) {
  const own = finding.axis
  if (own) {
    // A producer may write the label's name (`sécurité`) rather than the axis id.
    const byName = Object.entries(config.names?.axis ?? {}).find(([, name]) => name === own)
    return byName ? byName[0] : own
  }
  return config.axisBySeries[finding.series] ?? 'other'
}

export function priorityOf(config, finding) {
  if (finding.priority && PRIORITIES.includes(finding.priority)) return finding.priority
  const table = config.priority.byAxis?.[axisOf(config, finding)] ?? config.priority.default
  return table?.[finding.severity] ?? config.priority.default?.[finding.severity] ?? 'P3'
}

const nameOf = (config, kind, value) => config.names?.[kind]?.[value] ?? value

export function labelsOf(config, finding) {
  const axis = axisOf(config, finding)
  const date = dateTokens(finding.source.finished ?? undefined)
  const source = config.labels.source?.[finding.source.kind]
  return [
    config.labels.axis && fill(config.labels.axis, { axis: nameOf(config, 'axis', axis) }),
    config.labels.severity &&
      fill(config.labels.severity, { severity: nameOf(config, 'severity', finding.severity) }),
    config.labels.priority && fill(config.labels.priority, { priority: priorityOf(config, finding) }),
    source && fill(source, date),
    ...(config.labels.extra ?? []),
  ].filter(Boolean)
}

function lowerFirst(text) {
  return /^\p{Lu}\p{Ll}/u.test(text) ? text[0].toLowerCase() + text.slice(1) : text
}

export function titleOf(config, finding) {
  const c = config.title
  const axis = axisOf(config, finding)
  const title = c.lowercaseFirst ? lowerFirst(finding.title) : finding.title
  return fill(c.template, {
    prefix: c.prefixByAxis?.[axis] ?? c.defaultPrefix,
    ref: finding.source.kind === 'audit' ? `${finding.id} — ` : '',
    title,
  }).slice(0, c.maxLength ?? 250)
}

const BODY_MAX = 60_000 // GitHub refuses bodies over 65,536 characters

/** The anchor of a finding in its report. */
const anchorOf = (finding) =>
  finding.source.kind === 'scan' ? finding.id : String(finding.id).toLowerCase()

/** The `Source.` line: where the finding comes from, and its key in clear. */
export function sourceLine(finding, t) {
  const s = finding.source
  const parts = s.report ? [`\`${s.report}#${anchorOf(finding)}\``] : []
  if (s.kind === 'scan') {
    parts.push(`run \`${s.run}\``)
    if (finding.rule) parts.push(`${t('bodyRule')} \`${finding.rule}\``)
  } else parts.push(`${t('bodyAgent')} \`${s.agent}\``)
  const [kind, value] = finding.key.split(/:(.*)/s)
  parts.push(`${t(kind === 'fp' ? 'bodyFingerprint' : 'bodyIdentifier')} \`${value}\``)
  return parts
}

export function bodyOf(config, finding, i18n) {
  const { t } = i18n
  const priority = priorityOf(config, finding)
  const blocks = [`**${t('bodyPriority')}.** ${t(`priority_${priority}`)}`]
  if (finding.file)
    blocks.push(
      `**${t('bodyLocation')}.** \`${finding.file}${finding.line ? `:${finding.line}` : ''}\``
    )
  blocks.push(`**${t('bodyFinding')}.** ${finding.description}`)
  if (finding.reachability) blocks.push(`**${t('bodyReach')}.** ${finding.reachability}`)
  if (finding.evidence) blocks.push(`**${t('bodyEvidence')}.** ${finding.evidence}`)
  if (finding.remediation) blocks.push(`**${t('bodyRemediation')}.** ${finding.remediation}`)
  const source = sourceLine(finding, t)
  if (finding.verdict) source.push(t(`verdict_${finding.verdict}`))
  blocks.push(`**${t('bodySource')}.** ${source.join(' · ')}`)

  const s = finding.source
  const at = s.commit ? t('bodyAtCommit', { commit: s.commit, branch: s.branch ?? '?' }) : ''
  const who = s.kind === 'scan' ? t('bodyScan', { type: s.type }) : t('bodyAudit', { agent: s.agent })
  const footer = `---\n_${t('bodyFooter', { who, date: humanDate(s.finished, i18n.code), at })}_`

  const assemble = () => `${keyComment(finding.key)}\n${blocks.join('\n\n')}\n\n${footer}`
  let body = assemble()
  if (body.length > BODY_MAX) {
    // Cut the finding's text, never the Source line: it carries the key.
    const i = blocks.findIndex((b) => b.startsWith(`**${t('bodyFinding')}.**`))
    const excess = body.length - BODY_MAX + 80
    const kept = finding.description.slice(0, Math.max(200, finding.description.length - excess))
    blocks[i] = `**${t('bodyFinding')}.** ${kept} … _(${t('bodyTruncated')})_`
    body = assemble()
  }
  return body
}

/** The line appended to an existing issue that already tracks a finding without its key. */
export function linkLine(finding, t) {
  return `${keyComment(finding.key)}\n_${t('linkedFinding')} ${sourceLine(finding, t).join(' · ')}_`
}

// ─── Reading an issue back ──────────────────────────────────────────────────

const LOCATION_WORDS = ['Location', 'Emplacement', 'Ubicación', 'Fundstelle']

/** `path/to/file.ts:42` from the body's location line, else the first path-like code span. */
export function locationIn(body) {
  const text = String(body ?? '')
  const line = text
    .split('\n')
    .find((l) => LOCATION_WORDS.some((w) => new RegExp(`\\*\\*${w}\\.?\\*\\*`, 'i').test(l)))
  // On the location line a root-level file (`README.md:3`) counts; elsewhere only a
  // path with a directory does, so that a stray `final.json` is not taken for one.
  const onLine = (s) => s?.match(/`([^`\s#]+\.[A-Za-z0-9]+(?::\d+(?:-\d+)?)?)`/)?.[1] ?? null
  const inText = (s) => s?.match(/`([^`\s]+\/[^`\s]+?(?::\d+(?:-\d+)?)?)`/)?.[1] ?? null
  return onLine(line) ?? inText(text.replace(/`[^`]*#[^`]*`/g, ''))
}

/** The commit the finding was measured at, from the footer (`at commit \`abc1234\``), if any. */
export function commitIn(body) {
  // The footer only: the Source line above it carries hex fingerprints too.
  const text = String(body ?? '')
  const at = text.lastIndexOf('\n---\n')
  return at < 0 ? null : (text.slice(at).match(/`([0-9a-f]{7,40})`/)?.[1] ?? null)
}

/** The report the Source line points to (`docs/…html#anchor`), if any. */
export function reportIn(body) {
  const m = String(body ?? '').match(/`([^`\s]+\.(?:html?|md)#[^`\s]+)`/)
  return m ? m[1] : null
}

/** Regex that reads a value back out of a label template (`priority: {priority}`). */
export function labelPattern(template, token) {
  const [before, after] = String(template).split(`{${token}}`)
  if (after === undefined) return null
  return new RegExp(`^${escapeRegex(before)}(.+)${escapeRegex(after)}$`)
}

/** Priority, severity and axis of an issue, read from its labels. */
export function issueFacets(config, labels) {
  const names = labels.map((l) => (typeof l === 'string' ? l : l.name))
  const read = (template, token, reverse = {}) => {
    const re = labelPattern(template, token)
    if (!re) return null
    for (const n of names) {
      const m = n.match(re)
      if (m) return reverse[m[1]] ?? m[1]
    }
    return null
  }
  const invert = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [v, k]))
  return {
    priority: read(config.labels.priority, 'priority'),
    severity: read(config.labels.severity, 'severity', invert(config.names?.severity)),
    axis: read(config.labels.axis, 'axis', invert(config.names?.axis)),
  }
}

export const priorityRank = (p) => (PRIORITIES.includes(p) ? PRIORITIES.indexOf(p) : PRIORITIES.length)

export { SEVERITIES }
