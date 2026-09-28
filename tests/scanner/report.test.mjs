// The report rendered by the script from final.json: what it says, in which order, safely
// escaped, in both formats — and the `report` command on a run directory.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { groupFindings, notCoveredOf, renderHtml, renderMarkdown, reportModel } from '../../scanner-plugin/scripts/report.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = path.join(ROOT, 'scanner-plugin', 'scripts', 'scanner.mjs')
const EN = JSON.parse(readFileSync(path.join(ROOT, 'scanner-plugin', 'locales', 'en.json'), 'utf8'))
const t = (key, vars = {}) => String(EN[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))

const finding = (id, severity, extra = {}) => ({
  id,
  title: `title ${id}`,
  severity,
  file: 'src/app.ts',
  line: 3,
  snippet: 'const x = 1',
  rule: 'r1',
  description: 'what',
  reachability: 'who',
  evidence: 'proof',
  verdict: 'confirmed',
  triage_reason: 'kept',
  status: 'new',
  fingerprint: `fp${id}`,
  ...extra,
})

const FINAL = {
  run: 'security-20260928-1000',
  type: 'security',
  scope: 'full',
  commit: 'abc1234',
  branch: 'dev',
  finished: '2026-09-28T10:00:00Z',
  files: ['a', 'b'],
  profile_fingerprint: 'p2',
  previous: { run: 'security-20260920-1000', commit: 'def', profile_fingerprint: 'p1' },
  counts: { critical: 1, high: 0, medium: 1, low: 0, info: 1 },
  findings: [
    finding('F2', 'medium', { status: 'persisting', verdict: 'plausible' }),
    finding('F1', 'critical', { title: '<script>alert(1)</script>', snippet: 'a ``` b <b>' }),
    finding('F3', 'info', { rule: 'r2', file: 'src/b c.ts' }),
  ],
  refuted: [{ id: 'F9', title: 'not a bug', file: 'src/x.ts', reason: 'guarded', never_report_entry: 'rate limits in dev' }],
  resolved: [{ id: 'F7', title: 'old one', file: 'src/y.ts', severity: 'high', fingerprint: 'fp7' }],
  untriaged: [],
  report_format: 'html',
  report: 'docs/scans/scan-security-20260928.html',
}
const PROFILE = { type: 'security', title: 'Security', language_code: 'en', sources: { overlay: null } }

describe('report model', () => {
  it('orders by severity, keeps the three most severe apart, compares with the previous scan', () => {
    const m = reportModel(FINAL, PROFILE, { t })
    assert.deepEqual(m.groups.map((g) => g.name), ['critical', 'medium', 'info'])
    assert.deepEqual(m.top.map((f) => f.id), ['F1', 'F2'], 'info findings never lead')
    assert.equal(m.compare.newCount, 2)
    assert.equal(m.compare.resolved, 1)
    assert.equal(m.profileChanged, true)
    assert.equal(m.title, 'Scan report — Security')
  })

  it('groups by rule for the types that read better so, most severe group first', () => {
    const groups = groupFindings(FINAL.findings, 'rule')
    assert.deepEqual(groups.map((g) => g.name), ['r1', 'r2'])
    assert.deepEqual(groups[0].findings.map((f) => f.id), ['F1', 'F2'])
    assert.equal(reportModel({ ...FINAL, type: 'performance' }, PROFILE, { t }).by, 'rule')
    assert.equal(reportModel(FINAL, PROFILE, { t, groupBy: 'file' }).by, 'file')
  })

  it("states what the scan does not cover: the overlay's list, else the built-in text", () => {
    assert.equal(notCoveredOf(PROFILE, t).length, 3)
    assert.deepEqual(notCoveredOf({ ...PROFILE, not_covered: '- the VPS\n- the CDN\n' }, t), ['the VPS', 'the CDN'])
    assert.deepEqual(notCoveredOf({ type: 'custom' }, t), [])
  })
})

describe('HTML', () => {
  it('is self-contained, escapes what comes from findings, draws plausible findings apart', () => {
    const html = renderHtml(reportModel(FINAL, PROFILE, { t, narrative: { summary: 'Fix F1 <now>.', notes: ['n1'] } }), { t, code: 'en', css: '.x{}' })
    assert.match(html, /^<!doctype html>/)
    assert.match(html, /<html lang="en">/)
    assert.ok(!html.includes('<script>alert'), 'a title is escaped')
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(html, /<pre><code>a ``` b &lt;b&gt;<\/code><\/pre>/)
    assert.match(html, /<article id="F2" class="plausible">/)
    assert.match(html, /Fix F1 &lt;now&gt;\./)
    assert.match(html, /rate limits in dev/)
    assert.match(html, /\/\* project \*\/\n\.x\{\}/)
    assert.ok(!/<script|<link|src="http/.test(html), 'no script and no external resource')
  })

  it('renders the same run identically', () => {
    const a = renderHtml(reportModel(FINAL, PROFILE, { t }), { t, code: 'en' })
    const b = renderHtml(reportModel(FINAL, PROFILE, { t }), { t, code: 'en' })
    assert.equal(a, b)
  })
})

describe('Markdown', () => {
  const md = renderMarkdown(reportModel(FINAL, PROFILE, { t }), { t, report: FINAL.report.replace('.html', '.md') })

  it('fences a snippet longer than any run of backticks in it', () => {
    assert.match(md, /````ts\na ``` b <b>\n````/)
  })

  it('links file:line relatively from the report, and escapes prose', () => {
    assert.match(md, /\[`src\/app.ts:3`\]\(\.\.\/\.\.\/src\/app\.ts#L3\)/)
    assert.match(md, /\(\.\.\/\.\.\/src\/b%20c\.ts#L3\)/)
    assert.match(md, /\\<script\\>alert\(1\)\\<\/script\\>/)
    assert.ok(!/<[a-z]+[ >]/i.test(md.replace(/^(`{3,})[^\n]*\n[\s\S]*?\n\1$/gm, '').replace(/`[^`]*`/g, '')), 'no raw HTML outside code')
  })

  it('has one heading per finding, with its labels', () => {
    assert.match(md, /### F1 · critical · new — /)
    assert.match(md, /### F2 · medium · persisting · plausible — /)
  })
})

describe('the report command', () => {
  let repo
  const run = (...args) =>
    spawnSync('node', [SCRIPT, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGINS_LANGUAGE: 'fr', CLAUDE_CONFIG_DIR: os.tmpdir() },
    })

  before(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'scanner-report-'))
    const dir = path.join(repo, '.scanner', 'runs', FINAL.run)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'final.json'), JSON.stringify(FINAL))
    writeFileSync(path.join(dir, 'profile.json'), JSON.stringify({ ...PROFILE, language_code: 'fr' }))
    writeFileSync(path.join(dir, 'narrative.json'), JSON.stringify({ summary: 'Corriger F1 d’abord.', notes: [] }))
    writeFileSync(path.join(repo, 'style.css'), '.maison { color: red }')
    mkdirSync(path.join(repo, '.scanner'), { recursive: true })
    writeFileSync(path.join(repo, '.scanner', 'config.json'), JSON.stringify({ reportCss: 'style.css' }))
  })
  after(() => rmSync(repo, { recursive: true, force: true }))

  it('writes the report where final.json says, in the language of the plugin, with the summary', () => {
    const r = run('report', FINAL.run)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /REPORT=docs\/scans\/scan-security-20260928\.html/)
    const html = readFileSync(path.join(repo, 'docs/scans/scan-security-20260928.html'), 'utf8')
    assert.match(html, /<html lang="fr">/)
    assert.match(html, /Rapport de scan — Sécurité/)
    assert.match(html, /Corriger F1 d’abord\./)
    assert.match(html, /\.maison \{ color: red \}/)
  })

  it('renders Markdown on demand, next to the HTML', () => {
    const r = run('report', FINAL.run, '--format', 'md')
    assert.equal(r.status, 0, r.stderr)
    assert.match(readFileSync(path.join(repo, 'docs/scans/scan-security-20260928.md'), 'utf8'), /^# Rapport de scan — Sécurité/)
  })

  it('refuses a run that is not finalized', () => {
    mkdirSync(path.join(repo, '.scanner/runs/empty'), { recursive: true })
    const r = run('report', 'empty')
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /finaliser/)
  })
})
