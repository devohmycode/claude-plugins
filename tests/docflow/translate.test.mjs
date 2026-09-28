// Translations: plan (only changed sections), apply (splice, links, fingerprints),
// check of the twins (PRD § 6.2, SPECS § 4) — with a fake translator.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { parseTranslated, rewriteLinks } from '../../docflow/scripts/lib/translate.mjs'
import { docflow, makeRepo, read, workspace, write } from './helpers.mjs'

const ws = workspace('docflow-translate-')
after(() => ws.cleanup())

/** `DOC=… LANG=… CHANGED=…` lines of `translate plan`, as objects. */
const planLines = (stdout) =>
  stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith('DOC='))
    .map((l) => Object.fromEntries(l.split(' ').map((kv) => kv.split('='))))

/** A fake translator: keeps markers, heading numbers and code; prefixes the words with «fr». */
function translate(repo, source, target) {
  const text = readFileSync(path.join(repo, source), 'utf8')
  const out = text
    .split('\n')
    .map((l) => {
      if (/^<!-- docflow:section/.test(l) || !l.trim()) return l
      const h = /^(#{2,3} (?:\d+(?:\.\d+)*\.?|S\d+ —)?\s*)(.*)$/.exec(l)
      if (h && l.startsWith('#')) return `${h[1]}FR ${h[2]}`
      return `FR ${l}`
    })
    .join('\n')
  write(repo, target, out)
}

function prdRepo(name) {
  const repo = makeRepo(ws, { name })
  docflow(ws, repo, ['config', 'doc_languages', 'fr'])
  docflow(ws, repo, ['stage', 'prd'])
  write(repo, 'docs/PRD.md', read(repo, 'docs/PRD.md').replace(/<!-- docflow:todo[^>]*-->/g, 'Text, see [SPECS](SPECS.md).'))
  return repo
}

describe('translate', () => {
  it('translates every section first, then only the changed one', () => {
    const repo = prdRepo('incremental')
    let plan = docflow(ws, repo, ['translate', 'plan', 'prd'])
    let [line] = planLines(plan.stdout)
    assert.equal(line.CHANGED, '1,2,3,4,5,6,7,8')
    assert.equal(line.LANG, 'fr')
    translate(repo, line.SOURCE, line.TARGET)
    const applied = docflow(ws, repo, ['translate', 'apply', 'prd', 'fr', line.TARGET])
    assert.equal(applied.code, 0, applied.stdout)
    assert.equal(applied.keys.UPDATED, '1,2,3,4,5,6,7,8')
    const twin = read(repo, 'docs/PRD-FR.md')
    assert.match(twin, /^# incremental — Document d'exigences produit/)
    assert.match(twin, /\| Statut \| Brouillon v0\.1 \|/)
    assert.match(twin, /Version anglaise : \[PRD\.md\]\(PRD\.md\)\./)
    assert.match(twin, /Chaîne : \*\*PRD\*\* → \[ARCHITECTURE\]\(ARCHITECTURE-FR\.md\)/)
    assert.match(twin, /## 2\. FR Problem\n\nFR Text, see \[SPECS\]\(SPECS-FR\.md\)\./)
    assert.equal(docflow(ws, repo, ['check', 'prd']).keys.ISSUES, '0')

    write(repo, 'docs/PRD.md', read(repo, 'docs/PRD.md').replace('## 4. Users\n\nText', '## 4. Users\n\nOther text'))
    const check = docflow(ws, repo, ['check', 'prd'])
    assert.equal(check.keys.ISSUES, '1')
    assert.match(check.messages[0], /PRD-FR\.md:\d+ section 4 was translated from an older English text/)
    plan = docflow(ws, repo, ['translate', 'plan', 'prd'])
    ;[line] = planLines(plan.stdout)
    assert.equal(line.CHANGED, '4', 'only the changed section is sent')
    assert.equal(read(repo, line.SOURCE), `<!-- docflow:section 4 -->\n## 4. Users\n\nOther text, see [SPECS](SPECS.md).\n`)
    translate(repo, line.SOURCE, line.TARGET)
    assert.equal(docflow(ws, repo, ['translate', 'apply', 'prd', 'fr']).keys.UPDATED, '4')
    assert.match(read(repo, 'docs/PRD-FR.md'), /## 2\. FR Problem/, 'the other sections are kept')
    assert.match(read(repo, 'docs/PRD-FR.md'), /FR Other text/)
    assert.equal(docflow(ws, repo, ['check']).keys.ISSUES, '0')
    assert.equal(planLines(docflow(ws, repo, ['translate', 'plan']).stdout)[0].CHANGED, '')
  })

  it('reports a missing twin, and refuses an incomplete translation', () => {
    const repo = prdRepo('refuse')
    const check = docflow(ws, repo, ['check', 'prd'])
    assert.equal(check.keys.ISSUES, '1')
    assert.match(check.messages[0], /translation docs\/PRD-FR\.md does not exist/)
    const [line] = planLines(docflow(ws, repo, ['translate', 'plan', 'prd']).stdout)
    write(repo, line.TARGET, '<!-- docflow:section 1 -->\n## 1. Vision\n\nSeul.\n')
    const r = docflow(ws, repo, ['translate', 'apply', 'prd', 'fr'])
    assert.deepEqual([r.code, r.keys.ERROR], [2, 'missing'])
    translate(repo, line.SOURCE, line.TARGET)
    write(repo, line.TARGET, read(repo, line.TARGET).replace('## 3. FR', '## 9. FR'))
    assert.equal(docflow(ws, repo, ['translate', 'apply', 'prd', 'fr']).keys.ERROR, 'invalid')
  })

  it('drops the sections removed in English', () => {
    const repo = prdRepo('removed')
    let [line] = planLines(docflow(ws, repo, ['translate', 'plan', 'prd']).stdout)
    translate(repo, line.SOURCE, line.TARGET)
    docflow(ws, repo, ['translate', 'apply', 'prd', 'fr'])
    write(repo, 'docs/PRD.md', read(repo, 'docs/PRD.md').replace(/## 8\. Open questions[\s\S]*$/, ''))
    ;[line] = planLines(docflow(ws, repo, ['translate', 'plan', 'prd']).stdout)
    assert.deepEqual([line.CHANGED, line.REMOVED], ['', '8'])
    assert.match(docflow(ws, repo, ['check', 'prd']).stdout, /section 8 no longer exists in English/)
    write(repo, '.docflow/translate/PRD.fr.md', '')
    const r = docflow(ws, repo, ['translate', 'apply', 'prd', 'fr'])
    assert.deepEqual([r.code, r.keys.REMOVED], [0, '8'])
    assert.doesNotMatch(read(repo, 'docs/PRD-FR.md'), /## 8\./)
  })

  it('works per language and says when none is set', () => {
    const repo = makeRepo(ws, { name: 'none' })
    docflow(ws, repo, ['stage', 'prd'])
    assert.equal(docflow(ws, repo, ['translate', 'plan']).keys.LANGS, '')
    const es = docflow(ws, repo, ['translate', 'plan', 'prd', '--lang', 'es'])
    assert.equal(planLines(es.stdout)[0].LANG, 'es')
    assert.equal(docflow(ws, repo, ['translate', 'plan', '--lang', 'it']).code, 2)
  })
})

describe('translate helpers', () => {
  it('reads the chunks of a translated file by marker', () => {
    const chunks = parseTranslated('<!-- docflow:section 1 -->\n## 1. Un\n\nA\n\n<!-- docflow:section S2 -->\n## S2 — Deux\n')
    assert.deepEqual([...chunks.keys()], ['1', 'S2'])
    assert.equal(chunks.get('1'), '## 1. Un\n\nA')
  })

  it('points chain links to the twins, anchors kept', () => {
    assert.equal(rewriteLinks('[a](SPECS.md#3) [b](other.md) [c](TASKS.md)', 'de'), '[a](SPECS-DE.md#3) [b](other.md) [c](TASKS-DE.md)')
  })
})
