// The findings contract and the decisions of the tracker plugin: pure functions,
// no git, no gh. Run with `node --test tests/tracker/`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  keyComment,
  keysInBody,
  normalizeFindings,
  validateFindings,
} from '../../tracker-plugin/scripts/findings.mjs'
import {
  DEFAULT_CONFIG,
  agentOf,
  bodyOf,
  commitIn,
  i18nFor,
  issueFacets,
  labelsOf,
  locationIn,
  merge,
  priorityOf,
  reportIn,
  titleOf,
} from '../../tracker-plugin/scripts/lib.mjs'
import {
  areaOf,
  capSelection,
  decideTriage,
  groupBatches,
  parseSelector,
  planOpen,
  planSync,
  slug,
  sortIssues,
  triageGroups,
  triageReference,
} from '../../tracker-plugin/scripts/plan.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EXAMPLE = JSON.parse(readFileSync(path.join(ROOT, 'tracker-plugin/examples/config.json'), 'utf8'))
const plain = merge(DEFAULT_CONFIG, {})
const french = merge(DEFAULT_CONFIG, EXAMPLE)

const scan = (findings, extra = {}) => ({
  run: 'security-20260923-2039',
  type: 'security',
  scope: 'full',
  commit: '5108ef59',
  branch: 'dev',
  finished: '2026-09-23T19:10:00Z',
  report: 'docs/reports/scan-security.html',
  findings,
  ...extra,
})
const finding = (id, severity, fingerprint, extra = {}) => ({
  id,
  title: 'The guest list publishes family relatives',
  severity,
  file: 'lib/data/strip.ts',
  line: 33,
  rule: 'scope-leak',
  description: 'Finding.',
  fingerprint,
  verdict: 'confirmed',
  ...extra,
})
const audit = (findings) => ({
  kind: 'audit',
  agent: 'repo-auditor',
  report: 'docs/reports/audit-2026-09-24.html',
  commit: 'abc1234',
  finished: '2026-09-24T14:30:00Z',
  findings,
})

describe('findings contract', () => {
  it('accepts a scanner final.json and an audit file', () => {
    assert.deepEqual(validateFindings(scan([finding('F1', 'critical', 'aaaaaaaaaaaaaaaa')])), [])
    assert.deepEqual(
      validateFindings(audit([{ id: 'SEC-48', title: 'T', severity: 'high', description: 'D' }])),
      []
    )
  })

  it('refuses an id that is neither a fingerprint nor a series id, a bad severity, a duplicate key', () => {
    const problems = validateFindings(
      audit([
        { id: 'U-1', title: 'T', severity: 'high', description: 'D' },
        { id: 'SEC-2', title: 'T', severity: 'grave', description: 'D' },
        { id: 'SEC-2', title: 'T', severity: 'low', description: 'D' },
      ])
    ).join('\n')
    assert.match(problems, /series identifier/)
    assert.match(problems, /unknown severity "grave"/)
    assert.match(problems, /appears twice/)
  })

  it('reads keys back from comments and visible lines, in every language', () => {
    const body = [
      keyComment('fp:1111111111111111'),
      'empreinte `2222222222222222`',
      'huella `3333333333333333`',
      'Fingerabdruck `4444444444444444`',
      'identifiant `SEC-48` · identifier `PER-7` · Kennung `SAV-2`',
    ].join('\n')
    assert.deepEqual(keysInBody(body).sort(), [
      'fp:1111111111111111',
      'fp:2222222222222222',
      'fp:3333333333333333',
      'fp:4444444444444444',
      'id:PER-7',
      'id:SAV-2',
      'id:SEC-48',
    ])
  })
})

describe('from a finding to an issue', () => {
  it('reproduces the French labels and title of the example config', () => {
    const [f] = normalizeFindings(scan([finding('F1', 'critical', '5a7d9bffc4345f4f')]))
    assert.equal(priorityOf(french, f), 'P0')
    assert.deepEqual(labelsOf(french, f), ['axe: sécurité', 'sévérité: critique', 'priorité: P0', 'scan local 23/09'])
    assert.equal(titleOf(french, f), 'fix(sécurité) : the guest list publishes family relatives')
  })

  it('derives the axis of an audit finding from its series, and accepts a label name as axis', () => {
    const [a, b] = normalizeFindings(
      audit([
        { id: 'SAV-24', title: 'Backups', severity: 'medium', description: 'D' },
        { id: 'XYZ-1', title: 'T', severity: 'high', description: 'D', axis: 'qualité-tests' },
      ])
    )
    assert.deepEqual(labelsOf(french, a).slice(0, 3), ['axe: sauvegardes', 'sévérité: moyenne', 'priorité: P2'])
    assert.equal(titleOf(french, a), 'fix(sauvegardes) : SAV-24 — backups')
    assert.equal(priorityOf(french, b), 'P2')
  })

  it('writes the key into the body, and keeps it when the body is truncated', () => {
    const [f] = normalizeFindings(
      scan([finding('F1', 'low', 'dddddddddddddddd', { description: 'x'.repeat(80_000) })])
    )
    const body = bodyOf(plain, f, i18nFor('en'))
    assert.ok(body.length <= 60_000)
    assert.deepEqual(keysInBody(body), ['fp:dddddddddddddddd'])
    assert.equal(locationIn(body), 'lib/data/strip.ts:33')
    assert.equal(reportIn(body), 'docs/reports/scan-security.html#F1')
  })

  it('reads priority, severity and axis back from labels', () => {
    assert.deepEqual(issueFacets(french, [{ name: 'priorité: P1' }, 'sévérité: élevée', 'axe: qualité-tests']), {
      priority: 'P1',
      severity: 'high',
      axis: 'tests',
    })
  })
})

describe('open', () => {
  const findings = normalizeFindings(
    scan([
      finding('F1', 'critical', '1111111111111111'),
      finding('F2', 'high', '2222222222222222'),
      finding('F3', 'low', '3333333333333333'),
      finding('F4', 'high', '4444444444444444', { verdict: 'refuted' }),
      finding('F5', 'info', '5555555555555555'),
    ])
  )
  const closedAfter = { number: 292, state: 'CLOSED', closedAt: '2026-09-24T10:00:00Z', body: 'empreinte `1111111111111111`' }

  it('sorts findings into fresh, known and dismissed — a closed issue counts as known', () => {
    const plan = planOpen(findings, [closedAfter])
    assert.deepEqual(plan.known.map((k) => k.issue.number), [292])
    assert.deepEqual(plan.fresh.map((f) => f.id), ['F2', 'F3'])
    assert.deepEqual(plan.dismissed.map((d) => d.reason).sort(), ['severity:info', 'verdict:refuted'])
    assert.deepEqual(plan.regressed, [])
  })

  it('flags a finding that is back after its issue was closed', () => {
    const plan = planOpen(findings, [{ ...closedAfter, closedAt: '2026-09-20T10:00:00Z' }])
    assert.deepEqual(plan.regressed.map((r) => r.issue.number), [292])
  })

  it('is idempotent: the issues it created are enough to propose nothing more', () => {
    const first = planOpen(findings, [closedAfter])
    const created = first.fresh.map((f, i) => ({ number: 500 + i, state: 'OPEN', body: bodyOf(plain, f, i18nFor('en')) }))
    assert.deepEqual(planOpen(findings, [closedAfter, ...created]).fresh, [])
  })

  it('honours the threshold and the selection', () => {
    assert.deepEqual(planOpen(findings, [], { minSeverity: 'high' }).fresh.map((f) => f.id), ['F1', 'F2'])
    assert.deepEqual(planOpen(findings, [], { only: ['security/F3'] }).fresh.map((f) => f.id), ['F3'])
  })
})

describe('sync', () => {
  const issues = [
    { number: 1, state: 'OPEN', body: keyComment('fp:aaaaaaaaaaaaaaaa') },
    { number: 2, state: 'OPEN', body: keyComment('id:SEC-48') },
    { number: 3, state: 'CLOSED', closedAt: '2026-09-20T00:00:00Z', body: keyComment('fp:cccccccccccccccc') },
    { number: 4, state: 'OPEN', body: keyComment('fp:dddddddddddddddd') },
  ]
  const s = scan([finding('F9', 'high', 'cccccccccccccccc')], {
    resolved: [{ fingerprint: 'aaaaaaaaaaaaaaaa' }, { fingerprint: 'dddddddddddddddd' }],
  })
  const later = audit([{ id: 'SEC-48', title: 'T', severity: 'high', description: 'D', status: 'done' }])
  const live = scan([finding('F2', 'high', 'dddddddddddddddd')], { run: 'other', type: 'performance' })

  it('closes what a full scan resolved or an audit marked done, unless still live elsewhere; reopens what came back', () => {
    const sources = [s, later, live].map((doc) => ({
      findings: normalizeFindings(doc),
      resolved: doc.resolved ?? [],
      full: doc.scope === 'full',
      meta: {},
    }))
    const plan = planSync(sources, issues)
    assert.deepEqual(plan.close.map((c) => [c.issue.number, c.reason]), [
      [1, 'resolved'],
      [2, 'done'],
    ])
    assert.deepEqual(plan.reopen.map((r) => r.issue.number), [3])
  })

  it('does not close from a partial scan', () => {
    const plan = planSync([{ findings: [], resolved: [{ fingerprint: 'aaaaaaaaaaaaaaaa' }], full: false, meta: {} }], issues)
    assert.deepEqual(plan.close, [])
  })
})

describe('selection and batches', () => {
  it('parses selectors', () => {
    assert.deepEqual(parseSelector(['#12,15', 'priority:P1', 'label:bug', 'triage:triage-1']), {
      numbers: [12, 15],
      labels: ['bug'],
      facets: { priority: 'P1' },
      triage: 'triage-1',
      all: false,
    })
    assert.throws(() => parseSelector(['nonsense']), /selector/)
  })

  it('names the issues a selection leaves out past --max (issue #8)', () => {
    const p1 = [{ name: 'priority: P1' }]
    const issues = [404, 12, 13].map((number) => ({ number, labels: p1 }))
    const { kept, dropped } = capSelection(sortIssues(plain, issues), 2)
    assert.deepEqual(
      kept.map((i) => i.number),
      [12, 13]
    )
    assert.deepEqual(dropped, [404])
    assert.deepEqual(capSelection(issues, 5).dropped, [])
  })

  it('groups by area, cuts groups larger than perBatch, puts the most urgent first', () => {
    const issue = (number, priority, file) => ({
      number,
      title: `#${number}`,
      labels: [`priority: ${priority}`],
      body: `**Location.** \`${file}:1\``,
    })
    const batches = groupBatches(
      plain,
      [
        issue(1, 'P3', 'app/api/a/route.ts'),
        issue(2, 'P1', 'app/api/b/route.ts'),
        issue(3, 'P2', 'app/api/c/route.ts'),
        issue(4, 'P0', 'lib/auth/scope.ts'),
        issue(5, 'P2', 'README.md'),
      ],
      { perBatch: 2 }
    )
    assert.deepEqual(
      batches.map((b) => [b.id, b.group, b.issues.map((i) => i.number)]),
      [
        ['B1', 'lib/auth', [4]],
        ['B2', 'app/api', [2, 3]],
        ['B3', '(root)', [5]],
        ['B4', 'app/api', [1]],
      ]
    )
    assert.equal(areaOf('components/x/y/z.tsx:4-9'), 'components/x')
    assert.equal(slug('app/api — Été'), 'app-api-ete')
  })
})

describe('triage', () => {
  const issues = [12, 13, 14, 15].map((number) => ({ number, title: `#${number}`, labels: ['priority: P1'] }))
  const verdicts = new Map([
    [12, { verdict: 'fixed', reason: 'gone', commit: 'abc' }],
    [13, { verdict: 'fixed', reason: 'gone' }],
    [14, { verdict: 'holds', reason: 'still', priority: 'P2' }],
    [15, { verdict: 'obsolete', reason: 'file removed' }],
  ])
  const checks = new Map([
    [12, { agree: true }],
    [13, { agree: false, reason: 'twin route still leaks' }],
  ])

  it('closes only what a skeptic agreed to, and relabels a changed priority', () => {
    const d = decideTriage(plain, issues, verdicts, checks)
    assert.deepEqual(d[0].actions, [{ type: 'close', reason: 'completed' }])
    assert.equal(d[1].final, 'holds')
    assert.equal(d[1].reason, 'twin route still leaks')
    assert.deepEqual(d[2].actions, [{ type: 'relabel', from: 'P1', to: 'P2' }])
    assert.equal(d[3].final, 'unclear')
    assert.deepEqual(d[3].actions, [])
  })
})

describe('spending fewer agents', () => {
  it('reads the commit a finding was measured at from the footer only', () => {
    const body = [
      '<!-- tracker-key: fp:0123456789abcdef -->',
      '**Source.** run `scan-1` · fingerprint `0123456789abcdef`',
      '---',
      '_Security scan of 24/09/2026 at commit `a1b2c3d` (`main`)._',
    ].join('\n')
    assert.equal(commitIn(body), 'a1b2c3d')
    assert.equal(commitIn('**Source.** fingerprint `0123456789abcdef`'), null)
  })

  it('dates an issue by its last holding triage, else its commit, else its opening', () => {
    const issue = { number: 1, commit: 'a1b2c3d', createdAt: '2026-09-24T10:00:00Z' }
    assert.deepEqual(triageReference(issue, { commit: 'fff0000', run: 'triage-1' }), {
      kind: 'triage',
      ref: 'fff0000',
      run: 'triage-1',
    })
    assert.deepEqual(triageReference(issue), { kind: 'commit', ref: 'a1b2c3d' })
    assert.deepEqual(triageReference({ ...issue, commit: null }), { kind: 'date', ref: issue.createdAt })
    assert.equal(triageReference({ number: 2 }), null)
  })

  it('groups the issues of one area for one triager, perAgent at most', () => {
    const at = (number, location) => ({ number, labels: [], location })
    const issues = [at(1, 'src/api/a.js:1'), at(2, 'src/api/b.js:2'), at(3, 'src/api/c.js:3'), at(4, 'web/x.js:1')]
    assert.deepEqual(triageGroups(plain, issues, 1), [[1], [2], [3], [4]])
    assert.deepEqual(triageGroups(plain, issues, 2), [[1, 2], [3], [4]])
  })

  it('runs the triager on a lighter model by default, the skeptic and fixer on the session', () => {
    const saved = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = os.tmpdir()
    try {
      const triager = agentOf(plain, 'triager')
      assert.equal(triager.model.value, 'sonnet')
      assert.equal(triager.model.source, 'default')
      assert.equal(triager.type, 'tracker:triager-medium')
      assert.equal(agentOf(plain, 'skeptic').type, 'tracker:skeptic')
      assert.equal(agentOf(plain, 'fixer').model.value, 'inherit')
      assert.equal(agentOf(merge(DEFAULT_CONFIG, { roles: { triager: { model: 'inherit' } } }), 'triager').model.value, 'inherit')
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = saved
    }
  })
})
