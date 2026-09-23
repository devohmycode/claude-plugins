# Performance

The unit of reasoning is the **round trip**: a database or API call costs tens of
milliseconds, and a sequence of them is what users wait for. This scan reads code; it
measures nothing — pair it with real measurements (Lighthouse, traces) before acting on
anything large.

## Description

Performance scan of a web application reading its source only. Axis: server response time
(sequential round trips, N+1 queries, uncached hot paths, work done per request that could be
done at build time), then client weight (bundle size, eager imports of heavy libraries, images),
then rendering (layout thrash, unnecessary re-renders, blocking scripts). Every finding states
which page or flow pays for it and an order of magnitude of the gain.

## Investigation

- Trace the data path of the most visited pages: entry point → loaders → database/API
  calls. Count round trips and whether they are sequential when they could be parallel.
- Look for N+1 patterns: a query inside a loop or a map, a per-item fetch in a list.
- Check what is fetched: selecting every column (or a large text/blob column) for a list
  view; payloads serialized to the client that the client does not use.
- Check caching: a hot read recomputed on every request; a cache without bound or TTL; a
  cache keyed without the viewer's scope (a correctness bug, not a performance win).
- Client side: heavy libraries imported at the top level of a shared layout or component;
  code that could be loaded on interaction; barrel imports that pull a whole package;
  images without explicit size or served at full resolution.
- Rendering mode: a page forced dynamic when it could be static or incrementally
  regenerated, or the reverse (a per-user read inside a statically rendered page).
- Do not assume: open the file, count the calls, cite the lines.

## Triage

HIGH

- Sequential round trips on the critical path of a frequently visited page that could run
  in parallel or be merged.
- N+1 queries on a list page.
- A heavy dependency shipped in the shared client bundle of every page.

MEDIUM

- Over-fetching (columns, rows) on list endpoints.
- Missing cache on a hot, rarely changing read.
- Images served far above their rendered size.

LOW / INFO

- Micro-optimisations with no measurable user impact.

NEVER REPORT (generic)

- A security or correctness check that costs a round trip (re-validating a session,
  re-reading a role): it is not a cost to cut.
- Admin-only or rarely used screens, unless the cost is extreme.
- Anything the project overlay lists as a deliberate trade-off.

## Report

Group findings by expected gain, largest first, not by file. Each finding cites a path and a
line, names the page or flow that pays, and gives an order of magnitude (round trips, bytes
transferred, kilobytes of bundle). Open the report with the three largest gains before any
exhaustive list. State that the scan reads code and measures neither production nor real user
metrics.

## Remediation

PERFORMANCE — in addition to the common rules

- Parallelising must never change the scope of a read: every query keeps its access filter.
- Never trade a security check for speed.
- A new in-memory cache is bounded in size and time; a response that depends on the viewer
  is cached only if the viewer's scope is part of the key.
- State the expected gain in the report, without presenting it as measured.

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
docs/**
tests/**
**/*.test.*
**/*.spec.*
**/*.min.js
**/*.map
```
