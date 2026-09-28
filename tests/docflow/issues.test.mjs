// The GitHub issues mirror (PRD § 6.8, SPECS § 5, § 8): push creates each issue once and
// writes its number into TASKS.md and its twins; the key is the one the tracker plugin
// reads; a run's draft pull request closes the issues of what it ticked; pull reports the
// issues closed or reopened by hand and, with --apply, follows them.

import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { keysInBody } from '../../docflow/scripts/findings.mjs'
import { docFingerprint } from '../../docflow/scripts/lib/docs.mjs'
import { bodyFor, keyOf, labelsFor, pullPlan, pushPlan, titleFor } from '../../docflow/scripts/lib/issues.mjs'
import { parseTasks, setDone, setIssue } from '../../docflow/scripts/lib/tasks.mjs'
import { docflow, ghData, git, makeRepo, read, setGhData, workspace, write } from './helpers.mjs'

const ws = workspace('docflow-issues-')
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
const CHECK = "console.log('ok')\n"

/** A repository with its four documents approved and committed, a remote, a French twin. */
function project(name) {
  const repo = makeRepo(ws, {
    name,
    remote: true,
    files: { 'package.json': JSON.stringify({ name, scripts: { test: 'node check.mjs' } }), 'check.mjs': CHECK },
  })
  const docs = { PRD: '# demo — PRD\n\n## 1. Vision\n\nv\n', ARCHITECTURE: '# demo — Technical design\n\n## 1. Principles\n\np\n', SPECS, TASKS }
  const state = { schema: 1, docs: {}, translations: {}, lock: null, run: null, guard: null, pending: [] }
  for (const [doc, text] of Object.entries(docs)) {
    write(repo, `docs/${doc}.md`, text)
    state.docs[doc] = { approved: '2026-09-28T10:00:00Z', fingerprint: docFingerprint(doc, text), stale: false }
  }
  write(repo, 'docs/TASKS-FR.md', TASKS.replace('# demo — Tasks', '# demo — Tâches').replace('Add the adder', "Ajouter l'additionneur"))
  write(repo, '.docflow/state.json', JSON.stringify(state))
  write(repo, '.docflow/.gitignore', '*\n!config.json\n!.gitignore\n')
  assert.equal(docflow(ws, repo, ['config', 'issues', 'mirror']).code, 0)
  assert.equal(docflow(ws, repo, ['claude-md']).keys.CLAUDE_MD, 'created')
  git(['add', '-A'], repo)
  git(['commit', '-q', '-m', 'docs'], repo)
  git(['push', '-q'], repo)
  setGhData(ws, { prs: [], issues: [], labels: [], calls: [] })
  return repo
}

describe('issue plans', () => {
  const parsed = parseTasks(TASKS)
  const item = (id) => parsed.items.find((i) => i.id === id)

  it('writes the title, labels and body of SPECS § 8, with a key the tracker reads', () => {
    assert.equal(titleFor(item('S1-T1')), 'S1-T1 Add the adder')
    assert.equal(titleFor(item('S1 acceptance')), 'S1 acceptance — node -e prints 10')
    assert.deepEqual(labelsFor(item('S1-T2')), ['docflow', 'sprint:S1'])
    assert.deepEqual(labelsFor(item('S2 acceptance')), ['docflow', 'sprint:S2', 'acceptance'])
    const body = bodyFor(item('S1-T1'))
    assert.match(body, /^\*\*S1-T1\*\* Add the adder\. Refs: SPECS § 1\. \*Done when\* add\(2, 3\) is 5\./)
    assert.match(body, /- SPECS § 1/)
    assert.match(body, /<!-- tracker:key=id:docflow-S1-T1 -->$/)
    assert.deepEqual(keysInBody(body), ['id:docflow-S1-T1'])
    assert.deepEqual(keysInBody(bodyFor(item('S1 acceptance'))), [keyOf('S1 acceptance')])
  })

  it('keeps the body when the entry is ticked or numbered', () => {
    const numbered = parseTasks(setIssue(setDone(TASKS, 'S1-T1', true), 'S1-T1', 7))
    assert.equal(bodyFor(numbered.items[0]), bodyFor(item('S1-T1')))
  })

  it('plans a push: create the unticked, update what changed, leave a ticked entry without issue', () => {
    const ticked = parseTasks(setDone(TASKS, 'S2-T1', true))
    const issues = [
      { number: 3, title: 'S1-T1 Old title', body: bodyFor(item('S1-T1')), state: 'OPEN', labels: [{ name: 'docflow' }, { name: 'sprint:S1' }] },
      { number: 4, title: titleFor(item('S1-T2')), body: bodyFor(item('S1-T2')), state: 'OPEN', labels: ['docflow', 'sprint:S1'] },
      { number: 9, title: 'duplicate', body: bodyFor(item('S1-T2')), state: 'OPEN', labels: [] },
    ]
    const plan = pushPlan(ticked, issues)
    assert.deepEqual(plan.create.map((i) => i.id), ['S1 acceptance', 'S2 acceptance'])
    assert.deepEqual(plan.update.map((u) => [u.item.id, u.issue.number]), [['S1-T1', 3]])
    assert.deepEqual(plan.unchanged.map((i) => i.id), ['S1-T2'])
    assert.deepEqual(plan.numbers, [{ id: 'S1-T1', number: 3 }, { id: 'S1-T2', number: 4 }])
  })

  it('plans a pull: closed while unticked, open while ticked, by key or by number', () => {
    const text = setIssue(setDone(TASKS, 'S1-T2', true), 'S2-T1', 12)
    const issues = [
      { number: 3, title: '', body: bodyFor(item('S1-T1')), state: 'CLOSED', labels: [] },
      { number: 4, title: '', body: bodyFor(item('S1-T2')), state: 'OPEN', labels: [] },
      { number: 12, title: '', body: 'written by hand', state: 'CLOSED', labels: [] },
    ]
    const plan = pullPlan(parseTasks(text), issues)
    assert.deepEqual(plan.closed.map((c) => c.item.id), ['S1-T1', 'S2-T1'])
    assert.deepEqual(plan.reopened.map((c) => c.item.id), ['S1-T2'])
  })
})

describe('issues push and pull', () => {
  it('refuses while the mirror is off', () => {
    const repo = project('off')
    docflow(ws, repo, ['config', 'issues', 'off'])
    const r = docflow(ws, repo, ['issues', 'push'])
    assert.equal(r.code, 1)
    assert.equal(r.keys.ERROR, 'issues-off')
    assert.equal(ghData(ws).calls.length, 0)
  })

  it('creates each issue once, writes the numbers, and updates a changed title', () => {
    const repo = project('push')
    const first = docflow(ws, repo, ['issues', 'push'])
    assert.equal(first.code, 0, first.stdout)
    assert.equal(first.keys.CREATED, 'S1-T1,S1-T2,S1 acceptance,S2-T1,S2 acceptance')
    const db = ghData(ws)
    assert.equal(db.issues.length, 5)
    assert.deepEqual([...db.labels].sort(), ['acceptance', 'docflow', 'sprint:S1', 'sprint:S2'])
    const byKey = Object.fromEntries(db.issues.map((i) => [keysInBody(i.body)[0], i]))
    assert.equal(byKey['id:docflow-S1-T1'].title, 'S1-T1 Add the adder')
    assert.deepEqual(byKey['id:docflow-S2-acceptance'].labels, ['docflow', 'sprint:S2', 'acceptance'])
    const n = byKey['id:docflow-S1-T1'].number
    assert.match(read(repo, 'docs/TASKS.md'), new RegExp(`\\*\\*S1-T1\\*\\* \\(#${n}\\) Add the adder`))
    assert.match(read(repo, 'docs/TASKS-FR.md'), new RegExp(`\\*\\*S1-T1\\*\\* \\(#${n}\\) Ajouter`))
    // Issue numbers are not an edit of the approved TASKS.md.
    assert.equal(docflow(ws, repo, ['status']).keys.DOC_TASKS, 'approved')

    const again = docflow(ws, repo, ['issues', 'push'])
    assert.equal(again.keys.CREATED, '')
    assert.equal(again.keys.UPDATED, '')
    assert.equal(again.keys.UNCHANGED, '5')
    assert.equal(ghData(ws).issues.length, 5)

    write(repo, 'docs/TASKS.md', read(repo, 'docs/TASKS.md').replace('Add the doubler', 'Add the tripler'))
    const edited = docflow(ws, repo, ['issues', 'push'])
    assert.equal(edited.keys.UPDATED, 'S1-T2')
    assert.ok(ghData(ws).issues.some((i) => i.title === 'S1-T2 Add the tripler'))
  })

  it('reports issues closed or reopened by hand, and follows them on --apply', () => {
    const repo = project('pull')
    docflow(ws, repo, ['issues', 'push'])
    assert.equal(docflow(ws, repo, ['issues', 'pull']).keys.CLOSED, '')
    const db = ghData(ws)
    const t1 = db.issues.find((i) => i.title.startsWith('S1-T1'))
    t1.state = 'CLOSED'
    setGhData(ws, db)
    const report = docflow(ws, repo, ['issues', 'pull'])
    assert.equal(report.code, 0)
    assert.equal(report.keys.CLOSED, 'S1-T1')
    assert.equal(report.keys.APPLIED, '0')
    assert.match(read(repo, 'docs/TASKS.md'), /- \[ \] \*\*S1-T1\*\*/)
    const applied = docflow(ws, repo, ['issues', 'pull', '--apply'])
    assert.equal(applied.keys.APPLIED, '1')
    assert.match(read(repo, 'docs/TASKS.md'), /- \[x\] \*\*S1-T1\*\*/)
    assert.match(read(repo, 'docs/TASKS-FR.md'), /- \[x\] \*\*S1-T1\*\*/)
    t1.state = 'OPEN'
    setGhData(ws, db)
    assert.equal(docflow(ws, repo, ['issues', 'pull']).keys.REOPENED, 'S1-T1')
  })

  it("closes the sprint's issues from its draft pull request, the acceptance only once ticked", () => {
    const repo = project('closes')
    docflow(ws, repo, ['issues', 'push'])
    const number = (prefix) => ghData(ws).issues.find((i) => i.title.startsWith(prefix)).number
    const start = docflow(ws, repo, ['do', 'start', 'S1', '--commit-docs'])
    assert.equal(start.code, 0, start.stdout)
    for (const [id, file] of [['S1-T1', 'add.mjs'], ['S1-T2', 'double.mjs']]) {
      write(repo, file, 'export default 1\n')
      assert.equal(docflow(ws, repo, ['do', 'check', id]).keys.CHECKS, 'pass')
      assert.equal(docflow(ws, repo, ['do', 'commit', id]).code, 0)
    }
    assert.equal(docflow(ws, repo, ['do', 'result', 'S1', 'passed', 'printed 10']).code, 0)
    const finish = docflow(ws, repo, ['do', 'finish'])
    assert.equal(finish.code, 0, finish.stdout)
    const body = ghData(ws).prs.at(-1).body
    for (const prefix of ['S1-T1', 'S1-T2', 'S1 acceptance']) assert.match(body, new RegExp(`Closes #${number(prefix)}\\b`))
    assert.doesNotMatch(body, new RegExp(`Closes #${number('S2-T1')}\\b`))
  })

  it('refuses during a run, since the run owns TASKS.md', () => {
    const repo = project('during')
    assert.equal(docflow(ws, repo, ['do', 'start', 'S1']).code, 0)
    const r = docflow(ws, repo, ['issues', 'push'])
    assert.equal(r.keys.ERROR, 'run-active')
    assert.equal(ghData(ws).calls.length, 0)
  })
})
