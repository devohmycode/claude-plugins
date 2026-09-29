// The document chain (PRD § 5, § 9; SPECS § 1–2): paths, skeletons, the section index,
// section extraction, links, fingerprints, the status of each document and `check`.
//
// Sections are headings `## <n>. <Title>` / `### <n>.<m> <Title>` (id `3.2`), sprints
// `## S<n> — <title>` (id `S2`), and unnumbered headings (id `#<k>`, their rank among
// all headings). A section runs to the next heading of the same or a higher level; a
// *chunk*, the unit of translation, runs to the next heading of any level. Headings in
// code fences and HTML comments do not count.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PLUGIN_ROOT, readProjectConfig } from './config.mjs'
import { ACCEPTANCE_RE, TASK_RE, parseTasks } from './tasks.mjs'
import { hiddenLines, isoDate, readText, writeText } from './util.mjs'

/** The chain, in order; the stage (command) that writes each document. */
export const CHAIN = ['PRD', 'ARCHITECTURE', 'SPECS', 'TASKS']
export const STAGE_OF = { PRD: 'prd', ARCHITECTURE: 'architecture', SPECS: 'specs', TASKS: 'tasks' }
export const DOC_OF = Object.fromEntries(Object.entries(STAGE_OF).map(([d, s]) => [s, d]))
export const DOCS_DIR = 'docs'
export const TODO = '<!-- docflow:todo'
export const TEMPLATES_DIR = path.join(PLUGIN_ROOT, 'templates')
const LOCALES = { en: 'en-GB', fr: 'fr-FR', es: 'es-ES', de: 'de-DE' }

/** `prd`, `PRD`, `docs/PRD-FR.md` → `PRD`; null when it is not a document of the chain. */
export function docName(value) {
  const base = path.basename(String(value ?? '').trim()).replace(/\.md$/i, '').replace(/-(FR|ES|DE)$/i, '')
  const upper = base.toUpperCase()
  if (CHAIN.includes(upper)) return upper
  return DOC_OF[base.toLowerCase()] ?? null
}

/** `docs/PRD.md`, or the twin `docs/PRD-FR.md` with a language. */
export const docRel = (doc, lang = null) => `${DOCS_DIR}/${doc}${lang && lang !== 'en' ? `-${lang.toUpperCase()}` : ''}.md`
export const docPath = (root, doc, lang = null) => path.join(root, docRel(doc, lang))
export const predecessor = (doc) => CHAIN[CHAIN.indexOf(doc) - 1] ?? null
export const following = (doc) => CHAIN.slice(CHAIN.indexOf(doc) + 1)

// ─── Fingerprints ───────────────────────────────────────────────────────────

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
    .map((l) => l.replace(/^- \[[ xX]\] (\*\*S\d+(?:-T\d+| acceptance)\*\*)(?: \(#\d+\))?/, '- [ ] $1'))
    .join('\n')
}

/**
 * The fingerprint of a document: its sections, from the first heading on. The preamble —
 * title table and link lines, which the script rewrites when translations are added — is
 * not an edit of the document.
 */
export function docFingerprint(doc, text) {
  const { lines, preambleEnd } = indexSections(text)
  const body = lines.slice(preambleEnd).join('\n')
  return fingerprint(doc === 'TASKS' ? neutralTasks(body) : body)
}

// ─── Section index ──────────────────────────────────────────────────────────

/** The headings of a text with their ranges; `preambleEnd` is the first heading's line. */
export function indexSections(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  const hidden = hiddenLines(lines)
  const sections = []
  let rank = 0
  lines.forEach((line, i) => {
    if (hidden[i]) return
    const m = /^(#{2,3}) (.+?)\s*$/.exec(line)
    if (!m) return
    rank++
    const raw = m[2]
    const num = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(raw)
    const sprint = /^(S\d+)\b\s*(?:[—–-]\s*)?(.*)$/.exec(raw)
    const [id, title] = num ? [num[1], num[2]] : sprint ? [sprint[1], sprint[2]] : [`#${rank}`, raw]
    sections.push({ id, level: m[1].length, title: title.trim(), heading: line, line: i })
  })
  sections.forEach((s, k) => {
    const next = sections.slice(k + 1).find((o) => o.level <= s.level)
    s.end = next ? next.line : lines.length
    s.chunkEnd = sections[k + 1]?.line ?? lines.length
  })
  return { lines, sections, preambleEnd: sections[0]?.line ?? lines.length }
}

const trimEnd = (lines) => {
  const copy = [...lines]
  while (copy.length && !copy.at(-1).trim()) copy.pop()
  return copy
}

/** `3.2`, `§ 3.2`, `S2`, `#4` → the section id as indexed. */
export const normalizeRef = (ref) => String(ref ?? '').replace(/^§\s*/, '').replace(/\.$/, '').trim()

/** The text of one section (heading included), or null. */
export function section(text, ref) {
  const { lines, sections } = indexSections(text)
  const id = normalizeRef(ref)
  const s = sections.find((x) => x.id === id || x.id.toLowerCase() === id.toLowerCase())
  return s ? trimEnd(lines.slice(s.line, s.end)).join('\n') : null
}

/** The chunks of a text: `{ id, heading, text }`, each up to the next heading of any level. */
export function chunks(text) {
  const { lines, sections } = indexSections(text)
  return sections.map((s) => ({ id: s.id, level: s.level, heading: s.heading, line: s.line, text: trimEnd(lines.slice(s.line, s.chunkEnd)).join('\n') }))
}

/** The preamble: title, table, link lines — everything before the first heading. */
export function preambleOf(text) {
  const { lines, preambleEnd } = indexSections(text)
  return trimEnd(lines.slice(0, preambleEnd)).join('\n')
}

/** Fingerprint of each chunk, by id (the heading line counts: a renamed heading is a change). */
export function sectionFingerprints(doc, text) {
  const out = {}
  for (const c of chunks(text)) out[c.id] = fingerprint(doc === 'TASKS' ? neutralTasks(c.text) : c.text)
  return out
}

/** Sections whose body still holds a `docflow:todo` marker. */
export function unfilled(text) {
  const { lines, sections } = indexSections(text)
  const found = []
  lines.forEach((line, i) => {
    if (!line.includes(TODO)) return
    const owner = [...sections].reverse().find((s) => s.line <= i)
    found.push({ id: owner?.id ?? '0', title: owner?.title ?? '', line: i })
  })
  return found.filter((f, k) => found.findIndex((g) => g.id === f.id) === k)
}

/** Relative Markdown links outside code: `{ label, target, line }`. */
export function links(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  const hidden = hiddenLines(lines)
  const out = []
  lines.forEach((line, i) => {
    if (hidden[i]) return
    const clean = line.replace(/`[^`]*`/g, '')
    for (const m of clean.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      const target = m[2]
      if (/^([a-z][a-z0-9+.-]*:|#)/i.test(target)) continue
      out.push({ label: m[1], target, line: i })
    }
  })
  return out
}

// ─── Templates and skeletons ────────────────────────────────────────────────

const stringsCache = new Map()

/** The words of a language's documents (templates/<lang>/strings.json), English as fallback. */
export function strings(lang = 'en') {
  if (!stringsCache.has(lang)) {
    const file = path.join(TEMPLATES_DIR, lang, 'strings.json')
    const own = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
    const base = lang === 'en' ? {} : strings('en')
    stringsCache.set(lang, { ...base, ...own })
  }
  return stringsCache.get(lang)
}

/** The body of a document's template (sections with `docflow:todo` markers). */
export function templateBody(doc, lang = 'en', { adopt = false } = {}) {
  const stage = STAGE_OF[doc]
  const candidates = [
    ...(adopt ? [path.join(TEMPLATES_DIR, lang, `${stage}.adopt.md`), path.join(TEMPLATES_DIR, 'en', `${stage}.adopt.md`)] : []),
    path.join(TEMPLATES_DIR, lang, `${stage}.md`),
    path.join(TEMPLATES_DIR, 'en', `${stage}.md`),
  ]
  const file = candidates.find((f) => existsSync(f))
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}

export function formatDate(ms, lang = 'en') {
  return new Intl.DateTimeFormat(LOCALES[lang] ?? 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms))
}

/** The project's name: `project` in .docflow/config.json, else the folder name. */
export function projectName(root) {
  try {
    const own = readProjectConfig(root)
    if (typeof own.project === 'string' && own.project.trim()) return own.project.trim()
  } catch {}
  return path.basename(path.resolve(root))
}

/**
 * The link lines of a document: in English, one line per translation; in a twin, the
 * line back to the English document; then the chain, the document itself in bold.
 */
export function linkLines(doc, lang = 'en', langs = []) {
  const s = strings(lang)
  const lines = []
  if (lang === 'en') {
    for (const l of langs) {
      const file = `${doc}-${l.toUpperCase()}.md`
      lines.push(s.twin.replace('{language}', strings('en').languages[l]).replaceAll('{file}', file))
    }
  } else lines.push(s.twin.replaceAll('{file}', `${doc}.md`))
  const chain = CHAIN.map((d) => (d === doc ? `**${d}**` : `[${d}](${path.basename(docRel(d, lang))})`)).join(' → ')
  lines.push(s.chain.replace('{links}', chain))
  return lines
}

/** Title, table and link lines of a new document. */
export function preamble({ project, doc, lang = 'en', langs = [], now = Date.now() }) {
  const s = strings(lang)
  return [
    `# ${project} — ${s.titles[doc]}`,
    '',
    '| | |',
    '|---|---|',
    `| ${s.status} | ${s.draft} |`,
    `| ${s.date} | ${formatDate(now, lang)} |`,
    '',
    ...linkLines(doc, lang, langs),
  ].join('\n')
}

/** Writes the skeleton of `doc` when it does not exist. Returns `{ created, file }`. */
export function skeleton(root, doc, { langs = [], adopt = false, now = Date.now(), project = projectName(root) } = {}) {
  const file = docPath(root, doc)
  if (existsSync(file)) return { created: false, file }
  const body = templateBody(doc, 'en', { adopt }).replaceAll('{date}', isoDate(now))
  writeText(file, `${preamble({ project, doc, langs, now })}\n\n${body.replace(/\n+$/, '')}\n`)
  return { created: true, file }
}

/** Rewrites the link lines of a document (after `doc_languages` changed), keeping the rest. */
export function refreshLinks(text, doc, lang = 'en', langs = []) {
  const { lines, preambleEnd } = indexSections(text)
  const s = strings(lang)
  const prefixes =
    lang === 'en' ? Object.values(s.languages).map((n) => s.twin.split('[')[0].replace('{language}', n)) : [s.twin.split('[')[0]]
  prefixes.push(s.chain.split('{')[0])
  const kept = []
  let at = -1
  for (let i = 0; i < preambleEnd; i++) {
    if (prefixes.some((p) => lines[i].startsWith(p))) {
      if (at < 0) at = kept.length
      continue
    }
    kept.push(lines[i])
  }
  if (at < 0) return text
  kept.splice(at, 0, ...linkLines(doc, lang, langs))
  return [...kept, ...lines.slice(preambleEnd)].join('\n')
}

// ─── Status ─────────────────────────────────────────────────────────────────

/**
 * The status of every document: `missing`, `draft` (never approved, or edited since its
 * approval), `stale` (approved, but a preceding document changed since) or `approved`.
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

/**
 * The fingerprints of every section of the documents before `doc`: recorded at its
 * approval, so that once it is stale the sections that changed since can be named.
 */
export function basisOf(root, doc) {
  const basis = {}
  for (const d of CHAIN.slice(0, CHAIN.indexOf(doc))) {
    const f = readText(docPath(root, d))
    if (f) basis[d] = sectionFingerprints(d, f.text)
  }
  return basis
}

/** `PRD § 3`… of the preceding documents whose sections changed since `entry.basis`. */
export function changedSince(root, doc, entry) {
  const refs = []
  for (const [d, fps] of Object.entries(entry?.basis ?? {})) {
    const f = readText(docPath(root, d))
    if (!f) continue
    const now = sectionFingerprints(d, f.text)
    for (const id of new Set([...Object.keys(now), ...Object.keys(fps)])) if (now[id] !== fps[id]) refs.push(`${d} § ${id}`)
  }
  return refs
}

// ─── Check ──────────────────────────────────────────────────────────────────

/** A heading matches a required title when it contains it: `Plugin layout` is a Layout. */
const sameTitle = (heading, required) => heading.trim().toLowerCase().includes(required.trim().toLowerCase())

/**
 * Problems of one document: `{ file, line, key, vars }`, `key` naming a message
 * (`check_<key>` in the catalogs). `lang` checks a twin against its language's words.
 */
export function checkDoc(root, doc, { lang = 'en' } = {}) {
  const rel = docRel(doc, lang)
  const problems = []
  const add = (line, key, vars = {}) => problems.push({ file: rel, line: line + 1, key, vars })
  const file = readText(docPath(root, doc, lang))
  if (!file) {
    add(-1, 'missingDoc', { doc })
    return problems
  }
  const { text } = file
  const { lines, sections } = indexSections(text)
  if (!/^# \S/.test(lines[0] ?? '')) add(0, 'noTitle')
  const s = strings(lang)
  const top = sections.filter((x) => x.level === 2)

  for (const alternatives of s.required?.[doc] ?? [])
    if (!top.some((x) => alternatives.some((a) => sameTitle(x.title, a))))
      add(-1, 'missingSection', { title: alternatives.join(' / ') })

  if (doc === 'SPECS') {
    const numbered = top.filter((x) => /^\d+$/.test(x.id))
    if (!numbered.length) add(-1, 'noNumberedSection')
    else {
      const last = numbered.at(-1)
      if (!(s.limits ?? []).some((w) => last.title.toLowerCase().includes(w.toLowerCase())))
        add(last.line, 'noLimits', { title: last.title })
    }
  }

  for (const u of unfilled(text)) add(u.line, 'unfilled', { section: u.id, title: u.title })

  if (doc === 'TASKS') problems.push(...checkTasks(root, text, rel))

  for (const l of links(text)) {
    const target = decodeURI(l.target.split('#')[0])
    if (!target) continue
    const full = path.resolve(path.dirname(docPath(root, doc, lang)), target)
    if (existsSync(full)) continue
    // A document of the chain not written yet, or a translation: status and twins cover them.
    const rel2 = path.relative(root, full).split(path.sep).join('/')
    if (new RegExp(`^${DOCS_DIR}/(${CHAIN.join('|')})(-(FR|ES|DE))?\\.md$`).test(rel2)) continue
    add(l.line, 'brokenLink', { target: l.target })
  }
  return problems
}

/** TASKS.md: the grammar of each entry, ids, an acceptance test per sprint, references. */
function checkTasks(root, text, rel) {
  const problems = []
  const add = (line, key, vars = {}) => problems.push({ file: rel, line: line + 1, key, vars })
  const parsed = parseTasks(text)
  const { lines } = parsed
  const hidden = hiddenLines(lines)
  if (!parsed.sprints.length) add(-1, 'noSprint')
  const inSprint = (i) => {
    const s = [...parsed.sprints].reverse().find((x) => x.line < i)
    if (!s) return false
    const nextHeading = lines.findIndex((l, k) => k > s.line && /^#{1,2} /.test(l) && !hidden[k])
    return nextHeading < 0 || i < nextHeading
  }
  lines.forEach((line, i) => {
    if (hidden[i] || !/^- \[/.test(line) || !inSprint(i)) return
    if (!TASK_RE.test(line) && !ACCEPTANCE_RE.test(line)) add(i, 'taskGrammar', { line: line.slice(0, 60) })
  })
  const seen = new Set()
  for (const it of parsed.items) {
    if (seen.has(it.id)) add(it.line, 'duplicateId', { id: it.id })
    seen.add(it.id)
    const owner = [...parsed.sprints].reverse().find((x) => x.line < it.line)
    if (owner && owner.id !== it.sprint) add(it.line, 'wrongSprint', { id: it.id, sprint: owner.id })
  }
  for (const s of parsed.sprints) {
    if (!s.tasks.length) add(s.line, 'emptySprint', { sprint: s.id })
    if (!s.acceptance) add(s.line, 'noAcceptance', { sprint: s.id })
  }
  const indexes = {}
  for (const it of parsed.items)
    for (const ref of it.refs) {
      const [doc, id] = ref.split(' § ')
      if (!(doc in indexes)) {
        const f = readText(docPath(root, doc))
        indexes[doc] = f ? indexSections(f.text).sections.map((x) => x.id) : null
      }
      if (indexes[doc] && !indexes[doc].includes(id)) add(it.line, 'badRef', { id: it.id, ref })
    }
  return problems
}
