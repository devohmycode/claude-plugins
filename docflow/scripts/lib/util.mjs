// Small helpers shared by the docflow modules: text files that keep their line endings,
// atomic writes, dates and slugs. No messages here.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** A text file with its line endings normalised to `\n`; `eol` is what the file used. Null when absent. */
export function readText(file) {
  if (!existsSync(file)) return null
  const raw = readFileSync(file, 'utf8')
  return { text: raw.replace(/\r\n/g, '\n'), eol: raw.includes('\r\n') ? '\r\n' : '\n' }
}

/** Writes `text` (with `\n` line endings) using `eol`, creating the directory. */
export function writeText(file, text, eol = '\n') {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, eol === '\n' ? text : text.replace(/\n/g, eol), 'utf8')
}

/** Writes to a temporary file next to `file`, then renames it: readers never see half a file. */
export function writeAtomic(file, content) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
}

export function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback
  return JSON.parse(readFileSync(file, 'utf8'))
}

export const toPosix = (p) => String(p).split(path.sep).join('/')

/** `2026-09-28T13:44:00Z`: ISO 8601 without milliseconds. */
export const isoTime = (ms = Date.now()) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** `2026-09-28`. */
export const isoDate = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10)

/** Lower case ASCII words joined by `-`, cut at a word boundary within `max` characters. */
export function slugify(title, max = 40) {
  const words = String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/`[^`]*`/g, (m) => m.slice(1, -1))
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  let slug = ''
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w
    if (next.length > max) break
    slug = next
  }
  return slug || words.join('-').slice(0, max) || 'work'
}

/**
 * Which lines of a Markdown text are hidden from the structure: inside a fenced code block
 * or an HTML comment (a template's `<!-- docflow:todo … -->` may hold example headings).
 */
export function hiddenLines(lines) {
  const hidden = new Array(lines.length).fill(false)
  let fence = null
  let comment = false
  lines.forEach((line, i) => {
    if (comment) {
      hidden[i] = true
      if (line.includes('-->')) comment = false
      return
    }
    const f = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      hidden[i] = true
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      return
    }
    if (f) {
      fence = f[1]
      hidden[i] = true
      return
    }
    const open = line.lastIndexOf('<!--')
    if (open >= 0 && line.indexOf('-->', open) < 0) {
      comment = true
      hidden[i] = true
    }
  })
  return hidden
}

/** Sleeps synchronously (a script step waiting for a lock file). */
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
