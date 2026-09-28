// The scope of an armed guard: the session that armed it, and the project it was armed in.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { commandDirs, concerns, normalizeDir, within } from '../../shared/guard/scope.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const project = path.resolve(os.tmpdir(), 'scope-project')
const other = path.resolve(os.tmpdir(), 'scope-other')
const bash = (command, extra = {}) => ({ tool_name: 'Bash', tool_input: { command }, cwd: project, ...extra })

describe('guard scope', () => {
  it('reads the moves of a command: cd, pushd, git -C, quoted or not', () => {
    const dirs = commandDirs(`cd "${other}" && git push; pushd sub && git -C '${project}' log`, project)
    assert.deepEqual(dirs, [other, path.join(project, 'sub'), project])
    assert.equal(within(path.join(project, 'a', 'b'), project), true)
    assert.equal(within(`${project}-sibling`, project), false, 'a sibling with the same prefix is outside')
    if (process.platform === 'win32') assert.equal(normalizeDir('/c/Users/x'), 'c:/Users/x')
  })

  it('lets through a call from another session, never one from the arming session', () => {
    const state = { mode: 'batch', session: 'A' }
    assert.equal(concerns(state, bash('git push', { session_id: 'B' }), project), false)
    assert.equal(concerns(state, bash('git push', { session_id: 'A' }), project), true)
    assert.equal(concerns({ mode: 'batch' }, bash('git push', { session_id: 'B' }), project), true, 'no recorded session: every session')
  })

  it('lets through a command aimed at another repository, not one that comes back', () => {
    const state = { mode: 'batch', session: 'A', worktree: path.join(project, '.tracker', 'worktrees', 'w') }
    const call = (c) => concerns(state, bash(c, { session_id: 'A' }), project)
    assert.equal(call(`cd ${other} && git push -u origin x`), false)
    assert.equal(call(`git -C ${other} push`), false)
    assert.equal(call(`cd ${other} && cd ${project} && git push`), true, 'one move back into the project is enough')
    assert.equal(call(`cd "${state.worktree}" && git commit -m x`), true)
    assert.equal(call('git push'), true)
  })

  it('lets through a file written outside the project and its worktree', () => {
    const state = { mode: 'triage', session: 'A' }
    const write = (file) => concerns(state, { tool_name: 'Write', tool_input: { file_path: file }, cwd: project, session_id: 'A' }, project)
    assert.equal(write(path.join(other, 'x.md')), false)
    assert.equal(write(path.join(project, 'src', 'x.ts')), true)
  })
})

describe('the tracker guard, scoped', () => {
  let repo
  before(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'scope-guard-'))
    mkdirSync(path.join(repo, '.tracker'), { recursive: true })
    writeFileSync(path.join(repo, '.tracker', 'state.json'), JSON.stringify({ mode: 'batch', run: 'b1', batch: 'B1', session: 'A', writeDenied: [], protectedBranches: [] }))
  })
  after(() => rmSync(repo, { recursive: true, force: true }))

  const decide = (input) => {
    const r = spawnSync('node', [path.join(ROOT, 'tracker-plugin', 'scripts', 'guard.mjs'), 'pre'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGINS_LANGUAGE: 'en', CLAUDE_CONFIG_DIR: os.tmpdir() },
      input: JSON.stringify({ cwd: repo, tool_name: 'Bash', ...input }),
    })
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision : 'allow'
  }

  it('refuses a push in its session and its repository only', () => {
    assert.equal(decide({ session_id: 'A', tool_input: { command: 'git push origin x' } }), 'deny')
    assert.equal(decide({ session_id: 'B', tool_input: { command: 'git push origin x' } }), 'allow')
    assert.equal(decide({ session_id: 'A', tool_input: { command: `cd ${other} && git push origin x` } }), 'allow')
    assert.equal(decide({ session_id: 'A', tool_input: { command: `cd ${other} && gh pr create --draft` } }), 'allow')
  })
})
