#!/usr/bin/env node
// Writes what the plugin derives from its own sources, so that it cannot drift:
//
//   - one variant of each agent per reasoning effort (`agents/<agent>-<effort>.md`):
//     the Agent tool takes a model per call but no effort, and an agent's effort
//     can only come from its frontmatter;
//   - the /config rows of each role (`<role>_model`, `<role>_effort` in `userConfig`
//     of .claude-plugin/plugin.json).
//
//   node tracker-plugin/scripts/generate.mjs           write them
//   node tracker-plugin/scripts/generate.mjs --check   change nothing; exit 1 if one is stale

import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { AGENT_SETTINGS, PLUGIN_ROOT, ROLES, ROLE_DEFAULTS, agentOptionKey } from './lib.mjs'

const check = process.argv.includes('--check')
const EFFORTS = AGENT_SETTINGS.effort.values.filter((e) => e !== 'inherit')
const AGENTS_DIR = path.join(PLUGIN_ROOT, 'agents')
const MANIFEST = path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')
const variantPattern = new RegExp(`-(${EFFORTS.join('|')})\\.md$`)

let problems = 0
function sync(file, expected) {
  // Line endings aside: a checkout with core.autocrlf turns them into CRLF.
  const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null
  if (current === expected) return
  const rel = path.relative(PLUGIN_ROOT, file).split(path.sep).join('/')
  if (check) {
    problems++
    console.log(`✗ ${rel} is ${current === null ? 'missing' : 'stale'}`)
  } else {
    writeFileSync(file, expected, 'utf8')
    console.log(`↻ ${rel}`)
  }
}

// ─── Agent variants ─────────────────────────────────────────────────────────

const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'))
const bases = agentFiles.filter((f) => !variantPattern.test(f))
const expectedVariants = new Set()

for (const file of bases) {
  const text = readFileSync(path.join(AGENTS_DIR, file), 'utf8').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!match) {
    problems++
    console.log(`✗ agents/${file}: no frontmatter`)
    continue
  }
  const [, front, body] = match
  const field = (key) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(front)?.[1].trim()
  const name = field('name')
  for (const effort of EFFORTS) {
    const variant = `${name}-${effort}.md`
    expectedVariants.add(variant)
    const frontmatter = [
      `name: ${name}-${effort}`,
      `description: tracker:${name} at ${effort} reasoning effort — same role and instructions. Launched by the tracker commands when the ${name}'s effort is ${effort}.`,
      `tools: ${field('tools')}`,
      `effort: ${effort}`,
    ]
    const header = `<!-- GENERATED from agents/${file} by scripts/generate.mjs — edit the source, then regenerate. -->\n`
    sync(path.join(AGENTS_DIR, variant), `---\n${frontmatter.join('\n')}\n---\n\n${header}${body}`)
  }
}

for (const file of agentFiles.filter((f) => variantPattern.test(f) && !expectedVariants.has(f))) {
  if (check) {
    problems++
    console.log(`✗ agents/${file} has no source agent`)
  } else {
    unlinkSync(path.join(AGENTS_DIR, file))
    console.log(`✗ agents/${file} removed`)
  }
}

// ─── /config rows ───────────────────────────────────────────────────────────

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const { userConfig = {} } = manifest
const isAgentKey = (key) => /_(model|effort)$/.test(key)
const rows = Object.fromEntries(Object.entries(userConfig).filter(([k]) => !isAgentKey(k)))
for (const role of ROLES) {
  const def = (setting) => ROLE_DEFAULTS[role]?.[setting] ?? 'inherit'
  rows[agentOptionKey(role, 'model')] = {
    type: 'string',
    title: `Model — ${role}`,
    description: `Model of the ${role} agents: inherit (the session's model), haiku, sonnet, opus or fable. Default: ${def('model')}.`,
    options: AGENT_SETTINGS.model.values,
    default: def('model'),
  }
  rows[agentOptionKey(role, 'effort')] = {
    type: 'string',
    title: `Effort — ${role}`,
    description: `Reasoning effort of the ${role} agents: inherit (the session's effort), low, medium, high, xhigh or max. Default: ${def('effort')}.`,
    options: AGENT_SETTINGS.effort.values,
    default: def('effort'),
  }
}
const updated = { ...manifest, userConfig: rows }
if (JSON.stringify(updated) !== JSON.stringify(manifest))
  sync(MANIFEST, JSON.stringify(updated, null, 2) + '\n')

if (problems) {
  console.log(`\n${problems} problem(s): run node tracker-plugin/scripts/generate.mjs`)
  process.exit(1)
}
if (check) console.log('✓ agent variants and /config rows up to date')
