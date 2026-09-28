// A run (PRD § 6.4, SPECS § 8): one unit — a sprint or a task — on its own branch, in
// place or in a worktree; the project's checks after each task; the task ticked in
// TASKS.md and its twins and committed with the code; then a push and a draft pull request.
// Everything here is git and gh; the state and the output belong to docflow.mjs.

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { gh, git, gitMaybe, shell, tail } from './git.mjs'
import { parseTasks } from './tasks.mjs'
import { readText, slugify, writeText } from './util.mjs'

export const LOG_DIR = '.docflow/logs'
export const LOG_TAIL = 60

/** `docflow/S2-placement`, `docflow/S2-T3-drop-rules` (SPECS § 8). */
export const branchName = (prefix, unit, title) => `${prefix}${unit}-${slugify(title)}`

/** `<repo>/../<repo-name>.docflow/<unit>`. */
export const worktreePath = (root, unit) => path.join(path.dirname(root), `${path.basename(root)}.docflow`, unit)

export const branchExists = (root, branch) => !!gitMaybe(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root)

/** Tracked files changed in `dir` (the working tree must be clean to switch branches in place). */
export function trackedChanges(dir) {
  return (gitMaybe(['status', '--porcelain', '--untracked-files=no'], dir) ?? '').split('\n').filter(Boolean)
}

/** Files under `paths` that are modified or untracked (e.g. documents never committed). */
export function uncommitted(dir, paths) {
  const out = gitMaybe(['status', '--porcelain', '--untracked-files=all', '--', ...paths], dir) ?? ''
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ''))
}

/** Commits the given paths on the current branch (the documents, before a first run). */
export function commitPaths(dir, paths, message) {
  const present = paths.filter((p) => existsSync(path.join(dir, p)))
  if (!present.length) return null
  git(['add', '-A', '--', ...present], dir)
  const staged = (gitMaybe(['diff', '--cached', '--name-only'], dir) ?? '').split('\n').filter(Boolean)
  if (!staged.length) return null
  git(['commit', '-q', '-m', message], dir)
  return git(['rev-parse', '--short', 'HEAD'], dir).trim()
}

/**
 * Creates (or reuses) the run's branch from `startPoint`, in place (checkout) or in a
 * worktree. Returns `{ workdir, worktree }`.
 */
export function openBranch(root, { branch, startPoint, worktree, unit }) {
  const exists = branchExists(root, branch)
  if (!worktree) {
    if (exists) git(['checkout', '-q', branch], root)
    else git(['checkout', '-q', '-b', branch, startPoint], root)
    return { workdir: root, worktree: null }
  }
  const dir = worktreePath(root, unit)
  if (!existsSync(dir)) {
    const args = exists ? ['worktree', 'add', '-q', dir, branch] : ['worktree', 'add', '-q', '-b', branch, dir, startPoint]
    git(args, root)
  }
  return { workdir: dir, worktree: dir }
}

/** The TASKS files of a checkout: `docs/TASKS.md` then its twins. */
export function tasksFiles(dir) {
  const docs = path.join(dir, 'docs')
  if (!existsSync(docs)) return []
  const twins = readdirSync(docs).filter((f) => /^TASKS-[A-Z]{2}\.md$/.test(f))
  return ['TASKS.md', ...twins].map((f) => path.join(docs, f)).filter((f) => existsSync(f))
}

/**
 * Applies an edit (`text → text | null`) to TASKS.md and every twin, matched by id inside
 * the edit. Returns the files changed.
 */
export function editTasks(dir, edit) {
  const changed = []
  for (const file of tasksFiles(dir)) {
    const current = readText(file)
    const next = edit(current.text)
    if (next === null || next === current.text) continue
    writeText(file, next, current.eol)
    changed.push(file)
  }
  return changed
}

export const readTasks = (dir) => {
  const f = readText(path.join(dir, 'docs', 'TASKS.md'))
  return f ? parseTasks(f.text) : null
}

/** Stages everything and returns the tree it would commit: what the checks ran against. */
export function stagedTree(dir) {
  git(['add', '-A'], dir)
  return git(['write-tree'], dir).trim()
}

/** Runs the checks in `dir`; the full log goes to `.docflow/logs/<id>.log` under `root`. */
export function runChecks(root, dir, command, id) {
  const started = Date.now()
  const { status, output } = shell(command, dir)
  const log = path.join(root, LOG_DIR, `${id}.log`)
  writeText(log, `$ ${command}\n${output}`)
  return { pass: status === 0, status, log, tail: tail(output, LOG_TAIL), ms: Date.now() - started }
}

/** Commits everything in `dir` with `<id>: <title>` and `Refs: …`; returns the short sha. */
export function commitAll(dir, subject, body) {
  git(['add', '-A'], dir)
  const args = ['commit', '-q', '-m', subject]
  if (body) args.push('-m', body)
  git(args, dir)
  return git(['rev-parse', '--short', 'HEAD'], dir).trim()
}

/** A commit subject within 72 characters. */
export function subjectOf(id, title) {
  const s = `${id}: ${title}`
  return s.length <= 72 ? s : `${s.slice(0, 71).replace(/\s+\S*$/, '')}…`
}

/** The body of the draft pull request (SPECS § 8). */
export function prBody({ unit, tasks, checks, acceptance, closes = [], stackedOn = null }) {
  const lines = []
  if (stackedOn) lines.push(`Stacked on ${stackedOn}: merge that one first.`, '')
  lines.push('## Tasks', '', ...tasks.map((t) => `- [${t.done ? 'x' : ' '}] ${t.id} ${t.title}`), '')
  lines.push('## Checks', '', checks ? `\`${checks}\` — passed` : 'No checks command.', '')
  if (unit.kind === 'sprint') {
    lines.push('## Acceptance', '')
    lines.push(acceptance ? `${acceptance.status} — ${acceptance.evidence}` : 'Not recorded.', '')
  }
  if (closes.length) lines.push(...closes.map((n) => `Closes #${n}`), '')
  lines.push('Draft opened by docflow: review it, then merge it yourself.')
  return lines.join('\n')
}

/** Pushes the branch and opens (or updates) its draft pull request. Returns its URL. */
export function publish(root, dir, { branch, base, title, body }) {
  git(['push', '-q', '-u', 'origin', branch], dir)
  const bodyFile = path.join(root, '.docflow', 'pr-body.md')
  writeText(bodyFile, `${body}\n`)
  const open = JSON.parse(gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url,number'], dir) || '[]')
  if (open.length) {
    gh(['pr', 'edit', String(open[0].number), '--title', title, '--body-file', bodyFile], dir)
    return open[0].url
  }
  const out = gh(['pr', 'create', '--draft', '--base', base, '--head', branch, '--title', title, '--body-file', bodyFile], dir)
  return out.trim().split('\n').pop()
}

/**
 * Leaves the run: the checkout goes back to its branch (in place), or the worktree is
 * removed when clean. Returns what was restored.
 */
export function restore(root, run) {
  if (run.worktree) {
    if (!trackedChanges(run.worktree).length && !gitMaybe(['status', '--porcelain'], run.worktree)) {
      gitMaybe(['worktree', 'remove', run.worktree], root)
      return { restored: run.origin_branch, removed: run.worktree }
    }
    return { restored: run.origin_branch, removed: null }
  }
  if (run.origin_branch && run.origin_branch !== run.branch && !trackedChanges(root).length) {
    git(['checkout', '-q', run.origin_branch], root)
    return { restored: run.origin_branch, removed: null }
  }
  return { restored: gitMaybe(['rev-parse', '--abbrev-ref', 'HEAD'], root), removed: null }
}
