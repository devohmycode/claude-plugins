#!/usr/bin/env node
// A fake GitHub CLI for the docflow tests: pull requests, issues and labels live in the
// JSON file FAKE_GH_DB; every call is recorded in `calls`. FAKE_GH_FAIL=<sub command>
// (e.g. `pr create`) makes that call fail.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const dbFile = process.env.FAKE_GH_DB
const db = existsSync(dbFile) ? JSON.parse(readFileSync(dbFile, 'utf8')) : { prs: [], issues: [], labels: [], calls: [] }
for (const k of ['prs', 'issues', 'labels', 'calls']) db[k] ??= []
const args = process.argv.slice(2)
db.calls.push(args)
const save = () => writeFileSync(dbFile, JSON.stringify(db, null, 2))

const [group, action, ...rest] = args
const sub = `${group} ${action}`
if (process.env.FAKE_GH_FAIL && process.env.FAKE_GH_FAIL === sub) {
  save()
  process.stderr.write(`fake gh: ${sub} failed on purpose\n`)
  process.exit(1)
}

function option(name, all = false) {
  const values = []
  for (let i = 0; i < rest.length; i++) if (rest[i] === `--${name}`) values.push(rest[i + 1])
  return all ? values : values[0]
}
const flag = (name) => rest.includes(`--${name}`)
const body = () => {
  const file = option('body-file')
  return file ? readFileSync(file, 'utf8') : (option('body') ?? '')
}
const pick = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj[f]]))
const fields = () => (option('json') ?? 'number').split(',')
const nextNumber = () => 1 + Math.max(0, ...db.prs.map((p) => p.number), ...db.issues.map((i) => i.number))
const REPO = 'https://github.com/test/project'

function out(value) {
  save()
  process.stdout.write(typeof value === 'string' ? `${value}\n` : JSON.stringify(value))
  process.exit(0)
}

switch (sub) {
  case 'pr create': {
    const number = nextNumber()
    const pr = {
      number,
      url: `${REPO}/pull/${number}`,
      state: 'OPEN',
      isDraft: flag('draft'),
      base: option('base'),
      head: option('head'),
      title: option('title'),
      body: body(),
    }
    db.prs.push(pr)
    out(pr.url)
  }
  case 'pr list': {
    const head = option('head')
    out(db.prs.filter((p) => (!head || p.head === head) && p.state === 'OPEN').map((p) => pick(p, fields())))
  }
  case 'pr edit': {
    const pr = db.prs.find((p) => String(p.number) === rest[0] || p.head === rest[0] || p.url === rest[0])
    if (!pr) process.exit(1)
    if (option('title')) pr.title = option('title')
    if (option('body-file')) pr.body = body()
    out(pr.url)
  }
  case 'issue list': {
    const labels = option('label', true)
    const state = option('state') ?? 'open'
    const found = db.issues.filter(
      (i) => labels.every((l) => i.labels.includes(l)) && (state === 'all' || i.state.toLowerCase() === state)
    )
    out(found.map((i) => ({ ...pick(i, fields()), ...(fields().includes('labels') ? { labels: i.labels.map((name) => ({ name })) } : {}) })))
  }
  case 'issue create': {
    const number = nextNumber()
    const labels = option('label', true)
    for (const l of labels) if (!db.labels.includes(l)) {
      save()
      process.stderr.write(`could not add label: '${l}' not found\n`)
      process.exit(1)
    }
    db.issues.push({ number, url: `${REPO}/issues/${number}`, title: option('title'), body: body(), state: 'OPEN', labels })
    out(`${REPO}/issues/${number}`)
  }
  case 'issue edit': {
    const issue = db.issues.find((i) => String(i.number) === rest[0])
    if (!issue) process.exit(1)
    if (option('title')) issue.title = option('title')
    if (option('body-file')) issue.body = body()
    for (const l of option('add-label', true)) if (!issue.labels.includes(l)) issue.labels.push(l)
    out(issue.url)
  }
  case 'issue close':
  case 'issue reopen': {
    const issue = db.issues.find((i) => String(i.number) === rest[0])
    if (!issue) process.exit(1)
    issue.state = action === 'close' ? 'CLOSED' : 'OPEN'
    out('')
  }
  case 'label list':
    out(db.labels.map((name) => ({ name })))
  case 'label create': {
    if (!db.labels.includes(rest[0])) db.labels.push(rest[0])
    out('')
  }
  default:
    save()
    process.stderr.write(`fake gh: unsupported ${args.join(' ')}\n`)
    process.exit(2)
}
