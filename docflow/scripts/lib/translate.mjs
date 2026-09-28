// Translations (PRD § 6.2, SPECS § 4): each English document may have twins
// (`docs/PRD-FR.md`…) with the same chunks. The state records, per twin, the fingerprint
// of each English chunk it was last translated from; only chunks whose fingerprint changed
// are sent to the translator, then spliced into the twin by id. The twin's preamble (title,
// table, link lines) is the script's, in the twin's language.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { chunks, docPath, docRel, links, preamble, preambleOf, projectName, refreshLinks, sectionFingerprints } from './docs.mjs'
import { readText, writeText } from './util.mjs'

export const WORK_DIR = '.docflow/translate'
export const marker = (id) => `<!-- docflow:section ${id} -->`
const MARKER_RE = /^<!-- docflow:section (\S+) -->\s*$/
const DOCS = ['PRD', 'ARCHITECTURE', 'SPECS', 'TASKS']

/**
 * What a twin needs: `changed` — English chunks to (re)translate, in document order;
 * `removed` — twin chunks without an English counterpart; `exists` — whether the twin exists.
 */
export function planTwin(root, state, doc, lang) {
  const en = readText(docPath(root, doc))
  if (!en) return null
  const fps = sectionFingerprints(doc, en.text)
  const recorded = state.translations?.[doc]?.[lang] ?? {}
  const twin = readText(docPath(root, doc, lang))
  const twinIds = twin ? chunks(twin.text).map((c) => c.id) : []
  const enChunks = chunks(en.text)
  return {
    exists: !!twin,
    enChunks,
    fingerprints: fps,
    changed: enChunks.filter((c) => recorded[c.id] !== fps[c.id] || !twinIds.includes(c.id)).map((c) => c.id),
    removed: twinIds.filter((id) => !(id in fps)),
  }
}

/** The file handed to the translator: the changed chunks, each after its marker. */
export function writeSource(root, doc, lang, plan) {
  const rel = `${WORK_DIR}/${doc}.${lang}.source.md`
  const wanted = new Set(plan.changed)
  const body = plan.enChunks.filter((c) => wanted.has(c.id)).map((c) => `${marker(c.id)}\n${c.text}`).join('\n\n')
  writeText(path.join(root, rel), `${body}\n`)
  return { source: rel, target: `${WORK_DIR}/${doc}.${lang}.md` }
}

/** The chunks of a translated file, by id (markers removed). */
export function parseTranslated(text) {
  const out = new Map()
  let id = null
  let buf = []
  const flush = () => {
    if (id !== null) out.set(id, buf.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, ''))
  }
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const m = MARKER_RE.exec(line)
    if (m) {
      flush()
      id = m[1]
      buf = []
    } else if (id !== null) buf.push(line)
  }
  flush()
  return out
}

/** Links to the documents of the chain point to the twins of the same language. */
export function rewriteLinks(text, lang) {
  const suffix = `-${lang.toUpperCase()}`
  return text.replace(new RegExp(`\\]\\((${DOCS.join('|')})\\.md(#[^)]*)?\\)`, 'g'), (m, doc, anchor = '') => `](${doc}${suffix}.md${anchor})`)
}

/** Whether a translated chunk starts with a heading of the same level and number as the English one. */
function sameHeading(english, translated) {
  const e = /^(#{2,3}) (\S+)/.exec(english)
  const t = /^(#{2,3}) (\S+)/.exec(translated)
  if (!e || !t || e[1] !== t[1]) return false
  const numbered = /^(\d+(?:\.\d+)*\.?|S\d+)$/
  return numbered.test(e[2]) ? e[2] === t[2] : true
}

/**
 * Splices the translated chunks into the twin (created when missing) and records their
 * fingerprints in `state`. Returns `{ updated, removed }`, or `{ missing }` / `{ invalid }`
 * when chunks are absent or do not start with the English heading's number.
 */
export function applyTwin(root, state, doc, lang, translatedText, { now = Date.now() } = {}) {
  const plan = planTwin(root, state, doc, lang)
  const translated = parseTranslated(translatedText)
  const twinFile = readText(docPath(root, doc, lang))
  const existing = new Map(twinFile ? chunks(twinFile.text).map((c) => [c.id, c.text]) : [])
  const body = []
  const updated = []
  const missing = []
  const invalid = []
  for (const c of plan.enChunks) {
    if (translated.has(c.id)) {
      const text = translated.get(c.id)
      if (!sameHeading(c.text, text)) invalid.push(c.id)
      body.push(rewriteLinks(text, lang))
      updated.push(c.id)
    } else if (existing.has(c.id) && !plan.changed.includes(c.id)) body.push(existing.get(c.id))
    else missing.push(c.id)
  }
  if (missing.length) return { missing }
  if (invalid.length) return { invalid }
  const head = twinFile ? refreshLinks(preambleOf(twinFile.text), doc, lang) : preamble({ project: projectName(root), doc, lang, now })
  writeText(docPath(root, doc, lang), `${head}\n\n${body.join('\n\n')}\n`, twinFile?.eol ?? '\n')
  const recorded = state.translations?.[doc]?.[lang] ?? {}
  const next = {}
  for (const c of plan.enChunks) next[c.id] = updated.includes(c.id) ? plan.fingerprints[c.id] : recorded[c.id]
  state.translations ??= {}
  state.translations[doc] ??= {}
  state.translations[doc][lang] = next
  return { updated, removed: plan.removed }
}

/**
 * Adopt mode (PRD § 6.1, D-5): a twin written before docflow — nothing recorded for it — is
 * taken as translated from the current English text, for the sections it holds. Without
 * this, every section of a hand-written twin reads as outdated, and translating it again
 * would overwrite a person's work. False when something is recorded already.
 */
export function adoptTwin(root, state, doc, lang) {
  if (state.translations?.[doc]?.[lang]) return false
  const plan = planTwin(root, state, doc, lang)
  if (!plan?.exists) return false
  const twinIds = chunks(readText(docPath(root, doc, lang)).text).map((c) => c.id)
  const recorded = {}
  for (const c of plan.enChunks) if (twinIds.includes(c.id)) recorded[c.id] = plan.fingerprints[c.id]
  state.translations ??= {}
  state.translations[doc] ??= {}
  state.translations[doc][lang] = recorded
  return true
}

/**
 * Problems of the twins of `doc` (PRD L-4): a missing twin, missing or extra sections,
 * sections translated from an older English text, broken links.
 */
export function checkTwins(root, state, doc, langs) {
  const problems = []
  if (!readText(docPath(root, doc))) return problems
  for (const lang of langs) {
    const rel = docRel(doc, lang)
    const add = (line, key, vars = {}) => problems.push({ file: rel, line: line + 1, key, vars })
    const plan = planTwin(root, state, doc, lang)
    if (!plan.exists) {
      add(-1, 'twinMissing', { file: rel })
      continue
    }
    const twin = readText(docPath(root, doc, lang)).text
    const twinChunks = chunks(twin)
    const twinIds = twinChunks.map((c) => c.id)
    for (const c of plan.enChunks) if (!twinIds.includes(c.id)) add(-1, 'twinSectionMissing', { section: c.id })
    for (const c of twinChunks) if (plan.removed.includes(c.id)) add(c.line, 'twinSectionExtra', { section: c.id })
    for (const c of twinChunks)
      if (!plan.removed.includes(c.id) && plan.changed.includes(c.id)) add(c.line, 'twinOutdated', { section: c.id })
    for (const l of links(twin)) {
      const target = decodeURI(l.target.split('#')[0])
      if (!target) continue
      const full = path.resolve(path.dirname(docPath(root, doc, lang)), target)
      if (!existsSync(full) && !new RegExp(`^(${DOCS.join('|')})(-[A-Z]{2})?\\.md$`).test(path.basename(full)))
        add(l.line, 'brokenLink', { target: l.target })
    }
  }
  return problems
}
