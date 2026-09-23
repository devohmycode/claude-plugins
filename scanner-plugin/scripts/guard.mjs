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
  matchGlob,
  matchGlobSuffix,
  projectRoot,
  readConfig,
  readState,
  relativeTo,
} from './lib.mjs'

const event = process.argv[2]

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
    if (glob)
      deny(
        `${rel} is excluded by the "${state.type}" profile (${glob}). Do not read it: the exclusion list is part of the profile.`
      )
    return
  }
  if (WRITE_TOOLS.has(tool)) {
    const rel = relativeTo(root, targetPath(input))
    if (rel === null) return // outside the repository (scratchpad, temp files): not our concern
    if (!matchGlob(rel, state.writeAllowed ?? []))
      deny(
        `Scan in progress (${state.run}): writes are limited to ${state.writeAllowed.join(', ')}. ${rel} is not one of them — a scan reports, it does not fix.`
      )
    return
  }
  if (tool === 'Bash') {
    const pattern = MUTATING_DURING_SCAN.find((re) => re.test(String(input.command ?? '')))
    if (pattern)
      deny(
        `Scan in progress (${state.run}): command that would modify the repository denied (${pattern.source}). Reading, counting and running tests is fine; writing is not. Write findings with the Write tool into the run directory.`
      )
  }
}

function duringRemediation(state, root, tool, input, cwd) {
  if (WRITE_TOOLS.has(tool)) {
    const target = targetPath(input)
    if (!target) return
    // The worktree may live inside the repository (.claude/worktrees/…) or next to
    // it: globs are therefore tested on every suffix of the path.
    const glob = matchGlobSuffix(path.resolve(cwd ?? root, target), state.writeDenied ?? [])
    if (glob)
      deny(
        `Remediation of ${state.finding}: ${target} is out of bounds (${glob}). Stop and report it instead of changing it.`
      )
    return
  }
  if (tool === 'Bash') {
    const command = String(input.command ?? '')
    for (const source of state.commandsDenied ?? [])
      if (new RegExp(source).test(command))
        deny(`Remediation of ${state.finding}: command denied by the config (${source}).`)
    if (/\bgit\b[^|;&]*\b(commit|push)\b/.test(command)) {
      const protectedBranches = state.protectedBranches ?? []
      const branch = currentBranch(cwd ?? root)
      if (branch && protectedBranches.includes(branch))
        deny(
          `Remediation of ${state.finding}: the current branch "${branch}" is protected. Create the fix branch first.`
        )
      if (
        /\bpush\b/.test(command) &&
        protectedBranches.some((b) => new RegExp(`\\b${b}\\b`).test(command))
      )
        deny(`Remediation of ${state.finding}: push to a protected branch.`)
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
  if (found.length)
    blockAfter(
      `The last commit carries a forbidden attribution (${found.join(', ')}). Remove it with git commit --amend before going on.`
    )
}

try {
  const input = readInput()
  if (!input) process.exit(0)
  const root = projectRoot(input.cwd)
  const state = readState(root)
  const tool = input.tool_name
  const toolInput = input.tool_input ?? {}

  if (event === 'pre') {
    if (state?.mode === 'scan') duringScan(state, root, tool, toolInput)
    else if (state?.mode === 'remediation')
      duringRemediation(state, root, tool, toolInput, input.cwd)
  } else if (
    event === 'post' &&
    tool === 'Bash' &&
    /\bgit\b[^|;&]*\bcommit\b/.test(String(toolInput.command ?? ''))
  ) {
    const config = readConfig(root)
    if (state?.mode === 'remediation' || config.commits.checkOutsideScan === true)
      afterCommit(config, input.cwd ?? root)
  }
} catch {
  // See the header: a failing guard lets the call through.
}
process.exit(0)
