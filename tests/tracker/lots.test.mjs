// Lots: the committed plan, the lock shared by every agent, marking, the instructions
// block and the vendored copy — pure helpers first, then the script on a real repository.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  BUSY_EXIT,
  MARK_END,
  MARK_START,
  conflictsOf,
  finishPlan,
  importLegacy,
  markLot,
  nextLot,
  releaseLock,
  renderHtml,
  tryLock,
  validateProposal,
  withBlock,
} from '../../tracker-plugin/scripts/lots.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = path.join(ROOT, 'tracker-plugin', 'scripts', 'tracker.mjs')
const ENV = { ...process.env, CLAUDE_PLUGINS_LANGUAGE: 'en', CLAUDE_CONFIG_DIR: os.tmpdir() }

const lot = (id, numbers, files = [], extra = {}) => ({
  id,
  title: `Lot ${id}`,
  issues: numbers.map((n) => ({ number: n, title: `issue ${n}`, files })),
  ...extra,
})

const LEGACY = {
  schema: 'decker.lots-issues/1',
  date: '2026-09-27',
  depot: 'owner/repo',
  base: 'dev',
  releve: 'Open issues on 27/09.',
  consigneAgent: ['a rule that now lives in the instruction files'],
  perimetres: [{ id: 'securite', titre: 'Sécurité', resume: 'r', lots: ['1', '2'] }],
  lots: [
    {
      id: '1',
      perimetre: 'securite',
      titre: 'Oracle 403',
      nature: 'code',
      resume: 's',
      traite: { statut: 'traite', pr: { numero: 512, url: 'u', branche: 'fix/x', etat: 'brouillon' } },
      issues: [{ number: 479, titre: 't', url: 'u', priorite: 'P0', fichiers: ['app/a.ts'], correctifCode: true }],
    },
    {
      id: '2',
      perimetre: 'securite',
      titre: 'Droits',
      nature: 'reglage',
      resume: 's',
      issues: [{ number: 480, titre: 't', fichiers: ['app/a.ts'], correctifCode: false, attendreDeploiement: true }],
    },
  ],
  horsLots: [],
}

describe('plan helpers', () => {
  it('lists the lots that cite the same files, once per pair', () => {
    const c = conflictsOf([lot('1', [1], ['a.ts', 'b.ts']), lot('2', [2], ['a.ts', 'b.ts']), lot('10', [3], ['c.ts'])])
    assert.deepEqual(c, [{ lots: ['1', '2'], files: ['a.ts', 'b.ts'] }])
  })

  it('refuses a proposal that loses, repeats or invents an issue', () => {
    assert.deepEqual(validateProposal({ lots: [lot('1', [1, 2])] }, [1, 2]), [])
    const p = validateProposal({ lots: [lot('1', [1, 9]), lot('1', [1])] }, [1, 2])
    assert.ok(p.some((x) => x.includes('#9')))
    assert.ok(p.some((x) => x.includes('appears twice')))
    assert.ok(p.some((x) => x.includes('#1 is in lot 1 and in lot 1')))
    assert.ok(p.some((x) => x.includes('#2 is in no lot')))
    assert.deepEqual(validateProposal({ lots: [lot('1', [1])], unassigned: [{ number: 2, reason: 'dup' }] }, [1, 2]), [])
  })

  it('takes the next lot in order, skipping done, held and awaiting ones', () => {
    const plan = finishPlan({ lots: [lot('1', [1]), lot('2', [2], [], { awaitDeploy: true }), lot('3', [3]), lot('4', [4])] })
    const marked = markLot(plan, '1', { number: 7, state: 'draft' })
    assert.equal(nextLot(marked).id, '3')
    assert.equal(nextLot(marked, { held: '3' }).id, '4')
    assert.equal(nextLot(marked, { includeAwait: true }).id, '2')
  })

  it('marks a lot again to move its pull request from draft to merged', () => {
    let plan = finishPlan({ lots: [lot('1', [1]), lot('2', [2])] })
    plan = markLot(plan, '1', { number: 7, url: 'u', branch: 'fix/a', state: 'draft' })
    plan = markLot(plan, '1', { ...plan.lots[0].done.pr, state: 'merged' })
    assert.equal(plan.lots[0].done.pr.state, 'merged')
    assert.deepEqual(plan.progress.done, ['1'])
    assert.equal(plan.progress.remaining, 1)
    assert.throws(() => markLot(plan, '9', { number: 1, state: 'draft' }))
  })

  it('converts a plan of the previous format, keeping what was done', () => {
    const plan = importLegacy(LEGACY)
    assert.equal(plan.schema, 'tracker.plan/1')
    assert.equal(plan.base, 'dev')
    assert.equal(plan.lots[0].done.pr.state, 'draft')
    assert.equal(plan.lots[0].done.pr.number, 512)
    assert.equal(plan.lots[1].codeFix, false)
    assert.equal(plan.lots[1].awaitDeploy, true)
    assert.deepEqual(plan.conflicts, [{ lots: ['1', '2'], files: ['app/a.ts'] }])
    assert.equal(plan.scopes[0].title, 'Sécurité')
    assert.ok(!('consigneAgent' in plan))
  })

  it('renders the HTML from the JSON, escaped', () => {
    const plan = finishPlan({ summary: '<b>x</b>', lots: [lot('1', [1])] })
    const t = (k, v = {}) => `${k}${v.id ?? ''}`
    const html = renderHtml(plan, { t, code: 'fr', name: 'p', instructions: 'i' })
    assert.match(html, /<html lang="fr">/)
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/)
    assert.match(html, /id="lot-1"/)
  })

  it('writes the instructions block once, and replaces it in place', () => {
    const once = withBlock('# Title\r\n', `${MARK_START}\nA\n${MARK_END}`)
    assert.ok(once.includes(`${MARK_START}\r\nA\r\n${MARK_END}`))
    const twice = withBlock(once, `${MARK_START}\nB\n${MARK_END}`)
    assert.equal(twice.split(MARK_START).length, 2)
    assert.ok(twice.includes('B') && !twice.includes('\r\nA\r\n'))
  })
})

describe('lock', () => {
  let dir
  before(() => (dir = mkdtempSync(path.join(os.tmpdir(), 'tracker-lock-'))))
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('lets one agent hold one lot, renews it, and hands a stale one over', () => {
    const file = path.join(dir, 'lock')
    assert.equal(tryLock(file, { lot: '1', agent: 'claude' }).ok, true)
    const busy = tryLock(file, { lot: '2', agent: 'codex' })
    assert.equal(busy.ok, false)
    assert.equal(busy.lock.agent, 'claude')
    assert.equal(tryLock(file, { lot: '1', agent: 'claude' }).renewed, true)
    const later = new Date(Date.now() + 5 * 3600_000)
    const taken = tryLock(file, { lot: '2', agent: 'codex', staleHours: 4 }, later)
    assert.equal(taken.ok, true)
    assert.equal(taken.taken.agent, 'claude')
    assert.equal(releaseLock(file, '1'), false)
    assert.equal(releaseLock(file, '2'), true)
    assert.equal(existsSync(file), false)
  })

  it('releases only the lot named, held by the agent named, unless forced', () => {
    const file = path.join(dir, 'lock-release')
    assert.equal(tryLock(file, { lot: '3', agent: 'claude' }).ok, true)
    assert.equal(releaseLock(file), false)
    assert.equal(releaseLock(file, '3', { agent: 'codex' }), false)
    assert.equal(existsSync(file), true)
    assert.equal(releaseLock(file, '3', { agent: 'claude' }), true)
    assert.equal(tryLock(file, { lot: '4', agent: 'claude' }).ok, true)
    assert.equal(releaseLock(file, null, { force: true }), true)
    assert.equal(existsSync(file), false)
  })
})

describe('lots on a repository', () => {
  let repo
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  const run = (script, ...args) =>
    spawnSync('node', [script, ...args], { cwd: repo, encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: repo } })
  const tracker = (...args) => run(SCRIPT, ...args)
  const line = (out, key) => out.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]

  before(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'tracker-lots-'))
    git('init', '-q', '-b', 'dev')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    mkdirSync(path.join(repo, 'docs/issues'), { recursive: true })
    mkdirSync(path.join(repo, '.tracker'), { recursive: true })
    writeFileSync(path.join(repo, 'docs/issues/27092026-issues.json'), JSON.stringify(LEGACY, null, 2))
    writeFileSync(path.join(repo, '.tracker/config.json'), JSON.stringify({ batch: { base: 'dev' } }))
    writeFileSync(path.join(repo, 'CLAUDE.md'), '# Rules\n')
    writeFileSync(path.join(repo, '.gitignore'), '.tracker/runs/\n.tracker/state.json\n')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
  })
  after(() => rmSync(repo, { recursive: true, force: true }))

  it('asks to convert a plan of the previous format, then converts it in place', () => {
    const refused = tracker('lot', 'status')
    assert.equal(refused.status, 2)
    assert.match(refused.stderr, /previous format/)
    const dry = tracker('plan', 'import', 'docs/issues/27092026-issues.json')
    assert.match(dry.stdout, /Nothing was written/)
    const done = tracker('plan', 'import', 'docs/issues/27092026-issues.json', '--apply')
    assert.equal(done.status, 0, done.stderr)
    assert.ok(existsSync(path.join(repo, 'docs/issues/27092026-issues.html')))
    // Lot 1 is done and lot 2 waits for a deployment: `next` has nothing to offer.
    const status = tracker('lot', 'status')
    assert.equal(line(status.stdout, 'NEXT'), 'none')
  })

  it('holds one lot at a time across agents: 75 while busy, the next lot once marked', () => {
    const done = tracker('lot', 'take', '1', '--agent', 'a')
    assert.equal(done.status, 2, 'a done lot cannot be taken')
    assert.equal(line(tracker('lot', 'take', 'next', '--agent', 'claude').stdout, 'LOT'), 'none')
    const a = tracker('lot', 'take', 'next', '--agent', 'claude', '--include-await')
    assert.equal(a.status, 0, a.stderr)
    assert.equal(line(a.stdout, 'LOT'), '2')
    assert.match(a.stdout, /waits for a deployment/)
    const b = tracker('lot', 'take', '2', '--agent', 'codex')
    assert.equal(b.status, BUSY_EXIT)
    assert.equal(line(b.stdout, 'LOCK'), 'busy')
    assert.equal(line(tracker('lot', 'lock').stdout, 'LOT'), '2')
    const marked = tracker('lot', 'mark', '2', '--pr', '520')
    assert.equal(marked.status, 0, marked.stderr)
    assert.match(marked.stdout, /Lock of lot 2 released/)
    const plan = JSON.parse(readFileSync(path.join(repo, 'docs/issues/27092026-issues.json'), 'utf8'))
    assert.equal(plan.lots[1].done.pr.url, 'https://github.com/owner/repo/pull/520')
    assert.equal(line(tracker('lot', 'take', 'next', '--agent', 'codex').stdout, 'LOT'), 'none')
    assert.equal(line(tracker('lot', 'lock').stdout, 'LOCK'), 'free')
  })

  it('commits the plan on its base branch only', () => {
    git('switch', '-q', '-c', 'fix/other')
    const refused = tracker('lot', 'commit')
    assert.equal(refused.status, 2)
    git('switch', '-q', 'dev')
    const ok = tracker('lot', 'commit')
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(git('log', '-1', '--format=%s').trim(),/^docs\(issues\): plan 27092026-issues, 2 of 2 lots done$/)
  })

  it('writes the protocol into the instruction files, once', () => {
    assert.match(tracker('instructions').stdout, /Nothing was written/)
    assert.equal(tracker('instructions', '--apply').status, 0)
    const text = readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8')
    assert.ok(text.startsWith('# Rules\n'))
    assert.match(text, /lot take <id\|next> --agent <name> --wait/)
    assert.match(tracker('instructions', '--apply').stdout, /CLAUDE.md is up to date/)
    assert.ok(!existsSync(path.join(repo, 'AGENTS.md')), 'a missing file is not created without --create')
  })

  it('vendors the scripts so that an agent without the plugin takes the same lock', () => {
    assert.equal(tracker('vendor', '--apply').status, 0)
    const vendored = path.join(repo, '.tracker/bin/scripts/tracker.mjs')
    assert.ok(existsSync(vendored))
    const status = run(vendored, 'lot', 'lock')
    assert.equal(status.status, 0, status.stderr)
    assert.equal(line(status.stdout, 'LOCK'), 'free')
  })
})
