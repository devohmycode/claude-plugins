// The docflow block of CLAUDE.md (PRD D-6, SPECS § 7): docflow owns only the lines
// between its markers; the rest of the file is never touched.

import path from 'node:path'
import { readText } from './util.mjs'

export const MARK_START = '<!-- docflow:start -->'
export const MARK_END = '<!-- docflow:end -->'
export const MAX_LINES = 40

/** `missing` (no CLAUDE.md or no block) or `present`. */
export function blockState(root) {
  const file = readText(path.join(root, 'CLAUDE.md'))
  return file && file.text.includes(MARK_START) && file.text.includes(MARK_END) ? 'present' : 'missing'
}
