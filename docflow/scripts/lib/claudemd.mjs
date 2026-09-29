// The docflow block of CLAUDE.md (PRD D-6, SPECS § 7): docflow owns only the lines
// between its markers; the rest of the file is never touched. The block is loaded in
// every session, so it stays under 40 lines (PRD T-7).

import path from 'node:path'
import { readText, writeText } from './util.mjs'

export const MARK_START = '<!-- docflow:start -->'
export const MARK_END = '<!-- docflow:end -->'
export const MAX_LINES = 40
const CHAIN = ['PRD', 'ARCHITECTURE', 'SPECS', 'TASKS']
const LANGUAGE_NAMES = { fr: 'French', es: 'Spanish', de: 'German' }

/** `missing` (no CLAUDE.md or no block) or `present`. */
export function blockState(root) {
  const file = readText(path.join(root, 'CLAUDE.md'))
  return file && file.text.includes(MARK_START) && file.text.includes(MARK_END) ? 'present' : 'missing'
}

/** The lines of the block: the chain with its links, the working rules, the next command. */
export function blockLines({ langs = [], base = 'main', next = '`/docflow:status`' } = {}) {
  const link = (d, lang) => `[${d}](docs/${d}${lang ? `-${lang.toUpperCase()}` : ''}.md)`
  const lines = [
    MARK_START,
    '## docflow',
    '',
    'This project follows docflow. Read, in order: [PRD](docs/PRD.md) →',
    '[ARCHITECTURE](docs/ARCHITECTURE.md) → [SPECS](docs/SPECS.md) →',
    '[TASKS](docs/TASKS.md).',
  ]
  for (const lang of langs) lines.push(`${LANGUAGE_NAMES[lang]}: ${CHAIN.map((d) => link(d, lang)).join(' · ')}.`)
  lines.push(
    '',
    '- Work only through `/docflow:do`; one sprint (or task) per branch.',
    '- Run the checks, let docflow tick `docs/TASKS.md`, never tick by hand.',
    `- Pull requests are drafts; never merge, never push to \`${base}\`.`,
    '- Documents are approved; change them through their `/docflow:<doc>` command.',
    `- Next: ${next}.`,
    MARK_END
  )
  return lines
}

/**
 * Inserts the block at the end of CLAUDE.md when absent, replaces it when present,
 * creates the file when missing. Returns `{ status: created|updated|unchanged, lines }`.
 */
export function writeBlock(root, lines) {
  const file = path.join(root, 'CLAUDE.md')
  const current = readText(file)
  const block = lines.join('\n')
  if (!current) {
    writeText(file, `${block}\n`)
    return { status: 'created', lines: lines.length }
  }
  const { text, eol } = current
  const start = text.indexOf(MARK_START)
  const end = text.indexOf(MARK_END, start)
  let next
  if (start >= 0 && end > start) next = text.slice(0, start) + block + text.slice(end + MARK_END.length)
  else next = `${text.replace(/\s*$/, '')}\n\n${block}\n`
  if (next === text) return { status: 'unchanged', lines: lines.length }
  writeText(file, next, eol)
  return { status: start >= 0 && end > start ? 'updated' : 'created', lines: lines.length }
}
