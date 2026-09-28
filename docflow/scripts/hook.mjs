#!/usr/bin/env node
// docflow's hooks (PRD § 6.5, SPECS § 8, ARCHITECTURE § 7). They act only while a run
// holds the lock, and only for the session and repository that armed the guard
// (`scope.mjs`); otherwise they cost one state read and let everything through.
//
//   pre         (PreToolUse, Bash|Edit|Write|MultiEdit|NotebookEdit) — refuse a push to the
//               default branch or a forced push, a commit on the default branch,
//               `gh pr merge`, and an edit of an approved document of the chain;
//   stop        (Stop) — refuse to end the turn while the current task is neither ticked
//               nor reported as failed;
//   subagent    (SubagentStop) — an implementer agent that changed nothing for its task is
//               asked, once, to implement it or to say why nothing was needed.
//
// Any internal error lets the call through: a broken guard must not block the session.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createI18n } from './i18n.mjs'
import { PLUGIN_ROOT, readProjectConfig } from './lib/config.mjs'
import { CHAIN } from './lib/docs.mjs'
import { fastCurrentBranch, fastProjectRoot, gitMaybe } from './lib/git.mjs'
import { readState } from './lib/state.mjs'
import { commandDirs, concerns, normalizeDir, within } from './scope.mjs'

const event = process.argv[2]

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return null
  }
}

const emit = (value) => {
  process.stdout.write(JSON.stringify(value))
  process.exit(0)
}

function deny(reason) {
  emit({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[docflow] ${reason}` },
  })
}

const block = (reason) => emit({ decision: 'block', reason: `[docflow] ${reason}` })

// ─── Bash ───────────────────────────────────────────────────────────────────

/** The simple commands of a command line: split on `&&`, `||`, `;`, `|` and newlines. */
const segments = (command) =>
  String(command ?? '')
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean)

/** Words of a segment, quotes removed. */
const words = (segment) => (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, ''))

/** `git [-C dir] [-c k=v] <sub> args…` → `{ sub, args, dir }`, or null. */
function gitCall(segment) {
  const w = words(segment)
  const i = w.findIndex((x) => x === 'git' || x.endsWith('/git') || x.endsWith('\\git.exe') || x === 'git.exe')
  if (i < 0) return null
  let dir = null
  let k = i + 1
  while (k < w.length && w[k].startsWith('-')) {
    if (w[k] === '-C') dir = w[++k]
    else if (w[k] === '-c') k++
    k++
  }
  return k < w.length ? { sub: w[k], args: w.slice(k + 1), dir } : null
}

const FORCE = /^(-f|--force|--force-with-lease(=.*)?|--force-if-includes|--mirror|--delete|-d)$/

/** Why a `git push` is refused, or null. */
function pushProblem(args, { base, branch }) {
  if (args.some((a) => FORCE.test(a))) return 'force'
  const positional = args.filter((a) => !a.startsWith('-'))
  const refspecs = positional.slice(1)
  if (!refspecs.length) return branch === base ? 'base' : null
  for (const spec of refspecs) {
    if (spec.startsWith('+')) return 'force'
    const target = (spec.includes(':') ? spec.split(':').pop() : spec === 'HEAD' ? branch : spec).replace(/^refs\/heads\//, '')
    if (target === base) return 'base'
    if (spec.startsWith(':')) return 'force'
  }
  return null
}

function onBash(state, root, input) {
  const command = String(input.tool_input?.command ?? '')
  const cwd = input.cwd ?? root
  const base = state.guard.base ?? 'main'
  const moved = commandDirs(command, cwd)
  for (const segment of segments(command)) {
    if (/\bgh\s+pr\s+merge\b/.test(segment)) deny(t('guardMerge'))
    const call = gitCall(segment)
    if (!call || !['push', 'commit'].includes(call.sub)) continue
    const dir = call.dir ? path.resolve(cwd, normalizeDir(call.dir)) : (moved.at(-1) ?? cwd)
    const branch = fastCurrentBranch(dir)
    if (call.sub === 'push') {
      const problem = pushProblem(call.args, { base, branch })
      if (problem === 'force') deny(t('guardForce'))
      if (problem === 'base') deny(t('guardPushBase', { base }))
    } else if (branch === base) deny(t('guardCommitBase', { base }))
  }
}

// ─── Edits ──────────────────────────────────────────────────────────────────

function onWrite(state, root, input) {
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? input.tool_input?.path
  if (!target) return
  const full = path.resolve(input.cwd ?? root, target)
  for (const place of [root, state.guard.worktree].filter(Boolean)) {
    if (!within(full, place)) continue
    const rel = path.relative(place, full).split(path.sep).join('/')
    const m = new RegExp(`^docs/(${CHAIN.join('|')})(?:-(?:FR|ES|DE))?\\.md$`).exec(rel)
    if (m && state.docs?.[m[1]]?.approved) deny(t(m[1] === 'TASKS' ? 'guardTasks' : 'guardDoc', { file: rel, doc: m[1] }))
  }
}

// ─── Stop ───────────────────────────────────────────────────────────────────

function onStop(state, input, subagent) {
  if (input.stop_hook_active) return
  const run = state.run
  if (!run || run.status !== 'running' || !run.current || run.done?.includes(run.current)) return
  if (!subagent) block(t('guardStop', { id: run.current }))
  // An implementer agent: nudge once when it changed nothing at all.
  if (run.implementer === 'session') return
  const changes = gitMaybe(['status', '--porcelain'], run.worktree ?? state.guard.root)
  if (changes === '') block(t('guardSubagent', { id: run.current }))
}

// ─── Main ───────────────────────────────────────────────────────────────────

let t = (key) => key
try {
  const input = readInput()
  if (!input) process.exit(0)
  const root = fastProjectRoot(input.cwd ?? process.cwd())
  const state = readState(root)
  if (!state.guard) process.exit(0)
  let language = null
  try {
    language = readProjectConfig(root).language ?? null
  } catch {}
  t = createI18n({ localesDir: path.join(PLUGIN_ROOT, 'locales'), language }).t
  if (event === 'pre') {
    // Another session, or a command aimed at another repository: not this guard's concern.
    if (!concerns(state.guard, input, root)) process.exit(0)
    if (input.tool_name === 'Bash') onBash(state, root, input)
    else onWrite(state, root, input)
  } else if (event === 'stop' || event === 'subagent') {
    if (state.guard.session && input.session_id && state.guard.session !== input.session_id) process.exit(0)
    onStop(state, input, event === 'subagent')
  }
} catch {
  // See the header: a failing guard lets the call through.
}
process.exit(0)
