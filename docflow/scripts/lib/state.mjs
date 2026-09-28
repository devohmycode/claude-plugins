// The state of a project (SPECS § 4): `.docflow/state.json`, never committed.
//
//   docs          approvals: when, the fingerprint approved, whether a later edit of a
//                 preceding document made it stale
//   translations  per document and language, the fingerprint of each English section
//                 the twin was last translated from
//   lock          one run at a time per repository: owner session, since, expires
//   run           the running unit: tasks, done, status, base, branch, worktree…
//   guard         what the hooks guard while a run holds the lock: session, root, worktree
//
// Every write goes through a temporary file and a rename; `updateState` also holds a
// short-lived mutex file so that two scripts never interleave a read and a write.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isoTime, sleepSync, writeAtomic } from './util.mjs'

export const DOCFLOW_DIR = '.docflow'
export const STATE_FILE = '.docflow/state.json'
export const SCHEMA = 1
export const LOCK_HOURS = 4
export const GITIGNORE = '*\n!config.json\n!.gitignore\n'
export const RUN_STATUSES = ['running', 'failed', 'finishing']

export class StateError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.code = code
    this.detail = detail
  }
}

/** `pending`: finished runs whose draft pull request is not merged yet (`unit`, `branch`, `pr`). */
export const emptyState = () => ({ schema: SCHEMA, docs: {}, translations: {}, lock: null, run: null, guard: null, pending: [] })

/** Creates `.docflow/` and its `.gitignore` (state ignored, config kept). */
export function ensureDocflowDir(root) {
  const dir = path.join(root, DOCFLOW_DIR)
  mkdirSync(dir, { recursive: true })
  const ignore = path.join(dir, '.gitignore')
  if (!existsSync(ignore)) writeFileSync(ignore, GITIGNORE, 'utf8')
  return dir
}

/** Checks the shape of a state; returns a list of problems. */
export function validateState(state) {
  const problems = []
  if (!state || typeof state !== 'object') return ['not an object']
  if (state.schema !== SCHEMA) problems.push(`schema ${state.schema} (expected ${SCHEMA})`)
  for (const key of ['docs', 'translations'])
    if (state[key] != null && (typeof state[key] !== 'object' || Array.isArray(state[key]))) problems.push(`${key} must be an object`)
  if (state.run && !RUN_STATUSES.includes(state.run.status)) problems.push(`run.status "${state.run.status}"`)
  if (state.lock && (typeof state.lock.since !== 'string' || typeof state.lock.expires !== 'string')) problems.push('lock needs since and expires')
  return problems
}

/** The state of `root`; an empty one when the file does not exist. Throws StateError when unusable. */
export function readState(root) {
  const file = path.join(root, STATE_FILE)
  if (!existsSync(file)) return emptyState()
  let state
  try {
    state = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new StateError('corrupt', e.message)
  }
  const problems = validateState(state)
  if (problems.length) throw new StateError('invalid', problems.join('; '))
  return { ...emptyState(), ...state }
}

export function writeState(root, state) {
  ensureDocflowDir(root)
  writeAtomic(path.join(root, STATE_FILE), JSON.stringify(state, null, 2) + '\n')
}

const MUTEX_STALE_MS = 30_000

/**
 * Reads the state, lets `fn` change it, writes it back — under a mutex file, so that a
 * concurrent script waits. `fn` returns its result; returning `false` skips the write.
 */
export function updateState(root, fn, { waitMs = 5000 } = {}) {
  const mutex = path.join(ensureDocflowDir(root), 'state.mutex')
  const deadline = Date.now() + waitMs
  let fd
  for (;;) {
    try {
      fd = openSync(mutex, 'wx')
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        if (Date.now() - statSync(mutex).mtimeMs > MUTEX_STALE_MS) rmSync(mutex, { force: true })
      } catch {}
      if (Date.now() > deadline) throw new StateError('busy', mutex)
      sleepSync(50)
    }
  }
  try {
    const state = readState(root)
    const result = fn(state)
    if (result !== false) writeState(root, state)
    return result
  } finally {
    closeSync(fd)
    rmSync(mutex, { force: true })
  }
}

// ─── Approvals ──────────────────────────────────────────────────────────────

/** Records the approval of `doc` with the fingerprint of its approved text. */
export function approve(state, doc, fingerprint, now = Date.now()) {
  state.docs[doc] = { approved: isoTime(now), fingerprint, stale: false }
  return state.docs[doc]
}

/** Marks the approved documents among `docs` as stale; returns those marked. */
export function markStale(state, docs) {
  const marked = []
  for (const doc of docs) {
    const entry = state.docs[doc]
    if (entry?.approved && !entry.stale) {
      entry.stale = true
      marked.push(doc)
    }
  }
  return marked
}

// ─── Lock ───────────────────────────────────────────────────────────────────

export const lockExpired = (lock, now = Date.now()) => !!lock && Date.parse(lock.expires) <= now

/**
 * Takes the lock for `session`. A lock held by the same session is renewed. Another
 * session's lock refuses (`busy`), unless it expired and `takeover` is set (`expired`
 * otherwise: the command asks the user first).
 */
export function acquireLock(state, session, { now = Date.now(), takeover = false } = {}) {
  const held = state.lock
  if (held && held.session !== session) {
    if (!lockExpired(held, now)) return { ok: false, reason: 'busy', lock: held }
    if (!takeover) return { ok: false, reason: 'expired', lock: held }
  }
  const since = held && held.session === session ? held.since : isoTime(now)
  state.lock = { session, since, expires: isoTime(now + LOCK_HOURS * 3600_000) }
  return { ok: true, lock: state.lock, tookOver: !!held && held.session !== session }
}

/** Releases the lock; a lock of another, live session is left alone. */
export function releaseLock(state, session, { now = Date.now(), force = false } = {}) {
  const held = state.lock
  if (!held) return false
  if (!force && held.session !== session && !lockExpired(held, now)) return false
  state.lock = null
  return true
}
