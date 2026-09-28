// GENERATED from shared/guard/scope.mjs by scripts/sync-shared.mjs — do not edit this copy.
// Which tool calls an armed guard concerns.
//
// A plugin's guard is armed in a project (`.scanner/state.json`, `.tracker/state.json`) and
// read by the hooks of every Claude Code session opened in that project. Without a scope it
// applied to all of them, and to every repository they touched: a triage or a batch running
// in one session refused a `git push` another session made to an unrelated repository.
//
// Two limits, both only ever narrowing the guard:
//   - the session: a guard records the session that armed it (`CLAUDE_CODE_SESSION_ID`);
//     a call from another session is not its concern. Subagents run in their parent's
//     session, so the agents a command launches stay guarded;
//   - the target: a Bash command whose every `cd` / `git -C` points outside the project
//     (and outside the run's worktree), or a file written outside them, is not its concern.
//
// A guard armed without a session (an older state, a script run outside Claude Code)
// keeps the target limit only.

import os from 'node:os'
import path from 'node:path'

/** The session a script runs in, recorded when it arms a guard; null outside Claude Code. */
export const sessionOf = (env = process.env) =>
  env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || null

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** `/c/Users/x` (Git Bash) → `C:/Users/x`; `~` → the home directory; quotes removed. */
export function normalizeDir(raw) {
  let p = String(raw ?? '').trim().replace(/^["']|["']$/g, '')
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1))
  if (process.platform === 'win32' && /^\/[a-z]\//i.test(p)) p = `${p[1]}:${p.slice(2)}`
  return p
}

/** The directories a Bash command moves to (`cd X`, `pushd X`, `git -C X`), resolved. */
export function commandDirs(command, cwd) {
  const out = []
  const text = String(command ?? '')
  const re = /(?:^|[;&|(]\s*|\bthen\s+|\bdo\s+)(?:cd|pushd)\s+("[^"]+"|'[^']+'|[^\s;&|)]+)|\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/g
  for (const m of text.matchAll(re)) {
    const dir = normalizeDir(m[1] ?? m[2])
    if (!dir || dir === '-') continue
    out.push(path.resolve(cwd, dir))
  }
  return out
}

const key = (p) => {
  const r = path.resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? r.toLowerCase().replace(/\\/g, '/') : r
}

/** Whether `target` is `dir` or lies under it. */
export function within(target, dir) {
  if (!target || !dir) return false
  const t = key(target)
  const d = key(dir)
  return t === d || t.startsWith(`${d}/`) || t.startsWith(`${d}${path.sep}`)
}

/**
 * Whether the guard armed in `root` (state `state`) concerns the hook call `input`.
 * `false` means: let the call through without the guard's checks.
 */
export function concerns(state, input, root) {
  if (!state) return false
  if (state.session && input?.session_id && state.session !== input.session_id) return false
  const places = [root, state.worktree].filter(Boolean)
  const inside = (p) => places.some((d) => within(p, d))
  const cwd = input?.cwd ?? root
  const tool = input?.tool_name
  const toolInput = input?.tool_input ?? {}
  if (tool === 'Bash') {
    const dirs = commandDirs(toolInput.command, cwd)
    // Every move leaves the project: the command works elsewhere.
    if (dirs.length && !dirs.some(inside)) return false
    // No move, and the session itself works elsewhere.
    if (!dirs.length && !inside(cwd)) return false
    return true
  }
  if (WRITE_TOOLS.has(tool)) {
    const target = toolInput.file_path ?? toolInput.notebook_path ?? toolInput.path
    if (target && !inside(path.resolve(cwd, target))) return false
  }
  return true
}
