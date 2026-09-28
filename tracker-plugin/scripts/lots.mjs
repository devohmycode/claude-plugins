// Lots: a committed plan of the open issues, fixed one lot at a time by any agent.
//
// A batch run (`batch plan`) lives in `.tracker/runs/`, is not committed and serves one
// session. A plan is the durable form: two twin files in the repository (`<name>.json`
// for an agent, `<name>.html` for a reader), numbered lots read for days, marked as
// they are done, and a lock shared by every agent of the clone — Claude, Codex or a
// shell — so that one lot at a time is in progress.
//
// Pure helpers except the lock, which touches one file in git's common directory.

import { closeSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git } from './lib.mjs'

export const PLAN_SCHEMA = 'tracker.plan/1'
export const LEGACY_SCHEMA = 'decker.lots-issues/1'
export const LOCK_NAME = 'tracker-lot.lock'
export const BUSY_EXIT = 75
export const PR_STATES = ['draft', 'open', 'merged', 'closed']

export const MARK_START = '<!-- tracker:lots:start -->'
export const MARK_END = '<!-- tracker:lots:end -->'

// ─── The plan ───────────────────────────────────────────────────────────────

const asArray = (v) => (Array.isArray(v) ? v : [])
const bool = (v) => v === true

/** An issue of a lot, with only the fields the plan keeps. */
function planIssue(i) {
  return {
    number: Number(i.number),
    title: String(i.title ?? ''),
    url: i.url ?? null,
    priority: i.priority ?? null,
    severity: i.severity ?? null,
    axis: i.axis ?? null,
    files: [...new Set(asArray(i.files).map(String))],
    ...(i.note ? { note: String(i.note) } : {}),
    ...(bool(i.bag) ? { bag: true } : {}),
    ...(i.codeFix === false ? { codeFix: false } : {}),
    ...(bool(i.awaitDeploy) ? { awaitDeploy: true } : {}),
  }
}

/** Lots whose issues cite the same files: two agents must not take them at once. */
export function conflictsOf(lots) {
  const byFile = new Map()
  for (const lot of lots)
    for (const file of new Set(lot.issues.flatMap((i) => i.files))) {
      if (!byFile.has(file)) byFile.set(file, new Set())
      byFile.get(file).add(lot.id)
    }
  const pairs = new Map()
  for (const [file, ids] of byFile) {
    const list = [...ids]
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        const key = [list[a], list[b]].sort(byId).join('|')
        if (!pairs.has(key)) pairs.set(key, { lots: key.split('|'), files: [] })
        pairs.get(key).files.push(file)
      }
  }
  return [...pairs.values()].sort((x, y) => byId(x.lots[0], y.lots[0]) || byId(x.lots[1], y.lots[1]))
}

/** `2` before `10`; non-numeric ids after, alphabetically. */
export function byId(a, b) {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  if (Number.isFinite(na)) return -1
  if (Number.isFinite(nb)) return 1
  return String(a).localeCompare(String(b))
}

export function progressOf(plan, date = new Date()) {
  const done = plan.lots.filter((l) => l.done).map((l) => l.id)
  return { date: date.toISOString().slice(0, 10), done, remaining: plan.lots.length - done.length }
}

/** Fills what the plan derives (conflicts, progress) and orders its fields. */
export function finishPlan(plan) {
  const lots = plan.lots.map((l) => ({
    id: String(l.id),
    scope: l.scope ?? null,
    title: String(l.title ?? `#${l.id}`),
    summary: l.summary ?? '',
    codeFix: l.codeFix !== false,
    awaitDeploy: bool(l.awaitDeploy),
    ...(l.done ? { done: l.done } : {}),
    issues: asArray(l.issues).map(planIssue),
  }))
  const out = {
    schema: PLAN_SCHEMA,
    created: plan.created ?? new Date().toISOString(),
    updated: plan.updated ?? plan.created ?? new Date().toISOString(),
    repository: plan.repository ?? null,
    base: plan.base ?? null,
    commit: plan.commit ?? null,
    summary: plan.summary ?? '',
    scopes: asArray(plan.scopes).map((s) => ({
      id: String(s.id),
      title: String(s.title ?? s.id),
      summary: s.summary ?? '',
      lots: asArray(s.lots).map(String),
    })),
    lots,
    unassigned: asArray(plan.unassigned).map((u) => ({ ...planIssue(u), reason: u.reason ?? '' })),
  }
  out.conflicts = conflictsOf(lots)
  out.progress = progressOf(out, new Date(out.updated))
  return out
}

/**
 * Checks a planner's proposal against the draft: every lot has an id, a title and
 * issues of the draft; each issue of the draft is in exactly one lot, or unassigned.
 * Returns the list of problems (empty when it holds).
 */
export function validateProposal(proposal, draftNumbers) {
  const problems = []
  const known = new Set(draftNumbers)
  const seen = new Map()
  const ids = new Set()
  const note = (n, where) => {
    if (!known.has(n)) problems.push(`#${n} (${where}) is not in the draft`)
    if (seen.has(n)) problems.push(`#${n} is in ${seen.get(n)} and in ${where}`)
    seen.set(n, where)
  }
  if (!Array.isArray(proposal?.lots) || !proposal.lots.length) return ['no lots']
  for (const [k, lot] of proposal.lots.entries()) {
    const id = lot?.id == null ? null : String(lot.id)
    if (!id) problems.push(`lot at index ${k} has no id`)
    else if (ids.has(id)) problems.push(`lot ${id} appears twice`)
    ids.add(id)
    if (!lot?.title) problems.push(`lot ${id ?? k} has no title`)
    const numbers = asArray(lot?.issues).map((i) => Number(typeof i === 'object' ? i.number : i))
    if (!numbers.length) problems.push(`lot ${id ?? k} has no issues`)
    for (const n of numbers) note(n, `lot ${id ?? k}`)
  }
  for (const u of asArray(proposal.unassigned)) note(Number(typeof u === 'object' ? u.number : u), 'unassigned')
  for (const n of known) if (!seen.has(n)) problems.push(`#${n} is in no lot and not unassigned`)
  for (const s of asArray(proposal.scopes))
    for (const id of asArray(s.lots)) if (!ids.has(String(id))) problems.push(`scope ${s.id} names unknown lot ${id}`)
  return problems
}

/** The plan built from a planner's proposal and the draft's issue records. */
export function planFromProposal(proposal, draft) {
  const record = new Map(draft.issues.map((i) => [i.number, i]))
  const expand = (i) => {
    const n = Number(typeof i === 'object' ? i.number : i)
    const own = typeof i === 'object' ? i : {}
    return { ...record.get(n), ...own, number: n, files: own.files ?? record.get(n)?.files ?? [] }
  }
  return finishPlan({
    created: new Date().toISOString(),
    repository: draft.repository,
    base: draft.base,
    commit: draft.commit,
    summary: proposal.summary ?? '',
    scopes: proposal.scopes,
    lots: proposal.lots.map((l) => ({ ...l, issues: asArray(l.issues).map(expand) })),
    unassigned: asArray(proposal.unassigned).map((u) => ({ ...expand(u), reason: u.reason ?? '' })),
  })
}

/** The lot, or null. */
export const lotOf = (plan, id) => plan.lots.find((l) => l.id === String(id)) ?? null

/**
 * The first lot in the plan's order that is not done, not held by someone else and
 * not waiting for a deployment (unless `includeAwait`).
 */
export function nextLot(plan, { held = null, includeAwait = false } = {}) {
  return (
    plan.lots.find((l) => !l.done && l.id !== held && (includeAwait || !l.awaitDeploy)) ?? null
  )
}

/** Marks a lot done with its pull request; marking again updates it (draft → merged). */
export function markLot(plan, id, pr, now = new Date()) {
  if (!lotOf(plan, id)) throw new Error(`lot ${id} is not in the plan`)
  if (!PR_STATES.includes(pr.state)) throw new Error(`pull request state ${pr.state}: ${PR_STATES.join(', ')}`)
  const lots = plan.lots.map((l) =>
    l.id === String(id)
      ? {
          ...l,
          done: {
            pr: { number: Number(pr.number), url: pr.url ?? null, branch: pr.branch ?? null, state: pr.state },
            marked: now.toISOString(),
            ...(pr.agent ? { agent: pr.agent } : {}),
          },
        }
      : l
  )
  return finishPlan({ ...plan, lots, updated: now.toISOString() })
}

// ─── The plans of the previous generation (decker.lots-issues/1) ────────────

const LEGACY_PR_STATE = { brouillon: 'draft', fusionnee: 'merged', fermee: 'closed', ouverte: 'open' }

/** A plan written by hand in the French format that preceded this one. */
export function importLegacy(doc) {
  if (doc?.schema !== LEGACY_SCHEMA) throw new Error(`not a ${LEGACY_SCHEMA} document`)
  const issue = (i) => ({
    number: i.number,
    title: i.titre,
    url: i.url,
    priority: i.priorite,
    severity: i.severite,
    axis: i.axe,
    files: i.fichiers,
    note: i.note,
    bag: i.sac,
    codeFix: i.correctifCode,
    awaitDeploy: i.attendreDeploiement,
  })
  const lots = asArray(doc.lots).map((l) => {
    const issues = asArray(l.issues).map(issue)
    const pr = l.traite?.pr
    return {
      id: l.id,
      scope: l.perimetre,
      title: l.titre,
      summary: l.resume,
      codeFix: l.nature ? l.nature === 'code' : !issues.every((i) => i.codeFix === false),
      awaitDeploy: issues.some((i) => i.awaitDeploy === true),
      ...(pr
        ? {
            done: {
              pr: { number: pr.numero, url: pr.url, branch: pr.branche, state: LEGACY_PR_STATE[pr.etat] ?? 'draft' },
              marked: doc.avancement?.date ? `${doc.avancement.date}T00:00:00.000Z` : new Date().toISOString(),
            },
          }
        : {}),
      issues,
    }
  })
  return finishPlan({
    created: doc.date ? `${doc.date}T00:00:00.000Z` : undefined,
    updated: new Date().toISOString(),
    repository: doc.depot ?? null,
    base: doc.base ?? null,
    summary: doc.releve ?? '',
    scopes: asArray(doc.perimetres).map((s) => ({ id: s.id, title: s.titre, summary: s.resume, lots: s.lots })),
    lots,
    unassigned: asArray(doc.horsLots).map((h) => ({ ...issue(h), reason: h.raison ?? h.note ?? '' })),
  })
}

// ─── The lock ───────────────────────────────────────────────────────────────

/**
 * In git's common directory, never in the working tree: shared by every worktree of the
 * clone (a Codex worktree included) and impossible to commit or merge by mistake.
 */
export function lockFile(root) {
  const common = git(['rev-parse', '--git-common-dir'], root).trim()
  return path.join(path.resolve(root, common), LOCK_NAME)
}

export function readLock(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return null
    // Unreadable (an interrupted write): stale, never free.
    return { lot: '?', agent: '?', renewed: new Date(0).toISOString() }
  }
}

export function isStale(lock, hours, now = Date.now()) {
  const at = Date.parse(lock.renewed ?? lock.since)
  return !Number.isFinite(at) || now - at > hours * 3600_000
}

/**
 * One attempt, no waiting: `{ ok, lock, renewed?, taken? }`. The same agent on the same
 * lot renews; a stale lock is set aside by an atomic rename, then the new one is created
 * with `wx` (of two agents that arrive together, one wins). The file set aside is read
 * back: when it is no longer the stale lock both agents saw — the other agent took it in
 * between and this rename moved its fresh lock — it is put back, never overwriting, and
 * the lock is busy.
 */
export function tryLock(file, { lot, agent, plan, branch = null, staleHours = 4 }, now = new Date()) {
  const current = readLock(file)
  const at = now.toISOString()
  if (current && current.lot === lot && current.agent === agent) {
    const renewed = { ...current, renewed: at, branch: branch ?? current.branch }
    writeFileSync(file, JSON.stringify(renewed, null, 2) + '\n')
    return { ok: true, lock: renewed, renewed: true }
  }
  let taken = null
  if (current) {
    if (!isStale(current, staleHours, now.getTime())) return { ok: false, lock: current }
    const aside = `${file}.stale-${process.pid}`
    try {
      renameSync(file, aside)
      const moved = readLock(aside)
      if (!sameLock(moved, current)) {
        try {
          linkSync(aside, file)
        } catch (e) {
          if (e.code !== 'EEXIST') throw e
        }
        unlinkSync(aside)
        return { ok: false, lock: readLock(file) ?? moved }
      }
      unlinkSync(aside)
      taken = current
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  }
  const lock = { lot, agent, plan, branch, since: at, renewed: at }
  try {
    const fd = openSync(file, 'wx')
    writeFileSync(fd, JSON.stringify(lock, null, 2) + '\n')
    closeSync(fd)
  } catch (e) {
    if (e.code === 'EEXIST') return { ok: false, lock: readLock(file) }
    throw e
  }
  return { ok: true, lock, taken }
}

const sameLock = (a, b) =>
  a != null && b != null && a.lot === b.lot && a.agent === b.agent && a.since === b.since && a.renewed === b.renewed

/**
 * Releases the lock when it holds `lot` — and `agent`, when given; any lock with `force`.
 * Without `force`, a lot is required: releasing whatever is held is what `force` is for.
 * True when removed.
 */
export function releaseLock(file, lot = null, { force = false, agent = null } = {}) {
  const current = readLock(file)
  if (!current) return false
  if (!force && (lot == null || current.lot !== String(lot))) return false
  if (!force && agent && current.agent !== agent) return false
  try {
    unlinkSync(file)
    return true
  } catch (e) {
    if (e.code === 'ENOENT') return false
    throw e
  }
}

// ─── HTML ───────────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function prBadge(done, t) {
  const pr = done.pr
  const link = pr.url ? `<a href="${esc(pr.url)}">#${esc(pr.number)}</a>` : `#${esc(pr.number)}`
  return `<span class="badge done">✓ ${esc(t('htmlDone'))} · PR ${link} · ${esc(t(`prState_${pr.state}`))}</span>`
}

function issueItem(i, t) {
  const title = i.url ? `<a href="${esc(i.url)}">#${i.number}</a>` : `#${i.number}`
  const facets = [i.priority, i.severity, i.axis].filter(Boolean).map((f) => `<span class="facet">${esc(f)}</span>`).join(' ')
  const flags = [
    i.codeFix === false ? `<span class="badge">${esc(t('htmlNotCode'))}</span>` : '',
    i.awaitDeploy ? `<span class="badge wait">${esc(t('htmlAwaitDeploy'))}</span>` : '',
    i.bag ? `<span class="badge wait">${esc(t('htmlBag'))}</span>` : '',
  ].join('')
  const files = i.files.length ? `<p class="files">${i.files.map((f) => `<code>${esc(f)}</code>`).join(' · ')}</p>` : ''
  const note = i.note ? `<p class="note">${esc(i.note)}</p>` : ''
  return `<li>${title} ${facets} — ${esc(i.title)} ${flags}${files}${note}</li>`
}

function lotArticle(lot, t) {
  const flags = [
    lot.done ? prBadge(lot.done, t) : '',
    !lot.codeFix ? `<span class="badge">${esc(t('htmlNotCode'))}</span>` : '',
    lot.awaitDeploy ? `<span class="badge wait">${esc(t('htmlAwaitDeploy'))}</span>` : '',
  ].join(' ')
  return `<article id="lot-${esc(lot.id)}"${lot.done ? ' class="is-done"' : ''}>
  <header><span class="lot-id">${esc(t('htmlLot', { id: lot.id }))}</span><h3>${esc(lot.title)}</h3>${flags}</header>
  ${lot.summary ? `<p>${esc(lot.summary)}</p>` : ''}
  <ul class="issues">${lot.issues.map((i) => issueItem(i, t)).join('\n')}</ul>
</article>`
}

/** The reader's twin of the plan: generated whole from the JSON, never patched. */
export function renderHtml(plan, { t, code, name, instructions }) {
  const issues = plan.lots.reduce((n, l) => n + l.issues.length, 0)
  const scoped = new Set(plan.scopes.flatMap((s) => s.lots))
  const scopes = [...plan.scopes]
  const loose = plan.lots.filter((l) => !scoped.has(l.id))
  if (loose.length) scopes.push({ id: '_', title: t('htmlOtherLots'), summary: '', lots: loose.map((l) => l.id) })
  const sections = scopes
    .map(
      (s) => `<section id="scope-${esc(s.id)}">
  <h2>${esc(s.title)}</h2>
  ${s.summary ? `<p class="lede">${esc(s.summary)}</p>` : ''}
  ${s.lots
    .map((id) => lotOf(plan, id))
    .filter(Boolean)
    .map((l) => lotArticle(l, t))
    .join('\n')}
</section>`
    )
    .join('\n')
  const conflicts = plan.conflicts.length
    ? `<section id="conflicts"><h2>${esc(t('htmlConflicts'))}</h2><p>${esc(t('htmlConflictsIntro'))}</p><ul>${plan.conflicts
        .map(
          (c) =>
            `<li>${c.lots.map((id) => `<a href="#lot-${esc(id)}">${esc(t('htmlLot', { id }))}</a>`).join(' · ')} — ${c.files
              .map((f) => `<code>${esc(f)}</code>`)
              .join(' · ')}</li>`
        )
        .join('')}</ul></section>`
    : ''
  const unassigned = plan.unassigned.length
    ? `<section id="unassigned"><h2>${esc(t('htmlUnassigned'))}</h2><ul class="issues">${plan.unassigned
        .map((u) => issueItem({ ...u, note: u.reason || u.note }, t))
        .join('\n')}</ul></section>`
    : ''
  return `<!doctype html>
<html lang="${esc(code)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t('htmlTitle'))}</title>
<style>
:root { --bg: #fbfaf7; --fg: #1d1d1b; --muted: #6b6a66; --line: #e3e0d8; --accent: #1d5fb8; --ok: #2e7d4f; --warn: #a15c00; }
@media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecebe6; --muted: #a09e97; --line: #33322f; --accent: #7fb0f5; --ok: #6cc592; --warn: #e3a54f; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, sans-serif; }
.page { max-width: 58rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
a { color: var(--accent); }
h1 { font-size: 1.8rem; margin: 0 0 .5rem; }
h2 { font-size: 1.3rem; margin: 2.5rem 0 .5rem; border-bottom: 1px solid var(--line); padding-bottom: .3rem; }
h3 { font-size: 1.05rem; margin: 0; display: inline; }
.lede, .meta, .note, .files { color: var(--muted); }
.meta, .files { font-size: .85rem; }
.counts { display: flex; flex-wrap: wrap; gap: 1.5rem; padding: 0; list-style: none; }
.counts strong { display: block; font-size: 1.6rem; }
article { border: 1px solid var(--line); border-radius: 8px; padding: .9rem 1rem; margin: 1rem 0; }
article.is-done { opacity: .72; }
article header { display: flex; flex-wrap: wrap; gap: .5rem; align-items: baseline; }
.lot-id { font-family: ui-monospace, monospace; color: var(--muted); }
.badge { font-size: .78rem; border: 1px solid var(--line); border-radius: 999px; padding: 0 .5rem; }
.badge.done { color: var(--ok); border-color: currentColor; }
.badge.wait { color: var(--warn); border-color: currentColor; }
.facet { font-family: ui-monospace, monospace; font-size: .8rem; color: var(--muted); }
.issues { padding-left: 1.1rem; }
.issues li { margin: .4rem 0; }
code { font-size: .85em; overflow-wrap: anywhere; }
</style>
</head>
<body>
<div class="page">
<header>
<h1>${esc(t('htmlTitle'))}</h1>
${plan.summary ? `<p class="lede">${esc(plan.summary)}</p>` : ''}
<ul class="counts">
<li><strong>${issues}</strong>${esc(t('htmlIssues'))}</li>
<li><strong>${plan.lots.length}</strong>${esc(t('htmlLots'))}</li>
<li><strong>${plan.progress.done.length}</strong>${esc(t('htmlLotsDone'))}</li>
<li><strong>${plan.unassigned.length}</strong>${esc(t('htmlUnassignedCount'))}</li>
</ul>
<p class="meta">${esc(t('htmlMeta', { name, base: plan.base ?? '?', commit: plan.commit ?? '?', date: plan.updated.slice(0, 10) }))}</p>
<p class="meta">${esc(instructions)}</p>
</header>
${sections}
${conflicts}
${unassigned}
</div>
</body>
</html>
`
}

// ─── Instructions for every agent ───────────────────────────────────────────

/** The protocol block written into CLAUDE.md, AGENTS.md…, between two markers. */
export function instructionsBlock({ t, cli, dir, base }) {
  const vars = { cli, dir, base: base ?? '?' }
  const steps = [1, 2, 3, 4, 5, 6].map((n) => `${n}. ${t(`instr_${n}`, vars)}`)
  return [
    MARK_START,
    `### ${t('instrTitle', vars)}`,
    '',
    t('instrIntro', vars),
    '',
    ...steps,
    '',
    t('instrLock', vars),
    MARK_END,
  ].join('\n')
}

/** `text` with its block replaced, or the block appended when there is none. */
export function withBlock(text, block) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const body = block.replace(/\n/g, eol)
  const start = text.indexOf(MARK_START)
  const end = text.indexOf(MARK_END)
  if (start >= 0 && end > start) return text.slice(0, start) + body + text.slice(end + MARK_END.length)
  const sep = text.length && !text.endsWith(eol) ? eol + eol : text.length ? eol : ''
  return `${text}${sep}${body}${eol}`
}

export const planPaths = (root, dir, name) => ({
  json: path.join(root, dir, `${name}.json`),
  html: path.join(root, dir, `${name}.html`),
})

export const isPlanFile = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).schema === PLAN_SCHEMA
  } catch {
    return false
  }
}
