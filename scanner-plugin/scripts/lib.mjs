// Helpers shared by scanner.mjs (orchestration) and guard.mjs (hooks).
// No dependencies: Node 18+ only, so the plugin can be shared as is.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const STATE_DIR = '.scanner'
export const CONFIG_FILE = `${STATE_DIR}/config.json`
export const OVERLAY_DIR = `${STATE_DIR}/profiles`

/** Profile fields, following Devin's code-scan profile layout, keyed by their heading. */
export const FIELDS = {
  description: 'Description',
  threat_model_guidance: 'Threat model',
  investigation_guidance: 'Investigation',
  triage_guidance: 'Triage',
  report_guidance: 'Report',
  remediation_guidance: 'Remediation',
  exclude_globs: 'Exclusions',
}
const REQUIRED_FIELDS = [
  'description',
  'investigation_guidance',
  'triage_guidance',
  'report_guidance',
]

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']

export const DEFAULT_CONFIG = {
  language: 'English',
  reports: 'docs/scans',
  reportName: 'scan-{type}-{YYYYMMDD}.html',
  history: `${STATE_DIR}/history`,
  diffBase: 'main',
  remediationBase: null,
  branchPrefix: 'fix/',
  batches: 4,
  reportInstructions: '',
  types: {},
  check: {},
  guard: {
    ttlHours: 6,
    writeDenied: [],
    commandsDenied: [],
    protectedBranches: ['main', 'master'],
  },
  commits: { forbiddenTrailers: [], checkOutsideScan: false },
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

/** Project config merged over the defaults. The file is optional. */
export function readConfig(root) {
  const file = path.join(root, CONFIG_FILE)
  const own = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  return {
    ...DEFAULT_CONFIG,
    ...own,
    guard: { ...DEFAULT_CONFIG.guard, ...own.guard },
    commits: { ...DEFAULT_CONFIG.commits, ...own.commits },
    _hasFile: existsSync(file),
  }
}

export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function sha1(text) {
  return createHash('sha1').update(text).digest('hex')
}

/** Forward-slash path relative to `root`, or null when it lies outside. */
export function relativeTo(root, target) {
  if (!target) return null
  const rel = path.relative(root, path.resolve(root, target))
  if (rel === '') return ''
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

// ─── Globs ──────────────────────────────────────────────────────────────────

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
  // `dir/**` also designates the directory itself (a Grep with `path: dir`).
  if (glob.endsWith('/**')) source = `(?:${source}|${escapeRegex(glob.slice(0, -3))})`
  const regex = new RegExp(`^${source}$`, process.platform === 'win32' ? 'i' : '')
  globCache.set(glob, regex)
  return regex
}

export function matchGlob(relPath, globs) {
  return globs.find((g) => globToRegex(g).test(relPath)) ?? null
}

/**
 * For a path that may live in a worktree: tries every suffix starting at a
 * directory boundary. Over-matches on purpose — only ever used to deny.
 */
export function matchGlobSuffix(absPath, globs) {
  const segments = absPath.split(/[\\/]+/).filter(Boolean)
  for (let i = 0; i < segments.length; i++) {
    const found = matchGlob(segments.slice(i).join('/'), globs)
    if (found) return found
  }
  return null
}

// ─── Profiles ───────────────────────────────────────────────────────────────

/** Splits a profile Markdown file on its `## ` headings, ignoring fenced code. */
export function parseProfile(markdown) {
  const out = { title: null, intro: [], sections: {} }
  let current = null
  let inFence = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^```/.test(line)) inFence = !inFence
    if (!inFence && /^# /.test(line) && !out.title) {
      out.title = line.slice(2).trim()
      continue
    }
    if (!inFence && /^## /.test(line)) {
      current = line.slice(3).trim().toLowerCase()
      out.sections[current] = []
      continue
    }
    if (current) out.sections[current].push(line)
    else out.intro.push(line)
  }
  const text = (lines) => lines.join('\n').trim()
  return {
    title: out.title,
    intro: text(out.intro),
    sections: Object.fromEntries(Object.entries(out.sections).map(([k, v]) => [k, text(v)])),
  }
}

/** One glob per line; list markers, backticks, fences and blank lines are ignored. */
export function parseGlobs(text) {
  return (text ?? '')
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*[-*]\s+/, '')
        .replace(/`/g, '')
        .trim()
    )
    .filter((l) => l && !l.startsWith('```') && !/\s/.test(l))
}

export function builtinTypes() {
  return readdirSync(path.join(PLUGIN_ROOT, 'profiles'))
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => f.slice(0, -3))
    .sort()
}

/**
 * Builds the effective profile of a type: the built-in profile shipped with the
 * plugin, plus the project's optional overlay (`.scanner/profiles/<type>.md`),
 * whose sections are appended under a "Project-specific" marker, plus the
 * exclusion adjustments of the config.
 */
export function loadProfile(root, config, type) {
  const builtinFile = path.join(PLUGIN_ROOT, 'profiles', `${type}.md`)
  const overlayFile = path.join(root, OVERLAY_DIR, `${type}.md`)
  const hasBuiltin = existsSync(builtinFile)
  const hasOverlay = existsSync(overlayFile)
  if (!hasBuiltin && !hasOverlay)
    return { profile: null, problems: [`${type}: no built-in profile and no overlay`] }

  const base = hasBuiltin
    ? parseProfile(readFileSync(builtinFile, 'utf8'))
    : { title: type, intro: '', sections: {} }
  const overlay = hasOverlay ? parseProfile(readFileSync(overlayFile, 'utf8')) : null
  const common = parseProfile(
    readFileSync(path.join(PLUGIN_ROOT, 'profiles', '_common-remediation.md'), 'utf8')
  )

  const problems = []
  const profile = { type, title: base.title ?? type, context: base.intro }
  if (overlay?.intro) profile.project_context = overlay.intro
  for (const [key, heading] of Object.entries(FIELDS)) {
    const h = heading.toLowerCase()
    const own = base.sections[h] ?? ''
    const extra = overlay?.sections[h] ?? ''
    if (key === 'exclude_globs') continue
    const value = extra
      ? `${own}\n\nPROJECT-SPECIFIC (takes precedence over the generic guidance above):\n${extra}`.trim()
      : own
    if (value) profile[key] = value
    else if (REQUIRED_FIELDS.includes(key))
      problems.push(`${type}: missing "## ${heading}" section`)
  }

  const adjust = config.types?.[type]?.exclusions ?? {}
  const remove = new Set(adjust.remove ?? [])
  profile.exclusions = [
    ...new Set([
      ...parseGlobs(base.sections.exclusions),
      ...parseGlobs(overlay?.sections.exclusions),
      ...(adjust.add ?? []),
    ]),
  ].filter((g) => !remove.has(g))
  profile.common_remediation = common.sections['remediation'] ?? ''
  profile.language = config.language
  profile.require_reachability = config.types?.[type]?.requireReachability ?? type === 'security'
  profile.sources = {
    builtin: hasBuiltin,
    overlay: hasOverlay ? `${OVERLAY_DIR}/${type}.md` : null,
  }
  profile.fingerprint = sha1(JSON.stringify(profile)).slice(0, 12)
  return { profile, problems }
}

/** Types available in this project: built-in ones plus overlay-only ones, minus disabled ones. */
export function availableTypes(root, config) {
  const overlayDir = path.join(root, OVERLAY_DIR)
  const overlays = existsSync(overlayDir)
    ? readdirSync(overlayDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.slice(0, -3))
    : []
  return [...new Set([...builtinTypes(), ...overlays])].filter(
    (t) => config.types?.[t]?.enabled !== false
  )
}

// ─── Guard state ────────────────────────────────────────────────────────────

export function stateFile(root) {
  return path.join(root, STATE_DIR, 'state.json')
}

export function readState(root) {
  const file = stateFile(root)
  if (!existsSync(file)) return null
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'))
    if (state.expires && Date.parse(state.expires) < Date.now()) return null
    return state
  } catch {
    return null
  }
}

export function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`
}

export function isoDay(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return {
    YYYYMMDD: `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`,
    DDMMYYYY: `${p(date.getDate())}${p(date.getMonth() + 1)}${date.getFullYear()}`,
  }
}
