#!/usr/bin/env node
// docflow's command-line entry (SPECS § 5). Every command file calls it and branches on
// its output — one `KEY=value` per line, human messages on lines starting with `# ` —
// and on its exit code, never on prose.
//
//   status                                  the chain, the sprint progress, the next command
//   stage <doc> [--adopt] [--agent]         gate, skeleton, what to read and what to fill
//   section <DOC> [<n[.m]>|headings]        one section (or the whole document, or its headings)
//   layout                                  a summary of an existing code base (adopt mode)
//   check [doc]                             missing sections, unfilled ones, broken links, grammar
//   approve <doc>                           check, record, mark the following documents stale
//   claude-md                               write or refresh the docflow block of CLAUDE.md
//   translate plan [doc] [--lang l]         changed English sections per twin, in a source file
//   translate apply <doc> <lang> [file]     splice the translated sections into the twin
//   language [code|default]                 show or set the per-project language
//   config [key [value] | key --unset]      show the options, or set one per project
//   repo plan | repo init [--commit] | repo github [--public]
//   issues push | issues pull [--apply]    the GitHub issues mirror of TASKS.md
//
// Exit codes: 0 success · 1 nothing to do, a reported problem or a failed git step ·
// 2 unknown document, section, task or sprint · 3 repository missing (REPO=) ·
// 4 gate: predecessor not approved · 5 checks failed · 75 lock held by another session.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { LANGUAGES, SUPPORTED, createI18n, resolveLanguage } from './i18n.mjs'
import { REPO_EXIT, initRepo, missingFor, plannedFiles, publishRepo, repoState } from './repo.mjs'
import { MAX_LINES, blockLines, blockState, writeBlock } from './lib/claudemd.mjs'
import { CONFIG_FILE, OPTIONS, PLUGIN_ROOT, agentOf, checksOf, loadConfig, saveProjectOption } from './lib/config.mjs'
import {
  CHAIN,
  STAGE_OF,
  basisOf,
  changedSince,
  checkDoc,
  docFingerprint,
  docName,
  docPath,
  docRel,
  docStatuses,
  following,
  indexSections,
  predecessor,
  refreshLinks,
  section,
  sectionFingerprints,
  skeleton,
  strings,
  unfilled,
} from './lib/docs.mjs'
import { currentBranch, defaultBranch, git, projectRoot } from './lib/git.mjs'
import { layoutSummary } from './lib/layout.mjs'
import { applyTwin, checkTwins, planTwin, writeSource } from './lib/translate.mjs'
import { StateError, acquireLock, approve, markStale, readState, releaseLock, updateState } from './lib/state.mjs'
import { createIssue, ensureLabels, labelsFor, listIssues, pullPlan, pushPlan, updateIssue } from './lib/issues.mjs'
import { isManual, nextUnit, parseTasks, progress, recordResult, setDone, setIssue } from './lib/tasks.mjs'
import {
  branchName,
  commitAll,
  commitPaths,
  editTasks,
  openBranch,
  prBody,
  publish,
  readTasks,
  restore,
  runChecks,
  stagedTree,
  subjectOf,
  trackedChanges,
  uncommitted,
} from './lib/run.mjs'
import { sessionOf } from './scope.mjs'
import { isoDate, isoTime, readText, toPosix, writeText } from './lib/util.mjs'

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
// A command's arguments win over every other level of the options (SPECS § 3).
const argOf = (name) => (typeof flags[name] === 'string' ? flags[name] : undefined)
const config = loadConfig(root, { language: verb === 'language' ? undefined : argOf('lang'), unit: argOf('unit'), implementer: argOf('implementer') })
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

/** `updateState` with the state errors turned into messages. */
function changeState(fn) {
  try {
    return updateState(root, fn)
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
function nextStep(state, statuses, { block = blockState(root) } = {}) {
  for (const doc of CHAIN) {
    const { status } = statuses[doc]
    const command = `/docflow:${STAGE_OF[doc]}`
    if (status === 'missing') return { command, message: t('nextMissing', { doc, command }) }
    if (status === 'draft' && !unfilled(statuses[doc].text).length) {
      const approveCommand = `/docflow:approve ${STAGE_OF[doc]}`
      return { command: approveCommand, message: t('nextApprove', { doc, command: approveCommand }) }
    }
    if (status === 'draft') return { command, message: t('nextDraft', { doc, command }) }
    if (status === 'stale') return { command, message: t('nextStale', { doc, command }) }
  }
  if (block === 'missing') {
    const command = '/docflow:claude-md'
    return { command, message: t('nextClaudeMd', { command }) }
  }
  if (state.run) {
    const command = '/docflow:do --resume'
    return { command, message: t('nextResume', { unit: state.run.unit, status: state.run.status, command }) }
  }
  const tasks = readText(docPath(tasksRoot(state), 'TASKS'))
  const parsed = tasks && parseTasks(tasks.text)
  const pending = livePending(state, parsed)
  const unit = parsed && nextUnit(parsed, 'next', { mode: config.values.unit, skip: pending.map((p) => p.unit) })
  if (unit) {
    const command = '/docflow:do next'
    return { command, message: t('nextDo', { unit: unit.id, title: unit.title, command }), unit }
  }
  if (pending.length) return { command: 'none', message: t('nextPending', { list: pending.map((p) => `${p.unit} ${p.pr}`).join(', ') }) }
  return { command: 'none', message: t('nextNone') }
}

/**
 * The finished runs whose pull request is not merged yet: those whose tasks are not all
 * ticked in the checkout's TASKS.md (a merge brings the ticks in).
 */
function livePending(state, parsed) {
  if (!parsed) return state.pending ?? []
  return (state.pending ?? []).filter((p) => {
    const unit = nextUnit(parsed, p.unit)
    return unit && !unit.done
  })
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
  out('PENDING', livePending(state, tasks && parseTasks(tasks.text)).map((p) => p.unit))
  const next = nextStep(state, statuses)
  out('NEXT', next.command)
  for (const p of config.problems) say(t('configProblem', { key: p.key, value: p.value, source: p.source }))
  say(next.message)
}

// ─── Documents ──────────────────────────────────────────────────────────────

const docList = CHAIN.map((d) => STAGE_OF[d]).join(', ')

/** The document named by the first argument, or exit 2. */
function requireDoc(value) {
  const doc = docName(value)
  if (!doc) fail('doc', t('unknownDoc', { doc: value ?? '', list: docList }), EXIT.unknown)
  return doc
}

/** Exit 4 unless the document before `doc` is approved. */
function requireGate(doc, statuses) {
  const prev = predecessor(doc)
  if (!prev || statuses[prev].status === 'approved') return
  out('GATE', prev)
  fail('gate', t('gate', { doc, prev, status: statuses[prev].status, command: `/docflow:${STAGE_OF[prev]}` }), EXIT.gate)
}

/** Rewrites the link lines of an English document for the configured translations. */
function refreshEnglishLinks(doc) {
  const file = docPath(root, doc)
  const current = readText(file)
  if (!current) return
  const updated = refreshLinks(current.text, doc, 'en', config.values.doc_languages)
  if (updated !== current.text) writeText(file, updated, current.eol)
}

/** What a stage reads before writing (PRD § 6.1, T-3): whole documents, sections, headings. */
function inputsOf(doc, adopt) {
  const layout = adopt ? ['LAYOUT'] : []
  if (doc === 'PRD') return layout
  if (doc === 'ARCHITECTURE') return ['PRD', ...layout]
  if (doc === 'SPECS') return ['PRD', 'ARCHITECTURE']
  const arch = readText(docPath(root, 'ARCHITECTURE'))
  const plan = arch && indexSections(arch.text).sections.find((s) => s.level === 2 && strings('en').deliveryPlan.some((w) => s.title.toLowerCase().includes(w.toLowerCase())))
  return [plan ? `ARCHITECTURE § ${plan.id}` : 'ARCHITECTURE', 'SPECS headings']
}

function cmdStage() {
  const doc = requireDoc(rest[0])
  const state = loadState()
  const statuses = docStatuses(root, state)
  requireGate(doc, statuses)
  const adopt = !!flags.adopt || !!state.adopt
  if (flags.adopt && !state.adopt) changeState((s) => void (s.adopt = true))
  const langs = config.values.doc_languages
  const { created, file } = skeleton(root, doc, { langs, adopt })
  if (!created) refreshEnglishLinks(doc)
  const text = readText(file).text
  const status = created ? 'draft' : statuses[doc].status
  const todo = unfilled(text)
  out('DOC', docRel(doc))
  out('CREATED', created ? 1 : 0)
  out('STATUS', status)
  out('INPUTS', inputsOf(doc, adopt))
  out('SECTIONS', todo.map((u) => u.id))
  if (status === 'stale') out('CHANGED', changedSince(root, doc, state.docs[doc]))
  out('LANGS', langs)
  out('ADOPT', adopt ? 1 : 0)
  const writer = agentOf(config.values, 'writer')
  const agent = !!flags.agent || writer.model !== 'inherit' || writer.effort !== 'inherit'
  out('WRITER', agent ? 'agent' : 'session')
  if (agent) {
    out('AGENT', writer.type)
    out('MODEL', writer.model)
  }
  if (created) say(t('stageCreated', { file: docRel(doc), n: todo.length }))
  else if (status === 'stale') say(t('stageStale', { doc }))
  else say(todo.length ? t('stageResume', { file: docRel(doc), n: todo.length }) : t('stageFilled', { file: docRel(doc), doc: STAGE_OF[doc] }))
}

function cmdSection() {
  // `section SPECS 3.2`, `section "SPECS § 3.2"`, `section SPECS § 3.2`, `section PRD`, `section SPECS headings`.
  const words = rest.join(' ').split(/\s+/).filter((w) => w && w !== '§')
  if (words[0]?.toUpperCase() === 'LAYOUT') return cmdLayout()
  const doc = requireDoc(words[0])
  const ref = words.slice(1).join(' ').replace(/^§\s*/, '')
  const file = readText(docPath(state0().run?.worktree ?? root, doc)) ?? readText(docPath(root, doc))
  if (!file) fail('missing', t('docMissing', { file: docRel(doc) }), EXIT.unknown)
  if (!ref) return process.stdout.write(`${file.text.replace(/\s+$/, '')}\n`)
  if (ref.toLowerCase() === 'headings') {
    const { sections } = indexSections(file.text)
    return process.stdout.write(`${sections.map((s) => s.heading).join('\n')}\n`)
  }
  const text = section(file.text, ref)
  if (text === null) fail('section', t('unknownSection', { doc, ref }), EXIT.unknown)
  process.stdout.write(`${text}\n`)
}

/** The state without failing (the section verb reads it only to find a run's worktree). */
function state0() {
  try {
    return readState(root)
  } catch {
    return {}
  }
}

function cmdLayout() {
  process.stdout.write(`${layoutSummary(root).join('\n')}\n`)
}

/** Problems of the given documents (every existing one without argument), as `# ` lines. */
function problemsOf(docs, state = loadState()) {
  const problems = []
  for (const doc of docs) {
    problems.push(...checkDoc(root, doc))
    problems.push(...checkTwins(root, state, doc, config.values.doc_languages))
  }
  return problems
}

// ─── Translations ───────────────────────────────────────────────────────────

/** The languages a translate verb works on: `--lang`, else the `doc_languages` option. */
function translateLangs() {
  if (typeof flags.lang === 'string') {
    const lang = flags.lang.toLowerCase()
    if (!['fr', 'es', 'de'].includes(lang)) fail('language', t('unsupportedDocLanguage', { value: flags.lang }), EXIT.unknown)
    return [lang]
  }
  return config.values.doc_languages
}

function cmdTranslate() {
  const [action, docArg, langArg, fileArg] = rest
  if (action === 'plan') {
    const docs = docArg ? [requireDoc(docArg)] : CHAIN.filter((d) => readText(docPath(root, d)))
    const langs = translateLangs()
    if (!langs.length) {
      out('LANGS', '')
      return say(t('translateNoLanguage'))
    }
    const state = loadState()
    let total = 0
    for (const doc of docs) {
      refreshEnglishLinks(doc)
      for (const lang of langs) {
        const plan = planTwin(root, state, doc, lang)
        if (!plan) continue
        const files = plan.changed.length ? writeSource(root, doc, lang, plan) : null
        total += plan.changed.length
        process.stdout.write(
          `DOC=${doc} LANG=${lang} CHANGED=${plan.changed.join(',')} REMOVED=${plan.removed.join(',')}${files ? ` SOURCE=${files.source} TARGET=${files.target}` : ''}\n`
        )
      }
    }
    out('TOTAL', total)
    const translator = agentOf(config.values, 'translator')
    out('AGENT', translator.type)
    out('MODEL', translator.model)
    return say(total ? t('translatePlan', { n: total }) : t('translateNothing'))
  }
  if (action === 'apply') {
    const doc = requireDoc(docArg)
    const lang = String(langArg ?? '').toLowerCase()
    if (!['fr', 'es', 'de'].includes(lang)) fail('language', t('unsupportedDocLanguage', { value: langArg ?? '' }), EXIT.unknown)
    const file = readText(path.resolve(root, fileArg ?? `.docflow/translate/${doc}.${lang}.md`))
    if (!file) fail('file', t('translateNoFile', { file: fileArg ?? `.docflow/translate/${doc}.${lang}.md` }), EXIT.unknown)
    // A refused splice returns before touching the twin or the state.
    const result = changeState((s) => applyTwin(root, s, doc, lang, file.text))
    if (result.missing) fail('missing', t('translateMissing', { list: result.missing.join(', ') }), EXIT.unknown)
    if (result.invalid) fail('invalid', t('translateInvalid', { list: result.invalid.join(', ') }), EXIT.unknown)
    out('FILE', docRel(doc, lang))
    out('UPDATED', result.updated)
    out('REMOVED', result.removed)
    return say(t('translateApplied', { file: docRel(doc, lang), n: result.updated.length }))
  }
  fail('usage', t('usage', { syntax: 'translate plan [doc] [--lang fr|es|de] | translate apply <doc> <lang> [file]' }), EXIT.unknown)
}

function printProblems(problems, limit = 40) {
  out('ISSUES', problems.length)
  for (const p of problems.slice(0, limit)) say(`${p.file}${p.line > 0 ? `:${p.line}` : ''} ${t(`check_${p.key}`, p.vars)}`)
  if (problems.length > limit) say(t('checkMore', { n: problems.length - limit }))
}

function cmdCheck() {
  const docs = rest[0] ? [requireDoc(rest[0])] : CHAIN.filter((d) => readText(docPath(root, d)))
  const problems = problemsOf(docs)
  printProblems(problems)
  if (problems.length) throw new Exit(EXIT.problem)
  say(t('checkClean', { list: docs.join(', ') || '—' }))
}

/** The `Next:` of the CLAUDE.md block: the next command, with the unit when it is `do next`. */
function blockNext(state) {
  const next = nextStep(state, docStatuses(root, state), { block: 'present' })
  if (next.unit) return `\`${next.command}\` — ${next.unit.id} — ${next.unit.title}`
  return `\`${next.command}\``
}

function refreshBlock(state, { create = false } = {}) {
  if (!create && blockState(root) === 'missing') return { status: 'absent', lines: 0 }
  const lines = blockLines({ langs: config.values.doc_languages, base: defaultBranch(root), next: blockNext(state) })
  return writeBlock(root, lines.slice(0, MAX_LINES))
}

function cmdApprove() {
  const doc = requireDoc(rest[0])
  const state = loadState()
  const statuses = docStatuses(root, state)
  if (statuses[doc].status === 'missing') fail('missing', t('docMissing', { file: docRel(doc) }))
  requireGate(doc, statuses)
  const problems = problemsOf([doc])
  if (problems.length) {
    printProblems(problems)
    say(t('approveRefused', { doc }))
    throw new Exit(EXIT.problem)
  }
  const text = statuses[doc].text
  const fp = docFingerprint(doc, text)
  const stale = changeState((s) => {
    const before = s.docs[doc]
    approve(s, doc, fp)
    s.docs[doc].sections = sectionFingerprints(doc, text)
    s.docs[doc].basis = basisOf(root, doc)
    return !before || before.fingerprint !== fp ? markStale(s, following(doc)) : []
  })
  const after = loadState()
  const block = refreshBlock(after)
  out('APPROVED', doc)
  out('STALE', stale)
  out('CLAUDE_MD', block.status)
  const next = nextStep(after, docStatuses(root, after))
  out('NEXT', next.command)
  say(t('approved', { doc }))
  if (stale.length) say(t('approvedStale', { list: stale.join(', ') }))
  say(next.message)
}

function cmdClaudeMd() {
  const state = loadState()
  const { status, lines } = refreshBlock(state, { create: true })
  out('CLAUDE_MD', status)
  out('LINES', lines)
  say(t(`claudeMd_${status}`))
}

// ─── Implementation ─────────────────────────────────────────────────────────

// Null outside Claude Code: the guard then keeps its repository limit only (scope.mjs).
const session = sessionOf()
/** What must be committed before a run starts: the documents and the project options. */
const DOC_PATHS = ['docs', 'CLAUDE.md', '.docflow/config.json', '.docflow/.gitignore']

function requireRun(state) {
  if (!state.run) fail('no-run', t('noRun'))
  return state.run
}

const workdirOf = (run) => run.worktree ?? root

/** Runs a git or gh step; on failure prints the command and the end of its output, exit 1. */
function gitStep(fn) {
  try {
    return fn()
  } catch (e) {
    if (e instanceof Exit) throw e
    out('ERROR', 'git')
    say(t('gitFailed', { command: e.command ?? e.message }))
    if (e.output) say(e.output)
    throw new Exit(EXIT.problem)
  }
}

/** The run's task (or acceptance entry) `id`, from the run's TASKS.md; exit 2 when unknown. */
function runItem(run, id) {
  const parsed = readTasks(workdirOf(run))
  const item = parsed?.items.find((i) => i.id === String(id ?? '').toUpperCase().replace(/ ACCEPTANCE$/, ' acceptance'))
  if (!item) fail('task', t('unknownTask', { id: id ?? '' }), EXIT.unknown)
  return item
}

function printRun(run) {
  out('UNIT', run.unit)
  out('KIND', run.kind)
  out('TASKS', run.tasks.filter((id) => !run.done.includes(id)))
  out('ACCEPTANCE', run.kind === 'sprint' && !run.acceptance ? 1 : 0)
  out('BRANCH', run.branch)
  out('WORKDIR', toPosix(workdirOf(run)))
  out('IMPLEMENTER', run.implementer)
  if (run.implementer !== 'session') {
    const agent = agentOf(config.values, 'implementer')
    out('AGENT', agent.type)
    out('MODEL', agent.model)
  }
  out('CHECKS', checksOf(config.values, root).command ?? '')
}

function takeLock(state, { takeover, force = false }) {
  const lock = changeState((s) => acquireLock(s, session, { takeover, force }))
  if (lock.ok) return
  out('LOCK', lock.lock.session)
  out('SINCE', lock.lock.since)
  const expired = lock.reason === 'expired'
  fail(expired ? 'lock-expired' : 'lock-busy', t(expired ? 'lockExpired' : 'lockBusy', { since: lock.lock.since, expires: lock.lock.expires }), EXIT.busy)
}

function doStart() {
  const arg = (rest[1] ?? 'next').replace(/^s/, 'S')
  const state = loadState()
  if (state.run) {
    if (!flags.resume && arg !== 'next' && arg.toUpperCase() !== state.run.unit)
      fail('run-active', t('runActive', { unit: state.run.unit, status: state.run.status }))
    return doResume(state)
  }
  if (flags.resume) fail('no-run', t('noRun'))
  const statuses = docStatuses(root, state)
  if (statuses.TASKS.status !== 'approved') {
    out('GATE', 'TASKS')
    fail('gate', t('doGate', { status: statuses.TASKS.status }), EXIT.gate)
  }
  const dirty = uncommitted(root, DOC_PATHS)
  if (dirty.length && !flags['commit-docs']) {
    out('UNCOMMITTED', dirty)
    fail('docs-uncommitted', t('docsUncommitted', { list: dirty.slice(0, 6).join(', ') }))
  }
  const parsed = readTasks(root)
  const pending = livePending(state, parsed)
  const unit = nextUnit(parsed, arg, { mode: config.values.unit, skip: pending.map((p) => p.unit) })
  if (!unit) fail(arg === 'next' ? 'nothing' : 'unit', arg === 'next' ? t('nothingNext') : t('unknownUnit', { unit: arg }), arg === 'next' ? EXIT.problem : EXIT.unknown)
  if (unit.done) fail('done', t('unitDone', { unit: unit.id }))
  const worktree = flags.worktree ? true : flags['in-place'] ? false : config.values.worktree === 'on'
  if (!worktree && trackedChanges(root).filter((l) => !dirty.some((d) => l.endsWith(d))).length) fail('dirty', t('dirtyTree'))
  if (dirty.length) {
    const sha = gitStep(() => commitPaths(root, DOC_PATHS, 'docs: docflow documents'))
    out('DOCS_COMMIT', sha ?? '')
  }
  takeLock(state, { takeover: !!flags.takeover })
  const base = defaultBranch(root)
  const stacked = pending.at(-1) ?? null
  const branch = branchName(config.values.branch_prefix, unit.id, unit.title)
  const origin = currentBranch(root)
  let opened
  try {
    opened = openBranch(root, { branch, startPoint: stacked?.branch ?? base, worktree, unit: unit.id })
  } catch (e) {
    changeState((s) => void releaseLock(s, session))
    gitStep(() => {
      throw e
    })
  }
  const sprintTasks = unit.kind === 'sprint' ? unit.sprint.tasks : unit.tasks
  const run = {
    unit: unit.id,
    kind: unit.kind,
    title: unit.title,
    tasks: sprintTasks.map((x) => x.id),
    done: sprintTasks.filter((x) => x.done).map((x) => x.id),
    status: 'running',
    base,
    branch,
    worktree: opened.worktree,
    origin_branch: origin,
    implementer: config.values.implementer,
    current: null,
    passed: null,
    failed: null,
    acceptance: null,
    stacked_on: stacked ? { unit: stacked.unit, pr: stacked.pr, branch: stacked.branch } : null,
    started: isoTime(),
  }
  changeState((s) => {
    s.run = run
    s.guard = { session, root, worktree: opened.worktree, base }
  })
  printRun(run)
  say(t('runStarted', { unit: unit.id, title: unit.title, branch }))
  if (stacked) say(t('runStacked', { unit: stacked.unit, pr: stacked.pr }))
}

function doResume(state) {
  const run = state.run
  // A failed run was left by its session: another one may take it over.
  takeLock(state, { takeover: !!flags.takeover, force: run.status === 'failed' })
  if (run.worktree && !existsSync(run.worktree)) fail('worktree', t('runWorktreeMissing', { dir: toPosix(run.worktree) }))
  if (!run.worktree && currentBranch(root) !== run.branch) {
    if (trackedChanges(root).length) fail('dirty', t('dirtyTree'))
    gitStep(() => git(['checkout', '-q', run.branch], root))
  }
  const parsed = readTasks(workdirOf(run))
  const done = run.tasks.filter((id) => parsed.items.find((i) => i.id === id)?.done)
  const updated = changeState((s) => {
    Object.assign(s.run, { status: 'running', failed: null, done })
    s.guard = { session, root, worktree: run.worktree, base: run.base }
    return s.run
  })
  printRun(updated)
  say(t('runResumed', { unit: run.unit, n: run.tasks.length - done.length }))
}

function cmdTaskShow() {
  if (rest[0] !== 'show') fail('usage', t('usage', { syntax: 'task show <id>' }), EXIT.unknown)
  const state = loadState()
  const dir = state.run ? workdirOf(state.run) : root
  const parsed = readTasks(dir)
  const id = String(rest[1] ?? '').toUpperCase().replace(/ ACCEPTANCE$/, ' acceptance')
  const item = parsed?.items.find((i) => i.id === id)
  if (!item) fail('task', t('unknownTask', { id: rest[1] ?? '' }), EXIT.unknown)
  const parts = [parsed.lines.slice(item.line, item.end + 1).join('\n')]
  const texts = {}
  for (const ref of item.refs) {
    const [doc, n] = ref.split(' § ')
    texts[doc] ??= readText(docPath(dir, doc))?.text ?? null
    const text = texts[doc] && section(texts[doc], n)
    parts.push(text ? `<!-- ${ref} -->\n${text}` : `# ${t('taskRefMissing', { ref })}`)
  }
  process.stdout.write(`${parts.join('\n\n')}\n`)
  if (state.run?.tasks.includes(item.id)) changeState((s) => void (s.run.current = item.id))
}

function doCheck() {
  const state = loadState()
  const run = requireRun(state)
  const item = runItem(run, rest[1] ?? run.current)
  const checks = checksOf(config.values, root)
  if (!checks.command) {
    out('CHECKS', 'unset')
    fail('checks-unset', t('checksUnset'))
  }
  const dir = workdirOf(run)
  const tree = gitStep(() => stagedTree(dir))
  const result = runChecks(root, dir, checks.command, item.id.replace(' ', '-'))
  if (result.pass) {
    changeState((s) => {
      s.run.passed = { id: item.id, tree }
      s.run.current = item.id
    })
    out('CHECKS', 'pass')
    return say(t('checksPassed', { command: checks.command, id: item.id }))
  }
  changeState((s) => {
    Object.assign(s.run, { status: 'failed', failed: { id: item.id, reason: 'checks' }, current: item.id })
  })
  out('CHECKS', 'fail')
  out('LOG', toPosix(path.relative(root, result.log)))
  say(t('checksFailed', { command: checks.command, id: item.id, n: 60 }))
  say(result.tail)
  throw new Exit(EXIT.checks)
}

function doCommit() {
  const state = loadState()
  const run = requireRun(state)
  const item = runItem(run, rest[1] ?? run.current)
  if (!run.tasks.includes(item.id)) fail('not-in-run', t('notInRun', { id: item.id, unit: run.unit }))
  if (run.passed?.id !== item.id) fail('not-checked', t('notChecked', { id: item.id }))
  const dir = workdirOf(run)
  if (gitStep(() => stagedTree(dir)) !== run.passed.tree) fail('changed', t('changedSinceCheck', { id: item.id }))
  editTasks(dir, (text) => setDone(text, item.id, true))
  const sha = gitStep(() => commitAll(dir, subjectOf(item.id, item.title), item.refs.length ? `Refs: ${item.refs.join(', ')}.` : null))
  const updated = changeState((s) => {
    if (!s.run.done.includes(item.id)) s.run.done.push(item.id)
    Object.assign(s.run, { passed: null, current: null, failed: null, status: 'running' })
    return s.run
  })
  out('COMMIT', sha)
  out('TICKED', item.id)
  out('REMAINING', updated.tasks.filter((id) => !updated.done.includes(id)))
  say(t('committed', { id: item.id, sha }))
}

function doAcceptance() {
  const state = loadState()
  const run = requireRun(state)
  const sprint = String(rest[1] ?? run.unit).toUpperCase()
  const item = readTasks(workdirOf(run))?.items.find((i) => i.id === `${sprint} acceptance`)
  if (!item) fail('acceptance', t('acceptanceNone', { sprint }), EXIT.unknown)
  out('TEST', item.text)
  out('MANUAL', isManual(item.text) ? 1 : 0)
  out('WORKDIR', toPosix(workdirOf(run)))
  const agent = agentOf(config.values, 'acceptance')
  out('AGENT', agent.type)
  out('MODEL', agent.model)
}

function doResult() {
  const state = loadState()
  const run = requireRun(state)
  const [, sprintArg, status, ...words] = rest
  const sprint = String(sprintArg ?? '').toUpperCase()
  const evidence = words.join(' ').trim()
  if (!['passed', 'failed'].includes(status) || !evidence)
    fail('usage', t('usage', { syntax: 'do result <sprint> passed|failed "<evidence>"' }), EXIT.unknown)
  const dir = workdirOf(run)
  const changed = editTasks(dir, (text) => recordResult(text, sprint, status, evidence, isoDate()))
  if (!changed.length) fail('acceptance', t('acceptanceNone', { sprint }), EXIT.unknown)
  const sha = gitStep(() => commitAll(dir, `${sprint} acceptance: ${status}`, evidence))
  changeState((s) => void (s.run.acceptance = { status, evidence }))
  out('RECORDED', sprint)
  out('TICKED', status === 'passed' ? 1 : 0)
  out('COMMIT', sha)
  say(t('resultRecorded', { sprint, status }))
}

function doFinish() {
  const state = loadState()
  const run = requireRun(state)
  const remaining = run.tasks.filter((id) => !run.done.includes(id))
  if (remaining.length) fail('unfinished', t('unfinished', { list: remaining.join(', ') }))
  if (run.kind === 'sprint' && !run.acceptance) fail('no-acceptance', t('noAcceptanceResult', { sprint: run.unit }))
  requireRepo({ commit: true, remote: true })
  const dir = workdirOf(run)
  const parsed = readTasks(dir)
  const items = run.tasks.map((id) => parsed.items.find((i) => i.id === id)).filter(Boolean)
  const acceptance = parsed.items.find((i) => i.id === `${run.unit} acceptance`)
  const closes = [...items.filter((i) => i.done && i.issue), ...(acceptance?.done && acceptance.issue ? [acceptance] : [])].map((i) => i.issue)
  changeState((s) => void (s.run.status = 'finishing'))
  const checks = checksOf(config.values, root).command
  const body = prBody({ unit: run, tasks: items, checks, acceptance: run.acceptance, closes, stackedOn: run.stacked_on?.pr ?? null })
  const url = gitStep(() => publish(root, dir, { branch: run.branch, base: run.base, title: `${run.unit}: ${run.title}`, body }))
  const restored = gitStep(() => restore(root, run))
  const after = changeState((s) => {
    s.pending = [...(s.pending ?? []).filter((p) => p.unit !== run.unit), { unit: run.unit, branch: run.branch, pr: url }]
    s.run = null
    s.guard = null
    releaseLock(s, session, { force: true })
    return s
  })
  const block = refreshBlock(after)
  out('PR', url)
  out('RESTORED', restored.restored ?? '')
  if (restored.removed) out('WORKTREE_REMOVED', toPosix(restored.removed))
  out('CLAUDE_MD', block.status)
  say(t('finished', { unit: run.unit, url }))
}

function doFail() {
  const state = loadState()
  const run = requireRun(state)
  const item = runItem(run, rest[1] ?? run.current)
  const reason = rest.slice(2).join(' ').trim() || 'reported'
  changeState((s) => void Object.assign(s.run, { status: 'failed', failed: { id: item.id, reason } }))
  out('FAILED', item.id)
  say(t('failedRecorded', { id: item.id, command: '/docflow:do --resume' }))
}

function doAbort() {
  const state = loadState()
  const run = requireRun(state)
  const restored = gitStep(() => restore(root, run))
  changeState((s) => {
    s.run = null
    s.guard = null
    releaseLock(s, session, { force: true })
  })
  out('ABORTED', run.unit)
  out('BRANCH', run.branch)
  out('RESTORED', restored.restored ?? '')
  say(t('aborted', { unit: run.unit, branch: run.branch }))
}

function cmdDo() {
  const sub = rest[0]
  const verbs = { start: doStart, check: doCheck, commit: doCommit, acceptance: doAcceptance, result: doResult, finish: doFinish, fail: doFail, abort: doAbort }
  if (!verbs[sub]) fail('usage', t('usage', { syntax: `do ${Object.keys(verbs).join('|')}` }), EXIT.unknown)
  verbs[sub]()
}

// ─── Issues mirror ──────────────────────────────────────────────────────────

/** Human lines of a verb stay within the output budget (SPECS § 10). */
const LIST_MAX = 12

function sayList(entries, key) {
  for (const e of entries.slice(0, LIST_MAX)) say(t(key, { id: e.item.id, number: e.issue.number }))
  if (entries.length > LIST_MAX) say(t('checkMore', { n: entries.length - LIST_MAX }))
}

function cmdIssues() {
  const [action] = rest
  if (!['push', 'pull'].includes(action)) fail('usage', t('usage', { syntax: 'issues push | issues pull [--apply]' }), EXIT.unknown)
  if (config.values.issues !== 'mirror') {
    out('ISSUES', config.values.issues)
    fail('issues-off', t('issuesOff'))
  }
  const state = loadState()
  // TASKS.md is written in the main checkout: during a run it belongs to the run.
  if (state.run) fail('run-active', t('issuesRunActive', { unit: state.run.unit, status: state.run.status }))
  const parsed = readTasks(root)
  if (!parsed) fail('missing', t('docMissing', { file: docRel('TASKS') }), EXIT.unknown)
  const issues = gitStep(() => listIssues(root))
  if (action === 'push') return issuesPush(parsed, issues)
  issuesPull(parsed, issues)
}

function issuesPush(parsed, issues) {
  const plan = pushPlan(parsed, issues)
  const created = []
  try {
    const needed = [...plan.create.flatMap(labelsFor), ...plan.update.flatMap((u) => u.missing)]
    if (needed.length) gitStep(() => ensureLabels(root, needed))
    for (const item of plan.create) created.push({ id: item.id, number: gitStep(() => createIssue(root, root, item)) })
    for (const u of plan.update) gitStep(() => updateIssue(root, root, u))
  } finally {
    // Even when gh stops half-way, the numbers of the issues already created are written.
    const numbers = [...plan.numbers, ...created]
    if (numbers.length) editTasks(root, (text) => numbers.reduce((acc, { id, number }) => setIssue(acc, id, number) ?? acc, text))
  }
  const numbered = plan.numbers.length + created.length
  out('CREATED', created.map((c) => c.id))
  out('UPDATED', plan.update.map((u) => u.item.id))
  out('UNCHANGED', plan.unchanged.length)
  out('NUMBERED', numbered)
  say(t('issuesPushed', { created: created.length, updated: plan.update.length, unchanged: plan.unchanged.length }))
  if (numbered) say(t('issuesNumbered', { n: numbered, file: docRel('TASKS') }))
}

function issuesPull(parsed, issues) {
  const plan = pullPlan(parsed, issues)
  out('CLOSED', plan.closed.map((c) => c.item.id))
  out('REOPENED', plan.reopened.map((c) => c.item.id))
  const apply = !!flags.apply && (plan.closed.length || plan.reopened.length)
  if (apply) {
    const ticks = [...plan.closed.map((c) => [c.item.id, true]), ...plan.reopened.map((c) => [c.item.id, false])]
    editTasks(root, (text) => ticks.reduce((acc, [id, done]) => setDone(acc, id, done) ?? acc, text))
  }
  out('APPLIED', apply ? 1 : 0)
  if (!plan.closed.length && !plan.reopened.length) return say(t('issuesInSync'))
  sayList(plan.closed, 'issuesClosedOutside')
  sayList(plan.reopened, 'issuesReopenedOutside')
  say(apply ? t('issuesApplied', { file: docRel('TASKS') }) : t('issuesApplyHint'))
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

const VERBS = {
  status: cmdStatus,
  stage: cmdStage,
  section: cmdSection,
  layout: cmdLayout,
  check: cmdCheck,
  approve: cmdApprove,
  'claude-md': cmdClaudeMd,
  translate: cmdTranslate,
  task: cmdTaskShow,
  do: cmdDo,
  language: cmdLanguage,
  config: cmdConfig,
  repo: cmdRepo,
  issues: cmdIssues,
}

/** What each verb needs of the repository (SPECS § 5, exit 3). */
const NEEDS_REPO = {
  stage: () => ({}),
  // `do finish` checks its remote itself, after the unit is known to be complete.
  do: (sub) => ({ commit: true, remote: sub === 'start' }),
  issues: () => ({ commit: true, remote: true }),
}

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
