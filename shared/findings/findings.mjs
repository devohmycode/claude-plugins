// Shared findings contract for every plugin of this repository.
//
// Canonical copy: shared/findings/findings.mjs. Each plugin ships its own copy in
// <plugin>/scripts/findings.mjs — run `node scripts/sync-shared.mjs` at the
// repository root after editing this file, never edit the copies.
//
// A *findings file* is what one audit produced. Two shapes are accepted, and they
// share the same `findings` entries:
//
//   · a scan   — the `final.json` the scanner plugin writes in `.scanner/runs/<run>/`
//                (`run`, `type`, `commit`, `branch`, `finished`, `report`, `findings`);
//   · an audit — a file any other producer writes (an audit agent, a script):
//                `{ "kind": "audit", "agent", "report", "commit", "branch",
//                   "finished", "findings" }`.
//
// A finding: `id`, `title`, `severity` (critical | high | medium | low | info),
// `description`, and optionally `file`, `line`, `rule`, `reachability`, `evidence`,
// `remediation`, `axis`, `priority` (P0–P3), `status`, `verdict`, `fingerprint`.
//
// Every finding has a **key**, stable from one audit to the next, that tells two
// findings apart and ties a finding to the issue that tracks it:
//
//   · `fp:<fingerprint>` when the finding carries one (the scanner computes it from
//     type, rule, file and snippet — the line is left out, it moves);
//   · `id:<ID>` otherwise, and the id must then be unique across audits: a series
//     identifier such as `SEC-48`, never `F1` (the scanner restarts at F1 each run).
//
// The key is written into the issue body twice — an HTML comment for machines and a
// visible line for people — and `keysInBody` reads both, in every supported language.
//
// No dependencies: Node 18+ only.

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3']

/** Scan types of the scanner plugin → default axis. */
export const SCAN_AXES = {
  security: 'security',
  performance: 'performance',
  accessibility: 'accessibility',
  'dead-code': 'architecture',
  'test-coverage': 'tests',
}

/** Statuses and verdicts that mean a finding no longer calls for an issue. */
export const CLOSED_STATUSES = ['resolved', 'fixed', 'done']
export const DISMISSED_VERDICTS = ['refuted', 'duplicate']

/** A series identifier: `SEC-48`, `PER-7`, `A11Y-3`. */
export const SERIES_ID = /^([A-Z][A-Z0-9]{1,5})-(\d+)$/

/** Words used by the visible key line, per language — all of them are read back. */
export const KEY_WORDS = {
  fp: ['fingerprint', 'empreinte', 'huella', 'Fingerabdruck'],
  id: ['identifier', 'identifiant', 'identificador', 'Kennung'],
}

export const isScan = (doc) =>
  !!doc && typeof doc.run === 'string' && typeof doc.type === 'string' && doc.kind !== 'audit'

/**
 * Checks the shape of a findings file. Returns a list of problems (empty when the
 * file is usable). `name` prefixes every message.
 */
export function validateFindings(doc, name = 'findings') {
  const problems = []
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.findings))
    return [`${name}: an object with a "findings" array is expected`]
  const scan = isScan(doc)
  if (!scan) {
    if (doc.kind !== 'audit') problems.push(`${name}: "kind" must be "audit" (or the file a scan)`)
    for (const field of ['agent', 'report', 'commit', 'finished'])
      if (typeof doc[field] !== 'string' || !doc[field].trim())
        problems.push(`${name}: "${field}" is missing`)
  }
  const seen = new Set()
  doc.findings.forEach((f, i) => {
    const at = `${name} › findings[${i}]${f?.id ? ` (${f.id})` : ''}`
    if (!f || typeof f !== 'object') return problems.push(`${at}: an object is expected`)
    for (const field of ['id', 'title', 'severity', 'description'])
      if (typeof f[field] !== 'string' || !f[field].trim())
        problems.push(`${at}: "${field}" is missing`)
    if (f.severity && !SEVERITIES.includes(f.severity))
      problems.push(`${at}: unknown severity "${f.severity}" (${SEVERITIES.join(', ')})`)
    if (f.priority && !PRIORITIES.includes(f.priority))
      problems.push(`${at}: unknown priority "${f.priority}" (${PRIORITIES.join(', ')})`)
    if (f.line != null && !Number.isInteger(f.line)) problems.push(`${at}: "line" must be an integer`)
    if (scan && !f.fingerprint) problems.push(`${at}: "fingerprint" is missing`)
    if (!f.fingerprint && typeof f.id === 'string' && !SERIES_ID.test(f.id))
      problems.push(
        `${at}: without a fingerprint the id must be a series identifier (SEC-48), not "${f.id}"`
      )
    const key = keyOf(f)
    if (key && seen.has(key)) problems.push(`${at}: key "${key}" appears twice in the file`)
    seen.add(key)
  })
  return problems
}

/** The finding's key: `fp:<fingerprint>` or `id:<ID>`. */
export function keyOf(f) {
  if (f?.fingerprint) return `fp:${f.fingerprint}`
  if (f?.id) return `id:${f.id}`
  return null
}

/**
 * The findings of a file, uniform: each one carries its key, a label that tells
 * findings of different scans apart (`security/F8`), and its provenance.
 */
export function normalizeFindings(doc) {
  const scan = isScan(doc)
  const source = scan
    ? {
        kind: 'scan',
        run: doc.run,
        type: doc.type,
        scope: doc.scope ?? null,
        report: doc.report ?? null,
        commit: doc.commit ?? null,
        branch: doc.branch ?? null,
        finished: doc.finished ?? doc.started ?? null,
      }
    : {
        kind: 'audit',
        agent: doc.agent,
        report: doc.report,
        commit: doc.commit,
        branch: doc.branch ?? null,
        finished: doc.finished,
      }
  return doc.findings.map((f) => {
    const series = !f.fingerprint && SERIES_ID.test(f.id) ? f.id.match(SERIES_ID)[1] : null
    return {
      key: keyOf(f),
      id: f.id,
      label: scan ? `${doc.type}/${f.id}` : f.id,
      series,
      title: String(f.title).trim(),
      severity: f.severity,
      axis: f.axis ?? (scan ? (SCAN_AXES[doc.type] ?? doc.type) : null),
      priority: f.priority ?? null,
      file: f.file ?? null,
      line: Number.isInteger(f.line) ? f.line : null,
      rule: f.rule ?? null,
      description: String(f.description).trim(),
      reachability: f.reachability ?? null,
      evidence: f.evidence ?? null,
      remediation: f.remediation ?? null,
      verdict: f.verdict ?? null,
      status: f.status ?? null,
      source,
    }
  })
}

/** The machine marker written into an issue body. */
export const keyComment = (key) => `<!-- tracker:key=${key} -->`

/**
 * Every key an issue body carries (several when findings were grouped): the HTML
 * comments, and the visible lines `fingerprint \`…\`` / `identifier \`SEC-48\`` in any
 * supported language — issues written by hand or by an earlier tool use those.
 */
export function keysInBody(body) {
  const text = String(body ?? '')
  const keys = new Set()
  for (const m of text.matchAll(/<!--\s*tracker:key=((?:fp|id):[^\s>]+)\s*-->/g)) keys.add(m[1])
  const fp = KEY_WORDS.fp.join('|')
  const id = KEY_WORDS.id.join('|')
  for (const m of text.matchAll(new RegExp(`\\b(?:${fp})\\s+\`([0-9a-f]{8,})\``, 'gi')))
    keys.add(`fp:${m[1]}`)
  for (const m of text.matchAll(new RegExp(`\\b(?:${id})\\s+\`([A-Z][A-Z0-9]{1,5}-\\d+)\``, 'g')))
    keys.add(`id:${m[1]}`)
  return [...keys]
}

/** Severity rank: critical 4 … info 0; unknown −1. */
export const severityRank = (s) => {
  const i = SEVERITIES.indexOf(s)
  return i < 0 ? -1 : SEVERITIES.length - 1 - i
}

/** `security/F8`, `F8` or `SEC-48` → does it designate this finding? */
export const matchesRef = (finding, ref) => ref === finding.label || ref === finding.id
