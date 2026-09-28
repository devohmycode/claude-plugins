#!/usr/bin/env node
// Writes what the plugin derives from its own sources, so that it cannot drift:
//
//   - the /config rows (`userConfig` of .claude-plugin/plugin.json) of every option but
//     `language`, which scripts/sync-shared.mjs owns (SPECS § 3);
//   - one variant of each agent per reasoning effort (`agents/<agent>-<effort>.md`):
//     the Agent tool takes a model per call but no effort, and an agent's effort can
//     only come from its frontmatter.
//
//   node docflow/scripts/generate.mjs           write them
//   node docflow/scripts/generate.mjs --check   change nothing; exit 1 if one is stale

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { AGENTS, AGENT_DEFAULTS, EFFORTS, MODELS, PLUGIN_ROOT } from './lib/config.mjs'

const check = process.argv.includes('--check')
const VARIANT_EFFORTS = EFFORTS.filter((e) => e !== 'inherit')
const AGENTS_DIR = path.join(PLUGIN_ROOT, 'agents')
const MANIFEST = path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')
const variantPattern = new RegExp(`-(${VARIANT_EFFORTS.join('|')})\\.md$`)

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
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, expected, 'utf8')
    console.log(`↻ ${rel}`)
  }
}

// ─── /config rows ───────────────────────────────────────────────────────────

const choice = (title, description, options, def) => ({ type: 'string', title, description, options, default: def })
const ROWS = {
  doc_languages: {
    type: 'string',
    title: 'Document translations',
    description:
      'Translations written next to each English document, comma-separated: fr, es, de (docs/PRD-FR.md…). Empty: none. Only changed sections are translated again.',
    default: '',
  },
  unit: choice(
    'Unit of work',
    'What /docflow:do next takes: sprint (every task of the current sprint, then its acceptance test, on one branch) or task (the first unticked task).',
    ['task', 'sprint'],
    'sprint'
  ),
  implementer: choice(
    'Implementer',
    'Who writes the code: session (the current session — fewest tokens, the code read stays loaded), task (one fresh agent per task) or sprint (one agent per sprint).',
    ['task', 'sprint', 'session'],
    'session'
  ),
  worktree: choice(
    'Worktree',
    'on: each run gets its own worktree next to the repository, your checkout does not move. off: the branch is created in your checkout (tracked files clean), which goes back to its branch after the pull request.',
    ['on', 'off'],
    'off'
  ),
  issues: choice(
    'GitHub issues',
    'mirror: /docflow:issues push mirrors each unticked task as a GitHub issue (deduplicated, readable by the tracker plugin) and pull requests close them. off: TASKS.md only.',
    ['off', 'mirror'],
    'off'
  ),
  checks: {
    type: 'string',
    title: 'Checks command',
    description:
      'Shell command that must pass after each task (cargo test --locked, npm test…). Empty: detected from the project (Cargo.toml, package.json, pyproject.toml, go.mod), else asked once.',
    default: '',
  },
  branch_prefix: {
    type: 'string',
    title: 'Branch prefix',
    description: 'Prefix of the run branches, ending with / (docflow/S2-placement).',
    default: 'docflow/',
  },
}
for (const agent of AGENTS) {
  const def = AGENT_DEFAULTS[agent]
  ROWS[`${agent}_model`] = choice(
    `Model — ${agent}`,
    `Model of the ${agent} agent: inherit (the session's model), haiku, sonnet, opus or fable. Default: ${def.model}.`,
    MODELS,
    def.model
  )
  ROWS[`${agent}_effort`] = choice(
    `Effort — ${agent}`,
    `Reasoning effort of the ${agent} agent: inherit (the session's effort), low, medium, high, xhigh or max. Default: ${def.effort}.`,
    EFFORTS,
    def.effort
  )
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const userConfig = { ...(manifest.userConfig?.language ? { language: manifest.userConfig.language } : {}), ...ROWS }
const updated = { ...manifest, userConfig }
if (JSON.stringify(updated) !== JSON.stringify(manifest)) sync(MANIFEST, JSON.stringify(updated, null, 2) + '\n')

// ─── Agent variants ─────────────────────────────────────────────────────────

const agentFiles = existsSync(AGENTS_DIR) ? readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md')) : []
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
  for (const effort of VARIANT_EFFORTS) {
    const variant = `${name}-${effort}.md`
    expectedVariants.add(variant)
    const frontmatter = [
      `name: ${name}-${effort}`,
      `description: docflow:${name} at ${effort} reasoning effort — same role and instructions. Launched by the docflow commands when the ${name}'s effort is ${effort}.`,
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

if (problems) {
  console.log(`\n${problems} problem(s): run node docflow/scripts/generate.mjs`)
  process.exit(1)
}
if (check) console.log('✓ docflow: agent variants and /config rows up to date')
