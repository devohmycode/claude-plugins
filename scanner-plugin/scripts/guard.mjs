#!/usr/bin/env node
// Plugin hooks: what the profiles state in prose becomes an enforced constraint.
//
//   pre   (PreToolUse)  — during a scan: excluded files unreadable, writes limited
//                          to the run and the reports, mutating commands denied;
//                          during a remediation: denied paths and commands, no
//                          commit or push on a protected branch.
//   post  (PostToolUse) — after a `git commit`: forbidden trailers reported.
//
// Outside a scan or a remediation the guard does nothing (except the commit check
// when the config asks for it). Any internal error lets the call through: a broken
// guard must not block the whole session.

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

const event = process.argv[2]
// Set once the state (or the config) is known; English until then.
let t = i18nFor(null).t

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `[scanner] ${reason}`,
      },
    })
  )
  process.exit(0)
}

function blockAfter(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `[scanner] ${reason}` }))
  process.exit(0)
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// During a scan nothing may change the working tree. Best effort: Bash is a full
// language, so this list stops mistakes, not malice.
const MUTATING_DURING_SCAN = [
  /\bgit\s+(commit|push|add|rm|mv|reset|checkout|switch|restore|rebase|merge|cherry-pick|revert|stash|clean|tag|branch\s+-[dDmM])\b/,
  /\b(pnpm|npm|yarn|bun)\s+(format|install|i|add|remove|rm|up|update|dedupe|prune)\b/,
  /\bprettier\b[^|;&]*--write\b/,
  /\b(rm|mv|cp|rmdir|unlink|truncate|chmod|chown)\s/,
  /\bsed\s+(-[a-z]*i|--in-place)/,
  /\btee\b(?![^|;&]*\.scanner\/)/,
  /(^|[^0-9&>=-])>{1,2}\s*(?!\/dev\/null|&|\s*[^\s]*\.scanner\/)[^\s&]/,
]

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

function duringScan(state, root, tool, input) {
  if (READ_TOOLS.has(tool)) {
    const rel = relativeTo(root, targetPath(input))
    const glob = rel ? matchGlob(rel, state.exclusions ?? []) : null
    // Once the scan is finalized, the reporter may read what `reportAccess.read`
    // opens (the existing reports, their registry) even when the profile excludes it.
    if (glob && !matchGlob(rel, state.readAllowed ?? []))
      deny(t('excludedRead', { rel, type: state.type, glob }))
    return
  }
  if (WRITE_TOOLS.has(tool)) {
    const rel = relativeTo(root, targetPath(input))
    if (rel === null) return // outside the repository (scratchpad, temp files): not our concern
    if (!matchGlob(rel, state.writeAllowed ?? []))
      deny(t('scanWrite', { run: state.run, allowed: state.writeAllowed.join(', '), rel }))
    return
  }
  if (tool === 'Bash') {
    const pattern = MUTATING_DURING_SCAN.find((re) => re.test(String(input.command ?? '')))
    if (pattern) deny(t('scanCommand', { run: state.run, pattern: pattern.source }))
  }
}

function duringRemediation(state, root, tool, input, cwd) {
  if (WRITE_TOOLS.has(tool)) {
    const target = targetPath(input)
    if (!target) return
    // The worktree may live inside the repository (.claude/worktrees/…) or next to
    // it: globs are therefore tested on every suffix of the path.
    const glob = matchGlobSuffix(path.resolve(cwd ?? root, target), state.writeDenied ?? [])
    if (glob) deny(t('remWrite', { finding: state.finding, target, glob }))
    return
  }
  if (tool === 'Bash') {
    const command = String(input.command ?? '')
    for (const source of state.commandsDenied ?? [])
      if (new RegExp(source).test(command))
        deny(t('remCommand', { finding: state.finding, source }))
    if (/\bgit\b[^|;&]*\b(commit|push)\b/.test(command)) {
      const protectedBranches = state.protectedBranches ?? []
      // A batch fix works in its own worktree, reached by `cd` or `git -C`: when the
      // command names it, that worktree's branch is the one being committed to.
      const inWorktree =
        state.worktree && command.replace(/\\/g, '/').includes(state.worktree.replace(/\\/g, '/'))
      const branch = currentBranch(inWorktree ? state.worktree : (cwd ?? root))
      if (branch && protectedBranches.includes(branch))
        deny(t('remProtected', { finding: state.finding, branch }))
      if (
        /\bpush\b/.test(command) &&
        protectedBranches.some((b) => new RegExp(`\\b${b}\\b`).test(command))
      )
        deny(t('remPush', { finding: state.finding }))
    }
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
  if (found.length) blockAfter(t('forbiddenTrailer', { list: found.join(', ') }))
}

try {
  const input = readInput()
  if (!input) process.exit(0)
  const root = projectRoot(input.cwd)
  const state = readState(root)
  const tool = input.tool_name
  const toolInput = input.tool_input ?? {}

  if (event === 'pre') {
    // The state records the language at arming time: no config read on every call.
    if (state?.lang) t = i18nFor(state.lang).t
    if (state?.mode === 'scan') duringScan(state, root, tool, toolInput)
    else if (state?.mode === 'remediation')
      duringRemediation(state, root, tool, toolInput, input.cwd)
  } else if (
    event === 'post' &&
    tool === 'Bash' &&
    /\bgit\b[^|;&]*\bcommit\b/.test(String(toolInput.command ?? ''))
  ) {
    const config = readConfig(root)
    t = i18nFor(state?.lang ?? config).t
    if (state?.mode === 'remediation' || config.commits.checkOutsideScan === true)
      afterCommit(config, input.cwd ?? root)
  }
} catch {
  // See the header: a failing guard lets the call through.
}
process.exit(0)
