# Dead code

What a migration leaves behind: files nothing imports, exports nothing uses, flags that no
longer switch anything, dependencies no longer imported. The risk is not the bytes — it is
the reader who believes dead code is alive and builds on it.

## Description

Dead-code scan. Axis: unreferenced files and exports, then unused dependencies, then
configuration and environment variables read nowhere, then feature flags stuck on one value,
then database columns or tables written but never read (when the schema is in the repository),
then scripts and tests that exercise nothing. Every finding proves the absence of use with the
search that was run.

## Investigation

- An export is dead only if no import, dynamic import, string reference (routers, registries,
  config files, test globs) or framework convention (file-based routing, special file names)
  reaches it. Search for all of them before concluding.
- A dependency is unused only if no import, no config file, no script and no CLI invocation
  uses it.
- An environment variable is dead only if no code, CI workflow, Dockerfile or deployment
  config reads it.
- Framework entry points (pages, route handlers, middleware, config files) are alive by
  convention even when nothing imports them.
- A column read by a view, a function or a policy is alive.
- Look for leftovers of a removed library: names, adapters, env vars and docs that survive it.
- Record the exact searches in `evidence`.

## Triage

MEDIUM

- A module or component with no reference at all.
- A dependency in the manifest never imported.
- A flag or environment variable read nowhere, still set in deployment config.

LOW

- An unused export in a module that is otherwise alive.
- A test that asserts nothing or only mocks.

INFO

- Documentation describing code that no longer exists.

NEVER REPORT (generic)

- Deliberate mirrors and generated copies kept in sync by a script.
- Public API of a library package meant for external consumers.
- Anything the project overlay lists as intentionally kept (compatibility shims, migration
  windows).

## Report

Each finding cites the file (and line for an export), the searches that prove no use, and the
risk of removal (runtime reflection, external consumers). Group by kind: files, exports,
dependencies, configuration, schema, tests. Removals are proposed, never presented as safe
without the evidence.

## Remediation

DEAD CODE — in addition to the common rules

- Remove one kind of dead code per commit.
- Removing a dependency updates the lockfile with the package manager, never by hand.
- Removing a column or a table goes through a proper migration, and only after the code
  that wrote it is gone.

## Exclusions

```
node_modules/**
vendor/**
dist/**
build/**
out/**
.next/**
coverage/**
test-results/**
**/*.min.js
**/*.map
```
