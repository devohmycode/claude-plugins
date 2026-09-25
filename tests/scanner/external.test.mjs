// External investigators: prepare deals batches out to a fake bridge, investigate-external
// runs it and writes the batch's findings, consolidate keeps them with their engine.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { extractFindings, parseEngines } from '../../scanner-plugin/scripts/bridges.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCANNER = path.join(ROOT, 'scanner-plugin', 'scripts', 'scanner.mjs')

// Stands for a bridge plugin's script: `run --json --prompt-file <f>` → one JSON document.
const FAKE_BRIDGE = `
import { readFileSync } from 'node:fs'
const argv = process.argv.slice(2)
const prompt = readFileSync(argv[argv.indexOf('--prompt-file') + 1], 'utf8')
const mode = process.env.FAKE_BRIDGE_MODE ?? 'ok'
const findings = [
  { title: 'Unchecked input', severity: 'high', file: 'src/app.js', line: 1, snippet: 'run(input)',
    rule: 'unchecked-input', description: 'Input reaches run().', reachability: null, evidence: 'read' },
  { title: 'Leaked key', severity: 'critical', file: 'secret/key.js', line: 1, snippet: 'KEY',
    rule: 'hardcoded-secret', description: 'A key.', reachability: null, evidence: 'read' },
]
const rawOutput = mode === 'nojson'
  ? 'I looked around and everything seems fine.'
  : 'Here are my findings.\\n\\n\`\`\`json\\n' + JSON.stringify(findings) + '\\n\`\`\`'
console.log(JSON.stringify({
  status: 0,
  rawOutput,
  promptMentionsProfile: /# Scan profile/.test(prompt),
  readOnlyViolation: mode === 'modify' ? { changed: ['src/app.js'] } : null,
}))
`

let repo
let env
const write = (rel, content) => {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
  writeFileSync(path.join(repo, rel), content)
}
const scanner = (...args) =>
  spawnSync('node', [SCANNER, ...args], { cwd: repo, encoding: 'utf8', env })
const line = (out, key) => out.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]
const readRun = (dir, file) => JSON.parse(readFileSync(path.join(repo, dir, file), 'utf8'))

beforeEach(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'scanner-external-'))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('src/app.js', 'run(input)\n')
  write('src/util.js', 'export const x = 1\n')
  write('lib/other.js', 'export const y = 2\n')
  write('secret/key.js', 'KEY\n')
  write('.scanner/config.json', JSON.stringify({ batches: 2, types: { security: { exclusions: { add: ['secret/**'] } } } }))
  git('add', '-A')
  git('commit', '-q', '-m', 'init')

  const bridge = path.join(mkdtempSync(path.join(os.tmpdir(), 'fake-bridge-')), 'bridge.mjs')
  writeFileSync(bridge, FAKE_BRIDGE)
  env = {
    ...process.env,
    CLAUDE_PLUGINS_LANGUAGE: 'en',
    CLAUDE_CONFIG_DIR: mkdtempSync(path.join(os.tmpdir(), 'scanner-config-')),
    CLAUDE_PROJECT_DIR: repo,
    SCANNER_BRIDGE_FAKE: bridge,
  }
})

describe('external investigators', () => {
  it('deal batches out, run the external ones and keep their findings with their engine', () => {
    const prepared = scanner('prepare', 'security', '--via', 'claude,fake')
    assert.equal(prepared.status, 0, prepared.stderr)
    const run = line(prepared.stdout, 'RUN')
    const dir = line(prepared.stdout, 'DIR')
    assert.equal(line(prepared.stdout, 'BATCHES'), 'B1')
    assert.equal(line(prepared.stdout, 'EXTERNAL'), 'B2:fake')
    assert.match(prepared.stdout, /External investigators: fake\. They run outside Claude Code/)
    assert.equal(readRun(dir, 'meta.json').batches[1].engine, 'fake')

    const investigated = scanner('investigate-external', run)
    assert.equal(investigated.status, 0, investigated.stderr)
    assert.equal(line(investigated.stdout, 'EXTERNAL_DONE'), 'B2:ok')
    assert.match(investigated.stdout, /B2 \(fake\): 2 findings/)
    const prompt = readFileSync(path.join(repo, dir, 'prompt-B2.md'), 'utf8')
    assert.match(prompt, /# Scan profile/)
    assert.match(prompt, /`secret\/\*\*`/, 'the exclusions reach the prompt')
    assert.doesNotMatch(prompt, /\{\{[A-Z]+\}\}/)

    const consolidated = scanner('consolidate', run)
    assert.equal(consolidated.status, 0, consolidated.stderr)
    const findings = readRun(dir, 'findings.json')
    assert.equal(findings.length, 1)
    assert.equal(findings[0].engine, 'fake')
    assert.equal(findings[0].batch, 'B2')
    assert.match(readRun(dir, 'rejected.json').join('\n'), /secret\/key\.js is excluded by the profile/)
    // Batch B1 belonged to Claude's agents, which did not run in this test.
    assert.match(consolidated.stdout, /findings-B1\.json/)
  })

  it('report a batch whose answer holds no JSON, without writing its findings', () => {
    env.FAKE_BRIDGE_MODE = 'nojson'
    const prepared = scanner('prepare', 'security', '--via', 'fake')
    const run = line(prepared.stdout, 'RUN')
    const dir = line(prepared.stdout, 'DIR')
    assert.equal(line(prepared.stdout, 'BATCHES'), '')

    const investigated = scanner('investigate-external', run)
    assert.equal(investigated.status, 0, investigated.stderr)
    assert.match(line(investigated.stdout, 'EXTERNAL_DONE'), /^B1:failed/)
    assert.match(investigated.stdout, /no JSON array of findings/)
    assert.equal(existsSync(path.join(repo, dir, 'findings-B1.json')), false)
    assert.equal(readRun(dir, 'external-B1.json').code, 'no-findings-json')
  })

  it('treat a working-tree change as a failed batch', () => {
    env.FAKE_BRIDGE_MODE = 'modify'
    const run = line(scanner('prepare', 'security', '--via', 'fake').stdout, 'RUN')
    const investigated = scanner('investigate-external', run)
    assert.match(investigated.stdout, /modified the working tree/)
    assert.match(line(investigated.stdout, 'EXTERNAL_DONE'), /failed/)
  })

  it('refuse an unknown investigator and a bridge that is not installed', () => {
    const unknown = scanner('prepare', 'security', '--via', 'claude,nope')
    assert.equal(unknown.status, 1)
    assert.match(unknown.stderr, /Unknown investigator "nope"/)

    const missing = scanner('prepare', 'security', '--via', 'codex')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /the codex plugin is not installed/)
  })

  it('use the config when --via is absent, and claude alone by default', () => {
    const plain = scanner('prepare', 'security')
    assert.equal(line(plain.stdout, 'EXTERNAL'), '')
    scanner('guard', 'off')

    write('.scanner/config.json', JSON.stringify({ investigators: ['fake'] }))
    assert.match(line(scanner('prepare', 'security').stdout, 'EXTERNAL'), /^B1:fake/)
  })
})

describe('bridges helpers', () => {
  it('parse engine lists and extract findings from an answer', () => {
    assert.deepEqual(parseEngines('Claude, grok ,codex,claude'), ['claude', 'grok-build', 'codex'])
    assert.deepEqual(extractFindings('text\n```json\n[{"a":1}]\n```\nmore'), [{ a: 1 }])
    assert.deepEqual(extractFindings('{"findings": []}'), [])
    assert.deepEqual(extractFindings('Found: [ {"a": 2} ] done'), [{ a: 2 }])
    assert.equal(extractFindings('nothing here'), null)
  })
})
