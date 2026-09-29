// The budgets of SPECS § 10, measured: every script verb but `do check`, `do finish` and
// `issues` under a second on a repository of 5,000 files; a hook decision under 100 ms;
// the CLAUDE.md block within 40 lines; command files within 120 lines; a verb's output on
// success within 20 lines. Each timing is the median of a few runs, printed as a
// diagnostic so a slow drift shows before the budget breaks.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { docFingerprint } from '../../docflow/scripts/lib/docs.mjs'
import { PLUGIN, docflow, git, hook, makeRepo, read, workspace, write } from './helpers.mjs'

const ws = workspace('docflow-budgets-')
after(() => ws.cleanup())

const FILES = 5000
const RUNS = 3

const TASKS = [
  '# big — Tasks',
  '',
  '## How to work on this file',
  '',
  '- Through /docflow:do.',
  '',
  '## S1 — Placement',
  '',
  '- [ ] **S1-T1** Add the adder. Refs: SPECS § 1.',
  '- [ ] **S1-T2** Add the doubler. Refs: SPECS § 2.',
  '- [ ] **S1 acceptance** — node -e prints 10.',
  '',
].join('\n')
const SPECS = '# big — Specifications\n\n## 1. Adder\n\nadd(a, b) returns a + b.\n\n## 2. Limits\n\ndouble(x) returns 2x.\n'

/** A repository of FILES files whose four documents are approved and committed. */
function bigProject(name = 'big') {
  const files = { 'package.json': JSON.stringify({ name: 'big', scripts: { test: 'node -e 0' } }) }
  for (let i = 0; i < FILES; i++) files[`src/m${i % 50}/f${i}.txt`] = `${i}\n`
  const repo = makeRepo(ws, { name, remote: true, files })
  const docs = { PRD: '# big — PRD\n\n## 1. Vision\n\nv\n', ARCHITECTURE: '# big — Technical design\n\n## 1. Principles\n\np\n', SPECS, TASKS }
  const state = { schema: 1, docs: {}, translations: {}, lock: null, run: null, guard: null, pending: [] }
  for (const [doc, text] of Object.entries(docs)) {
    write(repo, `docs/${doc}.md`, text)
    state.docs[doc] = { approved: '2026-09-28T10:00:00Z', fingerprint: docFingerprint(doc, text), stale: false }
  }
  write(repo, '.docflow/state.json', JSON.stringify(state))
  write(repo, '.docflow/.gitignore', '*\n!config.json\n!.gitignore\n')
  docflow(ws, repo, ['claude-md'])
  git(['add', '-A'], repo)
  git(['commit', '-q', '-m', 'docs'], repo)
  git(['push', '-q'], repo)
  return repo
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** Runs `fn` RUNS times; returns the median duration in ms and the last result. */
function timed(fn, runs = RUNS) {
  const ms = []
  let last
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    last = fn()
    ms.push(performance.now() - t0)
  }
  return { ms: Math.round(median(ms)), last }
}

/** Lines of a verb's output (KEY=value and `# ` lines). */
const outputLines = (stdout) => stdout.split(/\r?\n/).filter(Boolean).length

describe('SPECS § 10 budgets', () => {
  const repo = bigProject()
  const results = []

  it(`keeps every script verb under a second on ${FILES} files, and its output within 20 lines`, (t) => {
    // Verbs that print a key/value answer; `section` and `task show` print raw text.
    const verbs = [
      ['status'],
      ['check', 'tasks'],
      ['stage', 'tasks'],
      ['section', 'SPECS', '1'],
      ['approve', 'tasks'],
      ['claude-md'],
      ['translate', 'plan'],
      ['task', 'show', 'S1-T1'],
      ['config'],
    ]
    for (const args of verbs) {
      const { ms, last } = timed(() => docflow(ws, repo, args))
      assert.equal(last.code, 0, `${args.join(' ')}\n${last.stdout}`)
      results.push([args.join(' '), ms, outputLines(last.stdout)])
    }
    // A run: start, commit, acceptance, result, abort. They change the state, so the run
    // is played once on each of RUNS identical repositories and each verb keeps its median.
    const runs = new Map()
    for (let i = 0; i < RUNS; i++) {
      const run = i === 0 ? repo : bigProject(`big-${i}`)
      const once = (args) => {
        const t0 = performance.now()
        const r = docflow(ws, run, args)
        assert.equal(r.code, 0, `${args.join(' ')}\n${r.stdout}`)
        const verb = args.join(' ')
        if (!runs.has(verb)) runs.set(verb, { ms: [], lines: 0 })
        runs.get(verb).ms.push(performance.now() - t0)
        runs.get(verb).lines = outputLines(r.stdout)
      }
      once(['do', 'start', 'S1'])
      write(run, 'add.mjs', 'export default 1\n')
      assert.equal(docflow(ws, run, ['do', 'check', 'S1-T1']).keys.CHECKS, 'pass')
      once(['do', 'commit', 'S1-T1'])
      once(['do', 'acceptance', 'S1'])
      once(['do', 'result', 'S1', 'failed', 'not run in this test'])
      once(['do', 'abort'])
    }
    for (const [verb, { ms, lines }] of runs) results.push([verb, Math.round(median(ms)), lines])
    for (const [verb, ms, lines] of results) t.diagnostic(`${verb}: ${ms} ms, ${lines} lines`)
    for (const [verb, ms, lines] of results) {
      assert.ok(ms < 1000, `${verb} took ${ms} ms`)
      if (!/^(section|task show)/.test(verb)) assert.ok(lines <= 20, `${verb} printed ${lines} lines`)
    }
  })

  it('decides a hook under 100 ms', (t) => {
    assert.equal(docflow(ws, repo, ['do', 'start', 'S1']).code, 0)
    const input = (tool_name, tool_input) => ({ session_id: 'session-test', cwd: repo, tool_name, tool_input })
    const cases = [
      ['push to main', input('Bash', { command: 'git push origin main' })],
      ['ordinary command', input('Bash', { command: 'npm test' })],
      ['edit of an approved document', input('Edit', { file_path: path.join(repo, 'docs/SPECS.md') })],
    ]
    for (const [name, payload] of cases) {
      hook(ws, 'pre', payload) // warm the file cache
      const { ms } = timed(() => hook(ws, 'pre', payload), 5)
      t.diagnostic(`hook pre, ${name}: ${ms} ms (process start included)`)
      assert.ok(ms < 100, `${name}: ${ms} ms`)
    }
    const { ms } = timed(() => hook(ws, 'stop', { session_id: 'session-test', cwd: repo }), 5)
    t.diagnostic(`hook stop: ${ms} ms (process start included)`)
    docflow(ws, repo, ['do', 'abort'])
  })

  it('keeps the CLAUDE.md block within 40 lines and command files within 120', (t) => {
    const block = read(repo, 'CLAUDE.md').split('\n')
    const start = block.findIndex((l) => l.includes('docflow:start'))
    const end = block.findIndex((l) => l.includes('docflow:end'))
    t.diagnostic(`CLAUDE.md block: ${end - start + 1} lines`)
    assert.ok(end - start + 1 <= 40)
    const dir = path.join(PLUGIN, 'commands')
    for (const f of readdirSync(dir)) {
      const n = readFileSync(path.join(dir, f), 'utf8').split('\n').length
      t.diagnostic(`commands/${f}: ${n} lines`)
      assert.ok(n <= 120, `${f}: ${n} lines`)
    }
  })
})
