// The document chain (PRD § 5, SPECS § 1–2): paths, fingerprints and the status of
// each document computed from the state and the files alone.

import { createHash } from 'node:crypto'
import path from 'node:path'
import { readText } from './util.mjs'

/** The chain, in order; the stage (command) that writes each document. */
export const CHAIN = ['PRD', 'ARCHITECTURE', 'SPECS', 'TASKS']
export const STAGE_OF = { PRD: 'prd', ARCHITECTURE: 'architecture', SPECS: 'specs', TASKS: 'tasks' }
export const DOC_OF = Object.fromEntries(Object.entries(STAGE_OF).map(([d, s]) => [s, d]))
export const DOCS_DIR = 'docs'

/** `prd`, `PRD`, `docs/PRD.md` → `PRD`; null when it is not a document of the chain. */
export function docName(value) {
  const v = String(value ?? '').trim()
  const base = path.basename(v).replace(/\.md$/i, '').replace(/-(FR|ES|DE)$/i, '')
  const upper = base.toUpperCase()
  if (CHAIN.includes(upper)) return upper
  return DOC_OF[base.toLowerCase()] ?? null
}

/** `docs/PRD.md`, or the twin `docs/PRD-FR.md` with a language. */
export const docRel = (doc, lang = null) => `${DOCS_DIR}/${doc}${lang ? `-${lang.toUpperCase()}` : ''}.md`
export const docPath = (root, doc, lang = null) => path.join(root, docRel(doc, lang))

/** First 12 hex digits of SHA-256, line endings normalised to `\n`, trailing spaces removed. */
export function fingerprint(text) {
  const normal = String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
  return createHash('sha256').update(normal).digest('hex').slice(0, 12)
}

/**
 * What the script itself changes in TASKS.md — ticks, results, issue numbers — does not
 * count as an edit: the fingerprint of a TASKS text ignores them.
 */
export function neutralTasks(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !/^ {2}\*Result \(\d{4}-\d{2}-\d{2}\): (passed|failed) — /.test(l))
    .map((l) =>
      l.replace(/^- \[[ xX]\] (\*\*S\d+(?:-T\d+| acceptance)\*\*)(?: \(#\d+\))?/, '- [ ] $1')
    )
    .join('\n')
}

export const docFingerprint = (doc, text) => fingerprint(doc === 'TASKS' ? neutralTasks(text) : text)

/**
 * The status of every document: `missing`, `draft` (never approved, or edited since its
 * approval), `stale` (approved, but a preceding document changed since) or `approved`.
 * `changed` tells whether an approved document was edited or removed since its approval.
 */
export function docStatuses(root, state) {
  const result = {}
  let before = false
  for (const doc of CHAIN) {
    const entry = state.docs?.[doc]
    const current = readText(docPath(root, doc))
    const fp = current ? docFingerprint(doc, current.text) : null
    const approvedOnce = !!entry?.approved
    const changed = approvedOnce && fp !== entry.fingerprint
    let status
    if (!current) status = 'missing'
    else if (!approvedOnce || changed) status = 'draft'
    else if (entry.stale || before) status = 'stale'
    else status = 'approved'
    result[doc] = { status, fingerprint: fp, approvedOnce, changed, text: current?.text ?? null }
    before ||= changed
  }
  return result
}
