#!/usr/bin/env node
// Deterministic side of a scan: whatever can be counted, sorted or compared is
// done here, never by an agent.
//
//   types                                   list available scan types
//   profile <type>                          print the effective profile (JSON)
//   prepare <type> [--scope full|diff|<path>] [--deep]
//   consolidate <run>                       findings-B*.json → findings.json + triage batches
//   finalize <run>                          verdicts-T*.json → final.json + history
//   check                                   check profiles and config against the repo
//   guard status | off | remediate <run> <id>

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  SEVERITIES,
  STATE_DIR,
  availableTypes,
  git,
  isoDay,
  loadProfile,
  matchGlob,
  projectRoot,
  readConfig,
  readJson,
  readState,
  sha1,
  stateFile,
  timestamp,
  writeJson,
} from './lib.mjs'

const root = projectRoot()
const [command, ...args] = process.argv.slice(2)

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
    fail(
      `Unknown or disabled type "${type}". Available: ${availableTypes(root, config).join(', ')}`
    )
  const { profile, problems } = loadProfile(root, config, type)
  if (!profile) fail(problems.join('\n'))
  return profile
}

function runDir(run) {
  const dir = path.isAbsolute(run) ? run : path.join(root, STATE_DIR, 'runs', run)
  if (!existsSync(dir)) fail(`Run not found: ${dir}`)
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
  if (!type) fail('Usage: prepare <type> [--scope full|diff|<path>] [--deep]')
  const profile = profileOf(config, type)
  const scope = option('scope', 'full')
  const deep = option('deep') === true

  const all = filesInScope(config, scope)
  const files = all.filter((f) => !matchGlob(f, profile.exclusions))
  if (!files.length) fail(`No file left in scope "${scope}" after exclusions.`)

  const batches = splitIntoBatches(files, (config.batches ?? 4) * (deep ? 2 : 1))
  const run = `${type}-${timestamp()}`
  const dir = path.join(root, STATE_DIR, 'runs', run)
  const meta = {
    run,
    type,
    scope,
    deep,
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
    expires: expiry(config),
  })

  console.log(`RUN=${run}`)
  console.log(`DIR=${toPosix(path.relative(root, dir))}`)
  console.log(
    `Profile ${type} (fingerprint ${profile.fingerprint}${profile.sources.overlay ? ', with project overlay' : ''}), commit ${meta.commit} on ${meta.branch}`
  )
  console.log(
    `${files.length} files, ${meta.excluded} excluded by the profile, ${batches.length} batches:`
  )
  for (const b of meta.batches)
    console.log(
      `  ${b.id} — ${b.files} files, ${Math.round(b.bytes / 1024)} KB: ${b.groups.join(', ')}`
    )
  console.log(
    'Guard armed: excluded files are unreadable, writes are limited to the run and the reports.'
  )
}

function validateFinding(f, source) {
  const errors = []
  for (const field of ['title', 'file', 'rule', 'description'])
    if (typeof f[field] !== 'string' || !f[field].trim()) errors.push(`missing ${field}`)
  if (!SEVERITIES.includes(f.severity))
    errors.push(`severity "${f.severity}" not in ${SEVERITIES.join('/')}`)
  if (f.line != null && !Number.isInteger(f.line)) errors.push('line is not an integer')
  if (f.file && !existsSync(path.join(root, f.file))) errors.push(`file does not exist: ${f.file}`)
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
      rejected.push(`${file}: unreadable JSON (${e.message})`)
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
  console.log(`${findings.length} unique findings, ${rejected.length} rejected by the schema.`)
  if (missing.length) console.log(`⚠ Batches without a findings file: ${missing.join(', ')}`)
  for (const r of rejected.slice(0, 10)) console.log(`  rejected — ${r}`)
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

function reportPath(config, type) {
  let name = config.reportName.replace('{type}', type)
  for (const [token, value] of Object.entries(isoDay())) name = name.replace(`{${token}}`, value)
  return path.posix.join(config.reports, name)
}

function cmdFinalize() {
  const config = readConfig(root)
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
      finding.downgraded = 'no reachability path'
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
    report: reportPath(config, meta.type),
  }
  writeJson(path.join(dir, 'final.json'), final)
  if (full) writeJson(path.join(root, config.history, `${meta.run}.json`), final)

  console.log(
    `${kept.length} kept (${SEVERITIES.map((s) => `${final.counts[s]} ${s}`).join(', ')}), ${refuted.length} refuted.`
  )
  if (previous)
    console.log(
      `Compared with ${previous.run}: ${kept.filter((f) => f.status === 'new').length} new, ${resolved.length} resolved.`
    )
  if (previous && previous.profile_fingerprint !== profile.fingerprint)
    console.log(
      '⚠ The profile changed since the previous scan: part of the difference may come from it.'
    )
  if (!full) console.log('Partial scope: no "resolved" list, no history entry.')
  if (untriaged.length) console.log(`⚠ No triage verdict for: ${untriaged.join(', ')}`)
  console.log(`REPORT=${final.report}`)
}

function cmdCheck() {
  const config = readConfig(root)
  const lines = []
  let failures = 0
  if (!config._hasFile) lines.push('· no .scanner/config.json — defaults apply')
  for (const type of availableTypes(root, config)) {
    const { profile, problems } = loadProfile(root, config, type)
    failures += problems.length
    for (const p of problems) lines.push(`✗ ${p}`)
    if (profile)
      lines.push(
        `✓ ${type}: ${Object.keys(profile).filter((k) => k.endsWith('_guidance')).length} guidance blocks, ${profile.exclusions.length} exclusions${profile.sources.overlay ? ', overlay' : ''}, fingerprint ${profile.fingerprint}`
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
    lines.push(`${n ? '✓' : '✗'} constant ${name}: ${n} file(s)`)
  }
  const pkgFile = path.join(root, 'package.json')
  const pkg = existsSync(pkgFile) ? readJson(pkgFile) : {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const name of check.libraries?.present ?? []) {
    if (!deps[name]) failures++
    lines.push(`${deps[name] ? '✓' : '✗'} ${name} present in package.json`)
  }
  for (const name of check.libraries?.absent ?? []) {
    if (deps[name]) failures++
    lines.push(`${deps[name] ? '✗' : '✓'} ${name} absent from package.json`)
  }
  for (const { label, glob, expected } of check.counts ?? []) {
    const n = tracked.filter((f) => matchGlob(f, [glob])).length
    lines.push(
      `${expected == null || n === expected ? '✓' : '≠'} ${label}: ${n}${expected == null ? '' : ` (config says ${expected})`}`
    )
  }
  console.log(lines.join('\n'))
  console.log(
    failures
      ? `\n${failures} point(s) to fix before scanning.`
      : '\nProfiles and config are consistent with the repository.'
  )
  process.exit(failures ? 1 : 0)
}

function cmdGuard() {
  const config = readConfig(root)
  const [action, run, id] = args
  if (action === 'status' || !action) {
    const state = readState(root)
    console.log(state ? JSON.stringify(state, null, 2) : 'Guard inactive.')
    return
  }
  if (action === 'off') {
    writeJson(stateFile(root), { mode: 'inactive', since: new Date().toISOString() })
    console.log('Guard lifted.')
    return
  }
  if (action === 'remediate') {
    if (!run || !id) fail('Usage: guard remediate <run> <id>')
    const final = readJson(path.join(runDir(run), 'final.json'))
    const finding = final.findings.find((f) => f.id === id)
    if (!finding) fail(`Finding ${id} not found in ${run}.`)
    writeJson(stateFile(root), {
      mode: 'remediation',
      run: final.run,
      finding: id,
      writeDenied: config.guard.writeDenied,
      commandsDenied: config.guard.commandsDenied,
      protectedBranches: config.guard.protectedBranches,
      expires: expiry(config),
    })
    console.log(JSON.stringify(finding, null, 2))
    return
  }
  fail('Usage: guard status | off | remediate <run> <id>')
}

const commands = {
  types: cmdTypes,
  profile: cmdProfile,
  prepare: cmdPrepare,
  consolidate: cmdConsolidate,
  finalize: cmdFinalize,
  check: cmdCheck,
  guard: cmdGuard,
}

try {
  if (!commands[command]) fail(`Unknown command. Available: ${Object.keys(commands).join(', ')}`)
  commands[command]()
} catch (e) {
  fail(`scanner: ${e.message}`)
}
