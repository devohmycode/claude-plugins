// The report of a finished scan, rendered from its final.json by the script.
//
// An agent used to write the report whole: it read final.json, the profile and an existing
// report for its look, then wrote tens of kilobytes that were a formatted copy of
// final.json. Here the same report costs no token, comes out in a second, and two renders
// of the same run are identical. What only an agent can write — a short summary following
// the profile's report guidance — is optional (`reportNarrative`) and arrives as
// `narrative.json`, a few sentences the script inserts.
//
// Pure: no file system, no git. `t` gives the labels in the plugin's language; the
// findings are already in it (the agents wrote them so).

import path from 'node:path'

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
export const GROUPINGS = ['severity', 'rule', 'file']

/** How a built-in type groups its findings when the config says nothing. */
export const DEFAULT_GROUPING = {
  performance: 'rule',
  accessibility: 'rule',
  'dead-code': 'rule',
}

const rank = (s) => (SEVERITIES.includes(s) ? SEVERITIES.indexOf(s) : SEVERITIES.length)
const location = (f) => (f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '')
const lines = (text) =>
  String(text ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)

/**
 * The findings in groups: by severity (the report's usual order), by rule or by file —
 * groups ordered by their most severe finding, findings by severity inside each.
 */
export function groupFindings(findings, by = 'severity') {
  const key = (f) => (by === 'rule' ? f.rule || '—' : by === 'file' ? f.file || '—' : f.severity)
  const groups = new Map()
  for (const f of [...findings].sort((a, b) => rank(a.severity) - rank(b.severity)))
    (groups.get(key(f)) ?? groups.set(key(f), []).get(key(f))).push(f)
  return [...groups.entries()]
    .map(([name, list]) => ({ name, findings: list }))
    .sort(
      (a, b) =>
        (by === 'severity' ? rank(a.name) - rank(b.name) : 0) ||
        rank(a.findings[0].severity) - rank(b.findings[0].severity) ||
        b.findings.length - a.findings.length ||
        String(a.name).localeCompare(String(b.name))
    )
}

/** What the scan does not cover: the project overlay's section, else the built-in text. */
export function notCoveredOf(profile, t) {
  const own = lines(profile.not_covered)
  if (own.length) return own
  const key = `notCovered_${profile.type}`
  const builtin = t(key)
  return builtin === key ? [] : lines(builtin.replace(/ \| /g, '\n'))
}

function comparison(final) {
  const status = (s) => final.findings.filter((f) => f.status === s).length
  return {
    newCount: status('new'),
    persisting: status('persisting'),
    resolved: final.resolved?.length ?? 0,
    refuted: final.refuted?.length ?? 0,
    untriaged: final.untriaged?.length ?? 0,
    previous: final.previous?.run ?? null,
  }
}

/** A built-in type's name in the plugin's language; an overlay-only type's own title. */
function typeTitle(type, profile, t) {
  const key = `rpt_type_${type}`
  const named = t(key)
  return named === key ? (profile.title ?? type) : named
}

/** Everything both formats say, in order: one model, two renderers. */
export function reportModel(final, profile, { t, groupBy = null, narrative = null } = {}) {
  const by = GROUPINGS.includes(groupBy) ? groupBy : (DEFAULT_GROUPING[final.type] ?? 'severity')
  const top = [...final.findings]
    .filter((f) => f.severity !== 'info')
    .sort((a, b) => rank(a.severity) - rank(b.severity))
    .slice(0, 3)
  return {
    title: t('rpt_title', { type: typeTitle(final.type, profile, t) }),
    meta: {
      date: String(final.finished ?? final.started ?? '').slice(0, 10),
      commit: final.commit ?? '?',
      branch: final.branch ?? '?',
      scope: final.scope ?? '?',
      files: Array.isArray(final.files) ? final.files.length : (final.files ?? '?'),
      profile: final.profile_fingerprint ?? '?',
      overlay: profile.sources?.overlay ?? null,
      run: final.run,
    },
    notCovered: notCoveredOf(profile, t),
    narrative: narrative && typeof narrative === 'object' ? narrative : null,
    counts: SEVERITIES.map((s) => ({ severity: s, n: final.counts?.[s] ?? 0 })),
    compare: comparison(final),
    profileChanged: Boolean(final.previous && final.previous.profile_fingerprint !== final.profile_fingerprint),
    top,
    by,
    groups: groupFindings(final.findings, by),
    resolved: final.resolved ?? [],
    refuted: final.refuted ?? [],
  }
}

// ─── HTML ───────────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Prose: escaped, paragraphs on blank lines, `code` spans kept. */
const prose = (text) =>
  String(text ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`)
    .join('')

const CSS = `
:root { --bg:#fbfaf7; --fg:#1d1d1b; --muted:#6b6a66; --line:#e3e0d8; --card:#ffffff; --code:#f3f1ec; --accent:#1d5fb8;
  --critical:#b3261e; --high:#c4550d; --medium:#9a6b00; --low:#2f6f9f; --info:#6b6a66; }
@media (prefers-color-scheme: dark) { :root { --bg:#151514; --fg:#ecebe6; --muted:#a09e97; --line:#34332f; --card:#1d1d1b; --code:#23221f; --accent:#7fb0f5;
  --critical:#f28b82; --high:#f6ad6b; --medium:#e5c35c; --low:#8ec5f0; --info:#a09e97; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 system-ui, sans-serif; }
.page { max-width:60rem; margin:0 auto; padding:2rem 1rem 4rem; }
a { color:var(--accent); }
h1 { font-size:1.8rem; margin:0 0 .4rem; }
h2 { font-size:1.3rem; margin:2.4rem 0 .6rem; padding-bottom:.3rem; border-bottom:1px solid var(--line); }
h3 { font-size:1.05rem; margin:0; }
.meta, .muted { color:var(--muted); font-size:.88rem; }
.callout { border-left:4px solid var(--medium); background:var(--card); padding:.6rem 1rem; margin:1.2rem 0; }
.counts { display:flex; flex-wrap:wrap; gap:1.4rem; list-style:none; padding:0; }
.counts strong { display:block; font-size:1.6rem; }
.sev { font:600 .75rem ui-monospace, monospace; text-transform:uppercase; letter-spacing:.03em; padding:.05rem .45rem; border-radius:4px; border:1px solid currentColor; }
.sev-critical { color:var(--critical); } .sev-high { color:var(--high); } .sev-medium { color:var(--medium); } .sev-low { color:var(--low); } .sev-info { color:var(--info); }
.tag { font-size:.75rem; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:0 .5rem; }
article { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:1rem 1.1rem; margin:1rem 0; }
article.plausible { border-style:dashed; }
article header { display:flex; flex-wrap:wrap; gap:.5rem; align-items:baseline; margin-bottom:.4rem; }
.fid { font-family:ui-monospace, monospace; color:var(--muted); }
dl { margin:.6rem 0 0; } dt { font-weight:600; margin-top:.6rem; } dd { margin:0; }
dd p { margin:.2rem 0; }
pre { background:var(--code); padding:.7rem .9rem; border-radius:6px; overflow-x:auto; font-size:.85rem; }
code { font-size:.88em; overflow-wrap:anywhere; }
ul.plain { padding-left:1.1rem; } ul.plain li { margin:.35rem 0; }
`

function findingHtml(f, t) {
  const verdict = f.verdict && f.verdict !== 'confirmed' ? `<span class="tag">${esc(t(`rpt_verdict_${f.verdict}`))}</span>` : ''
  const field = (label, value, raw = false) =>
    value ? `<dt>${esc(t(label))}</dt><dd>${raw ? value : prose(value)}</dd>` : ''
  return `<article id="${esc(f.id)}"${f.verdict === 'plausible' ? ' class="plausible"' : ''}>
<header><span class="fid">${esc(f.id)}</span><span class="sev sev-${esc(f.severity)}">${esc(t(`rpt_sev_${f.severity}`))}</span>${
    f.status ? `<span class="tag">${esc(t(`rpt_status_${f.status}`))}</span>` : ''
  }${verdict}<h3>${esc(f.title)}</h3></header>
${location(f) ? `<p class="meta"><code>${esc(location(f))}</code>${f.rule ? ` · ${esc(t('rpt_rule'))} <code>${esc(f.rule)}</code>` : ''}</p>` : ''}
${f.snippet ? `<pre><code>${esc(f.snippet)}</code></pre>` : ''}
<dl>${field('rpt_description', f.description)}${field('rpt_reachability', f.reachability)}${field('rpt_evidence', f.evidence)}${field(
    'rpt_remediation',
    f.remediation
  )}${field('rpt_triage', f.triage_reason)}${field('rpt_downgraded', f.downgraded)}</dl>
</article>`
}

export function renderHtml(model, { t, code, css = '' }) {
  const m = model.meta
  const c = model.compare
  const narrative = model.narrative
  const groupTitle = (g) =>
    model.by === 'severity' ? t(`rpt_sev_${g.name}`) : model.by === 'rule' ? t('rpt_groupRule', { rule: g.name }) : g.name
  return `<!doctype html>
<html lang="${esc(code)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)}</title>
<style>${CSS}${css ? `\n/* project */\n${css}` : ''}</style>
</head>
<body>
<div class="page">
<header>
<h1>${esc(model.title)}</h1>
<p class="meta">${esc(t('rpt_meta', m))}${m.overlay ? ` · ${esc(t('rpt_overlay', { overlay: m.overlay }))}` : ''}</p>
</header>
${
  model.notCovered.length
    ? `<section class="callout"><strong>${esc(t('rpt_notCovered'))}</strong><ul class="plain">${model.notCovered
        .map((l) => `<li>${esc(l)}</li>`)
        .join('')}</ul></section>`
    : ''
}
${narrative?.summary ? `<section><h2>${esc(t('rpt_summary'))}</h2>${prose(narrative.summary)}</section>` : ''}
<section>
<h2>${esc(t('rpt_counts'))}</h2>
<ul class="counts">${model.counts
    .map((x) => `<li><strong class="sev-${x.severity}">${x.n}</strong>${esc(t(`rpt_sev_${x.severity}`))}</li>`)
    .join('')}</ul>
<p>${esc(
    c.previous
      ? t('rpt_compare', { new: c.newCount, persisting: c.persisting, resolved: c.resolved, previous: c.previous })
      : t('rpt_firstScan')
  )} ${esc(t('rpt_refutedCount', { n: c.refuted }))}${c.untriaged ? ` ${esc(t('rpt_untriaged', { n: c.untriaged }))}` : ''}</p>
${model.profileChanged ? `<p class="muted">${esc(t('rpt_profileChanged'))}</p>` : ''}
${m.scope !== 'full' ? `<p class="muted">${esc(t('rpt_partial'))}</p>` : ''}
${
  model.top.length
    ? `<h3>${esc(t('rpt_top'))}</h3><ul class="plain">${model.top
        .map(
          (f) =>
            `<li><span class="sev sev-${esc(f.severity)}">${esc(t(`rpt_sev_${f.severity}`))}</span> <a href="#${esc(f.id)}">${esc(f.id)}</a> — ${esc(f.title)}${
              location(f) ? ` <code>${esc(location(f))}</code>` : ''
            }</li>`
        )
        .join('')}</ul>`
    : ''
}
${(narrative?.notes ?? []).length ? `<ul class="plain">${narrative.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
</section>
<section>
<h2>${esc(t('rpt_findings'))}</h2>
${
  model.groups.length
    ? model.groups
        .map(
          (g) =>
            `${model.groups.length > 1 || model.by !== 'severity' ? `<h3>${esc(groupTitle(g))} <span class="muted">(${g.findings.length})</span></h3>` : ''}\n${g.findings
              .map((f) => findingHtml(f, t))
              .join('\n')}`
        )
        .join('\n')
    : `<p>${esc(t('rpt_none'))}</p>`
}
</section>
${
  model.resolved.length
    ? `<section><h2>${esc(t('rpt_resolved'))}</h2><ul class="plain">${model.resolved
        .map(
          (r) =>
            `<li><span class="sev sev-${esc(r.severity)}">${esc(t(`rpt_sev_${r.severity}`))}</span> ${esc(r.title)}${r.file ? ` <code>${esc(r.file)}</code>` : ''}</li>`
        )
        .join('')}</ul></section>`
    : ''
}
${
  model.refuted.length
    ? `<section><h2>${esc(t('rpt_refuted'))}</h2><p class="muted">${esc(t('rpt_refutedIntro'))}</p><ul class="plain">${model.refuted
        .map(
          (r) =>
            `<li><strong>${esc(r.title)}</strong>${r.file ? ` <code>${esc(r.file)}</code>` : ''}${prose(r.reason)}${
              r.never_report_entry ? `<blockquote class="muted">${esc(r.never_report_entry)}</blockquote>` : ''
            }</li>`
        )
        .join('')}</ul></section>`
    : ''
}
<p class="muted">${esc(t('rpt_footer', { run: m.run }))}</p>
</div>
</body>
</html>
`
}

// ─── Markdown ───────────────────────────────────────────────────────────────

/** Inline text: what Markdown would read as markup is escaped; code spans kept. */
function mdText(text, { cell = false } = {}) {
  const parts = String(text ?? '').split(/(`[^`\n]+`)/)
  return parts
    .map((p, i) =>
      i % 2
        ? p
        : p
            .replace(/\\/g, '\\\\')
            .replace(/([*_<>[\]])/g, '\\$1')
            .replace(/\|/g, cell ? '\\|' : '|')
            .replace(/\n{2,}/g, '\n\n')
    )
    .join('')
}

/** A code span that survives backticks in the value. */
function mdCode(value) {
  const s = String(value)
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length))
  const fence = '`'.repeat(longest + 1)
  return longest ? `${fence} ${s} ${fence}` : `${fence}${s}${fence}`
}

/** A fenced block longer than any run of backticks inside it. */
function mdBlock(code, file) {
  const longest = Math.max(2, ...(String(code).match(/`+/g) ?? []).map((r) => r.length))
  const fence = '`'.repeat(longest + 1)
  const lang = path.extname(file ?? '').slice(1).toLowerCase()
  return `${fence}${lang}\n${code}\n${fence}`
}

/** `file:line` as a link from the report's directory to the file. */
function mdLocation(f, reportDir) {
  if (!f.file) return ''
  const label = mdCode(location(f))
  if (reportDir == null) return label
  const target = path.posix.relative(reportDir, f.file).split('/').map(encodeURIComponent).join('/')
  return `[${label}](${target}${f.line ? `#L${f.line}` : ''})`
}

export function renderMarkdown(model, { t, report = null }) {
  const m = model.meta
  const c = model.compare
  const reportDir = report ? path.posix.dirname(report) : null
  const out = [`# ${mdText(model.title)}`, '', `_${mdText(t('rpt_meta', m))}${m.overlay ? ` · ${mdText(t('rpt_overlay', { overlay: m.overlay }))}` : ''}_`, '']
  if (model.notCovered.length) out.push(`> **${mdText(t('rpt_notCovered'))}**`, '>', ...model.notCovered.map((l) => `> - ${mdText(l)}`), '')
  if (model.narrative?.summary) out.push(`## ${mdText(t('rpt_summary'))}`, '', mdText(model.narrative.summary), '')
  out.push(`## ${mdText(t('rpt_counts'))}`, '')
  out.push(`| ${model.counts.map((x) => mdText(t(`rpt_sev_${x.severity}`), { cell: true })).join(' | ')} |`)
  out.push(`| ${model.counts.map(() => '---:').join(' | ')} |`)
  out.push(`| ${model.counts.map((x) => x.n).join(' | ')} |`, '')
  out.push(
    `${mdText(c.previous ? t('rpt_compare', { new: c.newCount, persisting: c.persisting, resolved: c.resolved, previous: c.previous }) : t('rpt_firstScan'))} ${mdText(
      t('rpt_refutedCount', { n: c.refuted })
    )}${c.untriaged ? ` ${mdText(t('rpt_untriaged', { n: c.untriaged }))}` : ''}`,
    ''
  )
  if (model.profileChanged) out.push(`_${mdText(t('rpt_profileChanged'))}_`, '')
  if (m.scope !== 'full') out.push(`_${mdText(t('rpt_partial'))}_`, '')
  if (model.top.length) {
    out.push(`**${mdText(t('rpt_top'))}**`, '')
    for (const f of model.top) out.push(`- **${mdText(t(`rpt_sev_${f.severity}`))}** ${f.id} — ${mdText(f.title)} ${mdLocation(f, reportDir)}`.trimEnd())
    out.push('')
  }
  for (const n of model.narrative?.notes ?? []) out.push(`- ${mdText(n)}`)
  if (model.narrative?.notes?.length) out.push('')
  out.push(`## ${mdText(t('rpt_findings'))}`, '')
  if (!model.groups.length) out.push(mdText(t('rpt_none')), '')
  const headed = model.groups.length > 1 || model.by !== 'severity'
  for (const g of model.groups) {
    if (headed) {
      const name = model.by === 'severity' ? t(`rpt_sev_${g.name}`) : model.by === 'rule' ? t('rpt_groupRule', { rule: g.name }) : g.name
      out.push(`### ${mdText(name)} (${g.findings.length})`, '')
    }
    for (const f of g.findings) {
      const labels = [t(`rpt_sev_${f.severity}`), f.status && t(`rpt_status_${f.status}`), f.verdict && f.verdict !== 'confirmed' && t(`rpt_verdict_${f.verdict}`)]
        .filter(Boolean)
        .join(' · ')
      out.push(`${headed ? '####' : '###'} ${f.id} · ${mdText(labels)} — ${mdText(f.title)}`, '')
      const where = [mdLocation(f, reportDir), f.rule ? `${mdText(t('rpt_rule'))} ${mdCode(f.rule)}` : ''].filter(Boolean).join(' · ')
      if (where) out.push(where, '')
      if (f.snippet) out.push(mdBlock(f.snippet, f.file), '')
      for (const [label, value] of [
        ['rpt_description', f.description],
        ['rpt_reachability', f.reachability],
        ['rpt_evidence', f.evidence],
        ['rpt_remediation', f.remediation],
        ['rpt_triage', f.triage_reason],
        ['rpt_downgraded', f.downgraded],
      ])
        if (value) out.push(`**${mdText(t(label))}.** ${mdText(value)}`, '')
    }
  }
  if (model.resolved.length) {
    out.push(`## ${mdText(t('rpt_resolved'))}`, '')
    for (const r of model.resolved) out.push(`- **${mdText(t(`rpt_sev_${r.severity}`))}** ${mdText(r.title)}${r.file ? ` ${mdCode(r.file)}` : ''}`)
    out.push('')
  }
  if (model.refuted.length) {
    out.push(`## ${mdText(t('rpt_refuted'))}`, '', `_${mdText(t('rpt_refutedIntro'))}_`, '')
    for (const r of model.refuted) {
      out.push(`- **${mdText(r.title)}**${r.file ? ` ${mdCode(r.file)}` : ''} — ${mdText(r.reason).replace(/\n+/g, ' ')}`)
      if (r.never_report_entry) out.push(`  > ${mdText(r.never_report_entry).replace(/\n+/g, ' ')}`)
    }
    out.push('')
  }
  out.push('---', '', `_${mdText(t('rpt_footer', { run: m.run }))}_`, '')
  return out.join('\n')
}
