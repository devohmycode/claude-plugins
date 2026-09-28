// The script's entry: KEY=value output, exit codes, i18n messages, status, language,
// config and the repository contract — run as a command runs it.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { docflow, ghData, makeRepo, workspace, write } from './helpers.mjs'

const ws = workspace()
after(() => ws.cleanup())

describe('status', () => {
  it('lists every document as missing on an empty repository and names /docflow:prd', () => {
    const repo = makeRepo(ws, { name: 'empty', commit: false })
    const r = docflow(ws, repo, ['status'])
    assert.equal(r.code, 0)
    for (const doc of ['PRD', 'ARCHITECTURE', 'SPECS', 'TASKS']) assert.equal(r.keys[`DOC_${doc}`], 'missing')
    assert.equal(r.keys.NEXT, '/docflow:prd')
    assert.equal(r.keys.RUN, 'none')
    assert.equal(r.keys.CLAUDE_MD, 'missing')
    assert.ok(r.stdout.split('\n').filter(Boolean).length <= 20)
    assert.equal(existsSync(path.join(repo, '.docflow')), false, 'status writes nothing')
  })

  it('works in a folder that is not a repository', () => {
    const plain = path.join(ws.dir, 'plain')
    write(plain, 'notes.txt', 'x')
    const r = docflow(ws, plain, ['status'])
    assert.equal(r.code, 0)
    assert.equal(r.keys.NEXT, '/docflow:prd')
  })

  it('reports the sprint progress from TASKS.md', () => {
    const repo = makeRepo(ws, { name: 'progress' })
    write(
      repo,
      'docs/TASKS.md',
      [
        '# P — Tasks',
        '',
        '## S1 — One',
        '',
        '- [x] **S1-T1** Done.',
        '- [x] **S1 acceptance** — ok.',
        '',
        '## S2 — Two',
        '',
        '- [x] **S2-T1** First. Refs: SPECS § 2.',
        '- [ ] **S2-T2** Second.',
        '- [ ] **S2 acceptance** — it works.',
        '',
      ].join('\n')
    )
    const r = docflow(ws, repo, ['status'])
    assert.deepEqual([r.keys.SPRINT, r.keys.DONE, r.keys.TOTAL], ['S2', '2', '3'])
  })

  it('refuses a corrupt state with a clear message', () => {
    const repo = makeRepo(ws, { name: 'corrupt' })
    write(repo, '.docflow/state.json', '{ nope')
    const r = docflow(ws, repo, ['status'])
    assert.equal(r.code, 1)
    assert.equal(r.keys.ERROR, 'state-corrupt')
  })
})

describe('language', () => {
  it('shows the language and where it comes from', () => {
    const repo = makeRepo(ws, { name: 'lang-show' })
    const r = docflow(ws, repo, ['language'])
    assert.deepEqual([r.keys.LANGUAGE, r.keys.SOURCE], ['en', 'env'])
  })

  it('sets the per-project language, which the messages then follow', () => {
    const repo = makeRepo(ws, { name: 'lang-fr' })
    const set = docflow(ws, repo, ['language', 'fr'])
    assert.equal(set.code, 0)
    assert.match(set.messages[0], /Français/)
    const config = JSON.parse(readFileSync(path.join(repo, '.docflow', 'config.json'), 'utf8'))
    assert.equal(config.language, 'fr')
    const status = docflow(ws, repo, ['status'])
    assert.equal(status.messages.at(-1), "PRD n'existe pas encore : /docflow:prd l'écrit.")
    const back = docflow(ws, repo, ['language', 'default'])
    assert.equal(back.keys.LANGUAGE, 'en')
    assert.equal(JSON.parse(readFileSync(path.join(repo, '.docflow', 'config.json'), 'utf8')).language, undefined)
  })

  it('refuses an unsupported language', () => {
    const repo = makeRepo(ws, { name: 'lang-bad' })
    const r = docflow(ws, repo, ['language', 'klingon'])
    assert.equal(r.code, 2)
    assert.equal(r.keys.ERROR, 'language')
  })
})

describe('config', () => {
  it('shows the options and the detected checks', () => {
    const repo = makeRepo(ws, { name: 'config', files: { 'go.mod': 'module x\n' } })
    const r = docflow(ws, repo, ['config'])
    assert.equal(r.keys.UNIT, 'sprint')
    assert.equal(r.keys.TRANSLATOR_MODEL, 'haiku')
    assert.equal(r.keys.CHECKS_COMMAND, 'go test ./...')
    assert.equal(r.keys.CHECKS_SOURCE, 'detected:go.mod')
  })

  it('sets, shows and removes one option', () => {
    const repo = makeRepo(ws, { name: 'config-set' })
    assert.equal(docflow(ws, repo, ['config', 'checks', 'make test']).keys.CHECKS, 'make test')
    assert.equal(docflow(ws, repo, ['config', 'doc_languages', 'de,fr']).keys.DOC_LANGUAGES, 'fr,de')
    const shown = docflow(ws, repo, ['config', 'checks'])
    assert.deepEqual([shown.keys.CHECKS, shown.keys.SOURCE], ['make test', 'project'])
    assert.equal(docflow(ws, repo, ['config', 'checks', '--unset']).keys.UNSET, 'checks')
    assert.equal(docflow(ws, repo, ['config', 'checks']).keys.SOURCE, 'default')
  })

  it('refuses an unknown option or an invalid value', () => {
    const repo = makeRepo(ws, { name: 'config-bad' })
    assert.equal(docflow(ws, repo, ['config', 'colour', 'red']).code, 2)
    const r = docflow(ws, repo, ['config', 'unit', 'week'])
    assert.deepEqual([r.code, r.keys.ERROR], [2, 'value'])
  })
})

describe('entry', () => {
  it('rejects an unknown verb with exit 2', () => {
    const r = docflow(ws, ws.dir, ['frobnicate'])
    assert.deepEqual([r.code, r.keys.ERROR], [2, 'verb'])
  })

  it('plans and creates a repository on request', () => {
    const plain = path.join(ws.dir, 'fresh')
    write(plain, 'app.js', 'console.log(1)\n')
    write(plain, '.env', 'SECRET=1\n')
    const plan = docflow(ws, plain, ['repo', 'plan'])
    assert.equal(plan.keys.REPO_STATE, 'none')
    assert.equal(plan.keys.FILES, '2')
    assert.equal(plan.keys.FLAGGED, '.env')
    const init = docflow(ws, plain, ['repo', 'init'])
    assert.equal(init.keys.REPO_STATE, 'empty')
  })

  it('has a working fake gh', () => {
    assert.deepEqual(ghData(ws).prs, [])
  })
})
