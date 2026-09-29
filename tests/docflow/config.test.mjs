// Options: each precedence level, invalid values, and each checks detector (SPECS § 3).

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import {
  DETECTORS,
  agentOf,
  checksOf,
  detectChecks,
  loadConfig,
  saveProjectOption,
} from '../../docflow/scripts/lib/config.mjs'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'docflow-config-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

let n = 0
/** A project directory, with an optional .docflow/config.json. */
function project(own) {
  const dir = path.join(tmp, `p${++n}`)
  mkdirSync(path.join(dir, '.docflow'), { recursive: true })
  if (own) writeFileSync(path.join(dir, '.docflow', 'config.json'), JSON.stringify(own))
  return dir
}

/** A plugin directory and a Claude config directory whose settings.json holds `options`. */
function userSettings(options) {
  const pluginDir = path.join(tmp, `plugin${++n}`)
  mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true })
  writeFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'docflow' }))
  const configDir = path.join(tmp, `claude${n}`)
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    path.join(configDir, 'settings.json'),
    JSON.stringify({ pluginConfigs: { 'docflow@devohmycode-plugins': { options } } })
  )
  return { pluginDir, env: { CLAUDE_CONFIG_DIR: configDir } }
}

const noUser = { pluginDir: null, env: {} }

describe('option precedence', () => {
  it('uses the defaults when nothing is set', () => {
    const { values, sources, problems } = loadConfig(project(), {}, noUser)
    assert.equal(values.unit, 'sprint')
    assert.equal(values.implementer, 'session')
    assert.equal(values.worktree, 'off')
    assert.equal(values.issues, 'off')
    assert.equal(values.checks, '')
    assert.equal(values.branch_prefix, 'docflow/')
    assert.deepEqual(values.doc_languages, [])
    assert.equal(values.translator_model, 'haiku')
    assert.equal(values.acceptance_model, 'sonnet')
    assert.equal(values.writer_model, 'inherit')
    assert.equal(sources.unit, 'default')
    assert.deepEqual(problems, [])
  })

  it('reads the /config value before the default', () => {
    const user = userSettings({ unit: 'task', doc_languages: 'fr, de' })
    const { values, sources } = loadConfig(project(), {}, user)
    assert.equal(values.unit, 'task')
    assert.equal(sources.unit, 'user')
    assert.deepEqual(values.doc_languages, ['fr', 'de'])
  })

  it('reads the hook environment as /config', () => {
    const { values, sources } = loadConfig(project(), {}, { pluginDir: null, env: { CLAUDE_PLUGIN_OPTION_WORKTREE: 'on' } })
    assert.equal(values.worktree, 'on')
    assert.equal(sources.worktree, 'user')
  })

  it('reads the boolean Worktree row, and its former on/off spelling', () => {
    assert.equal(loadConfig(project(), {}, userSettings({ worktree: true })).values.worktree, 'on')
    assert.equal(loadConfig(project(), {}, userSettings({ worktree: false })).values.worktree, 'off')
    assert.equal(loadConfig(project(), {}, userSettings({ worktree: 'on' })).values.worktree, 'on')
    const env = { pluginDir: null, env: { CLAUDE_PLUGIN_OPTION_WORKTREE: 'true' } }
    assert.equal(loadConfig(project(), {}, env).values.worktree, 'on')
  })

  it('prefers the project file to /config', () => {
    const user = userSettings({ unit: 'task' })
    const { values, sources } = loadConfig(project({ unit: 'sprint', doc_languages: ['es'] }), {}, user)
    assert.equal(values.unit, 'sprint')
    assert.equal(sources.unit, 'project')
    assert.deepEqual(values.doc_languages, ['es'])
  })

  it('prefers an argument to everything', () => {
    const user = userSettings({ implementer: 'task' })
    const { values, sources } = loadConfig(project({ implementer: 'sprint' }), { implementer: 'session' }, user)
    assert.equal(values.implementer, 'session')
    assert.equal(sources.implementer, 'argument')
  })

  it('skips an invalid value and reports it', () => {
    const { values, sources, problems } = loadConfig(
      project({ unit: 'week', doc_languages: 'fr,it', branch_prefix: 'no-slash' }),
      {},
      noUser
    )
    assert.equal(values.unit, 'sprint')
    assert.equal(sources.unit, 'default')
    assert.deepEqual(values.doc_languages, [])
    assert.equal(values.branch_prefix, 'docflow/')
    assert.deepEqual(problems.map((p) => p.key).sort(), ['branch_prefix', 'doc_languages', 'unit'])
  })

  it('keeps an explicitly empty translation list', () => {
    const user = userSettings({ doc_languages: 'fr' })
    const { values, sources } = loadConfig(project({ doc_languages: '' }), {}, user)
    assert.deepEqual(values.doc_languages, [])
    assert.equal(sources.doc_languages, 'project')
  })

  it('leaves the language to the i18n engine below the project', () => {
    const user = userSettings({ language: 'de' })
    assert.equal(loadConfig(project(), {}, user).values.language, null)
    assert.equal(loadConfig(project({ language: 'fr' }), {}, user).values.language, 'fr')
  })

  it('saves one project option and keeps the others', () => {
    const dir = project({ unit: 'task' })
    saveProjectOption(dir, 'checks', 'make test')
    let own = JSON.parse(readFileSync(path.join(dir, '.docflow', 'config.json'), 'utf8'))
    assert.deepEqual(own, { unit: 'task', checks: 'make test' })
    saveProjectOption(dir, 'unit', null)
    own = JSON.parse(readFileSync(path.join(dir, '.docflow', 'config.json'), 'utf8'))
    assert.deepEqual(own, { checks: 'make test' })
  })

  it('names the agent variant of a role', () => {
    const { values } = loadConfig(project({ implementer_effort: 'high' }), {}, noUser)
    assert.deepEqual(agentOf(values, 'implementer'), { type: 'docflow:implementer-high', model: 'inherit', effort: 'high' })
    assert.equal(agentOf(values, 'translator').type, 'docflow:translator')
  })
})

describe('checks detection', () => {
  const cases = [
    ['Cargo.toml', '[package]\n', 'cargo test --locked'],
    ['package.json', JSON.stringify({ scripts: { test: 'node --test' } }), 'npm test'],
    ['pyproject.toml', '[project]\n', 'pytest -q'],
    ['pytest.ini', '[pytest]\n', 'pytest -q'],
    ['go.mod', 'module x\n', 'go test ./...'],
  ]
  for (const [file, content, command] of cases)
    it(`detects ${file}`, () => {
      const dir = project()
      writeFileSync(path.join(dir, file), content)
      assert.deepEqual(detectChecks(dir), { command, source: `detected:${file}` })
    })

  it('covers every detector', () => {
    assert.deepEqual(DETECTORS.map((d) => d.file), cases.map(([f]) => f))
  })

  it('ignores a package.json without a real test script', () => {
    const dir = project()
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }))
    assert.equal(detectChecks(dir), null)
  })

  it('takes the first match', () => {
    const dir = project()
    writeFileSync(path.join(dir, 'go.mod'), 'module x\n')
    writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\n')
    assert.equal(detectChecks(dir).command, 'cargo test --locked')
  })

  it('prefers the configured command, and says when there is none', () => {
    const dir = project()
    writeFileSync(path.join(dir, 'go.mod'), 'module x\n')
    assert.deepEqual(checksOf({ checks: 'make check' }, dir), { command: 'make check', source: 'config' })
    assert.deepEqual(checksOf({ checks: '' }, project()), { command: null, source: null })
  })
})
