// GENERATED from shared/git/repo.mjs by scripts/sync-shared.mjs — do not edit this copy.
// Whether a project directory is a git repository the plugins can work in, and how to
// make it one. Shared by every plugin that reads history, commits or opens worktrees.
// No messages here: each plugin words them in its own catalog.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The exit code of a command refused because the project is not a usable repository. */
export const REPO_EXIT = 3

const run = (args, cwd, extra = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...extra })

/**
 * `no-git` (git is not installed), `none` (not inside a repository), `empty` (a
 * repository without a commit) or `ready`; with `remote`, whether it has one.
 */
export function repoState(dir) {
  try {
    run(['--version'], dir)
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'no-git', remote: false }
  }
  try {
    if (run(['rev-parse', '--is-inside-work-tree'], dir).trim() !== 'true') return { state: 'none', remote: false }
  } catch {
    return { state: 'none', remote: false }
  }
  let remote = false
  try {
    remote = Boolean(run(['remote'], dir).trim())
  } catch {}
  try {
    run(['rev-parse', '--verify', '--quiet', 'HEAD'], dir)
    return { state: 'ready', remote }
  } catch {
    return { state: 'empty', remote }
  }
}

/**
 * What the refusal is about, or null when `dir` meets `needs`: `commit` (history,
 * worktrees, tracked files) and `remote` (the GitHub CLI works on the remote).
 */
export function missingFor(current, { commit = false, remote = false } = {}) {
  if (current.state === 'no-git' || current.state === 'none') return current.state
  if (commit && current.state === 'empty') return 'empty'
  if (remote && !current.remote) return 'no-remote'
  return null
}

// What should rarely be committed by accident: secrets, keys, dependencies, build output.
const FLAGGED = [
  /(^|\/)\.env(\.[^/]*)?$/,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /(^|\/)(node_modules|vendor|\.venv|venv|__pycache__|dist|build|target|\.next)\//,
]
const LARGE = 10 * 1024 * 1024

/**
 * The files a first `git add -A` would take (the project's .gitignore applies), and
 * those among them worth a second look — without touching the project: the index
 * lives in a throwaway repository.
 */
export function plannedFiles(dir) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'plugins-repo-plan-'))
  try {
    run(['init', '-q', tmp], dir)
    const out = run(['--git-dir', path.join(tmp, '.git'), '--work-tree', dir, 'add', '-A', '--dry-run'], dir)
    const files = out
      .split('\n')
      .map((l) => l.match(/^add '(.*)'$/)?.[1])
      .filter(Boolean)
    const flagged = new Map()
    for (const f of files) {
      const rule = FLAGGED.find((re) => re.test(f))
      if (rule) {
        // One line per dependency or build directory, not one per file in it.
        const dirMatch = f.match(/^(.*?(?:^|\/)(?:node_modules|vendor|\.venv|venv|__pycache__|dist|build|target|\.next))\//)
        const key = dirMatch ? `${dirMatch[1]}/` : f
        flagged.set(key, (flagged.get(key) ?? 0) + 1)
        continue
      }
      try {
        if (statSync(path.join(dir, f)).size > LARGE) flagged.set(f, 1)
      } catch {}
    }
    return { files, flagged: [...flagged].map(([p, n]) => ({ path: p, files: n })) }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * `git init` in `dir` (nothing when it already is a repository), then with `commit` a
 * first commit of every file the .gitignore lets through. Throws with git's message.
 */
export function initRepo(dir, { commit = false, message = 'Initial commit' } = {}) {
  if (repoState(dir).state === 'none') run(['init', '-q'], dir)
  if (!commit) return { committed: 0 }
  run(['add', '-A'], dir)
  const staged = run(['diff', '--cached', '--name-only'], dir).split('\n').filter(Boolean).length
  if (!staged) return { committed: 0 }
  run(['commit', '-q', '-m', message], dir)
  return { committed: staged }
}

/**
 * A private (or public) GitHub repository named after `dir`, set as `origin`, with the
 * current branch pushed. Publishes the code: only on the user's explicit request.
 */
export function publishRepo(dir, { visibility = 'private', name = path.basename(dir) } = {}) {
  execFileSync('gh', ['repo', 'create', name, `--${visibility}`, '--source', dir, '--remote', 'origin', '--push'], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return run(['remote', 'get-url', 'origin'], dir).trim()
}
