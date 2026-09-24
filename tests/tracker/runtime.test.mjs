// The tracker plugin against a real git repository: the guard's decisions, and a
// batch from its plan to the finish dry run. No gh: a batch only needs its plan.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { GITHUB_WRITE, MUTATING } from '../../tracker-plugin/scripts/rules.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPTS = path.join(ROOT, 'tracker-plugin', 'scripts')
const ENV = { ...process.env, CLAUDE_PLUGINS_LANGUAGE: 'en', CLAUDE_CONFIG_DIR: os.tmpdir() }

let repo
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
const write = (rel, content) => {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
  writeFileSync(path.join(repo, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}
const tracker = (...args) =>
  spawnSync('node', [path.join(SCRIPTS, 'tracker.mjs'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...ENV, CLAUDE_PROJECT_DIR: repo },
  })
const guard = (tool, input) => {
  const r = spawnSync('node', [path.join(SCRIPTS, 'guard.mjs'), 'pre'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...ENV, CLAUDE_PROJECT_DIR: repo },
    input: JSON.stringify({ cwd: repo, tool_name: tool, tool_input: input }),
  })
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision : 'allow'
}
const line = (out, key) => out.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]

before(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'tracker-test-'))
  git('init', '-q', '-b', 'dev')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('src/app.js', 'export const x = 1\n')
  write('.tracker/config.json', {
    batch: { checks: ['node -e "process.exit(0)"'] },
    guard: { writeDenied: ['content/**'], protectedBranches: ['main'] },
  })
  write('.gitignore', '.tracker/\n')
  git('add', 'src/app.js', '.gitignore')
  git('commit', '-q', '-m', 'init')
})

after(() => {
  try {
    git('worktree', 'prune')
  } catch {}
  rmSync(repo, { recursive: true, force: true })
})

describe('command patterns', () => {
  it('recognizes writes to GitHub, not reads', () => {
    for (const c of ['gh issue close 12', 'gh pr create --draft', 'gh label create x', 'gh api -X PATCH repos/o/r', 'gh issue comment 3 --body x'])
      assert.ok(GITHUB_WRITE.some((re) => re.test(c)), c)
    for (const c of ['gh issue view 12', 'gh issue list --label x', 'gh pr view 3', 'gh api repos/o/r/issues'])
      assert.ok(!GITHUB_WRITE.some((re) => re.test(c)), c)
  })

  it('recognizes mutating commands during a triage', () => {
    assert.ok(MUTATING.some((re) => re.test('git commit -m x')))
    assert.ok(!MUTATING.some((re) => re.test('git log --oneline')))
  })
})

describe('guard', () => {
  it('does nothing when no guard is armed', () => {
    assert.equal(guard('Bash', { command: 'gh issue close 1' }), 'allow')
  })

  it('during a triage: read-only tree, run directory writable, no GitHub write', () => {
    write('.tracker/state.json', { mode: 'triage', run: 't1', writeAllowed: ['.tracker/runs/t1/**'] })
    assert.equal(guard('Write', { file_path: path.join(repo, 'src/app.js') }), 'deny')
    assert.equal(guard('Write', { file_path: path.join(repo, '.tracker/runs/t1/verdict-1.json') }), 'allow')
    assert.equal(guard('Bash', { command: 'gh issue close 1' }), 'deny')
    assert.equal(guard('Bash', { command: 'git commit -m x' }), 'deny')
    assert.equal(guard('Bash', { command: 'git log -3' }), 'allow')
    write('.tracker/state.json', '{}')
  })

  it('during a batch: denied paths, no push, no GitHub write', () => {
    write('.tracker/state.json', { mode: 'batch', run: 'b1', batch: 'B1', writeDenied: ['content/**'], protectedBranches: ['main'] })
    assert.equal(guard('Write', { file_path: path.join(repo, 'content/a.md') }), 'deny')
    assert.equal(guard('Edit', { file_path: path.join(repo, 'src/app.js') }), 'allow')
    assert.equal(guard('Bash', { command: 'git push origin fix/x' }), 'deny')
    assert.equal(guard('Bash', { command: 'gh pr create --draft' }), 'deny')
    write('.tracker/state.json', '{}')
  })
})

describe('batch', () => {
  it('starts a worktree on a new branch, runs checks, reports, and refuses to push while armed', () => {
    const run = 'batch-test'
    write(`.tracker/runs/${run}/plan.json`, {
      run,
      base: 'dev',
      batches: [{ id: 'B1', group: 'src', issues: [{ number: 7, title: 'x is wrong', priority: 'P1', location: 'src/app.js:1' }] }],
    })
    write(`.tracker/runs/${run}/issue-7.json`, { number: 7, title: 'x is wrong', body: '', labels: [] })

    const start = tracker('batch', 'start', run, 'B1')
    assert.equal(start.status, 0, start.stderr)
    const worktree = line(start.stdout, 'WORKTREE')
    const branch = line(start.stdout, 'BRANCH')
    assert.match(branch, /^fix\/tracker-src-\d{8}$/)
    assert.ok(existsSync(path.join(worktree, 'src/app.js')))
    assert.equal(line(start.stdout, 'FIXER'), 'tracker:fixer')

    // What a fixer does: one commit, one outcome file.
    writeFileSync(path.join(worktree, 'src/app.js'), 'export const x = 2\n')
    execFileSync('git', ['-C', worktree, 'commit', '-qam', 'fix: x\n\nCloses #7'])
    write(`.tracker/runs/${run}/outcome-7.json`, { number: 7, status: 'fixed', commit: 'abc', reason: 'x fixed' })

    const checks = tracker('batch', 'checks', run, 'B1')
    assert.equal(line(checks.stdout, 'CHECKS'), 'pass', checks.stdout + checks.stderr)

    const status = tracker('batch', 'status', run)
    assert.match(status.stdout, /#7 fixed/)
    assert.match(status.stdout, /1 commit\(s\)/)

    const armed = tracker('batch', 'finish', run, 'B1', '--push')
    assert.notEqual(armed.status, 0)
    assert.match(armed.stderr, /guard off/)

    assert.equal(tracker('guard', 'off').status, 0)
    const dry = tracker('batch', 'finish', run, 'B1')
    assert.equal(dry.status, 0, dry.stderr)
    assert.equal(line(dry.stdout, 'TITLE'), 'fix(src): #7')
    assert.match(dry.stdout, /Nothing was pushed/)
  })
})
