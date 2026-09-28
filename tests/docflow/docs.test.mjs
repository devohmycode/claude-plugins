// Documents: skeletons (golden files), the section index, extraction, fingerprints,
// links, statuses and `check` (SPECS § 2, § 4). UPDATE_GOLDEN=1 rewrites the golden files.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CHAIN,
  changedSince,
  basisOf,
  checkDoc,
  chunks,
  docFingerprint,
  docName,
  docStatuses,
  fingerprint,
  indexSections,
  links,
  linkLines,
  refreshLinks,
  section,
  sectionFingerprints,
  skeleton,
  unfilled,
} from '../../docflow/scripts/lib/docs.mjs'
import { emptyState } from '../../docflow/scripts/lib/state.mjs'
import { read, workspace, write } from './helpers.mjs'

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden')
const ws = workspace('docflow-docs-')
after(() => ws.cleanup())
const NOW = Date.parse('2026-09-28T12:00:00Z')
let n = 0
const project = () => path.join(ws.dir, `p${++n}`)

function golden(name, actual) {
  const file = path.join(GOLDEN, name)
  if (process.env.UPDATE_GOLDEN || !existsSync(file)) {
    mkdirSync(GOLDEN, { recursive: true })
    writeFileSync(file, actual)
  }
  assert.equal(actual, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), `golden ${name}`)
}

const SAMPLE = [
  '# P — Specifications',
  '',
  '| | |',
  '|---|---|',
  '| Status | Draft |',
  '',
  'Chain: [PRD](PRD.md) → **SPECS**.',
  '',
  '## 1. Files',
  '',
  'Text of one.',
  '',
  '### 1.1 Paths',
  '',
  'Paths.',
  '',
  '```text',
  '## 9. Not a heading',
  '```',
  '',
  '## 2. Limits',
  '',
  '| Measure | Limit |',
  '',
  '### Unnumbered',
  '',
  'Tail.',
  '',
].join('\n')

describe('skeletons', () => {
  for (const doc of CHAIN)
    it(`writes the ${doc} skeleton`, () => {
      const root = project()
      const r = skeleton(root, doc, { langs: ['fr'], now: NOW, project: 'Demo' })
      assert.equal(r.created, true)
      golden(`${doc.toLowerCase()}.md`, read(root, `docs/${doc}.md`))
    })

  it('writes the adopt variants', () => {
    const root = project()
    skeleton(root, 'ARCHITECTURE', { adopt: true, now: NOW, project: 'Demo' })
    skeleton(root, 'TASKS', { adopt: true, now: NOW, project: 'Demo' })
    golden('architecture.adopt.md', read(root, 'docs/ARCHITECTURE.md'))
    golden('tasks.adopt.md', read(root, 'docs/TASKS.md'))
  })

  it('never overwrites an existing document', () => {
    const root = project()
    write(root, 'docs/PRD.md', 'mine\n')
    assert.equal(skeleton(root, 'PRD').created, false)
    assert.equal(read(root, 'docs/PRD.md'), 'mine\n')
  })
})

describe('sections', () => {
  it('indexes numbered, sprint and unnumbered headings, not those in code', () => {
    const { sections, preambleEnd } = indexSections(SAMPLE)
    assert.deepEqual(sections.map((s) => s.id), ['1', '1.1', '2', '#4'])
    assert.equal(preambleEnd, 8)
    const tasks = indexSections('# T\n\n## How to work\n\nx\n\n## S1 — One\n\n## S2 — Two\n')
    assert.deepEqual(tasks.sections.map((s) => [s.id, s.title]), [['#1', 'How to work'], ['S1', 'One'], ['S2', 'Two']])
  })

  it('extracts a section up to the next heading of the same or a higher level', () => {
    assert.equal(section(SAMPLE, '1'), SAMPLE.split('\n').slice(8, 19).join('\n'))
    assert.equal(section(SAMPLE, '§ 1.1'), '### 1.1 Paths\n\nPaths.\n\n```text\n## 9. Not a heading\n```')
    assert.equal(section(SAMPLE, '9'), null)
  })

  it('cuts chunks at every heading', () => {
    assert.deepEqual(chunks(SAMPLE).map((c) => c.id), ['1', '1.1', '2', '#4'])
    assert.equal(chunks(SAMPLE)[0].text, '## 1. Files\n\nText of one.')
  })

  it('finds unfilled sections and relative links', () => {
    const text = '# T\n\nSee [a](A.md), [web](https://x.y), [top](#1).\n\n## 1. One\n\n<!-- docflow:todo fill -->\n\n## 2. Two\n\n`[no](NO.md)` [b](../b.md#x)\n'
    assert.deepEqual(unfilled(text).map((u) => u.id), ['1'])
    assert.deepEqual(links(text).map((l) => l.target), ['A.md', '../b.md#x'])
  })
})

describe('fingerprints', () => {
  it('ignores line endings and trailing spaces', () => {
    assert.equal(fingerprint('a  \r\nb\n\n'), fingerprint('a\nb'))
    assert.equal(fingerprint('a'), fingerprint('a').slice(0, 12))
    assert.equal(fingerprint('a').length, 12)
    assert.notEqual(fingerprint('a'), fingerprint('b'))
  })

  it('ignores what the script changes in TASKS.md', () => {
    const before = '## S1 — X\n\n- [ ] **S1-T1** Do.\n- [ ] **S1 acceptance** — Test.\n'
    const after = '## S1 — X\n\n- [x] **S1-T1** (#12) Do.\n- [x] **S1 acceptance** (#13) — Test.\n  *Result (2026-09-28): passed — ok.*\n'
    assert.equal(docFingerprint('TASKS', before), docFingerprint('TASKS', after))
    assert.notEqual(docFingerprint('PRD', before), docFingerprint('PRD', after))
    assert.deepEqual(sectionFingerprints('TASKS', before), sectionFingerprints('TASKS', after))
  })

  it('fingerprints each chunk', () => {
    const a = sectionFingerprints('SPECS', SAMPLE)
    const b = sectionFingerprints('SPECS', SAMPLE.replace('Paths.', 'Other paths.'))
    assert.deepEqual(Object.keys(a).sort(), ['#4', '1', '1.1', '2'])
    assert.deepEqual(Object.keys(a).filter((id) => a[id] !== b[id]), ['1.1'])
  })
})

describe('links', () => {
  it('builds the link lines of an English document and of a twin', () => {
    assert.deepEqual(linkLines('SPECS', 'en', ['fr', 'de']), [
      'French version: [SPECS-FR.md](SPECS-FR.md).',
      'German version: [SPECS-DE.md](SPECS-DE.md).',
      'Chain: [PRD](PRD.md) → [ARCHITECTURE](ARCHITECTURE.md) → **SPECS** → [TASKS](TASKS.md).',
    ])
  })

  it('rewrites the link lines when the translations change', () => {
    const root = project()
    skeleton(root, 'PRD', { langs: ['fr'], now: NOW, project: 'Demo' })
    const text = read(root, 'docs/PRD.md')
    const updated = refreshLinks(text, 'PRD', 'en', ['es'])
    assert.match(updated, /Spanish version: \[PRD-ES\.md\]/)
    assert.doesNotMatch(updated, /French version/)
    assert.equal(refreshLinks(updated, 'PRD', 'en', ['es']), updated)
  })

  it('knows the names of the documents', () => {
    assert.deepEqual(['prd', 'SPECS', 'docs/TASKS-FR.md', 'nope'].map(docName), ['PRD', 'SPECS', 'TASKS', null])
  })
})

describe('statuses', () => {
  it('goes from missing to draft, approved, then stale after an earlier edit', () => {
    const root = project()
    const state = emptyState()
    assert.equal(docStatuses(root, state).PRD.status, 'missing')
    write(root, 'docs/PRD.md', '# P — PRD\n\n## 1. Vision\n\nv1\n')
    write(root, 'docs/ARCHITECTURE.md', '# P — Technical design\n\n## 1. Principles\n\np\n')
    assert.equal(docStatuses(root, state).PRD.status, 'draft')
    const st = docStatuses(root, state)
    state.docs.PRD = { approved: 'x', fingerprint: st.PRD.fingerprint, stale: false }
    state.docs.ARCHITECTURE = { approved: 'x', fingerprint: st.ARCHITECTURE.fingerprint, stale: false, basis: basisOf(root, 'ARCHITECTURE') }
    assert.deepEqual([docStatuses(root, state).PRD.status, docStatuses(root, state).ARCHITECTURE.status], ['approved', 'approved'])
    write(root, 'docs/PRD.md', '# P — PRD\n\n## 1. Vision\n\nv2\n')
    const after = docStatuses(root, state)
    assert.deepEqual([after.PRD.status, after.ARCHITECTURE.status], ['draft', 'stale'])
    assert.deepEqual(changedSince(root, 'ARCHITECTURE', state.docs.ARCHITECTURE), ['PRD § 1'])
  })
})

describe('check', () => {
  it('reports the unfilled sections of a skeleton, and nothing once filled', () => {
    const root = project()
    skeleton(root, 'PRD', { now: NOW, project: 'Demo' })
    const problems = checkDoc(root, 'PRD')
    assert.equal(problems.length, 8)
    assert.ok(problems.every((p) => p.key === 'unfilled'))
    write(root, 'docs/PRD.md', read(root, 'docs/PRD.md').replace(/<!-- docflow:todo[^>]*-->/g, 'Filled.'))
    assert.deepEqual(checkDoc(root, 'PRD'), [])
  })

  it('reports missing sections, a missing limits section and broken links', () => {
    const root = project()
    write(root, 'docs/PRD.md', '# P — PRD\n\n## 1. Vision\n\nSee [x](missing.md) and [SPECS](SPECS.md).\n')
    const keys = checkDoc(root, 'PRD').map((p) => p.key)
    assert.equal(keys.filter((k) => k === 'missingSection').length, 7)
    assert.ok(keys.includes('brokenLink'))
    write(root, 'docs/SPECS.md', '# P — Specifications\n\n## 1. Files\n\nx\n')
    assert.deepEqual(checkDoc(root, 'SPECS').map((p) => p.key), ['noLimits'])
  })

  it('checks the grammar, ids, acceptance tests and references of TASKS.md', () => {
    const root = project()
    write(root, 'docs/SPECS.md', '# P — Specifications\n\n## 1. Files\n\n## 2. Limits\n')
    write(
      root,
      'docs/TASKS.md',
      [
        '# P — Tasks',
        '',
        '## How to work on this file',
        '',
        '- [ ] not a task, outside sprints',
        '',
        '## S1 — One',
        '',
        '- [ ] **S1-T1** Good. Refs: SPECS § 2.',
        '- [ ] **S1-T1** Twice. Refs: SPECS § 7.',
        '- [ ] S1-T2 no bold',
        '- [ ] **S2-T1** Misplaced.',
        '',
        '## S2 — Two',
        '',
        '- [ ] **S2 acceptance** — Only a test.',
        '',
      ].join('\n')
    )
    const keys = checkDoc(root, 'TASKS').map((p) => `${p.key}:${p.line}`)
    assert.deepEqual(keys.sort(), [
      'badRef:10',
      'duplicateId:10',
      'emptySprint:14',
      'noAcceptance:7',
      'taskGrammar:11',
      'wrongSprint:12',
    ])
  })

  it('passes on docflow’s own documents', () => {
    const own = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docflow')
    for (const doc of ['PRD', 'SPECS', 'TASKS']) assert.deepEqual(checkDoc(own, doc), [], doc)
  })
})
