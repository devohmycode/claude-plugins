// Test harness of docflow: temporary repositories (with a bare `origin` when asked), the
// script run as a command would run it, and a fake `gh` (fake-gh.mjs) whose pull
// requests and issues live in a JSON file.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const PLUGIN = path.join(ROOT, 'docflow')
export const SCRIPT = path.join(PLUGIN, 'scripts', 'docflow.mjs')
export const HOOK = path.join(PLUGIN, 'scripts', 'hook.mjs')
export const FAKE_GH = path.join(ROOT, 'tests', 'docflow', 'fake-gh.mjs')

/** A directory removed by `cleanup()`. */
export function workspace(prefix = 'docflow-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  const claude = path.join(dir, '.claude-home')
  mkdirSync(claude)
  return {
    dir,
    claude,
    ghDb: path.join(dir, 'gh.json'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

export function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

/**
 * A repository in `ws`: `commit` makes a first commit (the files given in `files`),
 * `remote` adds a bare `origin` with `main` pushed. Returns its path.
 */
export function makeRepo(ws, { name = 'project', commit = true, remote = false, files = {} } = {}) {
  const dir = path.join(ws.dir, name)
  mkdirSync(dir, { recursive: true })
  git(['init', '-q', '-b', 'main'], dir)
  git(['config', 'user.email', 'test@example.com'], dir)
  git(['config', 'user.name', 'Test'], dir)
  git(['config', 'core.autocrlf', 'false'], dir)
  git(['config', 'commit.gpgsign', 'false'], dir)
  for (const [file, content] of Object.entries(files)) write(dir, file, content)
  if (commit) {
    if (!Object.keys(files).length) write(dir, 'README.md', '# project\n')
    git(['add', '-A'], dir)
    git(['commit', '-q', '-m', 'Initial commit'], dir)
  }
  if (remote) {
    const bare = path.join(ws.dir, `${name}.git`)
    git(['init', '-q', '--bare', '-b', 'main', bare], ws.dir)
    git(['remote', 'add', 'origin', bare], dir)
    if (commit) {
      git(['push', '-q', '-u', 'origin', 'main'], dir)
      git(['remote', 'set-head', 'origin', 'main'], dir)
    }
  }
  return dir
}

export function write(dir, file, content) {
  const full = path.join(dir, file)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
  return full
}

export const read = (dir, file) => readFileSync(path.join(dir, file), 'utf8')

/** `KEY=value` lines → an object; `# ` lines → `messages`. */
export function parseOutput(stdout) {
  const keys = {}
  const messages = []
  for (const line of String(stdout).split(/\r?\n/)) {
    if (line.startsWith('# ')) messages.push(line.slice(2))
    else {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
      if (m) keys[m[1]] = m[2]
    }
  }
  return { keys, messages }
}

/** The environment of a script run: English, no user settings, the fake gh. */
export function envFor(ws, extra = {}) {
  return {
    ...process.env,
    CLAUDE_PLUGINS_LANGUAGE: 'en',
    CLAUDE_CONFIG_DIR: ws.claude,
    CLAUDE_CODE_SESSION_ID: 'session-test',
    DOCFLOW_GH: `node "${FAKE_GH}"`,
    FAKE_GH_DB: ws.ghDb,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    ...extra,
  }
}

/** Runs `docflow.mjs <args>` in `cwd`: `{ code, stdout, stderr, keys, messages }`. */
export function docflow(ws, cwd, args, extra = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: envFor(ws, extra) })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, ...parseOutput(r.stdout) }
}

/** Runs `hook.mjs <event>` with a hook input: `{ code, stdout, json }`. */
export function hook(ws, event, input, extra = {}) {
  const r = spawnSync(process.execPath, [HOOK, event], {
    cwd: input.cwd,
    encoding: 'utf8',
    input: JSON.stringify(input),
    env: envFor(ws, extra),
  })
  let json = null
  try {
    json = r.stdout.trim() ? JSON.parse(r.stdout) : null
  } catch {}
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json }
}

/** The fake gh's data: `{ prs, issues, labels, calls }`. */
export function ghData(ws) {
  try {
    return JSON.parse(readFileSync(ws.ghDb, 'utf8'))
  } catch {
    return { prs: [], issues: [], labels: [], calls: [] }
  }
}

export function setGhData(ws, data) {
  writeFileSync(ws.ghDb, JSON.stringify(data, null, 2))
}
