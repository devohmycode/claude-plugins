#!/usr/bin/env node
// Plugin hooks: what the commands ask of the agents becomes an enforced constraint.
//
//   pre   (PreToolUse)  — during a triage: the working tree is read-only (writes only
//                          in the run directory), no mutating command, no write to
//                          GitHub; during a batch: denied paths and commands, no
//                          commit on a protected branch, no push, no write to GitHub.
//   post  (PostToolUse) — after a `git commit`: forbidden trailers reported.
//
// The script itself writes to GitHub (`open`, `sync`, `triage apply`, `batch
// finish`) only after the user agreed, and outside of an armed guard: an agent
// never does. Outside a triage or a batch the guard does nothing but the commit
// check. Any internal error lets the call through: a broken guard must not block
// the whole session.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  git,
  i18nFor,
  matchGlob,
  matchGlobSuffix,
  projectRoot,
  readConfig,
  readState,
  relativeTo,
} from './lib.mjs'
import { GITHUB_WRITE, MUTATING } from './rules.mjs'

const event = process.argv[2]
let t = i18nFor(null).t

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `[tracker] ${reason}`,
      },
    })
  )
  process.exit(0)
}

function blockAfter(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `[tracker] ${reason}` }))
  process.exit(0)
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const targetPath = (input) => input.file_path ?? input.notebook_path ?? input.path ?? null

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return null
  }
}

function currentBranch(cwd) {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim()
  } catch {
    return null
  }
}

function noGithubWrite(state, command) {
  if (GITHUB_WRITE.some((re) => re.test(command))) deny(t('guardGithub', { mode: state.mode, run: state.run }))
}

function duringTriage(state, root, tool, input) {
  if (WRITE_TOOLS.has(tool)) {
    const rel = relativeTo(root, targetPath(input))
    if (rel === null) return // outside the repository: not our concern
    if (!matchGlob(rel, state.writeAllowed ?? []))
      deny(t('guardTriageWrite', { run: state.run, rel }))
    return
  }
  if (tool === 'Bash') {
    const command = String(input.command ?? '')
    noGithubWrite(state, command)
    const pattern = MUTATING.find((re) => re.test(command))
    if (pattern) deny(t('guardTriageCommand', { run: state.run, pattern: pattern.source }))
  }
}

function duringBatch(state, root, tool, input, cwd) {
  if (WRITE_TOOLS.has(tool)) {
    const target = targetPath(input)
    if (!target) return
    const glob = matchGlobSuffix(path.resolve(cwd ?? root, target), state.writeDenied ?? [])
    if (glob) deny(t('guardBatchWrite', { batch: state.batch, target, glob }))
    return
  }
  if (tool !== 'Bash') return
  const command = String(input.command ?? '')
  noGithubWrite(state, command)
  for (const source of state.commandsDenied ?? [])
    if (new RegExp(source).test(command)) deny(t('guardBatchCommand', { batch: state.batch, source }))
  // Pushing is the script's job, once the user has seen the branch.
  if (/\bgit\b[^|;&]*\bpush\b/.test(command)) deny(t('guardPush', { batch: state.batch }))
  if (/\bgit\b[^|;&]*\bcommit\b/.test(command)) {
    const inWorktree =
      state.worktree && command.replace(/\\/g, '/').includes(state.worktree.replace(/\\/g, '/'))
    const branch = currentBranch(inWorktree ? state.worktree : (cwd ?? root))
    if (branch && (state.protectedBranches ?? []).includes(branch))
      deny(t('guardProtected', { batch: state.batch, branch }))
  }
}

function afterCommit(config, cwd) {
  const forbidden = config.commits.forbiddenTrailers ?? []
  if (!forbidden.length) return
  let message
  try {
    message = git(['log', '-1', '--format=%B'], cwd)
  } catch {
    return
  }
  const found = forbidden.filter((source) => new RegExp(source, 'im').test(message))
  if (found.length) blockAfter(t('guardTrailer', { list: found.join(', ') }))
}

try {
  const input = readInput()
  if (!input) process.exit(0)
  const root = projectRoot(input.cwd)
  const state = readState(root)
  const tool = input.tool_name
  const toolInput = input.tool_input ?? {}
  if (event === 'pre') {
    if (state?.lang) t = i18nFor(state.lang).t
    if (state?.mode === 'triage') duringTriage(state, root, tool, toolInput)
    else if (state?.mode === 'batch') duringBatch(state, root, tool, toolInput, input.cwd)
  } else if (
    event === 'post' &&
    tool === 'Bash' &&
    /\bgit\b[^|;&]*\bcommit\b/.test(String(toolInput.command ?? ''))
  ) {
    const config = readConfig(root)
    t = i18nFor(config).t
    afterCommit(config, input.cwd ?? root)
  }
} catch {
  // See the header: a failing guard lets the call through.
}
process.exit(0)
