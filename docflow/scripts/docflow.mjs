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
//
// Exit codes: 0 success · 1 nothing to do, a reported problem or a failed git step ·
// 2 unknown document, section, task or sprint · 3 repository missing (REPO=) ·
// 4 gate: predecessor not approved · 5 checks failed · 75 lock held by another session.

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
import { defaultBranch, projectRoot } from './lib/git.mjs'
import { layoutSummary } from './lib/layout.mjs'
import { applyTwin, checkTwins, planTwin, writeSource } from './lib/translate.mjs'
import { StateError, approve, markStale, readState, updateState } from './lib/state.mjs'
import { parseTasks, progress } from './lib/tasks.mjs'
import { readText, toPosix, writeText } from './lib/util.mjs'

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
  if (!created) {
    const current = readText(file)
    const updated = refreshLinks(current.text, doc, 'en', langs)
    if (updated !== current.text) writeText(file, updated, current.eol)
  }
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
    for (const doc of docs)
      for (const lang of langs) {
        const plan = planTwin(root, state, doc, lang)
        if (!plan) continue
        const files = plan.changed.length ? writeSource(root, doc, lang, plan) : null
        total += plan.changed.length
        process.stdout.write(
          `DOC=${doc} LANG=${lang} CHANGED=${plan.changed.join(',')} REMOVED=${plan.removed.join(',')}${files ? ` SOURCE=${files.source} TARGET=${files.target}` : ''}\n`
        )
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
  language: cmdLanguage,
  config: cmdConfig,
  repo: cmdRepo,
}

/** What each verb needs of the repository (SPECS § 5, exit 3). */
const NEEDS_REPO = {
  stage: () => ({}),
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
