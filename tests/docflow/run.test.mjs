// The implementation engine: TASKS.md edits, then a run end to end — do start → task show
// → do check → do commit → do acceptance → do result → do finish — in place and in a
// worktree; failed checks and --resume; the lock; the hooks (PRD § 6.4–6.5, SPECS § 5, § 8).

import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { docFingerprint } from '../../docflow/scripts/lib/docs.mjs'
import { branchName, prBody, worktreePath } from '../../docflow/scripts/lib/run.mjs'
import { isManual, nextUnit, parseTasks, recordResult, setDone, setIssue } from '../../docflow/scripts/lib/tasks.mjs'
import { docflow, ghData, git, hook, makeRepo, read, workspace, write } from './helpers.mjs'

const ws = workspace('docflow-run-')
after(() => ws.cleanup())

const TASKS = [
  '# demo — Tasks',
  '',
  '## How to work on this file',
  '',
  '- Through /docflow:do.',
  '',
  '## S1 — Placement',
  '',
  '- [ ] **S1-T1** Add the adder. Refs: SPECS § 1.',
  '  *Done when* add(2, 3) is 5.',
  '- [ ] **S1-T2** Add the doubler. Refs: SPECS § 2.',
  '- [ ] **S1 acceptance** — node -e prints 10.',
  '',
  '## S2 — Later',
  '',
  '- [ ] **S2-T1** Something else.',
  '- [ ] **S2 acceptance** — (manual) look at it.',
  '',
].join('\n')

const SPECS = '# demo — Specifications\n\n## 1. Adder\n\nadd(a, b) returns a + b.\n\n## 2. Limits\n\ndouble(x) returns 2x.\n'
const CHECK = "import fs from 'node:fs'\nif (fs.existsSync('broken')) { console.error('broken!'); process.exit(1) }\nconsole.log('ok')\n"

/** A repository whose four documents are committed and approved, with a remote and checks. */
function project(name, { langs = [], commit = true } = {}) {
  const repo = makeRepo(ws, {
    name,
    remote: true,
    files: { 'package.json': JSON.stringify({ name, scripts: { test: 'node check.mjs' } }), 'check.mjs': CHECK },
  })
  const docs = {
    PRD: '# demo — PRD\n\n## 1. Vision\n\nv\n',
    ARCHITECTURE: '# demo — Technical design\n\n## 1. Principles\n\np\n',
    SPECS,
    TASKS,
  }
  const state = { schema: 1, docs: {}, translations: {}, lock: null, run: null, guard: null, pending: [] }
  for (const [doc, text] of Object.entries(docs)) {
    write(repo, `docs/${doc}.md`, text)
    state.docs[doc] = { approved: '2026-09-28T10:00:00Z', fingerprint: docFingerprint(doc, text), stale: false }
  }
  for (const lang of langs)
    write(repo, `docs/TASKS-${lang.toUpperCase()}.md`, TASKS.replace('# demo — Tasks', '# demo — Tâches').replace('Add the adder', "Ajouter l'additionneur"))
  write(repo, '.docflow/state.json', JSON.stringify(state))
  write(repo, '.docflow/.gitignore', '*\n!config.json\n!.gitignore\n')
  assert.equal(docflow(ws, repo, ['claude-md']).keys.CLAUDE_MD, 'created')
  if (commit) {
    git(['add', '-A'], repo)
    git(['commit', '-q', '-m', 'docs'], repo)
    git(['push', '-q'], repo)
  }
  return repo
}

/** Implements and commits one task through the script. */
function implement(repo, workdir, id, file, content) {
  write(workdir, file, content)
  const check = docflow(ws, repo, ['do', 'check', id])
  assert.equal(check.keys.CHECKS, 'pass', check.stdout)
  const commit = docflow(ws, repo, ['do', 'commit', id])
  assert.equal(commit.code, 0, commit.stdout)
  return commit
}

describe('TASKS.md edits', () => {
  it('ticks, records results and issue numbers by id', () => {
    let text = setDone(TASKS, 'S1-T2', true)
    assert.match(text, /- \[x\] \*\*S1-T2\*\* Add the doubler/)
    assert.equal(setDone(TASKS, 'S9-T9', true), null)
    text = recordResult(text, 'S1', 'passed', 'printed 10.', '2026-09-28')
    assert.match(text, /- \[x\] \*\*S1 acceptance\*\* — node -e prints 10\.\n {2}\*Result \(2026-09-28\): passed — printed 10\.\*/)
    text = recordResult(text, 'S1', 'failed', 'printed 11', '2026-09-29')
    assert.match(text, /- \[ \] \*\*S1 acceptance\*\*[^\n]*\n {2}\*Result \(2026-09-29\): failed — printed 11\.\*\n\n## S2/)
    text = setIssue(setIssue(text, 'S1-T1', 12), 'S1-T1', 14)
    assert.match(text, /\*\*S1-T1\*\* \(#14\) Add the adder/)
    const parsed = parseTasks(text)
    assert.equal(parsed.items.find((i) => i.id === 'S1-T1').issue, 14)
    assert.equal(parsed.items.find((i) => i.id === 'S1-T1').doneWhen, 'add(2, 3) is 5')
  })

  it('picks the next unit by mode, skipping pending ones', () => {
    const parsed = parseTasks(setDone(TASKS, 'S1-T1', true))
    assert.equal(nextUnit(parsed, 'next', { mode: 'task' }).id, 'S1-T2')
    const sprint = nextUnit(parsed, 'next', { mode: 'sprint' })
    assert.deepEqual([sprint.id, sprint.tasks.map((t) => t.id)], ['S1', ['S1-T2']])
    assert.equal(nextUnit(parsed, 'next', { skip: ['S1'] }).id, 'S2')
    assert.equal(nextUnit(parsed, 'S9'), null)
    assert.equal(nextUnit(parsed, 'S1-T1').done, true)
    assert.equal(isManual('(manual) look at it'), true)
    assert.equal(isManual('node -e prints 10'), false)
  })

  it('names branches and worktrees as SPECS § 8 says', () => {
    assert.equal(branchName('docflow/', 'S2', 'Placement & drop rules — v2'), 'docflow/S2-placement-drop-rules-v2')
    assert.equal(
      branchName('docflow/', 'S2-T3', 'A very long title that goes on and on beyond forty characters'),
      'docflow/S2-T3-a-very-long-title-that-goes-on-and-on'
    )
    assert.equal(worktreePath(path.join('x', 'repo'), 'S2'), path.join('x', 'repo.docflow', 'S2'))
  })

  it('builds the pull request body', () => {
    const body = prBody({
      unit: { kind: 'sprint' },
      tasks: [{ id: 'S1-T1', title: 'A', done: true }],
      checks: 'npm test',
      acceptance: { status: 'passed', evidence: 'printed 10' },
      closes: [4, 5],
    })
    assert.match(body, /- \[x\] S1-T1 A/)
    assert.match(body, /`npm test` — passed/)
    assert.match(body, /passed — printed 10/)
    assert.match(body, /Closes #4\nCloses #5/)
  })
})

describe('a sprint run in place', () => {
  it('implements, checks, ticks, commits, records the acceptance and opens a draft pull request', () => {
    const repo = project('inplace')
    const mainBefore = git(['rev-parse', 'main'], repo)
    const start = docflow(ws, repo, ['do', 'start', 'next'])
    assert.equal(start.code, 0, start.stdout)
    assert.deepEqual(
      [start.keys.UNIT, start.keys.KIND, start.keys.TASKS, start.keys.BRANCH, start.keys.IMPLEMENTER, start.keys.ACCEPTANCE, start.keys.CHECKS],
      ['S1', 'sprint', 'S1-T1,S1-T2', 'docflow/S1-placement', 'session', '1', 'npm test']
    )
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo), 'docflow/S1-placement')

    const show = docflow(ws, repo, ['task', 'show', 'S1-T1'])
    assert.match(show.stdout, /^- \[ \] \*\*S1-T1\*\* Add the adder\. Refs: SPECS § 1\.\n {2}\*Done when\* add\(2, 3\) is 5\.\n\n<!-- SPECS § 1 -->\n## 1\. Adder\n\nadd\(a, b\) returns a \+ b\./)
    assert.doesNotMatch(show.stdout, /## 2\. Limits/, 'only the referenced section')

    const c1 = implement(repo, repo, 'S1-T1', 'add.mjs', 'export const add = (a, b) => a + b\n')
    assert.equal(c1.keys.TICKED, 'S1-T1')
    assert.equal(c1.keys.REMAINING, 'S1-T2')
    assert.match(read(repo, 'docs/TASKS.md'), /- \[x\] \*\*S1-T1\*\*/)
    assert.equal(git(['log', '-1', '--format=%B'], repo), 'S1-T1: Add the adder\n\nRefs: SPECS § 1.')
    assert.deepEqual(git(['show', '--name-only', '--format=', 'HEAD'], repo).split('\n').sort(), ['add.mjs', 'docs/TASKS.md'])

    // A commit without passing checks, or after a change, is refused.
    write(repo, 'double.mjs', 'export const double = (x) => 2 * x\n')
    assert.equal(docflow(ws, repo, ['do', 'commit', 'S1-T2']).keys.ERROR, 'not-checked')
    assert.equal(docflow(ws, repo, ['do', 'check', 'S1-T2']).keys.CHECKS, 'pass')
    write(repo, 'double.mjs', 'export const double = (x) => x + x\n')
    assert.equal(docflow(ws, repo, ['do', 'commit', 'S1-T2']).keys.ERROR, 'changed')

    // A failing check stops the run; --resume continues it.
    write(repo, 'broken', 'x')
    const failed = docflow(ws, repo, ['do', 'check', 'S1-T2'])
    assert.deepEqual([failed.code, failed.keys.CHECKS], [5, 'fail'])
    assert.equal(failed.keys.LOG, '.docflow/logs/S1-T2.log')
    assert.ok(failed.messages.includes('broken!'))
    assert.equal(docflow(ws, repo, ['status']).keys.RUN, 'failed:S1')
    assert.doesNotMatch(read(repo, 'docs/TASKS.md'), /- \[x\] \*\*S1-T2\*\*/)
    rmSync(path.join(repo, 'broken'))
    const resumed = docflow(ws, repo, ['do', 'start', '--resume'])
    assert.deepEqual([resumed.code, resumed.keys.TASKS], [0, 'S1-T2'])
    implement(repo, repo, 'S1-T2', 'double.mjs', 'export const double = (x) => 2 * x\n')

    const test = docflow(ws, repo, ['do', 'acceptance', 'S1'])
    assert.deepEqual([test.keys.TEST, test.keys.MANUAL, test.keys.AGENT, test.keys.MODEL], ['node -e prints 10.', '0', 'docflow:acceptance', 'sonnet'])
    assert.equal(docflow(ws, repo, ['do', 'finish']).keys.ERROR, 'no-acceptance')
    const result = docflow(ws, repo, ['do', 'result', 'S1', 'passed', 'node -e printed 10'])
    assert.deepEqual([result.keys.RECORDED, result.keys.TICKED], ['S1', '1'])
    assert.match(read(repo, 'docs/TASKS.md'), /- \[x\] \*\*S1 acceptance\*\* — node -e prints 10\.\n {2}\*Result \(\d{4}-\d{2}-\d{2}\): passed — node -e printed 10\.\*/)

    const finish = docflow(ws, repo, ['do', 'finish'])
    assert.equal(finish.code, 0, finish.stdout)
    assert.equal(finish.keys.PR, 'https://github.com/test/project/pull/1')
    assert.equal(finish.keys.RESTORED, 'main')
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo), 'main')
    assert.equal(git(['rev-parse', 'main'], repo), mainBefore, 'the default branch is unchanged')
    assert.equal(git(['rev-parse', 'origin/main'], repo), mainBefore)
    assert.ok(git(['ls-remote', 'origin', 'docflow/S1-placement'], repo))
    const [pr] = ghData(ws).prs
    assert.deepEqual([pr.isDraft, pr.base, pr.head, pr.title], [true, 'main', 'docflow/S1-placement', 'S1: Placement'])
    assert.match(pr.body, /- \[x\] S1-T1 Add the adder\n- \[x\] S1-T2 Add the doubler/)
    assert.match(pr.body, /`npm test` — passed/)
    assert.match(pr.body, /passed — node -e printed 10/)

    const status = docflow(ws, repo, ['status'])
    assert.deepEqual([status.keys.RUN, status.keys.PENDING, status.keys.NEXT], ['none', 'S1', '/docflow:do next'])
    assert.match(status.messages.at(-1), /S2/)
  })
})

describe('a task run in a worktree', () => {
  it('leaves the checkout alone, ticks the twin, removes the worktree at the end', () => {
    const repo = project('worktree', { langs: ['fr'] })
    const start = docflow(ws, repo, ['do', 'start', 'S1-T1', '--worktree'])
    assert.equal(start.code, 0, start.stdout)
    const workdir = start.keys.WORKDIR
    assert.equal(path.resolve(workdir), path.resolve(ws.dir, 'worktree.docflow', 'S1-T1'))
    assert.equal(start.keys.BRANCH, 'docflow/S1-T1-add-the-adder')
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo), 'main')
    implement(repo, workdir, 'S1-T1', 'add.mjs', 'export const add = (a, b) => a + b\n')
    assert.match(read(workdir, 'docs/TASKS-FR.md'), /- \[x\] \*\*S1-T1\*\* Ajouter l'additionneur/)
    assert.doesNotMatch(read(repo, 'docs/TASKS.md'), /\[x\]/, 'the main checkout is untouched')
    const finish = docflow(ws, repo, ['do', 'finish'])
    assert.equal(finish.code, 0, finish.stdout)
    assert.equal(existsSync(workdir), false)
    assert.equal(ghData(ws).prs.at(-1).title, 'S1-T1: Add the adder')
  })
})

describe('preconditions and the lock', () => {
  it('refuses to start before TASKS.md is approved, or with uncommitted documents', () => {
    const repo = project('pre', { commit: false })
    const dirty = docflow(ws, repo, ['do', 'start', 'next'])
    assert.equal(dirty.keys.ERROR, 'docs-uncommitted')
    const ok = docflow(ws, repo, ['do', 'start', 'next', '--commit-docs'])
    assert.equal(ok.code, 0, ok.stdout)
    assert.equal(git(['log', '-1', '--format=%s', 'main'], repo), 'docs: docflow documents')
    docflow(ws, repo, ['do', 'abort'])
    write(repo, 'docs/TASKS.md', `${TASKS}\n## S3 — More\n\n- [ ] **S3-T1** More.\n- [ ] **S3 acceptance** — more.\n`)
    const gate = docflow(ws, repo, ['do', 'start', 'next'])
    assert.deepEqual([gate.code, gate.keys.GATE], [4, 'TASKS'])
  })

  it('lets one run at a time hold the repository', () => {
    const repo = project('lock')
    assert.equal(docflow(ws, repo, ['do', 'start', 'next']).code, 0)
    const other = docflow(ws, repo, ['do', 'start', '--resume'], { CLAUDE_CODE_SESSION_ID: 'other' })
    assert.deepEqual([other.code, other.keys.ERROR], [75, 'lock-busy'])
    assert.equal(docflow(ws, repo, ['do', 'start', 'S2']).keys.ERROR, 'run-active')
    const abort = docflow(ws, repo, ['do', 'abort'])
    assert.deepEqual([abort.keys.ABORTED, abort.keys.RESTORED], ['S1', 'main'])
    assert.equal(docflow(ws, repo, ['do', 'start', 'next'], { CLAUDE_CODE_SESSION_ID: 'other' }).code, 0)
  })
})

describe('the guard', () => {
  it('refuses pushes to the default branch, forced pushes, merges and edits of approved documents during a run', () => {
    const repo = project('guard')
    const bash = (command, extra = {}) => hook(ws, 'pre', { session_id: 'session-test', cwd: repo, tool_name: 'Bash', tool_input: { command }, ...extra })
    const edit = (file) => hook(ws, 'pre', { session_id: 'session-test', cwd: repo, tool_name: 'Edit', tool_input: { file_path: path.join(repo, file) } })
    const denied = (r) => r.json?.hookSpecificOutput?.permissionDecision === 'deny'

    assert.equal(denied(bash('gh pr merge 1')), false, 'no run: everything goes through')
    docflow(ws, repo, ['do', 'start', 'next'])
    assert.equal(denied(bash('git push origin main')), true)
    assert.equal(denied(bash('git push origin HEAD:main')), true)
    assert.equal(denied(bash('git push -f origin docflow/S1-placement')), true)
    assert.equal(denied(bash('git push --force-with-lease')), true)
    assert.equal(denied(bash('git push -u origin docflow/S1-placement')), false)
    assert.equal(denied(bash('npm test && gh pr merge 3 --squash')), true)
    assert.equal(denied(bash('git commit -m wip')), false, 'on the run branch')
    git(['checkout', '-q', 'main'], repo)
    assert.equal(denied(bash('git commit -m wip')), true, 'on the default branch')
    assert.equal(denied(bash('git push')), true, 'the current branch is the default one')
    git(['checkout', '-q', 'docflow/S1-placement'], repo)
    assert.equal(denied(edit('docs/SPECS.md')), true)
    assert.equal(denied(edit('docs/TASKS.md')), true)
    assert.equal(denied(edit('src/app.mjs')), false)
    assert.equal(denied(bash('git push origin main', { session_id: 'another' })), false, 'another session')
    assert.match(bash('gh pr merge 1').json.hookSpecificOutput.permissionDecisionReason, /^\[docflow\] gh pr merge is refused/)
  })

  it('refuses to stop while the current task is neither ticked nor failed', () => {
    const repo = project('stop')
    const stop = (extra = {}) => hook(ws, 'stop', { session_id: 'session-test', cwd: repo, ...extra })
    docflow(ws, repo, ['do', 'start', 'next'])
    assert.equal(stop().json, null, 'no current task yet')
    docflow(ws, repo, ['task', 'show', 'S1-T1'])
    assert.equal(stop().json?.decision, 'block')
    assert.equal(stop({ stop_hook_active: true }).json, null, 'never twice in a row')
    assert.equal(stop({ session_id: 'another' }).json, null)
    docflow(ws, repo, ['do', 'fail', 'S1-T1', 'needs a decision'])
    assert.equal(stop().json, null)
    assert.equal(docflow(ws, repo, ['status']).keys.RUN, 'failed:S1')
  })
})
