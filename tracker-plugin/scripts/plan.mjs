// The decisions of the tracker, as pure functions: no git, no gh, no file system.
// tracker.mjs gathers the inputs and carries out what these functions decide;
// the tests exercise them directly.

import {
  CLOSED_STATUSES,
  DISMISSED_VERDICTS,
  SEVERITIES,
  keysInBody,
  matchesRef,
  severityRank,
} from './findings.mjs'
import { issueFacets, locationIn, priorityRank } from './lib.mjs'

/** Key → first issue that carries it. */
export function indexByKey(issues) {
  const index = new Map()
  for (const issue of issues)
    for (const key of keysInBody(issue.body)) if (!index.has(key)) index.set(key, issue)
  return index
}

const isLive = (f) =>
  !(f.verdict && DISMISSED_VERDICTS.includes(f.verdict)) &&
  !(f.status && CLOSED_STATUSES.includes(f.status))

/** A closed issue whose finding shows up in a source finished after the closing. */
export function reappeared(finding, issue) {
  if (issue.state !== 'CLOSED' || !issue.closedAt || !finding.source.finished) return false
  return new Date(finding.source.finished) > new Date(issue.closedAt)
}

/**
 * Which findings need an issue. Each finding lands in one list:
 *   fresh     — no issue carries its key, it is live and above the threshold;
 *   known     — an issue (open or closed) carries its key;
 *   dismissed — refuted, closed, below the threshold, or a duplicate across sources.
 * `regressed` lists the known ones whose issue was closed before the source ran.
 */
export function planOpen(findings, issues, { minSeverity = 'low', only = null } = {}) {
  const index = indexByKey(issues)
  const floor = Math.max(severityRank(minSeverity), severityRank('low'))
  const plan = { fresh: [], known: [], dismissed: [], regressed: [] }
  const seen = new Set()
  for (const f of findings) {
    if (only && !only.some((ref) => matchesRef(f, ref))) continue
    if (seen.has(f.key)) {
      plan.dismissed.push({ finding: f, reason: 'duplicate' })
      continue
    }
    seen.add(f.key)
    const issue = index.get(f.key)
    if (issue) {
      plan.known.push({ finding: f, issue })
      if (isLive(f) && reappeared(f, issue)) plan.regressed.push({ finding: f, issue })
    } else if (f.verdict && DISMISSED_VERDICTS.includes(f.verdict))
      plan.dismissed.push({ finding: f, reason: `verdict:${f.verdict}` })
    else if (f.status && CLOSED_STATUSES.includes(f.status))
      plan.dismissed.push({ finding: f, reason: `status:${f.status}` })
    else if (severityRank(f.severity) < floor)
      plan.dismissed.push({ finding: f, reason: `severity:${f.severity}` })
    else plan.fresh.push(f)
  }
  return plan
}

/** Orders findings for creation: priority, then severity, then label. */
export function sortFindings(findings, priorityOf) {
  return [...findings].sort(
    (a, b) =>
      priorityRank(priorityOf(a)) - priorityRank(priorityOf(b)) ||
      severityRank(b.severity) - severityRank(a.severity) ||
      a.label.localeCompare(b.label)
  )
}

/**
 * What a set of sources says about existing issues.
 *   close  — open issues whose finding is gone: `resolved` by a full-scope scan, or
 *            marked done (`status`) in an audit file — unless another source still
 *            reports it live;
 *   reopen — closed issues whose finding is live again in a source finished after
 *            the closing.
 * `sources`: [{ findings: normalized[], resolved: [{ fingerprint }], full: bool, meta }].
 */
export function planSync(sources, issues) {
  const index = indexByKey(issues)
  const live = new Map()
  for (const s of sources) for (const f of s.findings) if (isLive(f)) live.set(f.key, f)
  const close = []
  const reopen = []
  const handled = new Set()
  const propose = (key, entry) => {
    const issue = index.get(key)
    if (!issue || issue.state !== 'OPEN' || live.has(key) || handled.has(issue.number)) return
    handled.add(issue.number)
    close.push({ issue, ...entry })
  }
  for (const s of sources) {
    if (s.full)
      for (const r of s.resolved ?? [])
        if (r.fingerprint) propose(`fp:${r.fingerprint}`, { reason: 'resolved', meta: s.meta, ref: r })
    for (const f of s.findings)
      if (f.status && CLOSED_STATUSES.includes(f.status))
        propose(f.key, { reason: 'done', meta: s.meta, ref: f })
  }
  for (const [key, f] of live) {
    const issue = index.get(key)
    if (issue && !handled.has(issue.number) && reappeared(f, issue)) {
      handled.add(issue.number)
      reopen.push({ issue, finding: f })
    }
  }
  return { close, reopen }
}

// ─── Selecting issues ───────────────────────────────────────────────────────

/**
 * A selection, as tokens: `12` or `#12` (issue numbers), `label:<name>`,
 * `priority:P1`, `severity:high`, `axis:security` (turned into labels through the
 * config's templates), `triage:<run>` (the issues a triage found still holding),
 * `all` (every open issue).
 */
export function parseSelector(tokens) {
  const sel = { numbers: [], labels: [], facets: {}, triage: null, all: false }
  for (const raw of tokens.flatMap((t) => String(t).split(','))) {
    const token = raw.trim()
    if (!token) continue
    if (/^#?\d+$/.test(token)) sel.numbers.push(Number(token.replace('#', '')))
    else if (token === 'all') sel.all = true
    else {
      const m = token.match(/^(label|priority|severity|axis|triage):(.+)$/)
      if (!m) throw new Error(`selector: "${token}"`)
      if (m[1] === 'label') sel.labels.push(m[2])
      else if (m[1] === 'triage') sel.triage = m[2]
      else sel.facets[m[1]] = m[2]
    }
  }
  return sel
}

/** Orders issues by priority label, then number. */
export function sortIssues(config, issues) {
  return [...issues].sort(
    (a, b) =>
      priorityRank(issueFacets(config, a.labels ?? []).priority) -
        priorityRank(issueFacets(config, b.labels ?? []).priority) || a.number - b.number
  )
}

// ─── Batches ────────────────────────────────────────────────────────────────

/** `app/api/persons/route.ts:12` → `app/api`; a file at the root → `(root)`. */
export function areaOf(location) {
  if (!location) return null
  const file = location.replace(/:\d+(?:-\d+)?$/, '')
  const parts = file.split('/').filter(Boolean)
  if (parts.length <= 1) return '(root)'
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/')
}

/**
 * Splits issues into batches. `groupBy`: `area` (same part of the code: one branch
 * touches one region), `axis`, or `none`. A group larger than `perBatch` is cut;
 * batches are ordered by their most urgent issue.
 */
export function groupBatches(config, issues, { groupBy = 'area', perBatch = 5, max = 30 } = {}) {
  const enriched = sortIssues(config, issues)
    .slice(0, max)
    .map((issue) => {
      const facets = issueFacets(config, issue.labels ?? [])
      const location = issue.location ?? locationIn(issue.body)
      return { ...issue, ...facets, location, area: areaOf(location) }
    })
  const groupOf = (i) =>
    groupBy === 'axis' ? (i.axis ?? 'other') : groupBy === 'none' ? 'all' : (i.area ?? i.axis ?? 'other')
  const groups = new Map()
  for (const i of enriched) {
    const g = groupOf(i)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(i)
  }
  const batches = []
  for (const [group, list] of groups)
    for (let k = 0; k < list.length; k += Math.max(1, perBatch))
      batches.push({ group, issues: list.slice(k, k + Math.max(1, perBatch)) })
  batches.sort(
    (a, b) =>
      Math.min(...a.issues.map((i) => priorityRank(i.priority))) -
        Math.min(...b.issues.map((i) => priorityRank(i.priority))) ||
      a.group.localeCompare(b.group)
  )
  return batches.map((b, n) => ({ id: `B${n + 1}`, ...b }))
}

/** `app/api` → `app-api`, for a branch name. */
export const slug = (text) =>
  String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'batch'

// ─── Triage ─────────────────────────────────────────────────────────────────

export const VERDICTS = ['holds', 'fixed', 'obsolete', 'unclear']

/** The verdicts a skeptic must confirm before an issue is closed. */
export const needsCheck = (verdict) => verdict?.verdict === 'fixed' || verdict?.verdict === 'obsolete'

/**
 * From the triagers' verdicts and the skeptics' checks to decisions and actions.
 * An issue is proposed for closing only when a skeptic agreed; a disagreement
 * turns the verdict back into `holds`.
 */
export function decideTriage(config, issues, verdicts, checks) {
  return issues.map((issue) => {
    const v = verdicts.get(issue.number)
    const current = issueFacets(config, issue.labels ?? []).priority
    const decision = {
      number: issue.number,
      title: issue.title,
      priority: current,
      verdict: v?.verdict ?? 'untriaged',
      final: v?.verdict ?? 'untriaged',
      reason: v?.reason ?? null,
      location: v?.location ?? null,
      suggestedPriority: v?.priority ?? null,
      commit: v?.commit ?? null,
      check: null,
      actions: [],
    }
    if (!v || !VERDICTS.includes(v.verdict)) return decision
    if (needsCheck(v)) {
      const c = checks.get(issue.number)
      decision.check = c ? (c.agree ? 'agree' : 'disagree') : 'missing'
      if (c && !c.agree) {
        decision.final = 'holds'
        decision.reason = c.reason ?? decision.reason
      } else if (!c) decision.final = 'unclear'
    }
    if (decision.final === 'fixed' || decision.final === 'obsolete')
      decision.actions.push({ type: 'close', reason: decision.final === 'fixed' ? 'completed' : 'not planned' })
    if (
      decision.final === 'holds' &&
      config.triage.relabel &&
      decision.suggestedPriority &&
      current &&
      decision.suggestedPriority !== current
    )
      decision.actions.push({ type: 'relabel', from: current, to: decision.suggestedPriority })
    if (decision.final === 'holds' && config.triage.commentOnHolds)
      decision.actions.push({ type: 'comment' })
    return decision
  })
}

export { SEVERITIES }
