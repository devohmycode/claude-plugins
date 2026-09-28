// git and gh behind small runners. `gh` can be replaced for tests with DOCFLOW_GH (a
// command line, e.g. `node fake-gh.mjs`): pull requests and issues are then faked.

import { spawnSync } from 'node:child_process'
import path from 'node:path'

export class CommandError extends Error {
  constructor(command, output) {
    super(`${command} failed`)
    this.command = command
    this.output = output
  }
}

/** The last `n` lines of a text. */
export const tail = (text, n = 20) => String(text ?? '').replace(/\s+$/, '').split('\n').slice(-n).join('\n')

function exec(file, args, cwd, { input, env } = {}) {
  const r = spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    input,
    env: env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  if (r.error) throw new CommandError(`${file} ${args.join(' ')}`, r.error.message)
  if (r.status !== 0) throw new CommandError(`${path.basename(file)} ${args.join(' ')}`, tail(`${r.stdout ?? ''}\n${r.stderr ?? ''}`))
  return r.stdout
}

export const git = (args, cwd, options) => exec('git', args, cwd, options)

/** Like `git`, but null instead of an error. */
export function gitMaybe(args, cwd) {
  try {
    return git(args, cwd).trim()
  } catch {
    return null
  }
}

/** Runs gh (or the DOCFLOW_GH replacement) and returns its standard output. */
export function gh(args, cwd, options) {
  const custom = process.env.DOCFLOW_GH
  if (!custom) return exec('gh', args, cwd, options)
  const [file, ...pre] = custom.match(/"[^"]*"|\S+/g).map((s) => s.replace(/^"|"$/g, ''))
  return exec(file, [...pre, ...args], cwd, options)
}

/**
 * The project root: the top of the repository `cwd` is in — the main checkout when `cwd`
 * is one of its linked worktrees, since `.docflow/` lives there. `cwd` outside a repository.
 */
export function projectRoot(cwd) {
  const top = gitMaybe(['rev-parse', '--show-toplevel'], cwd)
  if (!top) return path.resolve(cwd)
  const common = gitMaybe(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
  if (common && path.basename(common) === '.git') {
    const main = path.dirname(path.resolve(common))
    if (path.resolve(main) !== path.resolve(top)) return path.resolve(main)
  }
  return path.resolve(top)
}

/** The current branch, or null (detached, or not a repository). */
export function currentBranch(cwd) {
  const b = gitMaybe(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return b && b !== 'HEAD' ? b : null
}

/** The default branch: `origin/HEAD`, else a local `main` or `master`, else the current one. */
export function defaultBranch(cwd) {
  const head = gitMaybe(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd)
  if (head) return head.replace(/^origin\//, '')
  for (const b of ['main', 'master']) if (gitMaybe(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], cwd)) return b
  return currentBranch(cwd) ?? 'main'
}

/** Runs a shell command (the project's checks); never throws. */
export function shell(command, cwd) {
  const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true })
  return { status: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}` }
}
