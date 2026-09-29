// State: schema 1, atomic writes, the mutex, approvals and the lock with expiry (SPECS § 4).

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import {
  GITIGNORE,
  LOCK_HOURS,
  StateError,
  acquireLock,
  approve,
  emptyState,
  markStale,
  readState,
  releaseLock,
  updateState,
  writeState,
} from '../../docflow/scripts/lib/state.mjs'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'docflow-state-'))
after(() => rmSync(tmp, { recursive: true, force: true }))
let n = 0
const dir = () => mkdtempSync(path.join(tmp, `s${++n}-`))

const T0 = Date.parse('2026-09-28T14:00:00Z')
const HOUR = 3600_000

describe('state file', () => {
  it('is empty and of schema 1 when absent', () => {
    assert.deepEqual(readState(dir()), emptyState())
    assert.equal(emptyState().schema, 1)
  })

  it('round-trips, with its .gitignore and no temporary file left', () => {
    const root = dir()
    const state = emptyState()
    approve(state, 'PRD', 'abcdef012345', T0)
    writeState(root, state)
    assert.deepEqual(readState(root), state)
    assert.equal(readFileSync(path.join(root, '.docflow', '.gitignore'), 'utf8'), GITIGNORE)
    assert.deepEqual(readdirSync(path.join(root, '.docflow')).sort(), ['.gitignore', 'state.json'])
  })

  it('refuses a corrupt or foreign state', () => {
    const root = dir()
    writeState(root, emptyState())
    writeFileSync(path.join(root, '.docflow', 'state.json'), '{ nope')
    assert.throws(() => readState(root), (e) => e instanceof StateError && e.code === 'corrupt')
    writeFileSync(path.join(root, '.docflow', 'state.json'), JSON.stringify({ schema: 2 }))
    assert.throws(() => readState(root), (e) => e instanceof StateError && e.code === 'invalid')
  })

  it('updates under a mutex and removes it afterwards', () => {
    const root = dir()
    const result = updateState(root, (s) => {
      approve(s, 'PRD', 'fp', T0)
      return 'done'
    })
    assert.equal(result, 'done')
    assert.equal(readState(root).docs.PRD.fingerprint, 'fp')
    assert.equal(existsSync(path.join(root, '.docflow', 'state.mutex')), false)
  })

  it('waits for a held mutex, then gives up', () => {
    const root = dir()
    writeState(root, emptyState())
    writeFileSync(path.join(root, '.docflow', 'state.mutex'), '')
    assert.throws(() => updateState(root, () => {}, { waitMs: 120 }), (e) => e.code === 'busy')
  })

  it('skips the write when the change returns false', () => {
    const root = dir()
    updateState(root, (s) => {
      approve(s, 'PRD', 'fp', T0)
      return false
    })
    assert.equal(existsSync(path.join(root, '.docflow', 'state.json')), false)
  })
})

describe('approvals', () => {
  it('records the fingerprint and clears the stale mark', () => {
    const s = emptyState()
    approve(s, 'ARCHITECTURE', 'a1', T0)
    s.docs.ARCHITECTURE.stale = true
    approve(s, 'ARCHITECTURE', 'a2', T0 + HOUR)
    assert.deepEqual(s.docs.ARCHITECTURE, { approved: '2026-09-28T15:00:00Z', fingerprint: 'a2', stale: false })
  })

  it('marks only approved, not yet stale documents', () => {
    const s = emptyState()
    approve(s, 'SPECS', 's', T0)
    approve(s, 'TASKS', 't', T0)
    s.docs.TASKS.stale = true
    assert.deepEqual(markStale(s, ['ARCHITECTURE', 'SPECS', 'TASKS']), ['SPECS'])
    assert.equal(s.docs.SPECS.stale, true)
  })
})

describe('lock', () => {
  it('is taken, renewed by its owner, refused to another session', () => {
    const s = emptyState()
    const first = acquireLock(s, 'A', { now: T0 })
    assert.equal(first.ok, true)
    assert.equal(s.lock.expires, new Date(T0 + LOCK_HOURS * HOUR).toISOString().replace('.000', ''))
    const renewed = acquireLock(s, 'A', { now: T0 + HOUR })
    assert.equal(renewed.ok, true)
    assert.equal(s.lock.since, '2026-09-28T14:00:00Z')
    assert.equal(s.lock.expires, '2026-09-28T19:00:00Z')
    const other = acquireLock(s, 'B', { now: T0 + 2 * HOUR })
    assert.deepEqual([other.ok, other.reason], [false, 'busy'])
  })

  it('asks before taking over an expired lock', () => {
    const s = emptyState()
    acquireLock(s, 'A', { now: T0 })
    const later = T0 + (LOCK_HOURS + 1) * HOUR
    assert.equal(acquireLock(s, 'B', { now: later }).reason, 'expired')
    const taken = acquireLock(s, 'B', { now: later, takeover: true })
    assert.deepEqual([taken.ok, taken.tookOver, s.lock.session], [true, true, 'B'])
  })

  it('is released by its owner only, unless expired or forced', () => {
    const s = emptyState()
    acquireLock(s, 'A', { now: T0 })
    assert.equal(releaseLock(s, 'B', { now: T0 }), false)
    assert.equal(releaseLock(s, 'B', { now: T0 + 5 * HOUR }), true)
    acquireLock(s, 'A', { now: T0 })
    assert.equal(releaseLock(s, 'B', { now: T0, force: true }), true)
    assert.equal(s.lock, null)
    assert.equal(releaseLock(s, 'A'), false)
  })
})
