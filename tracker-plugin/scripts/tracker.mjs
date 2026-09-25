#!/usr/bin/env node
// Deterministic side of the tracker: reading findings, comparing them with the
// issues, writing to GitHub, preparing triage and batch runs. Agents judge; this
// script counts, compares and carries out — and writes to GitHub only with --apply.
//
//   sources                                     findings files and scanner runs available
//   open <source…> [--min-severity s] [--only a,b] [--link ref=12,…] [--apply] [--json]
//   sync [<source…>] [--only 12,15] [--close-only|--reopen-only] [--apply] [--json]
//   select <selector…> [--max n]                resolve a selection of issues
//   triage prepare <selector…> [--max n] [--per-agent n] [--full] [--model …] [--effort …]
//   triage verify <run>                         which verdicts a skeptic must check
//   triage finalize <run>                       verdicts + checks → decisions
//   triage apply <run> [--only 12,15]           carry the decisions out on GitHub
//   batch plan <selector…|triage:<run>> [--per-batch n] [--group area|axis|none] [--max n] [--fixer issue|batch]
//   batch start <run> <B1> [--fixer …] [--model …] [--effort …]   branch + worktree, guard armed
//   batch checks <run> <B1>                     run the project's checks in the worktree
//   batch status <run> [<B1>]                   outcomes, commits, checks
//   batch finish <run> <B1> [--push] [--pr]     push the branch, open the pull request
//   status                                      open issues by priority, runs, guard
//   check                                       config, gh, sources
//   language [<code>] · model [<role>|all] [--model …] [--effort …] · guard status|off
//   repo plan | repo init [--commit] | repo github [--public]
//
// Every command that calls the GitHub CLI needs a repository with a remote; triage and
// batch also need a commit. Without them: REPO=none|empty|no-remote|no-git, exit 3.

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  SEVERITIES,
  keysInBody,
  matchesRef,
  normalizeFindings,
  validateFindings,
} from './findings.mjs'
import { LANGUAGES, SUPPORTED, resolveLanguage } from './i18n.mjs'
import { REPO_EXIT, initRepo, missingFor, plannedFiles, publishRepo, repoState } from './repo.mjs'
import {
  AGENT_SETTINGS,
  CONFIG_FILE,
  ROLES,
  STATE_DIR,
  agentOf,
  agentSettingFor,
  bodyOf,
  commitIn,
  dateTokens,
  expiry,
  fill,
  gh,
  git,
  humanDate,
  i18nFor,
  issueFacets,
  labelPattern,
  labelsOf,
  linkLine,
  locationIn,
  priorityOf,
  projectRoot,
  readConfig,
  readJson,
  readState,
  reportIn,
  stateFile,
  timestamp,
  titleOf,
  toPosix,
  writeJson,
} from './lib.mjs'
import {
  capSelection,
  decideTriage,
  groupBatches,
  needsCheck,
  parseSelector,
  planOpen,
  planSync,
  slug,
  sortFindings,
  sortIssues,
  triageGroups,
  triageReference,
} from './plan.mjs'

const root = projectRoot()
const [command, ...args] = process.argv.slice(2)
let config
try {
  config = readConfig(root)
} catch (e) {
  console.error(`tracker: ${CONFIG_FILE}: ${e.message}`)
  process.exit(1)
}
const i18n = i18nFor(config)
const t = i18n.t
const RUNS = path.join(root, STATE_DIR, 'runs')

// ─── Arguments ──────────────────────────────────────────────────────────────

const VALUE_OPTIONS = ['min-severity', 'only', 'link', 'max', 'model', 'effort', 'per-batch', 'group', 'fixer', 'per-agent']

function option(name, fallback = null) {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const value = args[i + 1]
  return value && !value.startsWith('--') ? value : fallback
}

const flag = (name) => args.includes(`--${name}`)

/** `args` without the options, starting after `skip` leading words. */
function positional(skip = 0) {
  const out = []
  for (let i = skip; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (VALUE_OPTIONS.includes(args[i].slice(2)) && args[i + 1] && !args[i + 1].startsWith('--')) i++
    } else out.push(args[i])
  }
  return out
}

function fail(message, code = 1) {
  console.error(message)
  process.exit(code)
}

const list = (value) =>
  value
    ? String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null

const headCommit = (cwd = root) => {
  try {
    return git(['rev-parse', '--short', 'HEAD'], cwd).trim()
  } catch {
    return null
  }
}

const currentBranch = (cwd = root) => {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim()
  } catch {
    return null
  }
}

// ─── Sources ────────────────────────────────────────────────────────────────

const abs = (rel) => path.join(root, rel)

function scannerRuns() {
  const dir = abs(config.sources.scannerRuns)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((r) => existsSync(path.join(dir, r, 'final.json')))
    .sort()
}

function historyFiles() {
  const dir = abs(config.sources.scannerHistory)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f))
}

function findingsFiles() {
  const dir = abs(config.sources.reports)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(config.sources.suffix))
    .sort()
    .map((f) => path.join(dir, f))
}

/** A source named by the user → the findings file it designates. */
function resolveSource(arg) {
  const candidates = [
    path.resolve(root, arg),
    path.join(abs(config.sources.scannerRuns), arg),
    path.join(abs(config.sources.scannerHistory), `${arg}.json`),
  ]
  for (const c of candidates) {
    if (!existsSync(c)) continue
    if (statSync(c).isDirectory()) {
      if (existsSync(path.join(c, 'final.json'))) return path.join(c, 'final.json')
      continue
    }
    if (/\.(html?|md)$/i.test(c)) {
      const sibling = c.replace(/\.(html?|md)$/i, config.sources.suffix)
      if (existsSync(sibling)) return sibling
      fail(t('noSibling', { report: arg, suffix: config.sources.suffix }))
    }
    return c
  }
  fail(t('sourceNotFound', { source: arg, runs: config.sources.scannerRuns }))
}

function loadSource(file) {
  const rel = toPosix(path.relative(root, file))
  let doc
  try {
    doc = readJson(file)
  } catch (e) {
    fail(t('sourceUnreadable', { file: rel, error: e.message }))
  }
  const problems = validateFindings(doc, rel)
  if (problems.length) fail(t('sourceInvalid', { n: problems.length, list: problems.join('\n  ') }))
  return { file: rel, doc, findings: normalizeFindings(doc) }
}

function cmdSources() {
  const runs = scannerRuns()
  console.log(t('sourcesRuns', { dir: config.sources.scannerRuns, n: runs.length }))
  for (const r of runs) {
    const f = readJson(path.join(abs(config.sources.scannerRuns), r, 'final.json'))
    const counts = SEVERITIES.map((s) => `${f.counts?.[s] ?? 0} ${s}`).join(', ')
    console.log(`  ${r}  (${f.findings.length}: ${counts})`)
  }
  const files = findingsFiles()
  console.log(t('sourcesFiles', { dir: config.sources.reports, suffix: config.sources.suffix, n: files.length }))
  for (const f of files) console.log(`  ${toPosix(path.relative(root, f))}`)
}

// ─── Issues and labels ──────────────────────────────────────────────────────

const ISSUE_FIELDS = 'number,state,createdAt,closedAt,title,body,labels'

function allIssues() {
  return JSON.parse(
    gh(['issue', 'list', '--state', 'all', '--limit', String(config.issueLimit), '--json', ISSUE_FIELDS], {
      cwd: root,
    })
  )
}

const labelNames = (issue) => (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name))

const PALETTE = { axis: '1d76db', severity: 'd93f0b', priority: 'fbca04', source: 'c5def5' }

/** The template family a label belongs to (`axis`, `severity`, `priority`, `source`). */
function labelKind(name) {
  for (const kind of ['axis', 'severity', 'priority']) {
    const re = labelPattern(config.labels[kind], kind)
    if (re?.test(name)) return kind
  }
  for (const tpl of Object.values(config.labels.source ?? {})) {
    const prefix = String(tpl).split('{')[0]
    if (prefix && name.startsWith(prefix)) return 'source'
  }
  return null
}

/** Creates the labels that do not exist yet, in the color of their family. */
function ensureLabels(names) {
  const existing = JSON.parse(gh(['label', 'list', '--limit', '1000', '--json', 'name,color'], { cwd: root }))
  const known = new Set(existing.map((l) => l.name))
  for (const name of new Set(names)) {
    if (known.has(name)) continue
    const kind = labelKind(name)
    const cousin = kind && existing.find((l) => labelKind(l.name) === kind)
    gh(['label', 'create', name, '--color', cousin?.color ?? PALETTE[kind] ?? 'ededed'], { cwd: root })
    known.add(name)
    console.log(t('labelCreated', { name }))
  }
}

// ─── open ───────────────────────────────────────────────────────────────────

function parseLinks(value) {
  return (list(value) ?? []).map((pair) => {
    const [ref, number] = pair.split('=').map((s) => s.trim())
    if (!ref || !/^#?\d+$/.test(number ?? '')) fail(t('badLink', { pair }))
    return { ref, number: Number(number.replace('#', '')) }
  })
}

function cmdOpen() {
  const sources = positional()
  if (!sources.length) {
    cmdSources()
    fail(t('openUsage'), 2)
  }
  const loaded = sources.map((s) => loadSource(resolveSource(s)))
  const findings = loaded.flatMap((l) => l.findings)
  const issues = allIssues()
  const minSeverity = option('min-severity', config.minSeverity)
  if (!SEVERITIES.includes(minSeverity)) fail(t('badSeverity', { value: minSeverity, list: SEVERITIES.join(', ') }))
  const plan = planOpen(findings, issues, { minSeverity, only: list(option('only')) })

  const links = parseLinks(option('link')).map(({ ref, number }) => {
    const i = plan.fresh.findIndex((f) => matchesRef(f, ref))
    if (i < 0) fail(t('linkNotFresh', { ref }))
    const issue = issues.find((x) => x.number === number)
    if (!issue) fail(t('issueNotFound', { number }))
    return { finding: plan.fresh.splice(i, 1)[0], issue }
  })
  const fresh = sortFindings(plan.fresh, (f) => priorityOf(config, f))

  if (flag('json')) {
    console.log(
      JSON.stringify(
        {
          fresh: fresh.map((f) => ({ ref: f.label, key: f.key, title: titleOf(config, f), labels: labelsOf(config, f) })),
          links: links.map(({ finding, issue }) => ({ ref: finding.label, issue: issue.number })),
          known: plan.known.map(({ finding, issue }) => ({ ref: finding.label, issue: issue.number, state: issue.state })),
          regressed: plan.regressed.map(({ finding, issue }) => ({ ref: finding.label, issue: issue.number })),
          dismissed: plan.dismissed.map(({ finding, reason }) => ({ ref: finding.label, reason })),
        },
        null,
        2
      )
    )
  } else {
    console.log(t('openRead', { findings: findings.length, sources: loaded.length, issues: issues.length }))
    console.log(`\n${t('openFresh', { n: fresh.length })}`)
    for (const f of fresh)
      console.log(`  ${priorityOf(config, f)} ${f.severity.padEnd(8)} ${f.label.padEnd(20)} ${titleOf(config, f).slice(0, 90)}`)
    for (const { finding, issue } of links)
      console.log(`  ↳ ${t('openLink', { ref: finding.label, number: issue.number, title: issue.title.slice(0, 70) })}`)
    const closed = plan.known.filter((k) => k.issue.state === 'CLOSED').length
    console.log(`\n${t('openKnown', { n: plan.known.length, closed })}`)
    for (const { finding, issue } of plan.regressed)
      console.log(
        `  ⚠ ${t('openRegressed', { ref: finding.label, number: issue.number, date: humanDate(issue.closedAt, i18n.code) })}`
      )
    if (plan.dismissed.length) {
      const reasons = {}
      for (const d of plan.dismissed) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1
      const detail = Object.entries(reasons)
        .map(([r, n]) => `${n} ${r}`)
        .join(', ')
      console.log(`\n${t('openDismissed', { n: plan.dismissed.length, detail })}`)
    }
  }

  if (!flag('apply')) {
    if (!flag('json') && (fresh.length || links.length)) console.log(`\n${t('dryRun')}`)
    return
  }
  for (const { finding, issue } of links) {
    const body = `${String(issue.body ?? '').trimEnd()}\n\n${linkLine(finding, t)}\n`
    gh(['issue', 'edit', String(issue.number), '--body-file', '-'], { cwd: root, input: body })
    // Several findings may be linked to the same issue: the next edit must start from
    // this body, not from the one read at the start, or it would drop this line.
    issue.body = body
    console.log(t('linked', { ref: finding.label, number: issue.number }))
  }
  if (!fresh.length) return
  ensureLabels(fresh.flatMap((f) => labelsOf(config, f)))
  for (const f of fresh) {
    const argv = ['issue', 'create', '--title', titleOf(config, f), '--body-file', '-']
    for (const l of labelsOf(config, f)) argv.push('--label', l)
    const url = gh(argv, { cwd: root, input: bodyOf(config, f, i18n) }).trim()
    console.log(t('created', { ref: f.label, url }))
  }
  console.log(`\n${t('openDone', { n: fresh.length })}`)
}

// ─── sync ───────────────────────────────────────────────────────────────────

/** Without arguments: the latest history file of each scan type, and every findings file. */
function defaultSyncSources() {
  const latest = new Map()
  for (const file of historyFiles()) {
    try {
      const doc = readJson(file)
      if (doc.type) latest.set(doc.type, file)
    } catch {
      // An unreadable history file is left out; `check` reports it.
    }
  }
  return [...latest.values(), ...findingsFiles()]
}

function cmdSync() {
  const named = positional()
  const files = named.length ? named.map(resolveSource) : defaultSyncSources()
  if (!files.length) fail(t('syncNoSource', { history: config.sources.scannerHistory, reports: config.sources.reports }))
  const sources = files.map((file) => {
    const l = loadSource(file)
    const scan = l.doc.run && l.doc.kind !== 'audit'
    return {
      findings: l.findings,
      resolved: scan ? (l.doc.resolved ?? []) : [],
      full: scan && l.doc.scope === 'full',
      meta: {
        label: scan ? l.doc.run : l.file,
        commit: l.doc.commit ?? '?',
        branch: l.doc.branch ?? '?',
        finished: l.doc.finished,
      },
    }
  })
  const issues = allIssues()
  const plan = planSync(sources, issues)
  const only = list(option('only'))?.map(Number)
  const keep = (e) => !only || only.includes(e.issue.number)
  const close = flag('reopen-only') ? [] : plan.close.filter(keep)
  const reopen = flag('close-only') ? [] : plan.reopen.filter(keep)

  if (flag('json')) {
    console.log(
      JSON.stringify(
        {
          close: close.map((c) => ({ issue: c.issue.number, reason: c.reason, source: c.meta.label })),
          reopen: reopen.map((r) => ({ issue: r.issue.number, ref: r.finding.label })),
        },
        null,
        2
      )
    )
  } else {
    console.log(t('syncRead', { sources: sources.length, issues: issues.length }))
    console.log(`\n${t('syncClose', { n: close.length })}`)
    for (const c of close)
      console.log(`  #${c.issue.number} ${c.issue.title.slice(0, 80)} — ${t(`syncReason_${c.reason}`, { source: c.meta.label })}`)
    console.log(`\n${t('syncReopen', { n: reopen.length })}`)
    for (const r of reopen)
      console.log(
        `  #${r.issue.number} ${r.issue.title.slice(0, 80)} — ${t('syncReappeared', { ref: r.finding.label, date: humanDate(r.issue.closedAt, i18n.code) })}`
      )
  }
  if (!flag('apply')) {
    if (!flag('json') && (close.length || reopen.length)) console.log(`\n${t('dryRun')}`)
    return
  }
  for (const c of close) {
    const comment = t(`syncCloseComment_${c.reason}`, {
      source: c.meta.label,
      commit: c.meta.commit,
      branch: c.meta.branch,
      date: humanDate(c.meta.finished, i18n.code),
    })
    gh(['issue', 'close', String(c.issue.number), '--reason', 'completed', '--comment', comment], { cwd: root })
    console.log(t('closed', { number: c.issue.number }))
  }
  for (const r of reopen) {
    const s = r.finding.source
    const comment = t('syncReopenComment', {
      ref: r.finding.label,
      source: s.run ?? s.report ?? '?',
      commit: s.commit ?? '?',
      date: humanDate(s.finished, i18n.code),
    })
    gh(['issue', 'reopen', String(r.issue.number), '--comment', comment], { cwd: root })
    console.log(t('reopened', { number: r.issue.number }))
  }
}

// ─── Selecting issues ───────────────────────────────────────────────────────

/** The labels a selection's facets stand for (`priority:P1` → `priority: P1`). */
function facetLabels(facets) {
  const out = []
  const nameOf = (kind, v) => config.names?.[kind]?.[v] ?? v
  if (facets.priority) out.push(fill(config.labels.priority, { priority: facets.priority }))
  if (facets.severity) out.push(fill(config.labels.severity, { severity: nameOf('severity', facets.severity) }))
  if (facets.axis) out.push(fill(config.labels.axis, { axis: nameOf('axis', facets.axis) }))
  return out
}

function selectIssues(tokens, max) {
  let sel
  try {
    sel = parseSelector(tokens)
  } catch (e) {
    fail(t('badSelector', { detail: e.message }))
  }
  if (sel.triage) {
    const file = path.join(RUNS, sel.triage, 'final.json')
    if (!existsSync(file)) fail(t('triageNotFinalized', { run: sel.triage }))
    for (const d of readJson(file).decisions) if (d.final === 'holds') sel.numbers.push(d.number)
  }
  let issues = []
  let limit = Infinity
  if (sel.numbers.length) {
    for (const n of [...new Set(sel.numbers)]) {
      const issue = JSON.parse(gh(['issue', 'view', String(n), '--json', ISSUE_FIELDS], { cwd: root }))
      if (issue.state !== 'OPEN') console.log(t('skipClosed', { number: n }))
      else issues.push(issue)
    }
  } else if (sel.labels.length || Object.keys(sel.facets).length || sel.all) {
    limit = Math.max(max, 1) * 4
    const argv = ['issue', 'list', '--state', 'open', '--limit', String(limit), '--json', ISSUE_FIELDS]
    for (const l of [...sel.labels, ...facetLabels(sel.facets)]) argv.push('--label', l)
    issues = JSON.parse(gh(argv, { cwd: root }))
  } else fail(t('selectorEmpty'), 2)
  const { kept, dropped } = capSelection(sortIssues(config, issues), max)
  if (dropped.length) {
    const shown = dropped.slice(0, 20).map((n) => `#${n}`)
    if (dropped.length > shown.length) shown.push('…')
    // gh stops at --limit: past it, the count is only a lower bound.
    const key = issues.length >= limit ? 'selectionCutAtLeast' : 'selectionCut'
    console.log(t(key, { total: issues.length, kept: kept.length, max, list: shown.join(', ') }))
    console.log(`DROPPED=${dropped.join(',')}`)
  }
  return kept
}

/**
 * What an agent needs to know about an issue, written into the run directory. With
 * `triage`, the last finalized triage that found it holding: where the defect is and
 * what showed it, so that a fixer starts from there instead of searching again.
 */
function issueRecord(issue, { triage = false } = {}) {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    labels: labelNames(issue),
    ...issueFacets(config, issue.labels ?? []),
    location: locationIn(issue.body),
    report: reportIn(issue.body),
    keys: keysInBody(issue.body),
    commit: commitIn(issue.body),
    createdAt: issue.createdAt ?? null,
    ...(triage ? { triage: lastHolds(issue.number) } : {}),
  }
}

let triageRuns
/** Finalized triage runs, newest first. */
function finalizedTriages() {
  if (!triageRuns)
    triageRuns = existsSync(RUNS)
      ? readdirSync(RUNS)
          .filter((r) => r.startsWith('triage-') && existsSync(path.join(RUNS, r, 'final.json')))
          .sort()
          .reverse()
      : []
  return triageRuns
}

/**
 * The newest finalized triage that found an issue holding, with the evidence behind it;
 * null when none did, or when a newer one found it fixed or obsolete.
 */
function lastHolds(number) {
  for (const run of finalizedTriages()) {
    const dir = path.join(RUNS, run)
    let final
    try {
      final = readJson(path.join(dir, 'final.json'))
    } catch {
      continue
    }
    const d = final.decisions?.find((x) => x.number === number)
    if (!d || d.final === 'unclear' || d.final === 'untriaged') continue
    if (d.final !== 'holds') return null
    // A skeptic who disagreed carries the evidence the decision stands on.
    const source = readIfExists(path.join(dir, `${d.check === 'disagree' ? 'check' : 'verdict'}-${number}.json`))
    return {
      run,
      commit: final.commit ?? null,
      reason: d.reason ?? null,
      location: d.location ?? null,
      evidence: source?.evidence ?? [],
      auto: d.auto ?? null,
    }
  }
  return null
}

/**
 * Whether `file` is the same now as at the reference point: true, false, or null when
 * git cannot tell (unknown commit, no history). Uncommitted edits count as a change.
 */
function unchangedSince(file, reference) {
  try {
    if (git(['status', '--porcelain', '--', file], root).trim()) return false
    if (reference.kind === 'date')
      return !git(['log', '-1', '--format=%h', `--since=${reference.ref}`, 'HEAD', '--', file], root).trim()
    git(['cat-file', '-e', `${reference.ref}^{commit}`], root)
  } catch {
    return null
  }
  try {
    git(['diff', '--quiet', reference.ref, 'HEAD', '--', file], root)
    return true
  } catch {
    return false
  }
}

/** The verdict the script writes itself for an issue whose file has not moved; else null. */
function unchangedVerdict(record) {
  if (!record.location) return null
  const file = record.location.replace(/:\d+(?:-\d+)?$/, '')
  if (!existsSync(path.join(root, file))) return null
  const reference = triageReference(record, lastHolds(record.number))
  if (!reference || unchangedSince(file, reference) !== true) return null
  const since =
    reference.kind === 'triage'
      ? t('sinceTriage', { run: reference.run, commit: reference.ref })
      : reference.kind === 'commit'
        ? t('sinceCommit', { commit: reference.ref })
        : t('sinceDate', { date: humanDate(reference.ref, i18n.code) })
  const how =
    reference.kind === 'date'
      ? `git log --since=${reference.ref} HEAD -- ${file} → no commit`
      : `git diff ${reference.ref} HEAD -- ${file} → no difference`
  return {
    number: record.number,
    verdict: 'holds',
    auto: 'unchanged',
    reason: t('unchangedReason', { file, since }),
    location: record.location,
    commit: null,
    priority: null,
    evidence: [how, 'git status -- ' + file + ' → clean'],
    since,
  }
}

function cmdSelect() {
  const issues = selectIssues(positional(), Number(option('max', config.triage.max)))
  for (const i of issues) {
    const f = issueFacets(config, i.labels ?? [])
    console.log(`#${i.number} ${f.priority ?? '--'} ${i.title.slice(0, 90)}`)
  }
  console.log(`ISSUES=${issues.map((i) => i.number).join(',')}`)
}

// ─── Guard ──────────────────────────────────────────────────────────────────

function arm(state) {
  const current = readState(root)
  if (current && !(current.run === state.run && current.mode === state.mode))
    fail(t('guardBusy', { mode: current.mode, run: current.run }))
  writeJson(stateFile(root), { ...state, lang: i18n.code, expires: expiry(config) })
}

function disarm(run = null) {
  const current = readState(root)
  if (!current || (run && current.run !== run)) return false
  writeFileSync(stateFile(root), '{}\n', 'utf8')
  return true
}

function cmdGuard() {
  const [action] = positional()
  const state = readState(root)
  if (action === 'off') {
    console.log(disarm() ? t('guardOff') : t('guardIdle'))
    return
  }
  if (!state?.mode) console.log(t('guardIdle'))
  else console.log(t('guardActive', { mode: state.mode, run: state.run, until: state.expires }))
}

function printAgent(role, overrides = {}) {
  const a = agentOf(config, role, overrides)
  if (!a.model.known) console.log(t('unsupportedSetting', { setting: 'model', value: a.model.raw }))
  if (!a.effort.known) console.log(t('unsupportedSetting', { setting: 'effort', value: a.effort.raw }))
  console.log(`${role.toUpperCase()}=${a.type}`)
  console.log(`${role.toUpperCase()}_MODEL=${a.model.value}`)
}

const runDir = (run) => {
  const dir = path.join(RUNS, run ?? '')
  if (!run || !existsSync(dir)) fail(t('runNotFound', { run: run ?? '?' }))
  return dir
}

const readIfExists = (file) => (existsSync(file) ? readJson(file) : null)

// ─── triage ─────────────────────────────────────────────────────────────────

function triagePrepare() {
  const issues = selectIssues(positional(1), Number(option('max', config.triage.max)))
  if (!issues.length) fail(t('selectionNone'))
  const run = `triage-${timestamp()}`
  const dir = path.join(RUNS, run)
  const shortcut = config.triage.skipUnchanged && !flag('full')
  const unchanged = []
  const toAgents = []
  for (const issue of issues) {
    const record = issueRecord(issue)
    writeJson(path.join(dir, `issue-${issue.number}.json`), record)
    const verdict = shortcut ? unchangedVerdict(record) : null
    if (verdict) {
      writeJson(path.join(dir, `verdict-${issue.number}.json`), verdict)
      unchanged.push(verdict)
    } else toAgents.push(issue)
  }
  const perAgent = Math.max(1, Number(option('per-agent', config.triage.perAgent)) || 1)
  const groups = triageGroups(config, toAgents, perAgent)
  const meta = {
    run,
    created: new Date().toISOString(),
    commit: headCommit(),
    branch: currentBranch(),
    language: i18n.englishName,
    issues: issues.map((i) => i.number),
  }
  writeJson(path.join(dir, 'meta.json'), meta)
  arm({ mode: 'triage', run, writeAllowed: [`${STATE_DIR}/runs/${run}/**`] })
  console.log(`RUN=${run}`)
  console.log(`DIR=${toPosix(dir)}`)
  console.log(`COMMIT=${meta.commit}`)
  console.log(`LANG=${i18n.englishName}`)
  console.log(`ISSUES=${meta.issues.join(',')}`)
  printAgent('triager', { model: option('model'), effort: option('effort') })
  printAgent('skeptic', { model: option('model'), effort: option('effort') })
  for (const i of toAgents) console.log(`  #${i.number} ${i.title.slice(0, 90)}`)
  for (const v of unchanged) console.log(`  ${t('unchangedLine', { number: v.number, since: v.since })}`)
  console.log(`UNCHANGED=${unchanged.map((v) => v.number).join(',')}`)
  for (const g of groups) console.log(`GROUP=${g.join(',')}`)
  console.log(`AGENTS=${groups.length}`)
  console.log(t('triageCost', { agents: groups.length, n: toAgents.length, unchanged: unchanged.length }))
}

function readVerdicts(dir, prefix) {
  const out = new Map()
  for (const f of readdirSync(dir).filter((x) => x.startsWith(`${prefix}-`) && x.endsWith('.json'))) {
    try {
      const v = readJson(path.join(dir, f))
      out.set(Number(v.number ?? f.slice(prefix.length + 1, -5)), v)
    } catch (e) {
      console.log(t('unreadable', { file: f, error: e.message }))
    }
  }
  return out
}

function triageVerify() {
  const dir = runDir(positional(1)[0])
  const meta = readJson(path.join(dir, 'meta.json'))
  const verdicts = readVerdicts(dir, 'verdict')
  const missing = meta.issues.filter((n) => !verdicts.has(n))
  const toCheck = meta.issues.filter((n) => needsCheck(verdicts.get(n)))
  const counts = {}
  for (const v of verdicts.values()) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1
  console.log(t('triageCounts', { detail: Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ') || '0' }))
  if (missing.length) console.log(t('triageMissing', { list: missing.map((n) => `#${n}`).join(', ') }))
  console.log(`VERIFY=${toCheck.join(',')}`)
}

function triageFinalize() {
  const run = positional(1)[0]
  const dir = runDir(run)
  const meta = readJson(path.join(dir, 'meta.json'))
  const issues = meta.issues.map((n) => readJson(path.join(dir, `issue-${n}.json`)))
  const decisions = decideTriage(
    config,
    issues.map((i) => ({ ...i, labels: i.labels })),
    readVerdicts(dir, 'verdict'),
    readVerdicts(dir, 'check')
  )
  writeJson(path.join(dir, 'final.json'), { ...meta, finished: new Date().toISOString(), decisions })
  disarm(run)
  for (const d of decisions) {
    const actions = d.actions.map((a) => t(`action_${a.type}`, a)).join(', ') || '—'
    console.log(`#${d.number} ${t(`verdict_${d.final}`)} (${d.priority ?? '--'}) ${d.title.slice(0, 60)} → ${actions}`)
  }
  const n = decisions.reduce((s, d) => s + d.actions.length, 0)
  console.log(`ACTIONS=${n}`)
  console.log(t('triageFinalized', { run, n }))
}

function triageApply() {
  const run = positional(1)[0]
  const dir = runDir(run)
  const file = path.join(dir, 'final.json')
  if (!existsSync(file)) fail(t('triageNotFinalized', { run }))
  const final = readJson(file)
  const only = list(option('only'))?.map(Number)
  const applied = final.applied ?? []
  for (const d of final.decisions) {
    if (only && !only.includes(d.number)) continue
    for (const a of d.actions) {
      const id = `${d.number}:${a.type}`
      if (applied.includes(id)) continue
      const vars = { reason: d.reason ?? '', commit: d.commit ?? final.commit ?? '?', run }
      if (a.type === 'close')
        gh(['issue', 'close', String(d.number), '--reason', a.reason, '--comment', t(`triageCloseComment_${d.final}`, vars)], {
          cwd: root,
        })
      else if (a.type === 'relabel') {
        const to = fill(config.labels.priority, { priority: a.to })
        const from = fill(config.labels.priority, { priority: a.from })
        ensureLabels([to])
        gh(['issue', 'edit', String(d.number), '--remove-label', from, '--add-label', to], { cwd: root })
      } else if (a.type === 'comment')
        gh(['issue', 'comment', String(d.number), '--body', t('triageHoldsComment', vars)], { cwd: root })
      applied.push(id)
      console.log(`#${d.number} ${t(`action_${a.type}`, a)} ✓`)
      writeJson(file, { ...final, applied })
    }
  }
  console.log(t('triageApplied', { n: applied.length }))
}

function cmdTriage() {
  const sub = { prepare: triagePrepare, verify: triageVerify, finalize: triageFinalize, apply: triageApply }[args[0]]
  if (!sub) fail(t('usage', { syntax: 'triage prepare|verify|finalize|apply …' }), 2)
  sub()
}

// ─── batch ──────────────────────────────────────────────────────────────────

function branchExists(name) {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], root)
    return true
  } catch {
    return false
  }
}

function batchPlan() {
  const tokens = positional(1)
  const max = Number(option('max', config.batch.max))
  const issues = selectIssues(tokens, max)
  if (!issues.length) fail(t('selectionNone'))
  const batches = groupBatches(config, issues, {
    groupBy: option('group', config.batch.groupBy),
    perBatch: Number(option('per-batch', config.batch.perBatch)),
    max,
  })
  const fixer = fixerScope(option('fixer', config.batch.fixer))
  const run = `batch-${timestamp()}`
  const dir = path.join(RUNS, run)
  for (const issue of issues)
    writeJson(path.join(dir, `issue-${issue.number}.json`), issueRecord(issue, { triage: true }))
  const base = config.batch.base ?? currentBranch()
  writeJson(path.join(dir, 'plan.json'), {
    run,
    created: new Date().toISOString(),
    base,
    commit: headCommit(),
    language: i18n.englishName,
    fixer,
    batches: batches.map((b) => ({
      id: b.id,
      group: b.group,
      issues: b.issues.map((i) => ({ number: i.number, title: i.title, priority: i.priority, location: i.location })),
    })),
  })
  console.log(`RUN=${run}`)
  console.log(`BASE=${base}`)
  for (const b of batches) {
    console.log(`${b.id} — ${b.group} (${b.issues.length})`)
    for (const i of b.issues) console.log(`    #${i.number} ${i.priority ?? '--'} ${i.title.slice(0, 80)}${i.location ? ` — ${i.location}` : ''}`)
  }
  console.log(`BATCHES=${batches.map((b) => b.id).join(',')}`)
  const agents = fixer === 'batch' ? batches.length : issues.length
  console.log(`FIXER_SCOPE=${fixer}`)
  console.log(`AGENTS=${agents}`)
  console.log(t('batchCost', { agents, n: issues.length, scope: t(`fixerScope_${fixer}`) }))
}

/** `issue` (one fixer per issue) or `batch` (one fixer per batch). */
function fixerScope(value) {
  const v = String(value ?? 'issue').trim().toLowerCase()
  if (v !== 'issue' && v !== 'batch') fail(t('badFixerScope', { value }), 2)
  return v
}

function batchOf(dir, id) {
  const plan = readJson(path.join(dir, 'plan.json'))
  const batch = plan.batches.find((b) => b.id === id)
  if (!batch) fail(t('batchNotFound', { id: id ?? '?', run: plan.run }))
  return { plan, batch, file: path.join(dir, `batch-${id}.json`) }
}

function runIn(cwd, cmd, minutes) {
  try {
    const out = execSync(cmd, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: minutes * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    return { cmd, code: 0, tail: out.split('\n').slice(-20).join('\n') }
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message
    return { cmd, code: e.status ?? 1, tail: String(out).split('\n').slice(-30).join('\n') }
  }
}

function batchStart() {
  const [run, id] = positional(1)
  const dir = runDir(run)
  const { plan, batch, file } = batchOf(dir, id)
  if (existsSync(file)) fail(t('batchStarted', { id, run }))
  const scope = fixerScope(option('fixer', plan.fixer ?? config.batch.fixer))
  const stem = `${config.batch.branchPrefix}tracker-${slug(batch.group)}-${dateTokens().YYYY}${dateTokens().MM}${dateTokens().DD}`
  let branch = stem
  for (let n = 2; branchExists(branch); n++) branch = `${stem}-${n}`
  const parent = path.join(root, STATE_DIR, 'worktrees')
  const worktree = path.join(parent, `${run}-${id}`)
  if (existsSync(worktree)) fail(t('worktreeExists', { worktree: toPosix(worktree) }))
  if (!existsSync(path.join(parent, '.gitignore'))) {
    mkdirSync(parent, { recursive: true })
    writeFileSync(path.join(parent, '.gitignore'), '*\n', 'utf8')
  }
  try {
    execFileSync('git', ['worktree', 'add', '-b', branch, worktree, plan.base], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    fail(t('worktreeFailed', { error: String(e.stderr || e.message).trim() }))
  }
  const setup = (config.batch.setup ?? []).map((cmd) => runIn(worktree, cmd, config.batch.checkTimeoutMinutes))
  const record = {
    id,
    group: batch.group,
    branch,
    base: plan.base,
    worktree: toPosix(worktree),
    started: new Date().toISOString(),
    issues: batch.issues.map((i) => i.number),
    setup,
  }
  writeJson(file, record)
  arm({
    mode: 'batch',
    run,
    batch: id,
    worktree: record.worktree,
    branch,
    writeDenied: config.guard.writeDenied,
    commandsDenied: config.guard.commandsDenied,
    protectedBranches: config.guard.protectedBranches,
  })
  for (const s of setup) console.log(`${s.code === 0 ? '✓' : '✗'} ${s.cmd}${s.code ? `\n${s.tail}` : ''}`)
  console.log(`DIR=${toPosix(dir)}`)
  console.log(`BRANCH=${branch}`)
  console.log(`BASE=${plan.base}`)
  console.log(`WORKTREE=${record.worktree}`)
  console.log(`ISSUES=${record.issues.join(',')}`)
  console.log(`FIXER_SCOPE=${scope}`)
  console.log(`LANG=${i18n.englishName}`)
  printAgent('fixer', { model: option('model'), effort: option('effort') })
  console.log(t('batchReady', { id, branch, base: plan.base, n: record.issues.length, scope: t(`fixerScope_${scope}`) }))
}

function batchChecks() {
  const [run, id] = positional(1)
  const dir = runDir(run)
  const { file } = batchOf(dir, id)
  const record = readIfExists(file)
  if (!record) fail(t('batchNotStarted', { id, run }))
  const checks = config.batch.checks ?? []
  if (!checks.length) {
    console.log(t('noChecks'))
    console.log('CHECKS=none')
    return
  }
  const results = checks.map((cmd) => runIn(record.worktree, cmd, config.batch.checkTimeoutMinutes))
  writeJson(file, { ...record, checks: results, checked: new Date().toISOString(), checkedCommit: headCommit(record.worktree) })
  for (const r of results) console.log(`${r.code === 0 ? '✓' : '✗'} ${r.cmd}${r.code ? `\n${r.tail}` : ''}`)
  console.log(`CHECKS=${results.every((r) => r.code === 0) ? 'pass' : 'fail'}`)
}

function outcomesOf(dir, record) {
  return record.issues.map((n) => {
    const o = readIfExists(path.join(dir, `outcome-${n}.json`)) ?? { status: 'pending' }
    const issue = readIfExists(path.join(dir, `issue-${n}.json`)) ?? { title: '?' }
    return { number: n, title: issue.title, ...o, status: ['fixed', 'skipped', 'failed'].includes(o.status) ? o.status : 'pending' }
  })
}

function commitsOf(record) {
  try {
    return git(['log', '--oneline', `${record.base}..${record.branch}`], root).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function batchStatus() {
  const [run, only] = positional(1)
  const dir = runDir(run)
  const plan = readJson(path.join(dir, 'plan.json'))
  for (const b of plan.batches) {
    if (only && b.id !== only) continue
    const record = readIfExists(path.join(dir, `batch-${b.id}.json`))
    if (!record) {
      console.log(`${b.id} — ${b.group}: ${t('notStarted')}`)
      continue
    }
    console.log(`${b.id} — ${b.group}: ${record.branch}${record.pr ? ` · ${record.pr}` : ''}`)
    for (const o of outcomesOf(dir, record))
      console.log(`    #${o.number} ${t(`status_${o.status}`)}${o.commit ? ` (${o.commit})` : ''}${o.reason ? ` — ${o.reason}` : ''}`)
    const commits = commitsOf(record)
    const checks = record.checks ? (record.checks.every((c) => c.code === 0) ? '✓' : '✗') : '—'
    console.log(`    ${t('batchSummary', { commits: commits.length, checks })}`)
  }
}

function prBody(record, outcomes) {
  const lines = [t('prIntro', { n: outcomes.length, group: record.group }), '']
  for (const o of outcomes)
    lines.push(
      o.status === 'fixed'
        ? `- Closes #${o.number} — ${o.title}`
        : `- Refs #${o.number} — ${o.title} (${t(`status_${o.status}`)}${o.reason ? `: ${o.reason}` : ''})`
    )
  if (record.checks?.length) {
    lines.push('', `**${t('prChecks')}**`, '')
    for (const c of record.checks) lines.push(`- ${c.code === 0 ? '✓' : '✗'} \`${c.cmd}\``)
  }
  lines.push('', `_${t('prFooter')}_`)
  return lines.join('\n')
}

function batchFinish() {
  const [run, id] = positional(1)
  const dir = runDir(run)
  const { file } = batchOf(dir, id)
  const record = readIfExists(file)
  if (!record) fail(t('batchNotStarted', { id, run }))
  const state = readState(root)
  if (state?.mode === 'batch' && state.run === run && state.batch === id) fail(t('guardStillArmed'))
  // Pushing needs a remote: checked once the guard is known to be lifted.
  if (flag('push') || flag('pr')) requireRepo({ remote: true })
  const outcomes = outcomesOf(dir, record)
  const commits = commitsOf(record)
  const fixed = outcomes.filter((o) => o.status === 'fixed')
  const base = config.batch.prBase ?? record.base
  const title = t('prTitle', { group: record.group, list: fixed.map((o) => `#${o.number}`).join(', ') || '—' })
  console.log(t('finishPlan', { branch: record.branch, base, commits: commits.length, fixed: fixed.length, n: outcomes.length }))
  console.log(`TITLE=${title}`)
  if (!commits.length) fail(t('nothingToPush'))
  if (!flag('push') && !flag('pr')) {
    console.log(`\n${t('dryRunFinish')}`)
    return
  }
  if (flag('push')) {
    try {
      execFileSync('git', ['push', '-u', 'origin', record.branch], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      fail(t('pushFailed', { error: String(e.stderr || e.message).trim() }))
    }
    console.log(t('pushed', { branch: record.branch }))
  }
  if (flag('pr')) {
    const argv = ['pr', 'create', '--base', base, '--head', record.branch, '--title', title, '--body-file', '-']
    if (config.batch.draft) argv.push('--draft')
    const url = gh(argv, { cwd: root, input: prBody(record, outcomes) }).trim()
    writeJson(file, { ...record, pr: url })
    console.log(`PR=${url}`)
  }
}

function cmdBatch() {
  const sub = { plan: batchPlan, start: batchStart, checks: batchChecks, status: batchStatus, finish: batchFinish }[args[0]]
  if (!sub) fail(t('usage', { syntax: 'batch plan|start|checks|status|finish …' }), 2)
  sub()
}

// ─── status, check ──────────────────────────────────────────────────────────

function cmdStatus() {
  const open = JSON.parse(
    gh(['issue', 'list', '--state', 'open', '--limit', String(config.issueLimit), '--json', 'number,labels,body'], { cwd: root })
  )
  const byPriority = {}
  let tracked = 0
  for (const i of open) {
    const p = issueFacets(config, i.labels ?? []).priority ?? '--'
    byPriority[p] = (byPriority[p] ?? 0) + 1
    if (keysInBody(i.body).length) tracked++
  }
  const detail = Object.entries(byPriority)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, n]) => `${p} ${n}`)
    .join(' · ')
  console.log(t('statusOpen', { n: open.length, detail, tracked }))
  const runs = existsSync(RUNS) ? readdirSync(RUNS).sort().slice(-8) : []
  for (const r of runs) {
    const dir = path.join(RUNS, r)
    if (r.startsWith('triage-')) {
      const final = readIfExists(path.join(dir, 'final.json'))
      console.log(`  ${r}: ${final ? t('statusTriageDone', { n: final.decisions.length, applied: (final.applied ?? []).length }) : t('statusTriageOpen')}`)
    } else if (r.startsWith('batch-')) {
      const plan = readIfExists(path.join(dir, 'plan.json'))
      const started = plan?.batches.filter((b) => existsSync(path.join(dir, `batch-${b.id}.json`))).length ?? 0
      console.log(`  ${r}: ${t('statusBatch', { n: plan?.batches.length ?? 0, started })}`)
    }
  }
  cmdGuard()
}

function cmdCheck() {
  const problems = []
  const ok = (m) => console.log(`✓ ${m}`)
  const ko = (m) => {
    problems.push(m)
    console.log(`✗ ${m}`)
  }
  config._hasFile ? ok(t('checkConfig', { file: CONFIG_FILE })) : console.log(`· ${t('checkNoConfig', { file: CONFIG_FILE })}`)
  for (const kind of ['axis', 'severity', 'priority'])
    if (config.labels[kind] && !String(config.labels[kind]).includes(`{${kind}}`))
      ko(t('checkTemplate', { kind, template: config.labels[kind] }))
  try {
    execFileSync('gh', ['auth', 'status'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    ok(t('checkGh'))
  } catch {
    ko(t('checkGhFailed'))
  }
  try {
    git(['rev-parse', '--show-toplevel'], root)
    ok(t('checkGit', { root: toPosix(root) }))
  } catch {
    ko(t('checkNoGit'))
  }
  for (const [name, rel] of [
    ['scannerRuns', config.sources.scannerRuns],
    ['scannerHistory', config.sources.scannerHistory],
    ['reports', config.sources.reports],
  ])
    existsSync(abs(rel)) ? ok(`${name}: ${rel}`) : console.log(`· ${t('checkMissingDir', { name, dir: rel })}`)
  for (const file of [...historyFiles(), ...findingsFiles()]) {
    let found
    try {
      found = validateFindings(readJson(file), toPosix(path.relative(root, file)))
    } catch (e) {
      found = [`${toPosix(path.relative(root, file))}: ${e.message}`]
    }
    found.length ? found.forEach(ko) : ok(toPosix(path.relative(root, file)))
  }
  for (const role of ROLES)
    for (const setting of Object.keys(AGENT_SETTINGS)) {
      const s = agentSettingFor(config, role, setting)
      if (!s.known) ko(t('unsupportedSetting', { setting: `${role}.${setting}`, value: s.raw }))
    }
  console.log(problems.length ? t('checkProblems', { n: problems.length }) : t('checkOk'))
  process.exit(problems.length ? 1 : 0)
}

// ─── language, model ────────────────────────────────────────────────────────

function ownConfig() {
  const file = path.join(root, CONFIG_FILE)
  return { file, own: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {} }
}

function cmdLanguage() {
  const [value] = positional()
  const languages = SUPPORTED.map((c) => `${c} (${LANGUAGES[c].native})`).join(', ')
  if (!value) {
    console.log(t('languageCurrent', { name: i18n.name, code: i18n.code, source: t(`source_${i18n.source}`), list: languages }))
    return
  }
  const resolved = resolveLanguage(value)
  if (!resolved.known) fail(t('unsupportedLanguage', { value, list: SUPPORTED.join(', ') }))
  const { file, own } = ownConfig()
  writeJson(file, { ...own, language: resolved.code })
  console.log(i18nFor(resolved.code).t('languageSet', { name: LANGUAGES[resolved.code].native, file: CONFIG_FILE }))
}

function cmdModel() {
  const [target] = positional()
  const wanted = { model: option('model'), effort: option('effort') }
  if (!wanted.model && !wanted.effort) {
    for (const role of ROLES) {
      const a = agentOf(config, role)
      console.log(`${role}: model ${a.model.value} (${t(`source_${a.model.source}`)}), effort ${a.effort.value} (${t(`source_${a.effort.source}`)}) → ${a.type}`)
    }
    return
  }
  if (target && target !== 'all' && !ROLES.includes(target)) fail(t('unknownRole', { role: target, list: ROLES.join(', ') }))
  for (const [setting, v] of Object.entries(wanted)) {
    if (!v) continue
    const { values, aliases } = AGENT_SETTINGS[setting]
    const resolved = values.includes(v) ? v : aliases[v]
    if (!resolved) fail(t('unsupportedSetting', { setting, value: v }))
    wanted[setting] = resolved
  }
  const { file, own } = ownConfig()
  const put = (object, setting) => {
    if (!wanted[setting]) return
    if (wanted[setting] === 'inherit') delete object[setting]
    else object[setting] = wanted[setting]
  }
  if (!target || target === 'all') for (const s of Object.keys(wanted)) put(own, s)
  else {
    own.roles = { ...own.roles, [target]: { ...own.roles?.[target] } }
    for (const s of Object.keys(wanted)) put(own.roles[target], s)
  }
  writeJson(file, own)
  console.log(t('modelSet', { target: target ?? 'all', file: CONFIG_FILE }))
}

// ─── The repository ─────────────────────────────────────────────────────────

/**
 * What each command needs of the project's repository: a remote wherever the GitHub CLI
 * is called, and a commit for triage (history) and batches (branches, worktrees).
 */
const NEEDS_REPO = {
  open: () => ({ remote: true }),
  sync: () => ({ remote: true }),
  select: () => ({ remote: true }),
  status: () => ({ remote: true }),
  triage: (sub) => ({ commit: true, remote: sub === 'prepare' || sub === 'apply' }),
  // `batch finish --push|--pr` checks its remote itself, after the guard.
  batch: (sub) => ({ commit: true, remote: sub === 'plan' }),
}

const REPO_MESSAGES = { 'no-git': 'repoNoGit', none: 'repoNone', empty: 'repoEmpty', 'no-remote': 'repoNoRemote' }

/** Stops with `REPO=<what is missing>` and exit code 3 when the project is not usable. */
function requireRepo(needs) {
  const missing = missingFor(repoState(root), needs)
  if (!missing) return
  console.log(`REPO=${missing}`)
  console.error(t(REPO_MESSAGES[missing], { dir: toPosix(root) }))
  process.exit(REPO_EXIT)
}

function cmdRepo() {
  const [action] = positional()
  const dir = toPosix(root)
  const current = repoState(root)
  if (current.state === 'no-git') fail(t('repoNoGit', { dir }))
  if (action === 'plan') {
    console.log(`REPO_STATE=${current.state}`)
    console.log(`REMOTE=${current.remote ? 'yes' : 'no'}`)
    if (current.state === 'ready') return console.log(t('repoAlready', { dir }))
    const { files, flagged } = plannedFiles(root)
    console.log(`FILES=${files.length}`)
    console.log(t('repoPlanFiles', { n: files.length }))
    if (flagged.length) {
      console.log(t('repoPlanFlagged'))
      for (const f of flagged) console.log(`  ${f.path}${f.files > 1 ? ` ×${f.files}` : ''}`)
    } else console.log(t('repoPlanClean'))
    console.log(`FLAGGED=${flagged.map((f) => f.path).join(',')}`)
    return
  }
  if (action === 'init') {
    try {
      const { committed } = initRepo(root, { commit: flag('commit'), message: t('repoInitialCommit') })
      if (current.state === 'none') console.log(t('repoCreated', { dir }))
      if (flag('commit')) console.log(committed ? t('repoCommitted', { n: committed }) : t('repoNothingToCommit'))
    } catch (e) {
      fail(t('repoFailed', { error: String(e.stderr || e.message).trim() }))
    }
    console.log(`REPO_STATE=${repoState(root).state}`)
    return
  }
  if (action === 'github') {
    // Publishes the code: the command runs it only on the user's explicit answer.
    if (current.remote) fail(t('repoHasRemote', { dir }))
    if (current.state !== 'ready') fail(t('repoEmpty', { dir }), REPO_EXIT)
    try {
      const url = publishRepo(root, { visibility: flag('public') ? 'public' : 'private' })
      console.log(t('repoPublished', { url }))
    } catch (e) {
      fail(t('repoPublishFailed', { error: String(e.stderr || e.message).trim() }))
    }
    return
  }
  fail(t('usage', { syntax: 'repo plan | repo init [--commit] | repo github [--public]' }), 2)
}

const commands = {
  sources: cmdSources,
  open: cmdOpen,
  sync: cmdSync,
  select: cmdSelect,
  triage: cmdTriage,
  batch: cmdBatch,
  status: cmdStatus,
  check: cmdCheck,
  language: cmdLanguage,
  model: cmdModel,
  guard: cmdGuard,
  repo: cmdRepo,
}

try {
  if (!commands[command]) fail(t('unknownCommand', { list: Object.keys(commands).join(', ') }), 2)
  if (NEEDS_REPO[command]) requireRepo(NEEDS_REPO[command](args[0]))
  commands[command]()
} catch (e) {
  fail(`tracker: ${e.message}`)
}
