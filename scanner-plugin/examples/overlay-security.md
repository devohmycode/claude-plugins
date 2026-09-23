Multi-tenant SaaS on Next.js + Postgres with row-level security. Every tenant-scoped read
must go through `getCurrentUserScope()`; redirects through `safeRedirect()`.

## Investigation

- The viewer's scope is computed by `getCurrentUserScope()` (lib/auth/scope.ts). Any read of
  tenant data that does not receive its result is a finding.
- Row-level policies live in `db/migrations/*.sql`; a missing application check may be
  covered there — read the policy before reporting.

## Triage

NEVER REPORT

- `'unsafe-inline'` in `script-src`: required by the theme bootstrap script, documented in
  docs/security.md.
- Cookies without `httpOnly` named `theme` or `locale`: read by client code on purpose.

## Exclusions

```
db/seed/**
fixtures/**
```
