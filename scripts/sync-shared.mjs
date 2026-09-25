#!/usr/bin/env node
// Copies the shared modules into every plugin of the marketplace and checks
// their catalogs. A plugin is installed alone, so each one ships its own copy.
//
//   node scripts/sync-shared.mjs           write the copies, create missing locale files,
//                                          declare the /config language field in plugin.json
//   node scripts/sync-shared.mjs --check   change nothing; exit 1 if a copy is stale, a locale
//                                          file is missing, a catalog is incomplete, or the
//                                          manifest lacks the language field
//
// Plugins are read from .claude-plugin/marketplace.json: a new plugin is covered
// as soon as it is listed there.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUPPORTED, USER_CONFIG_FIELD, checkCatalogs } from '../shared/i18n/i18n.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')

/** Shared module → path of its copy inside each plugin. */
const SHARED = [
  { source: 'shared/i18n/i18n.mjs', target: 'scripts/i18n.mjs' },
  { source: 'shared/findings/findings.mjs', target: 'scripts/findings.mjs' },
  { source: 'shared/git/repo.mjs', target: 'scripts/repo.mjs' },
]

const header = (source) =>
  `// GENERATED from ${source} by scripts/sync-shared.mjs — do not edit this copy.\n`

const marketplace = JSON.parse(
  readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8')
)
const plugins = marketplace.plugins
  .filter((p) => typeof p.source === 'string' && p.source.startsWith('./'))
  .map((p) => ({ name: p.name, dir: path.join(ROOT, p.source) }))

let problems = 0
const report = (plugin, message) => {
  problems++
  console.log(`✗ ${plugin}: ${message}`)
}

for (const { name, dir } of plugins) {
  for (const { source, target } of SHARED) {
    const expected = header(source) + readFileSync(path.join(ROOT, source), 'utf8')
    const file = path.join(dir, target)
    const current = existsSync(file) ? readFileSync(file, 'utf8') : null
    if (current === expected) continue
    if (check) report(name, `${target} is ${current === null ? 'missing' : 'stale'}`)
    else {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, expected, 'utf8')
      console.log(`↻ ${name}: ${target}`)
    }
  }

  // The language field of /config: `userConfig.language` in the manifest.
  const manifestFile = path.join(dir, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifestFile)) report(name, '.claude-plugin/plugin.json is missing')
  else {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    const field = manifest.userConfig?.language
    if (JSON.stringify(field) !== JSON.stringify(USER_CONFIG_FIELD)) {
      if (check)
        report(name, `plugin.json: userConfig.language is ${field ? 'outdated' : 'missing'}`)
      else {
        manifest.userConfig = { ...manifest.userConfig, language: USER_CONFIG_FIELD }
        writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
        console.log(`↻ ${name}: .claude-plugin/plugin.json (userConfig.language)`)
      }
    }
  }

  const localesDir = path.join(dir, 'locales')
  for (const code of SUPPORTED) {
    const file = path.join(localesDir, `${code}.json`)
    if (existsSync(file) || check) continue
    mkdirSync(localesDir, { recursive: true })
    writeFileSync(file, '{}\n', 'utf8')
    console.log(`+ ${name}: locales/${code}.json (empty, to fill)`)
  }
  for (const p of checkCatalogs(localesDir)) report(name, `locales: ${p}`)
}

console.log(
  problems
    ? `\n${problems} problem(s).${check ? ' Run `node scripts/sync-shared.mjs` and complete the catalogs.' : ''}`
    : `${plugins.length} plugin(s) up to date (${SUPPORTED.join(', ')}).`
)
process.exit(problems ? 1 : 0)
