#!/usr/bin/env node
// docflow's command-line entry (SPECS § 5). Every command file calls it and branches on
// its output — one `KEY=value` per line, human messages on lines starting with `# ` —
// and on its exit code, never on prose.
//
//   status                                  the chain, the sprint progress, the next command
//   language [code|default]                 show or set the per-project language
//   config [key [value] | key --unset]      show the options, or set one per project
//   repo plan | repo init [--commit] | repo github [--public]
//
// Exit codes: 0 success · 1 nothing to do, a reported problem or a failed git step ·
// 2 unknown document, section, task or sprint · 3 repository missing (REPO=) ·
// 4 gate: predecessor not approved · 5 checks failed · 75 lock held by another session.

import path from 'node:path'
import { LANGUAGES, SUPPORTED, createI18n, resolveLanguage } from './i18n.mjs'
import { REPO_EXIT, initRepo, missingFor, plannedFiles, publishRepo, repoState } from './repo.mjs'
import { blockState } from './lib/claudemd.mjs'
import { CONFIG_FILE, OPTIONS, PLUGIN_ROOT, checksOf, loadConfig, saveProjectOption } from './lib/config.mjs'
import { CHAIN, STAGE_OF, docPath, docStatuses } from './lib/docs.mjs'
import { projectRoot } from './lib/git.mjs'
import { StateError, readState } from './lib/state.mjs'
import { parseTasks, progress } from './lib/tasks.mjs'
import { readText, toPosix } from './lib/util.mjs'

const EXIT = { ok: 0, problem: 1, unknown: 2, repo: REPO_EXIT, gate: 4, checks: 5, busy: 75 }

// ─── Arguments and output ───────────────────────────────────────────────────

/** Flags that take a value (`--unit task` or `--unit=task`); the others are booleans. */
const VALUED = new Set(['unit', 'implementer', 'lang', 'through', 'model', 'effort'])

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a)
    if (!m) {
      positional.push(a)
      continue
    }
    const name = m[1]
    if (m[2] !== undefined) flags[name] = m[2]
    else if (VALUED.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[name] = argv[++i]
    else flags[name] = true
  }
  return { positional, flags }
}

class Exit extends Error {
  constructor(code) {
    super(`exit ${code}`)
    this.exitCode = code
  }
}

const oneLine = (v) => (Array.isArray(v) ? v.join(',') : String(v ?? '')).replace(/[\r\n]+/g, ' ')
const out = (key, value) => process.stdout.write(`${key}=${oneLine(value)}\n`)
const say = (message) => {
  for (const line of String(message).split('\n')) process.stdout.write(`# ${line}\n`)
}
/** Prints `ERROR=<code>` and the message, then stops with `exit`. */
function fail(code, message, exit = EXIT.problem) {
  out('ERROR', code)
  if (message) say(message)
  throw new Exit(exit)
}

// ─── Context ────────────────────────────────────────────────────────────────

const { positional: [verb, ...rest], flags } = parseArgs(process.argv.slice(2))
const root = projectRoot(process.cwd())
const config = loadConfig(root, { language: typeof flags.lang === 'string' ? flags.lang : undefined })
const localesDir = path.join(PLUGIN_ROOT, 'locales')
let i18n = createI18n({ localesDir, language: config.values.language })
let t = i18n.t

function loadState() {
  try {
    return readState(root)
  } catch (e) {
    if (e instanceof StateError) fail(`state-${e.code}`, t(e.code === 'busy' ? 'stateBusy' : 'stateError', { detail: e.detail }))
    throw e
  }
}

// ─── The repository ─────────────────────────────────────────────────────────

const REPO_MESSAGES = { 'no-git': 'repoNoGit', none: 'repoNone', empty: 'repoEmpty', 'no-remote': 'repoNoRemote' }

/** Stops with `REPO=<what is missing>` and exit 3 when the project is not usable. */
function requireRepo(needs = {}) {
  const missing = missingFor(repoState(root), needs)
  if (!missing) return
  out('REPO', missing)
  say(t(REPO_MESSAGES[missing], { dir: toPosix(root) }))
  throw new Exit(EXIT.repo)
}

function cmdRepo() {
  const [action] = rest
  const dir = toPosix(root)
  const current = repoState(root)
  if (current.state === 'no-git') fail('no-git', t('repoNoGit', { dir }))
  if (action === 'plan') {
    out('REPO_STATE', current.state)
    out('REMOTE', current.remote ? 'yes' : 'no')
    if (current.state === 'ready') return say(t('repoAlready', { dir }))
    const { files, flagged } = plannedFiles(root)
    out('FILES', files.length)
    out('FLAGGED', flagged.map((f) => f.path))
    say(t('repoPlanFiles', { n: files.length }))
    if (flagged.length) {
      say(t('repoPlanFlagged'))
      for (const f of flagged) say(`  ${f.path}${f.files > 1 ? ` ×${f.files}` : ''}`)
    } else say(t('repoPlanClean'))
    return
  }
  if (action === 'init') {
    try {
      const { committed } = initRepo(root, { commit: !!flags.commit, message: t('repoInitialCommit') })
      if (current.state === 'none') say(t('repoCreated', { dir }))
      if (flags.commit) say(committed ? t('repoCommitted', { n: committed }) : t('repoNothingToCommit'))
    } catch (e) {
      fail('git', t('repoFailed', { error: String(e.stderr || e.message).trim() }))
    }
    out('REPO_STATE', repoState(root).state)
    return
  }
  if (action === 'github') {
    // Publishes the code: the command runs it only on the user's explicit answer.
    if (current.remote) fail('has-remote', t('repoHasRemote', { dir }))
    if (current.state !== 'ready') fail('empty', t('repoEmpty', { dir }), EXIT.repo)
    try {
      const url = publishRepo(root, { visibility: flags.public ? 'public' : 'private' })
      out('URL', url)
      say(t('repoPublished', { url }))
    } catch (e) {
      fail('gh', t('repoPublishFailed', { error: String(e.stderr || e.message).trim() }))
    }
    return
  }
  fail('usage', t('usage', { syntax: 'repo plan | repo init [--commit] | repo github [--public]' }), EXIT.unknown)
}

// ─── Language and options ───────────────────────────────────────────────────

function cmdLanguage() {
  const [value] = rest
  const list = SUPPORTED.map((c) => `${c} (${LANGUAGES[c].native})`).join(', ')
  if (!value) {
    out('LANGUAGE', i18n.code)
    out('SOURCE', i18n.source)
    say(t('languageCurrent', { name: i18n.name, code: i18n.code, source: t(`source_${i18n.source}`), list }))
    return
  }
  if (value === 'default') {
    saveProjectOption(root, 'language', null)
    i18n = createI18n({ localesDir, language: null })
    out('LANGUAGE', i18n.code)
    return say(i18n.t('languageUnset', { file: CONFIG_FILE }))
  }
  const resolved = resolveLanguage(value)
  if (!resolved.known) fail('language', t('unsupportedLanguage', { value, list }), EXIT.unknown)
  saveProjectOption(root, 'language', resolved.code)
  out('LANGUAGE', resolved.code)
  say(createI18n({ localesDir, language: resolved.code }).t('languageSet', { name: LANGUAGES[resolved.code].native, file: CONFIG_FILE }))
}

function cmdConfig() {
  const [key, value] = rest
  if (!key) {
    for (const k of Object.keys(OPTIONS)) {
      if (k === 'language') continue
      out(k.toUpperCase(), config.values[k])
    }
    const checks = checksOf(config.values, root)
    out('CHECKS_COMMAND', checks.command ?? '')
    out('CHECKS_SOURCE', checks.source ?? 'none')
    return
  }
  if (!OPTIONS[key]) fail('option', t('unknownOption', { key, list: Object.keys(OPTIONS).join(', ') }), EXIT.unknown)
  if (flags.unset) {
    saveProjectOption(root, key, null)
    out('UNSET', key)
    return say(t('configUnset', { key, file: CONFIG_FILE }))
  }
  if (value === undefined) {
    out(key.toUpperCase(), config.values[key])
    out('SOURCE', config.sources[key])
    return
  }
  const parsed = OPTIONS[key].parse(value)
  if (parsed === undefined) fail('value', t('invalidOption', { key, value }), EXIT.unknown)
  saveProjectOption(root, key, parsed)
  out(key.toUpperCase(), parsed)
  say(t('configSet', { key, value: oneLine(parsed), file: CONFIG_FILE }))
}

// ─── Status ─────────────────────────────────────────────────────────────────

/** The TASKS.md a run works on: the run's checkout (its worktree) when there is one. */
const tasksRoot = (state) => state.run?.worktree ?? root

/** The next command and the message that explains it. */
function nextStep(state, statuses) {
  for (const doc of CHAIN) {
    const { status } = statuses[doc]
    const command = `/docflow:${STAGE_OF[doc]}`
    if (status === 'missing') return { command, message: t('nextMissing', { doc, command }) }
    if (status === 'draft') return { command, message: t('nextDraft', { doc, command }) }
    if (status === 'stale') return { command, message: t('nextStale', { doc, command }) }
  }
  if (blockState(root) === 'missing') {
    const command = '/docflow:claude-md'
    return { command, message: t('nextClaudeMd', { command }) }
  }
  if (state.run) {
    const command = '/docflow:do --resume'
    return { command, message: t('nextResume', { unit: state.run.unit, status: state.run.status, command }) }
  }
  const tasks = readText(docPath(tasksRoot(state), 'TASKS'))
  const current = tasks && progress(parseTasks(tasks.text)).current
  if (current) {
    const command = '/docflow:do next'
    return { command, message: t('nextDo', { unit: current.id, title: current.title, command }), unit: current }
  }
  return { command: 'none', message: t('nextNone') }
}

function cmdStatus() {
  const state = loadState()
  const statuses = docStatuses(root, state)
  for (const doc of CHAIN) out(`DOC_${doc}`, statuses[doc].status)
  out('CLAUDE_MD', blockState(root))
  out('APPROVED_ONCE', CHAIN.filter((d) => statuses[d].approvedOnce))
  const tasks = readText(docPath(tasksRoot(state), 'TASKS'))
  const p = tasks ? progress(parseTasks(tasks.text)) : null
  out('SPRINT', p?.current?.id ?? '')
  out('DONE', p?.done ?? 0)
  out('TOTAL', p?.total ?? 0)
  out('RUN', state.run ? `${state.run.status}:${state.run.unit}` : 'none')
  const next = nextStep(state, statuses)
  out('NEXT', next.command)
  for (const p of config.problems) say(t('configProblem', { key: p.key, value: p.value, source: p.source }))
  say(next.message)
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

const VERBS = {
  status: cmdStatus,
  language: cmdLanguage,
  config: cmdConfig,
  repo: cmdRepo,
}

/** What each verb needs of the repository (SPECS § 5, exit 3). */
const NEEDS_REPO = {}

try {
  if (!VERBS[verb]) fail('verb', t('unknownVerb', { verb: verb ?? '', list: Object.keys(VERBS).join(', ') }), EXIT.unknown)
  if (NEEDS_REPO[verb]) requireRepo(NEEDS_REPO[verb](rest[0]))
  VERBS[verb]()
} catch (e) {
  if (e instanceof Exit) process.exitCode = e.exitCode
  else {
    out('ERROR', 'internal')
    say(`docflow: ${e.message}`)
    process.exitCode = EXIT.problem
  }
}
