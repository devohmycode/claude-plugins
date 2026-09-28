// Adopt mode (PRD D-5): a summary of an existing code base, made by the script so that
// the model reads a page instead of walking the tree — top-level directories, languages,
// manifests and their scripts, test locations, the checks command.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { detectChecks } from './config.mjs'
import { gitMaybe } from './git.mjs'

const SKIP = new Set(['.git', 'node_modules', 'vendor', 'target', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.docflow'])
const MANIFESTS = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json', '*.csproj', '*.sln', 'Makefile', 'CMakeLists.txt', 'Dockerfile']
const LANGUAGES = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.rs': 'Rust', '.py': 'Python', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.cs': 'C#', '.cpp': 'C++', '.cc': 'C++',
  '.c': 'C', '.h': 'C/C++ header', '.swift': 'Swift', '.rb': 'Ruby', '.php': 'PHP', '.vue': 'Vue', '.svelte': 'Svelte',
  '.css': 'CSS', '.scss': 'SCSS', '.html': 'HTML', '.sql': 'SQL', '.sh': 'Shell', '.ps1': 'PowerShell', '.md': 'Markdown',
}
const isTest = (p) => /(^|\/)(tests?|__tests__|spec|specs)\//i.test(p) || /[._-](test|spec)\.[a-z]+$/i.test(p) || /_test\.(go|py)$/.test(p)

/** The project's files: tracked by git when it is a repository, else a walk of the tree. */
export function listFiles(root, max = 20000) {
  const tracked = gitMaybe(['ls-files', '--cached', '--others', '--exclude-standard'], root)
  if (tracked !== null && tracked !== '') return tracked.split('\n').filter((f) => f && !f.startsWith('.docflow/')).slice(0, max)
  const out = []
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= max) return
      if (SKIP.has(e.name)) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), r)
      else out.push(r)
    }
  }
  walk(root, '')
  return out
}

const top = (counts, n) => [...counts].sort((a, b) => b[1] - a[1]).slice(0, n)

/** The summary, as Markdown lines (at most about 40). */
export function layoutSummary(root) {
  const files = listFiles(root)
  const dirs = new Map()
  const langs = new Map()
  let tests = 0
  const testDirs = new Map()
  for (const f of files) {
    const [first, ...rest] = f.split('/')
    const key = rest.length ? `${first}/` : '(root)'
    dirs.set(key, (dirs.get(key) ?? 0) + 1)
    const lang = LANGUAGES[path.extname(f).toLowerCase()]
    if (lang) langs.set(lang, (langs.get(lang) ?? 0) + 1)
    if (isTest(f)) {
      tests++
      const d = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '(root)'
      testDirs.set(d.split('/').slice(0, 2).join('/'), (testDirs.get(d.split('/').slice(0, 2).join('/')) ?? 0) + 1)
    }
  }
  const lines = [`Files: ${files.length}${files.length >= 20000 ? '+' : ''}`]
  lines.push(`Languages: ${top(langs, 8).map(([l, n]) => `${l} ${n}`).join(', ') || 'none recognised'}`)
  lines.push('Top-level:')
  for (const [d, n] of top(dirs, 15)) lines.push(`- ${d} ${n}`)
  const manifestRes = MANIFESTS.map((p) => new RegExp(`^${p.replace(/\./g, '\\.').replace('*', '[^/]+')}$`))
  const manifests = files.filter((f) => f.split('/').length <= 2 && manifestRes.some((re) => re.test(f.split('/').pop())))
  lines.push(`Manifests: ${manifests.slice(0, 10).join(', ') || 'none'}`)
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    const scripts = Object.keys(pkg.scripts ?? {})
    if (scripts.length) lines.push(`package.json scripts: ${scripts.slice(0, 12).join(', ')}`)
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    if (deps.length) lines.push(`Dependencies: ${deps.slice(0, 15).join(', ')}${deps.length > 15 ? ` (+${deps.length - 15})` : ''}`)
  } catch {}
  lines.push(`Tests: ${tests} file(s)${testDirs.size ? ` in ${top(testDirs, 5).map(([d, n]) => `${d} ${n}`).join(', ')}` : ''}`)
  lines.push(`Checks: ${detectChecks(root)?.command ?? 'none detected'}`)
  const commits = gitMaybe(['rev-list', '--count', 'HEAD'], root)
  if (commits) lines.push(`Commits: ${commits}, last: ${gitMaybe(['log', '-1', '--format=%cs %s'], root)}`)
  for (const readme of ['README.md', 'readme.md', 'README']) {
    try {
      if (statSync(path.join(root, readme)).isFile()) {
        lines.push(`Readme: ${readme}`)
        break
      }
    } catch {}
  }
  return lines
}
