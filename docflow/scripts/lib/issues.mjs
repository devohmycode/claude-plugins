// The GitHub issues mirror (PRD § 6.8, SPECS § 8): each task and each sprint acceptance
// of TASKS.md as an issue, so that `tracker` or a person can pick it up — TASKS.md stays
// the source of truth. An issue is found again by the key in its body, written in the
// format the tracker plugin reads (`<!-- tracker:key=id:docflow-S2-T3 -->`): never by
// its title or its number alone, so a push run twice creates nothing twice.
//
// The plans are pure functions over the parsed TASKS.md and the listed issues; the I/O
// (gh) is the thin layer at the end.

import path from 'node:path'
import { keyComment, keysInBody } from '../findings.mjs'
import { gh } from './git.mjs'
import { writeText } from './util.mjs'

export const LABEL = 'docflow'
export const ACCEPTANCE_LABEL = 'acceptance'
const LABEL_COLORS = { [LABEL]: '5319e7', [ACCEPTANCE_LABEL]: '0e8a16', sprint: 'c5def5' }
/** GitHub accepts 256 characters; a title is read in a list, so it stays short. */
const TITLE_MAX = 120

/** `id:docflow-S2-T3`, `id:docflow-S2-acceptance`. */
export const keyOf = (id) => `id:docflow-${String(id).replace(/\s+/g, '-')}`

/** `S2-T3 <title>`, `S2 acceptance — <test>`; within TITLE_MAX characters. */
export function titleFor(item) {
  const title = item.kind === 'acceptance' ? `${item.id} — ${item.title}` : `${item.id} ${item.title}`
  return title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 1).replace(/\s+\S*$/, '')}…`
}

export const labelsFor = (item) => [LABEL, `sprint:${item.sprint}`, ...(item.kind === 'acceptance' ? [ACCEPTANCE_LABEL] : [])]

/**
 * The body: the task line as TASKS.md holds it — without its box and its issue number,
 * which change without the task changing —, its references, then the key.
 */
export function bodyFor(item) {
  const lines = [`**${item.id}** ${item.text}`.replace(/\s+$/, ''), '']
  if (item.refs.length) lines.push('References:', '', ...item.refs.map((r) => `- ${r}`), '')
  lines.push(
    item.kind === 'acceptance'
      ? '_Mirrored from `docs/TASKS.md` by docflow. Closed when the acceptance box is ticked._'
      : '_Mirrored from `docs/TASKS.md` by docflow, which stays the source of truth._',
    '',
    keyComment(keyOf(item.id))
  )
  return lines.join('\n')
}

const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '')
const labelNames = (issue) => (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name))
const isOpen = (issue) => String(issue.state).toUpperCase() === 'OPEN'

/** Listed issues by key; of two issues with the same key, the older one (a duplicate is not ours to close). */
export function indexByKey(issues) {
  const byKey = new Map()
  for (const issue of [...issues].sort((a, b) => a.number - b.number))
    for (const key of keysInBody(issue.body)) if (!byKey.has(key)) byKey.set(key, issue)
  return byKey
}

/**
 * What a push does: `create` (unticked entries without an issue), `update` (an issue whose
 * title, body or labels differ), `unchanged`, and `numbers` — the entries whose issue number
 * TASKS.md does not hold yet. A ticked entry without an issue is left alone: there is
 * nothing left to pick up.
 */
export function pushPlan(parsed, issues) {
  const byKey = indexByKey(issues)
  const plan = { create: [], update: [], unchanged: [], numbers: [] }
  for (const item of parsed.items) {
    const issue = byKey.get(keyOf(item.id))
    if (!issue) {
      if (!item.done) plan.create.push(item)
      continue
    }
    const want = { title: titleFor(item), body: bodyFor(item), labels: labelsFor(item) }
    const missing = want.labels.filter((l) => !labelNames(issue).includes(l))
    if (norm(issue.title) !== want.title || norm(issue.body) !== norm(want.body) || missing.length)
      plan.update.push({ item, issue, ...want, missing })
    else plan.unchanged.push(item)
    if (item.issue !== issue.number) plan.numbers.push({ id: item.id, number: issue.number })
  }
  return plan
}

/**
 * What a pull finds: `closed` — issues closed outside docflow while their entry is still
 * unticked (a tick to make) —, `reopened` — issues open again while their entry is ticked
 * (a tick to take back). Entries are matched by key, else by the number TASKS.md holds.
 */
export function pullPlan(parsed, issues) {
  const byKey = indexByKey(issues)
  const byNumber = new Map(issues.map((i) => [i.number, i]))
  const plan = { closed: [], reopened: [] }
  for (const item of parsed.items) {
    const issue = byKey.get(keyOf(item.id)) ?? (item.issue ? byNumber.get(item.issue) : null)
    if (!issue) continue
    if (!isOpen(issue) && !item.done) plan.closed.push({ item, issue })
    else if (isOpen(issue) && item.done) plan.reopened.push({ item, issue })
  }
  return plan
}

// ─── gh ─────────────────────────────────────────────────────────────────────

/** Every issue labelled docflow, open or closed. */
export function listIssues(dir) {
  const out = gh(['issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '1000', '--json', 'number,title,body,state,labels'], dir)
  return JSON.parse(out || '[]')
}

/** Creates the labels the plan needs and the repository lacks. */
export function ensureLabels(dir, names) {
  const have = new Set(JSON.parse(gh(['label', 'list', '--limit', '500', '--json', 'name'], dir) || '[]').map((l) => l.name))
  for (const name of new Set(names)) {
    if (have.has(name)) continue
    const color = LABEL_COLORS[name] ?? LABEL_COLORS.sprint
    gh(['label', 'create', name, '--color', color, '--description', 'Mirrored by docflow'], dir)
  }
}

const bodyFile = (root, body) => {
  const file = path.join(root, '.docflow', 'issue-body.md')
  writeText(file, `${body}\n`)
  return file
}

/** Creates the issue of an entry; returns its number. */
export function createIssue(root, dir, item) {
  const args = ['issue', 'create', '--title', titleFor(item), '--body-file', bodyFile(root, bodyFor(item))]
  for (const l of labelsFor(item)) args.push('--label', l)
  const url = gh(args, dir).trim().split('\n').pop()
  const m = /\/issues\/(\d+)\s*$/.exec(url)
  if (!m) throw Object.assign(new Error('gh issue create'), { command: 'gh issue create', output: url })
  return Number(m[1])
}

export function updateIssue(root, dir, { issue, title, body, missing }) {
  const args = ['issue', 'edit', String(issue.number), '--title', title, '--body-file', bodyFile(root, body)]
  for (const l of missing) args.push('--add-label', l)
  gh(args, dir)
}
