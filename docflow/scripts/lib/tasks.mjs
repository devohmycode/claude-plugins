// TASKS.md (SPECS § 6): parser and editor. The file is edited by the script only, so
// its grammar stays parseable; ticks, results and issue numbers are mirrored into the
// twins (TASKS-FR.md…), matched by id, never by text.
//
//   ## S<n> — <title>
//   - [ ] **S<n>-T<m>** [(#<issue>)] <title>. [Refs: <DOC> § <n[.m]>[, …].]
//     [*Done when* <condition>.]
//   - [ ] **S<n> acceptance** [(#<issue>)] — <test>.
//     [*Result (<YYYY-MM-DD>): passed|failed — <evidence>.*]

import { hiddenLines } from './util.mjs'

export const SPRINT_RE =/^## (S\d+)\b(?:\s*[—–-]\s*(.*))?$/
export const TASK_RE = /^- \[( |x|X)\] \*\*(S\d+-T\d+)\*\*(?: \(#(\d+)\))? (.+)$/
export const ACCEPTANCE_RE = /^- \[( |x|X)\] \*\*(S\d+) acceptance\*\*(?: \(#(\d+)\))?(?:\s*[—–-])?\s*(.*)$/
export const RESULT_RE = /^ {2}\*Result \((\d{4}-\d{2}-\d{2})\): (passed|failed) — (.*?)\.?\*$/
const DOCS = 'PRD|ARCHITECTURE|SPECS|TASKS'

/** Every `<DOC> § <n>` of a text; `§ <n>` alone takes the last document named; ranges keep both ends. */
export function parseRefs(text) {
  const refs = []
  let doc = null
  const re = new RegExp(`(?:\\b(${DOCS})\\s+)?§\\s*(\\d+(?:\\.\\d+)*)(?:\\s*[–-]\\s*(\\d+(?:\\.\\d+)*))?`, 'g')
  for (const m of String(text).matchAll(re)) {
    doc = m[1] ?? doc
    if (!doc) continue
    for (const n of [m[2], m[3]].filter(Boolean)) {
      const ref = `${doc} § ${n}`
      if (!refs.includes(ref)) refs.push(ref)
    }
  }
  return refs
}

/** A task's title: its text before `Refs:` or `*Done when*`, without the final period. */
export function titleOf(text) {
  return String(text)
    .split(/\s(?:Refs:|\*Done when\*)/)[0]
    .trim()
    .replace(/\.$/, '')
}

/**
 * The sprints of a TASKS.md text, each with its tasks and acceptance entry. Every entry
 * keeps the index of its first line (`line`) and of its last continuation line (`end`).
 */
export function parseTasks(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  const sprints = []
  const items = []
  const hidden = hiddenLines(lines)
  let sprint = null
  let item = null
  lines.forEach((line, i) => {
    if (hidden[i]) {
      item = null
      return
    }
    const s = SPRINT_RE.exec(line)
    if (s) {
      sprint = { id: s[1], title: (s[2] ?? '').trim(), line: i, tasks: [], acceptance: null }
      sprints.push(sprint)
      item = null
      return
    }
    if (/^#{1,2} /.test(line)) {
      sprint = null
      item = null
      return
    }
    const task = TASK_RE.exec(line)
    const acceptance = !task && ACCEPTANCE_RE.exec(line)
    if (task || acceptance) {
      const m = task ?? acceptance
      item = {
        kind: task ? 'task' : 'acceptance',
        id: task ? m[2] : `${m[2]} acceptance`,
        sprint: task ? m[2].split('-')[0] : m[2],
        done: m[1] !== ' ',
        issue: m[3] ? Number(m[3]) : null,
        head: m[4],
        text: m[4],
        line: i,
        end: i,
        result: null,
      }
      items.push(item)
      const owner = sprints.find((x) => x.id === item.sprint)
      if (owner) {
        if (task) owner.tasks.push(item)
        else owner.acceptance = item
      }
      return
    }
    if (item && line.startsWith('  ') && line.trim()) {
      item.end = i
      const r = RESULT_RE.exec(line)
      if (r && item.kind === 'acceptance') item.result = { date: r[1], status: r[2], evidence: r[3], line: i }
      else item.text += ` ${line.trim()}`
      return
    }
    item = null
  })
  for (const it of items) {
    it.title = titleOf(it.text)
    it.refs = parseRefs(it.text)
    const done = /\*Done when\*\s*(.*?)\.?$/.exec(it.text)
    it.doneWhen = done ? done[1].trim() : null
  }
  return { sprints, items, lines }
}

// ─── Units ──────────────────────────────────────────────────────────────────

/**
 * The unit a run takes (SPECS § 6): `next` — the first unticked task (`task` mode) or the
 * first sprint with an unticked task or acceptance (`sprint` mode) — or a named sprint
 * (`S2`) or task (`S2-T3`). Units listed in `skip` (pending pull requests) are passed over
 * by `next`. Returns `{ kind, id, title, sprint, tasks, acceptance, done }`, or null.
 */
export function nextUnit(parsed, arg = 'next', { mode = 'sprint', skip = [] } = {}) {
  const sprintUnit = (s) => ({
    kind: 'sprint',
    id: s.id,
    title: s.title,
    sprint: s,
    tasks: s.tasks.filter((t) => !t.done),
    acceptance: s.acceptance,
    done: !s.tasks.some((t) => !t.done) && (!s.acceptance || s.acceptance.done),
  })
  const taskUnit = (t) => {
    const s = parsed.sprints.find((x) => x.id === t.sprint)
    return { kind: 'task', id: t.id, title: t.title, sprint: s, tasks: t.done ? [] : [t], acceptance: null, done: t.done }
  }
  if (/^S\d+$/i.test(arg)) {
    const s = parsed.sprints.find((x) => x.id === arg.toUpperCase())
    return s ? sprintUnit(s) : null
  }
  if (/^S\d+-T\d+$/i.test(arg)) {
    const t = parsed.items.find((x) => x.kind === 'task' && x.id === arg.toUpperCase())
    return t ? taskUnit(t) : null
  }
  if (arg !== 'next') return null
  const skipped = (id) => skip.includes(id)
  if (mode === 'task') {
    const t = parsed.items.find((x) => x.kind === 'task' && !x.done && !skipped(x.id) && !skipped(x.sprint))
    return t ? taskUnit(t) : null
  }
  const s = parsed.sprints.find((x) => !skipped(x.id) && !sprintUnit(x).done)
  return s ? sprintUnit(s) : null
}

/** Whether a text of a manual acceptance test asks for a person. */
export const isManual = (text) => /\((manual)\)|\bmanual(ly)?\b|\bby hand\b/i.test(String(text))

// ─── Edits ──────────────────────────────────────────────────────────────────

const bold = (id) => `**${id}**`

function withItem(text, id, fn) {
  const parsed = parseTasks(text)
  const item = parsed.items.find((i) => i.id === id)
  if (!item) return null
  const lines = [...parsed.lines]
  fn(lines, item)
  return lines.join('\n')
}

/** Ticks (`done`) or unticks a task or an acceptance entry; null when the id is absent. */
export const setDone = (text, id, done) =>
  withItem(text, id, (lines, item) => {
    lines[item.line] = lines[item.line].replace(/^- \[[ xX]\]/, done ? '- [x]' : '- [ ]')
  })

/** Writes (or replaces) the result line under a sprint's acceptance, ticked only on success. */
export const recordResult = (text, sprint, status, evidence, date) =>
  withItem(text, `${sprint} acceptance`, (lines, item) => {
    const line = `  *Result (${date}): ${status} — ${String(evidence).trim().replace(/[.\s]+$/, '').replace(/\s*\n\s*/g, ' ')}.*`
    if (item.result) lines[item.result.line] = line
    else lines.splice(item.end + 1, 0, line)
    lines[item.line] = lines[item.line].replace(/^- \[[ xX]\]/, status === 'passed' ? '- [x]' : '- [ ]')
  })

/** Writes the issue number after the id: `**S2-T3** (#42)`. */
export const setIssue = (text, id, number) =>
  withItem(text, id, (lines, item) => {
    const b = bold(id)
    lines[item.line] = lines[item.line].replace(new RegExp(`${b.replace(/[*]/g, '\\*')}(?: \\(#\\d+\\))?`), `${b} (#${number})`)
  })

/** Counts for the status: tasks done and total, sprints validated, the current sprint. */
export function progress(parsed) {
  const tasks = parsed.items.filter((i) => i.kind === 'task')
  const current = parsed.sprints.find((s) => s.tasks.some((t) => !t.done) || (s.acceptance && !s.acceptance.done)) ?? null
  return {
    done: tasks.filter((t) => t.done).length,
    total: tasks.length,
    sprintsDone: parsed.sprints.filter((s) => s !== current && !s.tasks.some((t) => !t.done) && (!s.acceptance || s.acceptance.done)).length,
    sprints: parsed.sprints.length,
    current,
  }
}
