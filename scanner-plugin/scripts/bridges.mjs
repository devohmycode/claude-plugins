// External investigators: coding agents (Codex, Cursor, Devin…) reached through the
// agent-bridges plugins Claude Code installed (github.com/devohmycode/agent-bridges-cc).
//
// A bridge runs its agent read-only and prints one JSON document:
//   node <installPath>/<script> <subcommand> --json --cwd <root> --prompt-file <file>
//   → { status, rawOutput, readOnlyViolation?, … }
// Nothing here is user-facing: callers turn the `code` of a failure into a message.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Engine that stands for the plugin's own investigator agents. */
export const CLAUDE = 'claude'
const MARKETPLACE = 'agent-bridges'
const OVERRIDE_PREFIX = 'SCANNER_BRIDGE_'

export const PROVIDERS = {
  codex: { plugin: 'codex', script: 'scripts/codex-companion.mjs', subcommand: 'task' },
  'grok-build': { plugin: 'grok-build', script: 'scripts/grok-bridge.mjs', subcommand: 'run' },
  cursor: { plugin: 'cursor-bridge', script: 'scripts/bridge.mjs', subcommand: 'run' },
  devin: { plugin: 'devin-bridge', script: 'scripts/bridge.mjs', subcommand: 'run' },
  copilot: { plugin: 'copilot-bridge', script: 'scripts/bridge.mjs', subcommand: 'run' },
  antigravity: { plugin: 'antigravity-bridge', script: 'scripts/bridge.mjs', subcommand: 'run' },
  warp: { plugin: 'warp-bridge', script: 'scripts/bridge.mjs', subcommand: 'run' },
}
const ALIASES = { grok: 'grok-build' }

/** `SCANNER_BRIDGE_<ID>=<script>` adds or overrides a provider (tests, local clones). */
function overrides(env) {
  const out = {}
  for (const [key, value] of Object.entries(env))
    if (key.startsWith(OVERRIDE_PREFIX) && value)
      out[key.slice(OVERRIDE_PREFIX.length).toLowerCase().replace(/_/g, '-')] = value
  return out
}

export const normalizeEngine = (value) => {
  const id = String(value ?? '').trim().toLowerCase()
  return ALIASES[id] ?? id
}

export const knownEngines = (env = process.env) => [
  CLAUDE,
  ...new Set([...Object.keys(PROVIDERS), ...Object.keys(overrides(env))]),
]

/** `claude,codex` or ['claude', 'codex'] → normalized, deduplicated list. */
export function parseEngines(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',')
  return [...new Set(list.map(normalizeEngine).filter(Boolean))]
}

const configDir = (env) => env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')

function installedPlugins(env) {
  try {
    const file = path.join(configDir(env), 'plugins', 'installed_plugins.json')
    return JSON.parse(readFileSync(file, 'utf8')).plugins ?? {}
  } catch {
    return {}
  }
}

const within = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Where a provider's bridge script is. A project-scoped install for this root wins, then
 * a user install; the agent-bridges marketplace wins over another one.
 * @returns {{ id, found: true, script, subcommand, plugin, version }
 *   | { id, found: false, code: 'unknown'|'not-installed'|'script-missing', plugin? }}
 */
export function resolveBridge(engine, { root, env = process.env } = {}) {
  const id = normalizeEngine(engine)
  const override = overrides(env)[id]
  if (override)
    return existsSync(override)
      ? { id, found: true, script: override, subcommand: 'run', plugin: id, version: null }
      : { id, found: false, code: 'script-missing', plugin: id }
  const spec = PROVIDERS[id]
  if (!spec) return { id, found: false, code: 'unknown' }

  const candidates = []
  for (const [key, entries] of Object.entries(installedPlugins(env))) {
    const at = key.lastIndexOf('@')
    if ((at < 0 ? key : key.slice(0, at)) !== spec.plugin || !Array.isArray(entries)) continue
    const marketplace = at < 0 ? '' : key.slice(at + 1)
    for (const entry of entries) {
      if (!entry?.installPath) continue
      const scoped = entry.scope && entry.scope !== 'user'
      if (scoped && !(entry.projectPath && root && within(root, entry.projectPath))) continue
      candidates.push({ ...entry, rank: (scoped ? 0 : 2) + (marketplace === MARKETPLACE ? 0 : 1) })
    }
  }
  const install = candidates.sort((a, b) => a.rank - b.rank)[0]
  if (!install) return { id, found: false, code: 'not-installed', plugin: spec.plugin }
  const script = path.join(install.installPath, spec.script)
  if (!existsSync(script)) return { id, found: false, code: 'script-missing', plugin: spec.plugin }
  return {
    id,
    found: true,
    script,
    subcommand: spec.subcommand,
    plugin: spec.plugin,
    version: install.version ?? null,
  }
}

/** The JSON array an agent answered with: the last ```json block, else the outer brackets. */
export function extractFindings(text) {
  const source = String(text ?? '')
  const tries = [...source.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]).reverse()
  const first = source.indexOf('[')
  const last = source.lastIndexOf(']')
  if (first >= 0 && last > first) tries.push(source.slice(first, last + 1))
  const brace = source.indexOf('{')
  if (brace >= 0) tries.push(source.slice(brace, source.lastIndexOf('}') + 1))
  for (const candidate of tries) {
    try {
      const value = JSON.parse(candidate)
      if (Array.isArray(value)) return value
      if (Array.isArray(value?.findings)) return value.findings
    } catch {}
  }
  return null
}

function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  else
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
}

/**
 * Run a read-only task through a bridge.
 * @returns {Promise<{ ok: boolean, code?: 'timeout'|'exit'|'no-json-output'|'status'|'read-only',
 *   rawOutput: string, detail: string, ms: number }>}
 */
export function runBridge(bridge, { root, promptFile, model, effort, timeoutMs, env = process.env }) {
  const args = [bridge.script, bridge.subcommand, '--json', '--cwd', root, '--prompt-file', promptFile]
  if (model) args.push('--model', model)
  if (effort) args.push('--effort', effort)
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Own process group on POSIX, so a timeout takes the agent CLI down with the bridge.
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.setEncoding('utf8').on('data', (c) => (stdout += c))
    child.stderr.setEncoding('utf8').on('data', (c) => (stderr += c))
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          killTree(child.pid)
        }, timeoutMs)
      : null
    const done = (result) => {
      clearTimeout(timer)
      resolve({ rawOutput: '', detail: '', ...result, ms: Date.now() - started })
    }
    child.on('error', (e) => done({ ok: false, code: 'exit', detail: e.message }))
    child.on('close', (status) => {
      const tail = stderr.trim().slice(-2000)
      if (timedOut) return done({ ok: false, code: 'timeout', detail: tail })
      let payload = null
      try {
        payload = JSON.parse(stdout.trim())
      } catch {}
      if (!payload) return done({ ok: false, code: status ? 'exit' : 'no-json-output', detail: tail })
      const rawOutput = typeof payload.rawOutput === 'string' ? payload.rawOutput : ''
      if (payload.readOnlyViolation) return done({ ok: false, code: 'read-only', rawOutput, detail: tail })
      if (status || (payload.status ?? 0) !== 0)
        return done({ ok: false, code: 'status', rawOutput, detail: tail || rawOutput.slice(-2000) })
      done({ ok: true, rawOutput, detail: tail })
    })
  })
}
