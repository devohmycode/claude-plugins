#!/usr/bin/env node
// Deterministic side of a scan: whatever can be counted, sorted or compared is
// done here, never by an agent.
//
//   types                                   list available scan types
//   profile <type>                          print the effective profile (JSON)
//   prepare <type> [--scope full|diff|<path>] [--deep] [--mode report|fix|review]
//   consolidate <run>                       findings-B*.json → findings.json + triage batches
//   finalize <run>                          verdicts-T*.json → final.json + history
//   select <run> [<selection>]              list the retained findings, resolve a selection
//   fix <run> <selection>                   fix branch + worktree, remediation guard armed
//   fix-status <run>                        what the remediators did, commits on the branch
//   check                                   check profiles and config against the repo
//   language [<code>]                       show the language, or set it in .scanner/config.json
//   guard status | off | remediate <run> <id>

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  CONFIG_FILE,
  MODES,
  REPORT_FORMATS,
  SEVERITIES,
  STATE_DIR,
  availableTypes,
  git,
  i18nFor,
  isoDay,
  loadProfile,
  matchGlob,
  modeFor,
  projectRoot,
  readConfig,
  readJson,
  readState,
  reportFormatFor,
  sha1,
  stateFile,
  timestamp,
  writeJson,
} from './lib.mjs'
import { LANGUAGES, SUPPORTED, resolveLanguage } from './i18n.mjs'

const root = projectRoot()
const [command, ...args] = process.argv.slice(2)
// Messages follow the project's `language`; a broken config still gets English messages.
const i18n = (() => {
  try {
    return i18nFor(readConfig(root))
  } catch {
    return i18nFor(null)
  }
})()
const t = i18n.t
const SOURCE_KEYS = {
  arg: 'sourceArg',
  project: 'sourceProject',
  env: 'sourceEnv',
  user: 'sourceUser',
  default: 'sourceDefault',
}
const languageSource = () => t(SOURCE_KEYS[i18n.source])

function option(name, fallback = null) {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const value = args[i + 1]
  return value && !value.startsWith('--') ? value : true
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function profileOf(config, type) {
  if (!availableTypes(root, config).includes(type))
    fail(t('unknownType', { type, list: availableTypes(root, config).join(', ') }))
  const { profile, problems } = loadProfile(root, config, type)
  if (!profile) fail(problems.join('\n'))
  return profile
}

function runDir(run) {
  const dir = path.isAbsolute(run) ? run : path.join(root, STATE_DIR, 'runs', run)
  if (!existsSync(dir)) fail(t('runNotFound', { dir }))
  return dir
}

const expiry = (config) =>
  new Date(Date.now() + (config.guard.ttlHours ?? 6) * 3600_000).toISOString()
const toPosix = (p) => p.split(path.sep).join('/')

// ─── Scope and batching ─────────────────────────────────────────────────────

function filesInScope(config, scope) {
  let files
  if (scope === 'diff') {
    const since = git(['merge-base', config.diffBase, 'HEAD'], root).trim()
    files = [
      ...new Set([
        ...git(['diff', '--name-only', '--diff-filter=d', since], root).split('\n'),
        ...git(['ls-files', '--others', '--exclude-standard'], root).split('\n'),
      ]),
    ].filter(Boolean)
  } else {
    files = git(['ls-files'], root).split('\n').filter(Boolean)
    if (scope && scope !== 'full') {
      const prefix = scope.replace(/\\/g, '/').replace(/\/$/, '')
      files = files.filter((f) => f === prefix || f.startsWith(`${prefix}/`))
    }
  }
  return files.filter((f) => existsSync(path.join(root, f)))
}

/** Groups by directory (deepening until there are enough groups), then balances batches by bytes. */
function splitIntoBatches(files, n) {
  const size = (f) => {
    try {
      return statSync(path.join(root, f)).size
    } catch {
      return 0
    }
  }
  const group = (depth) => {
    const groups = new Map()
    for (const f of files) {
      const parts = f.split('/')
      const key =
        parts.length > 1 ? parts.slice(0, Math.min(depth, parts.length - 1)).join('/') : '(root)'
      const g = groups.get(key) ?? { key, files: [], bytes: 0 }
      g.files.push(f)
      g.bytes += size(f)
      groups.set(key, g)
    }
    return groups
  }
  let groups = group(2)
  for (let depth = 3; groups.size < n && depth <= 6; depth++) {
    const deeper = group(depth)
    if (deeper.size === groups.size) break
    groups = deeper
  }
  if (groups.size < n)
    groups = new Map(files.map((f) => [f, { key: f, files: [f], bytes: size(f) }]))

  const batches = Array.from({ length: Math.max(1, Math.min(n, groups.size)) }, (_, i) => ({
    id: `B${i + 1}`,
    groups: [],
    files: [],
    bytes: 0,
  }))
  for (const g of [...groups.values()].sort((a, b) => b.bytes - a.bytes)) {
    const batch = batches.reduce((min, b) => (b.bytes < min.bytes ? b : min))
    batch.groups.push(g.files.length > 1 ? `${g.key} (${g.files.length})` : g.key)
    batch.files.push(...g.files)
    batch.bytes += g.bytes
  }
  return batches.filter((b) => b.files.length)
}

// ─── Commands ───────────────────────────────────────────────────────────────

function cmdTypes() {
  const config = readConfig(root)
  for (const type of availableTypes(root, config)) {
    const { profile, problems } = loadProfile(root, config, type)
    const overlay = profile?.sources.overlay ? ` + overlay ${profile.sources.overlay}` : ''
    console.log(
      `${type} — ${profile?.title ?? '?'}${overlay}${problems.length ? ` (⚠ ${problems.join('; ')})` : ''}`
    )
  }
}

function cmdProfile() {
  console.log(JSON.stringify(profileOf(readConfig(root), args[0]), null, 2))
}

function cmdPrepare() {
  const config = readConfig(root)
  const type = args[0]
  if (!type) fail(t('usage', { syntax: 'prepare <type> [--scope full|diff|<path>] [--deep]' }))
  const profile = profileOf(config, type)
  const scope = option('scope', 'full')
  const deep = option('deep') === true
  const asked = option('mode')
  const mode = modeFor(config, typeof asked === 'string' ? asked : null)
  if (!mode.known) fail(t('badMode', { value: mode.value, list: MODES.join(', ') }))

  const all = filesInScope(config, scope)
  const files = all.filter((f) => !matchGlob(f, profile.exclusions))
  if (!files.length) fail(t('noFileInScope', { scope }))

  const batches = splitIntoBatches(files, (config.batches ?? 4) * (deep ? 2 : 1))
  const run = `${type}-${timestamp()}`
  const dir = path.join(root, STATE_DIR, 'runs', run)
  const meta = {
    run,
    type,
    scope,
    deep,
    mode: mode.mode,
    commit: git(['rev-parse', '--short', 'HEAD'], root).trim(),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim(),
    started: new Date().toISOString(),
    files: files.length,
    excluded: all.length - files.length,
    batches: batches.map(({ id, groups, files: f, bytes }) => ({
      id,
      groups,
      files: f.length,
      bytes,
    })),
  }
  writeJson(path.join(dir, 'profile.json'), profile)
  for (const b of batches) writeJson(path.join(dir, `batch-${b.id}.json`), b.files)
  writeJson(path.join(dir, 'meta.json'), meta)
  writeJson(stateFile(root), {
    mode: 'scan',
    run,
    type,
    exclusions: profile.exclusions,
    writeAllowed: [`${STATE_DIR}/runs/${run}/**`, `${config.reports}/**`],
    lang: i18n.code,
    expires: expiry(config),
  })

  console.log(`RUN=${run}`)
  console.log(`DIR=${toPosix(path.relative(root, dir))}`)
  console.log(`LANG=${profile.language_code}`)
  console.log(`MODE=${mode.mode}`)
  console.log(
    t('modeAnnounce', {
      description: t(`mode_${mode.mode}`),
      source: t(SOURCE_KEYS[mode.source]),
    })
  )
  console.log(
    t('profileLine', {
      type,
      fingerprint: profile.fingerprint,
      overlay: profile.sources.overlay ? t('withOverlay') : '',
      commit: meta.commit,
      branch: meta.branch,
    })
  )
  console.log(
    t('filesLine', { files: files.length, excluded: meta.excluded, batches: batches.length })
  )
  for (const b of meta.batches)
    console.log(
      t('batchLine', {
        id: b.id,
        files: b.files,
        kb: Math.round(b.bytes / 1024),
        groups: b.groups.join(', '),
      })
    )
  console.log(t('guardArmed'))
}

function validateFinding(f, source) {
  const errors = []
  for (const field of ['title', 'file', 'rule', 'description'])
    if (typeof f[field] !== 'string' || !f[field].trim()) errors.push(t('missingField', { field }))
  if (!SEVERITIES.includes(f.severity))
    errors.push(t('badSeverity', { severity: f.severity, list: SEVERITIES.join('/') }))
  if (f.line != null && !Number.isInteger(f.line)) errors.push(t('lineNotInteger'))
  if (f.file && !existsSync(path.join(root, f.file)))
    errors.push(t('fileMissing', { file: f.file }))
  return errors.length ? `${source} "${f.title ?? '?'}": ${errors.join(', ')}` : null
}

/** Stable across scans: the line number is left out, since it moves with every edit above it. */
function fingerprint(type, f) {
  const snippet = String(f.snippet ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return sha1(`${type}|${f.rule}|${f.file}|${snippet}`).slice(0, 16)
}

function cmdConsolidate() {
  const dir = runDir(args[0])
  const meta = readJson(path.join(dir, 'meta.json'))
  const present = readdirSync(dir).filter((f) => /^findings-B\d+\.json$/.test(f))
  const missing = meta.batches
    .map((b) => `findings-${b.id}.json`)
    .filter((f) => !present.includes(f))

  const rejected = []
  const byFingerprint = new Map()
  for (const file of present) {
    let list
    try {
      list = readJson(path.join(dir, file))
    } catch (e) {
      rejected.push(t('unreadableJson', { file, error: e.message }))
      continue
    }
    for (const f of Array.isArray(list) ? list : (list.findings ?? [])) {
      const error = validateFinding(f, file)
      if (error) {
        rejected.push(error)
        continue
      }
      const fp = fingerprint(meta.type, f)
      if (!byFingerprint.has(fp))
        byFingerprint.set(fp, { ...f, fingerprint: fp, batch: file.slice(9, -5) })
    }
  }
  const findings = [...byFingerprint.values()]
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
    .map((f, i) => ({ id: `F${i + 1}`, ...f }))
  writeJson(path.join(dir, 'findings.json'), findings)
  writeJson(path.join(dir, 'rejected.json'), rejected)

  const triage = []
  for (let i = 0; i < findings.length; i += 10) {
    const id = `T${triage.length + 1}`
    writeJson(path.join(dir, `triage-${id}.json`), findings.slice(i, i + 10))
    triage.push(id)
  }
  console.log(t('consolidated', { findings: findings.length, rejected: rejected.length }))
  if (missing.length) console.log(t('batchesWithoutFile', { list: missing.join(', ') }))
  for (const r of rejected.slice(0, 10)) console.log(t('rejectedLine', { reason: r }))
  console.log(`TRIAGE_BATCHES=${triage.join(',')}`)
}

function latestHistory(config, type, exceptRun) {
  const dir = path.join(root, config.history)
  if (!existsSync(dir)) return null
  const candidates = readdirSync(dir)
    .filter((f) => f.startsWith(`${type}-`) && f.endsWith('.json') && f !== `${exceptRun}.json`)
    .sort()
  return candidates.length ? readJson(path.join(dir, candidates.at(-1))) : null
}

/**
 * `{ext}` in `reportName` becomes the format's extension; a name written with a
 * fixed extension (`….html`, `….md`, the pre-0.3 default) gets it replaced, so
 * the file always matches the format.
 */
function reportPath(config, type, ext) {
  let name = config.reportName.replace('{type}', type)
  for (const [token, value] of Object.entries(isoDay())) name = name.replace(`{${token}}`, value)
  name = name.includes('{ext}')
    ? name.replace('{ext}', ext)
    : `${name.replace(/\.(html?|md|markdown)$/i, '')}.${ext}`
  return path.posix.join(config.reports, name)
}

function cmdFinalize() {
  const config = readConfig(root)
  const reportFormat = reportFormatFor(config)
  const dir = runDir(args[0])
  const meta = readJson(path.join(dir, 'meta.json'))
  const profile = readJson(path.join(dir, 'profile.json'))
  const findingsFile = path.join(dir, 'findings.json')
  const findings = existsSync(findingsFile) ? readJson(findingsFile) : []

  const verdicts = new Map()
  for (const f of readdirSync(dir).filter((f) => /^verdicts-T\d+\.json$/.test(f)))
    for (const v of readJson(path.join(dir, f))) verdicts.set(v.id, v)

  const kept = []
  const refuted = []
  const untriaged = []
  for (const f of findings) {
    const v = verdicts.get(f.id)
    if (!v) {
      untriaged.push(f.id)
      kept.push({ ...f, verdict: 'untriaged' })
      continue
    }
    if (v.verdict === 'refuted') {
      refuted.push({
        id: f.id,
        title: f.title,
        file: f.file,
        reason: v.reason,
        never_report_entry: v.never_report_entry ?? null,
      })
      continue
    }
    const finding = {
      ...f,
      severity: SEVERITIES.includes(v.severity) ? v.severity : f.severity,
      verdict: v.verdict,
      triage_reason: v.reason,
    }
    if (
      profile.require_reachability &&
      !String(f.reachability ?? '').trim() &&
      finding.severity !== 'info'
    ) {
      finding.severity = 'info'
      finding.downgraded = t('noReachability')
    }
    kept.push(finding)
  }
  kept.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))

  const full = meta.scope === 'full'
  const previous = latestHistory(config, meta.type, meta.run)
  const known = new Set((previous?.findings ?? []).map((f) => f.fingerprint))
  for (const f of kept) f.status = known.has(f.fingerprint) ? 'persisting' : 'new'
  const current = new Set(kept.map((f) => f.fingerprint))
  // "Resolved" only means something when both scans covered the whole repository.
  const resolved =
    previous && full && previous.scope === 'full'
      ? previous.findings
          .filter((f) => !current.has(f.fingerprint))
          .map(({ id, title, file, severity, fingerprint: fp }) => ({
            id,
            title,
            file,
            severity,
            fingerprint: fp,
          }))
      : []

  const final = {
    ...meta,
    finished: new Date().toISOString(),
    profile_fingerprint: profile.fingerprint,
    previous: previous
      ? {
          run: previous.run,
          commit: previous.commit,
          profile_fingerprint: previous.profile_fingerprint,
        }
      : null,
    counts: Object.fromEntries(
      SEVERITIES.map((s) => [s, kept.filter((f) => f.severity === s).length])
    ),
    findings: kept,
    refuted,
    resolved,
    untriaged,
    report_format: reportFormat.format,
    report: reportPath(config, meta.type, REPORT_FORMATS[reportFormat.format]),
  }
  writeJson(path.join(dir, 'final.json'), final)
  if (full) writeJson(path.join(root, config.history, `${meta.run}.json`), final)

  console.log(
    t('finalized', {
      kept: kept.length,
      counts: SEVERITIES.map((s) => `${final.counts[s]} ${s}`).join(', '),
      refuted: refuted.length,
    })
  )
  if (previous)
    console.log(
      t('comparedWith', {
        run: previous.run,
        new: kept.filter((f) => f.status === 'new').length,
        resolved: resolved.length,
      })
    )
  if (previous && previous.profile_fingerprint !== profile.fingerprint)
    console.log(t('profileChanged'))
  if (!full) console.log(t('partialScope'))
  if (untriaged.length) console.log(t('noVerdict', { list: untriaged.join(', ') }))
  console.log(`MODE=${final.mode ?? 'report'}`)
  console.log(`FORMAT=${final.report_format}`)
  console.log(`REPORT=${final.report}`)
}

// ─── Selection and fixes ────────────────────────────────────────────────────

const location = (f) => `${f.file}${f.line ? `:${f.line}` : ''}`

/**
 * A selection, comma- or space-separated: `F3` (an id), `high` (a severity),
 * `>=medium` or `medium+` (that severity and above), `all` (every finding down to
 * `fixMinSeverity`), `none`. Returns the findings in the report's order.
 */
function resolveSelection(config, { run, findings }, spec) {
  const tokens = String(spec ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const rank = (s) => SEVERITIES.indexOf(s)
  const picked = new Set()
  for (const raw of tokens) {
    const token = raw.toLowerCase()
    if (token === 'none') continue
    let keep
    if (token === 'all') {
      const floor = rank(config.fixMinSeverity ?? 'low')
      keep = (f) => rank(f.severity) <= (floor < 0 ? rank('low') : floor)
    } else if (/^f\d+$/.test(token)) {
      const id = token.toUpperCase()
      if (!findings.some((f) => f.id === id)) fail(t('findingNotFound', { id, run }))
      keep = (f) => f.id === id
    } else {
      const m = token.match(/^(?:>=)?([a-z]+)(\+)?$/)
      const severity = m?.[1]
      if (!severity || rank(severity) < 0) fail(t('badSelection', { token: raw }))
      keep =
        token.startsWith('>=') || m[2]
          ? (f) => rank(f.severity) <= rank(severity)
          : (f) => f.severity === severity
    }
    for (const f of findings) if (keep(f)) picked.add(f.id)
  }
  return findings.filter((f) => picked.has(f.id))
}

function cmdSelect() {
  const config = readConfig(root)
  const dir = runDir(args[0])
  const final = readJson(path.join(dir, 'final.json'))
  const selected = args[1] ? resolveSelection(config, final, args.slice(1).join(' ')) : null
  for (const f of selected ?? final.findings)
    console.log(`${f.id} [${f.severity}] ${f.title} — ${location(f)}`)
  if (selected) console.log(`SELECTED=${selected.map((f) => f.id).join(',')}`)
  else
    console.log(
      `ALL=${resolveSelection(config, final, 'all')
        .map((f) => f.id)
        .join(',')}`
    )
}

function branchExists(name) {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], root)
    return true
  } catch {
    return false
  }
}

/** One branch per run, one worktree, one commit per finding: the remediators run one after the other. */
function cmdFix() {
  const config = readConfig(root)
  const dir = runDir(args[0])
  const final = readJson(path.join(dir, 'final.json'))
  const selected = resolveSelection(config, final, args.slice(1).join(' '))
  if (!selected.length) fail(t('selectionEmpty', { run: final.run }))

  const base = config.remediationBase ?? git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()
  const stem = `${config.branchPrefix ?? 'fix/'}scan-${final.type}-${isoDay().YYYYMMDD}`
  let branch = stem
  for (let n = 2; branchExists(branch); n++) branch = `${stem}-${n}`

  const parent = path.join(root, STATE_DIR, 'worktrees')
  const worktree = path.join(parent, final.run)
  if (existsSync(worktree)) fail(t('worktreeExists', { worktree: toPosix(worktree) }))
  // The worktree lives inside the repository: this keeps it out of `git status`.
  if (!existsSync(path.join(parent, '.gitignore'))) {
    mkdirSync(parent, { recursive: true })
    writeFileSync(path.join(parent, '.gitignore'), '*\n', 'utf8')
  }
  try {
    execFileSync('git', ['worktree', 'add', '-b', branch, worktree, base], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    fail(t('worktreeFailed', { error: String(e.stderr || e.message).trim() }))
  }

  const remediation = {
    run: final.run,
    type: final.type,
    branch,
    base,
    worktree: toPosix(worktree),
    started: new Date().toISOString(),
    findings: selected.map((f) => f.id),
  }
  writeJson(path.join(dir, 'remediation.json'), remediation)
  writeJson(stateFile(root), {
    mode: 'remediation',
    run: final.run,
    finding: remediation.findings.join(','),
    worktree: remediation.worktree,
    branch,
    writeDenied: config.guard.writeDenied,
    commandsDenied: config.guard.commandsDenied,
    protectedBranches: config.guard.protectedBranches,
    lang: i18n.code,
    expires: expiry(config),
  })

  console.log(`BRANCH=${branch}`)
  console.log(`BASE=${base}`)
  console.log(`WORKTREE=${remediation.worktree}`)
  console.log(`FINDINGS=${remediation.findings.join(',')}`)
  console.log(t('fixReady', { branch, base, n: selected.length }))
  for (const f of selected) console.log(`${f.id} [${f.severity}] ${f.title} — ${location(f)}`)
}

/** Reads the `remediation-F*.json` left by the remediators, and the branch's commits. */
function cmdFixStatus() {
  const dir = runDir(args[0])
  const file = path.join(dir, 'remediation.json')
  if (!existsSync(file)) fail(t('noRemediation', { run: args[0] }))
  const rem = readJson(file)
  const final = readJson(path.join(dir, 'final.json'))
  const counts = { fixed: 0, skipped: 0, failed: 0, pending: 0 }
  for (const id of rem.findings) {
    const f = final.findings.find((x) => x.id === id) ?? { id, title: '?', severity: '?' }
    const out = path.join(dir, `remediation-${id}.json`)
    const result = existsSync(out) ? readJson(out) : { status: 'pending' }
    const status = counts[result.status] != null ? result.status : 'failed'
    counts[status]++
    console.log(
      `${id} [${f.severity}] ${f.title}: ${t(`status_${status}`)}${result.commit ? ` (${result.commit})` : ''}${result.reason ? ` — ${result.reason}` : ''}`
    )
  }
  let commits = []
  try {
    commits = git(['log', '--oneline', `${rem.base}..${rem.branch}`], root)
      .split('\n')
      .filter(Boolean)
  } catch {
    // Branch removed since: the counts above still stand.
  }
  console.log(
    t('fixSummary', {
      ...counts,
      commits: commits.length,
      branch: rem.branch,
      base: rem.base,
      worktree: rem.worktree,
    })
  )
}

function cmdCheck() {
  const config = readConfig(root)
  const lines = []
  let failures = 0
  if (!config._hasFile) lines.push(t('noConfig'))
  const reportFormat = reportFormatFor(config)
  if (reportFormat.known)
    lines.push(
      t('reportFormatLine', {
        format: reportFormat.format,
        source: t(SOURCE_KEYS[reportFormat.source]),
      })
    )
  else {
    failures++
    lines.push(
      t('unsupportedReportFormat', {
        value: reportFormat.value,
        list: Object.keys(REPORT_FORMATS).join(', '),
      })
    )
  }
  const mode = modeFor(config)
  if (mode.known)
    lines.push(
      t('modeLine', {
        mode: mode.mode,
        description: t(`mode_${mode.mode}`),
        source: t(SOURCE_KEYS[mode.source]),
      })
    )
  else {
    failures++
    lines.push(t('unsupportedMode', { value: mode.value, list: MODES.join(', ') }))
  }
  if (!SEVERITIES.includes(config.fixMinSeverity)) {
    failures++
    lines.push(
      t('badFixMinSeverity', { value: config.fixMinSeverity, list: SEVERITIES.join(', ') })
    )
  }
  if (i18n.known)
    lines.push(t('languageLine', { name: i18n.name, code: i18n.code, source: languageSource() }))
  else {
    failures++
    lines.push(t('unsupportedLanguage', { value: i18n.value, list: SUPPORTED.join(', ') }))
  }
  for (const type of availableTypes(root, config)) {
    const { profile, problems } = loadProfile(root, config, type)
    failures += problems.length
    for (const p of problems) lines.push(`✗ ${p}`)
    if (profile)
      lines.push(
        t('typeOk', {
          type,
          guidance: Object.keys(profile).filter((k) => k.endsWith('_guidance')).length,
          exclusions: profile.exclusions.length,
          overlay: profile.sources.overlay ? t('overlaySuffix') : '',
          fingerprint: profile.fingerprint,
        })
      )
  }

  const check = config.check ?? {}
  const tracked = git(['ls-files'], root).split('\n').filter(Boolean)
  const ignored = [`${STATE_DIR}/**`, ...(check.ignore ?? [])]
  const code = tracked.filter(
    (f) =>
      !matchGlob(f, ignored) &&
      /\.(m?[jt]sx?|cjs|py|go|rb|rs|java|kt|php|cs|sql|sh|ya?ml|json|toml)$/.test(f)
  )
  const texts = code.map((f) => {
    try {
      return readFileSync(path.join(root, f), 'utf8')
    } catch {
      return ''
    }
  })
  for (const name of check.constants ?? []) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    const n = texts.filter((t) => re.test(t)).length
    if (!n) failures++
    lines.push(t('constant', { mark: n ? '✓' : '✗', name, n }))
  }
  const pkgFile = path.join(root, 'package.json')
  const pkg = existsSync(pkgFile) ? readJson(pkgFile) : {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const name of check.libraries?.present ?? []) {
    if (!deps[name]) failures++
    lines.push(t('libraryPresent', { mark: deps[name] ? '✓' : '✗', name }))
  }
  for (const name of check.libraries?.absent ?? []) {
    if (deps[name]) failures++
    lines.push(t('libraryAbsent', { mark: deps[name] ? '✗' : '✓', name }))
  }
  for (const { label, glob, expected } of check.counts ?? []) {
    const n = tracked.filter((f) => matchGlob(f, [glob])).length
    lines.push(
      t('count', {
        mark: expected == null || n === expected ? '✓' : '≠',
        label,
        n,
        expected: expected == null ? '' : t('configSays', { expected }),
      })
    )
  }
  console.log(lines.join('\n'))
  console.log(`\n${failures ? t('toFix', { n: failures }) : t('consistent')}`)
  process.exit(failures ? 1 : 0)
}

function cmdGuard() {
  const config = readConfig(root)
  const [action, run, id] = args
  if (action === 'status' || !action) {
    const state = readState(root)
    console.log(state ? JSON.stringify(state, null, 2) : t('guardInactive'))
    return
  }
  if (action === 'off') {
    writeJson(stateFile(root), { mode: 'inactive', since: new Date().toISOString() })
    console.log(t('guardLifted'))
    return
  }
  if (action === 'remediate') {
    if (!run || !id) fail(t('usage', { syntax: 'guard remediate <run> <id>' }))
    const final = readJson(path.join(runDir(run), 'final.json'))
    const finding = final.findings.find((f) => f.id === id)
    if (!finding) fail(t('findingNotFound', { id, run }))
    writeJson(stateFile(root), {
      mode: 'remediation',
      run: final.run,
      finding: id,
      writeDenied: config.guard.writeDenied,
      commandsDenied: config.guard.commandsDenied,
      protectedBranches: config.guard.protectedBranches,
      lang: i18n.code,
      expires: expiry(config),
    })
    console.log(JSON.stringify(finding, null, 2))
    return
  }
  fail(t('usage', { syntax: 'guard status | off | remediate <run> <id>' }))
}

/** Without argument: the current language. With a code or a name: writes it to the config. */
function cmdLanguage() {
  const value = args[0]
  const list = SUPPORTED.map((c) => `${c} (${LANGUAGES[c].native})`).join(', ')
  if (!value) {
    if (!i18n.known)
      console.log(t('unsupportedLanguage', { value: i18n.value, list: SUPPORTED.join(', ') }))
    console.log(
      t('languageCurrent', {
        name: i18n.name,
        code: i18n.code,
        source: languageSource(),
        list,
      })
    )
    return
  }
  const { code, known } = resolveLanguage(value)
  if (!known) fail(t('languageUnknown', { value, list }))
  const file = path.join(root, CONFIG_FILE)
  const own = existsSync(file) ? readJson(file) : {}
  writeJson(file, { ...own, language: code })
  // Confirm in the new language, which is what the user asked for.
  console.log(
    i18nFor(code).t('languageSet', { name: LANGUAGES[code].native, code, file: CONFIG_FILE })
  )
}

const commands = {
  types: cmdTypes,
  profile: cmdProfile,
  prepare: cmdPrepare,
  consolidate: cmdConsolidate,
  finalize: cmdFinalize,
  select: cmdSelect,
  fix: cmdFix,
  'fix-status': cmdFixStatus,
  check: cmdCheck,
  language: cmdLanguage,
  guard: cmdGuard,
}

try {
  if (!commands[command]) fail(t('unknownCommand', { list: Object.keys(commands).join(', ') }))
  commands[command]()
} catch (e) {
  fail(`scanner: ${e.message}`)
}
