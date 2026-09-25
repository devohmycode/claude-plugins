// The shared repository module, and both plugins in a folder that is not a git
// repository yet: refused with REPO= and exit code 3, then created on request.
// Run with `node --test tests/shared/`.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { REPO_EXIT, initRepo, missingFor, plannedFiles, repoState } from '../../shared/git/repo.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// A commit needs an identity; CI runners have none configured.
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}
Object.assign(process.env, IDENTITY)

let dir
const write = (rel, content = 'x\n') => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), content)
}
const plugin = (name, ...args) =>
  spawnSync('node', [path.join(ROOT, `${name}-plugin`, 'scripts', `${name}.mjs`), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGINS_LANGUAGE: 'en', CLAUDE_CONFIG_DIR: os.tmpdir() },
  })
const line = (out, key) => out.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'plugins-repo-test-'))
  write('src/app.js', 'export const x = 1\n')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('repository state', () => {
  it('tells a folder, a repository without a commit and a ready one apart', () => {
    assert.equal(repoState(dir).state, 'none')
    initRepo(dir)
    assert.deepEqual(repoState(dir), { state: 'empty', remote: false })
    assert.equal(initRepo(dir, { commit: true }).committed, 1)
    assert.deepEqual(repoState(dir), { state: 'ready', remote: false })
  })

  it('names what a command is missing', () => {
    assert.equal(missingFor({ state: 'none', remote: false }, {}), 'none')
    assert.equal(missingFor({ state: 'empty', remote: false }, { commit: true }), 'empty')
    assert.equal(missingFor({ state: 'empty', remote: true }, { remote: true }), null)
    assert.equal(missingFor({ state: 'ready', remote: false }, { commit: true, remote: true }), 'no-remote')
    assert.equal(missingFor({ state: 'ready', remote: true }, { commit: true, remote: true }), null)
  })

  it('plans a first commit without touching the folder, and flags what should not go in', () => {
    write('.env', 'TOKEN=1\n')
    write('node_modules/a/index.js')
    write('node_modules/b/index.js')
    write('ignored/secret.pem')
    write('.gitignore', 'ignored/\n')
    const { files, flagged } = plannedFiles(dir)
    assert.ok(files.includes('src/app.js'))
    assert.ok(!files.some((f) => f.startsWith('ignored/')))
    assert.deepEqual(flagged, [
      { path: '.env', files: 1 },
      { path: 'node_modules/', files: 2 },
    ])
    assert.equal(repoState(dir).state, 'none')
  })
})

describe('commands outside a repository', () => {
  it('scanner: refuses a scan with REPO=none, then scans once the repository exists', () => {
    const refused = plugin('scanner', 'prepare', 'security')
    assert.equal(refused.status, REPO_EXIT, refused.stderr)
    assert.equal(line(refused.stdout, 'REPO'), 'none')
    assert.match(refused.stderr, /not a git repository/)

    const plan = plugin('scanner', 'repo', 'plan')
    assert.equal(line(plan.stdout, 'FILES'), '1')

    const init = plugin('scanner', 'repo', 'init', '--commit')
    assert.equal(init.status, 0, init.stderr)
    assert.equal(line(init.stdout, 'REPO_STATE'), 'ready')

    const again = plugin('scanner', 'prepare', 'security')
    assert.notEqual(again.status, REPO_EXIT, again.stdout + again.stderr)
    assert.equal(line(again.stdout, 'REPO'), undefined)
    plugin('scanner', 'guard', 'off')
  })

  it('scanner: a repository without a commit is refused too (REPO=empty)', () => {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const refused = plugin('scanner', 'check')
    assert.equal(refused.status, REPO_EXIT)
    assert.equal(line(refused.stdout, 'REPO'), 'empty')
  })

  it('tracker: REPO=none, then REPO=no-remote once committed; local steps need no remote', () => {
    const none = plugin('tracker', 'triage', 'prepare', '1')
    assert.equal(none.status, REPO_EXIT)
    assert.equal(line(none.stdout, 'REPO'), 'none')

    assert.equal(plugin('tracker', 'repo', 'init', '--commit').status, 0)
    const noRemote = plugin('tracker', 'open', 'x')
    assert.equal(noRemote.status, REPO_EXIT)
    assert.equal(line(noRemote.stdout, 'REPO'), 'no-remote')
    assert.match(noRemote.stderr, /repo github/)

    // A batch's local steps (start, checks, status) work without a remote.
    const status = plugin('tracker', 'batch', 'status', 'batch-none')
    assert.notEqual(status.status, REPO_EXIT)
  })

  it('tracker: never publishes without a commit, and refuses a second remote', () => {
    const early = plugin('tracker', 'repo', 'github')
    assert.notEqual(early.status, 0)
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/x.git'], { cwd: dir })
    const twice = plugin('tracker', 'repo', 'github')
    assert.notEqual(twice.status, 0)
    assert.match(twice.stderr, /already has a remote/)
  })
})
