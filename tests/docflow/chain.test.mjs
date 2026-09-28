// The document chain end to end through the script: stage, section, check, approve with
// the gate and staleness, the CLAUDE.md block, adopt mode (PRD § 6.1, SPECS § 5, § 7).

import assert from 'node:assert/strict'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { MAX_LINES, blockLines, writeBlock } from '../../docflow/scripts/lib/claudemd.mjs'
import { docflow, makeRepo, read, workspace, write } from './helpers.mjs'

const ws = workspace('docflow-chain-')
after(() => ws.cleanup())

/** Replaces every `docflow:todo` marker of a document with some text. */
function fill(repo, doc, text = 'Filled by the test.') {
  const file = `docs/${doc}.md`
  write(repo, file, read(repo, file).replace(/<!-- docflow:todo[\s\S]*?-->/g, text))
}

const TASKS_BODY = [
  '- [ ] **S1-T1** Build the thing. Refs: SPECS § 1, ARCHITECTURE § 3.',
  '  *Done when* it builds.',
  '- [ ] **S1-T2** Test the thing. Refs: SPECS § 5.',
  '- [ ] **S1 acceptance** — The thing works end to end.',
].join('\n')

/** Runs the chain up to and including `last`, approving each document. */
function chain(repo, last = 'tasks') {
  for (const stage of ['prd', 'architecture', 'specs', 'tasks']) {
    const r = docflow(ws, repo, ['stage', stage])
    assert.equal(r.code, 0, r.stdout)
    fill(repo, stage === 'prd' ? 'PRD' : stage.toUpperCase(), stage === 'tasks' ? TASKS_BODY : undefined)
    const a = docflow(ws, repo, ['approve', stage])
    assert.equal(a.code, 0, a.stdout)
    if (stage === last) break
  }
}

describe('stage', () => {
  it('writes the skeleton and says what to read and fill', () => {
    const repo = makeRepo(ws, { name: 'stage' })
    const r = docflow(ws, repo, ['stage', 'prd'])
    assert.equal(r.code, 0)
    assert.equal(r.keys.DOC, 'docs/PRD.md')
    assert.equal(r.keys.CREATED, '1')
    assert.equal(r.keys.INPUTS, '')
    assert.equal(r.keys.SECTIONS, '1,2,3,4,5,6,7,8')
    assert.equal(r.keys.WRITER, 'session')
    assert.match(read(repo, 'docs/PRD.md'), /^# stage — Product Requirements Document/)
    const again = docflow(ws, repo, ['stage', 'prd'])
    assert.deepEqual([again.keys.CREATED, again.keys.STATUS], ['0', 'draft'])
  })

  it('refuses a document whose predecessor is not approved (exit 4)', () => {
    const repo = makeRepo(ws, { name: 'gate' })
    const r = docflow(ws, repo, ['stage', 'architecture'])
    assert.deepEqual([r.code, r.keys.GATE], [4, 'PRD'])
    docflow(ws, repo, ['stage', 'prd'])
    assert.equal(docflow(ws, repo, ['stage', 'architecture']).code, 4)
  })

  it('needs a repository (exit 3)', () => {
    const plain = path.join(ws.dir, 'no-repo')
    write(plain, 'x.txt', 'x')
    const r = docflow(ws, plain, ['stage', 'prd'])
    assert.deepEqual([r.code, r.keys.REPO], [3, 'none'])
  })

  it('points each stage at its inputs', () => {
    const repo = makeRepo(ws, { name: 'inputs' })
    chain(repo, 'specs')
    const r = docflow(ws, repo, ['stage', 'tasks'])
    assert.equal(r.keys.INPUTS, 'ARCHITECTURE § 6,SPECS headings')
    const plan = docflow(ws, repo, ['section', 'ARCHITECTURE', '§', '6'])
    assert.match(plan.stdout, /^## 6\. Delivery plan/)
    const headings = docflow(ws, repo, ['section', 'SPECS', 'headings'])
    assert.equal(headings.stdout.trim().split('\n').length, 5)
    assert.equal(docflow(ws, repo, ['section', 'SPECS 9']).code, 2)
    assert.equal(docflow(ws, repo, ['section', 'NOPE']).code, 2)
  })

  it('asks for the writer agent when its model is set', () => {
    const repo = makeRepo(ws, { name: 'writer' })
    docflow(ws, repo, ['config', 'writer_model', 'sonnet'])
    const r = docflow(ws, repo, ['stage', 'prd'])
    assert.deepEqual([r.keys.WRITER, r.keys.AGENT, r.keys.MODEL], ['agent', 'docflow:writer', 'sonnet'])
  })
})

describe('check and approve', () => {
  it('refuses to approve an unfilled document, then approves it', () => {
    const repo = makeRepo(ws, { name: 'approve' })
    docflow(ws, repo, ['stage', 'prd'])
    const refused = docflow(ws, repo, ['approve', 'prd'])
    assert.deepEqual([refused.code, refused.keys.ISSUES], [1, '8'])
    assert.equal(docflow(ws, repo, ['check', 'prd']).code, 1)
    fill(repo, 'PRD')
    assert.equal(docflow(ws, repo, ['status']).keys.NEXT, '/docflow:approve prd')
    const ok = docflow(ws, repo, ['approve', 'prd'])
    assert.equal(ok.code, 0)
    assert.equal(ok.keys.APPROVED, 'PRD')
    assert.equal(ok.keys.NEXT, '/docflow:architecture')
    assert.equal(docflow(ws, repo, ['status']).keys.DOC_PRD, 'approved')
    assert.deepEqual(docflow(ws, repo, ['check']).keys.ISSUES, '0')
  })

  it('runs the whole chain; every document links to its neighbours; check reports nothing', () => {
    const repo = makeRepo(ws, { name: 'full' })
    chain(repo)
    const status = docflow(ws, repo, ['status'])
    for (const doc of ['PRD', 'ARCHITECTURE', 'SPECS', 'TASKS']) assert.equal(status.keys[`DOC_${doc}`], 'approved')
    assert.equal(status.keys.NEXT, '/docflow:claude-md')
    for (const doc of ['PRD', 'ARCHITECTURE', 'SPECS', 'TASKS']) {
      const text = read(repo, `docs/${doc}.md`)
      for (const other of ['PRD', 'ARCHITECTURE', 'SPECS', 'TASKS'].filter((d) => d !== doc)) assert.match(text, new RegExp(`\\[${other}\\]\\(${other}\\.md\\)`))
    }
    assert.equal(docflow(ws, repo, ['check']).keys.ISSUES, '0')
    const md = docflow(ws, repo, ['claude-md'])
    assert.deepEqual([md.keys.CLAUDE_MD, md.code], ['created', 0])
    assert.ok(Number(md.keys.LINES) <= 40)
    const after = docflow(ws, repo, ['status'])
    assert.deepEqual([after.keys.CLAUDE_MD, after.keys.NEXT, after.keys.SPRINT], ['present', '/docflow:do next', 'S1'])
    assert.match(read(repo, 'CLAUDE.md'), /- Next: `\/docflow:do next` — S1 — First sprint\./)
    assert.equal(docflow(ws, repo, ['claude-md']).keys.CLAUDE_MD, 'unchanged')
  })

  it('marks the following documents stale when an approved one changes', () => {
    const repo = makeRepo(ws, { name: 'stale' })
    chain(repo)
    write(repo, 'docs/PRD.md', read(repo, 'docs/PRD.md').replace('## 2. Problem\n\nFilled by the test.', '## 2. Problem\n\nA new problem.'))
    let status = docflow(ws, repo, ['status'])
    assert.deepEqual(
      [status.keys.DOC_PRD, status.keys.DOC_ARCHITECTURE, status.keys.DOC_SPECS, status.keys.DOC_TASKS],
      ['draft', 'stale', 'stale', 'stale']
    )
    const a = docflow(ws, repo, ['approve', 'prd'])
    assert.equal(a.keys.STALE, 'ARCHITECTURE,SPECS,TASKS')
    status = docflow(ws, repo, ['status'])
    assert.deepEqual([status.keys.DOC_PRD, status.keys.DOC_ARCHITECTURE, status.keys.NEXT], ['approved', 'stale', '/docflow:architecture'])
    const stage = docflow(ws, repo, ['stage', 'architecture'])
    assert.deepEqual([stage.keys.STATUS, stage.keys.CHANGED, stage.keys.SECTIONS], ['stale', 'PRD § 2', ''])
    assert.equal(docflow(ws, repo, ['approve', 'architecture']).keys.STALE, '', 'unchanged: nothing more is stale')
    assert.equal(docflow(ws, repo, ['status']).keys.DOC_ARCHITECTURE, 'approved')
  })

  it('does not count ticks as edits of TASKS.md', () => {
    const repo = makeRepo(ws, { name: 'ticks' })
    chain(repo)
    write(repo, 'docs/TASKS.md', read(repo, 'docs/TASKS.md').replace('- [ ] **S1-T1**', '- [x] **S1-T1** (#4)'))
    assert.equal(docflow(ws, repo, ['status']).keys.DOC_TASKS, 'approved')
  })
})

describe('CLAUDE.md block', () => {
  it('keeps the rest of the file and stays under 40 lines', () => {
    const repo = makeRepo(ws, { name: 'claudemd' })
    write(repo, 'CLAUDE.md', '# Rules\n\nKeep this.\n')
    const lines = blockLines({ langs: ['fr', 'es', 'de'], base: 'dev', next: '`/docflow:do next`' })
    assert.ok(lines.length <= MAX_LINES)
    assert.equal(writeBlock(repo, lines).status, 'created')
    const text = read(repo, 'CLAUDE.md')
    assert.match(text, /^# Rules\n\nKeep this\.\n\n<!-- docflow:start -->/)
    assert.match(text, /never push to `dev`/)
    assert.match(text, /French: \[PRD\]\(docs\/PRD-FR\.md\)/)
    assert.equal(writeBlock(repo, blockLines({ base: 'main' })).status, 'updated')
    assert.match(read(repo, 'CLAUDE.md'), /^# Rules\n\nKeep this\.\n\n<!-- docflow:start -->[\s\S]*<!-- docflow:end -->\n$/)
    assert.doesNotMatch(read(repo, 'CLAUDE.md'), /French/)
  })
})

describe('adopt mode', () => {
  it('summarises the code base and pre-ticks S1 of TASKS.md', () => {
    const repo = makeRepo(ws, {
      name: 'adopt',
      files: {
        'package.json': JSON.stringify({ name: 'app', scripts: { test: 'node --test', build: 'tsc' }, dependencies: { express: '1' } }),
        'src/index.ts': 'export {}\n',
        'src/app.ts': 'export {}\n',
        'tests/app.test.ts': 'test\n',
      },
    })
    const prd = docflow(ws, repo, ['stage', 'prd', '--adopt'])
    assert.deepEqual([prd.keys.ADOPT, prd.keys.INPUTS], ['1', 'LAYOUT'])
    const layout = docflow(ws, repo, ['layout'])
    assert.match(layout.stdout, /Languages: TypeScript 3/)
    assert.match(layout.stdout, /- src\/ 2/)
    assert.match(layout.stdout, /package\.json scripts: test, build/)
    assert.match(layout.stdout, /Checks: npm test/)
    assert.equal(docflow(ws, repo, ['section', 'LAYOUT']).stdout, layout.stdout)
    fill(repo, 'PRD')
    docflow(ws, repo, ['approve', 'prd'])
    const arch = docflow(ws, repo, ['stage', 'architecture'])
    assert.deepEqual([arch.keys.ADOPT, arch.keys.INPUTS], ['1', 'PRD,LAYOUT'])
    assert.match(read(repo, 'docs/ARCHITECTURE.md'), /## 1\. Starting point/)
    fill(repo, 'ARCHITECTURE')
    docflow(ws, repo, ['approve', 'architecture'])
    docflow(ws, repo, ['stage', 'specs'])
    fill(repo, 'SPECS')
    docflow(ws, repo, ['approve', 'specs'])
    const tasks = docflow(ws, repo, ['stage', 'tasks'])
    assert.equal(tasks.keys.INPUTS, 'ARCHITECTURE § 7,SPECS headings')
    assert.match(read(repo, 'docs/TASKS.md'), /- \[x\] \*\*S1-T1\*\*/)
    fill(repo, 'TASKS', TASKS_BODY.replaceAll('S1', 'S2'))
    assert.equal(docflow(ws, repo, ['approve', 'tasks']).code, 0)
    assert.equal(docflow(ws, repo, ['status']).keys.SPRINT, 'S2')
  })
})
