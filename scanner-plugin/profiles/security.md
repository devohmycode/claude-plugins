# Security

Main axis: **authorization and data exposure** — a read whose scope does not come from
the right place, before injection. Generic profile: a project overlay should name the
application's access-control primitives, its trust boundaries and its deliberate
decisions (the "never report" list).

## Description

Security scan of a web application or service. Axis: authorization and data exposure first
(who can read or change what, and where that decision is made), then injection, secrets,
authentication and session handling, abuse controls (rate limits, quotas), fail-closed
robustness, and production dependencies. Excludes generated code, vendored dependencies,
build output and test fixtures. Findings must describe a concrete exploitation path.

## Threat model

ACTORS

- Anonymous visitor; authenticated user with the lowest role; user with an elevated role
  who should still be bounded; holder of a leaked or shared link; a compromised third-party
  service calling a webhook.

ASSETS

- Personal data and anything whose visibility depends on the viewer.
- Credentials, API keys, signing secrets, session tokens.
- The ability to write: admin actions, content mutation, account changes.
- Availability of paid third-party quotas (AI, email, storage) that an abuser can drain.

TRUST BOUNDARIES

- HTTP entry points: route handlers, API routes, server actions, RPC, webhooks, middleware.
- The database: row-level policies, views, functions running with elevated privileges.
- Caches: anything cached across users must not depend on the viewer.
- Redirects and URLs built from user input.

WHAT USUALLY GOES WRONG

- The scope of a read is derived from a request parameter, a client-provided id or a
  token claim that can be stale, instead of the server-side authority.
- A resource the viewer may not see answers 403 instead of 404, which confirms it exists.
- A catch-all error handler lets a request through when a security check throws.
- A cache key omits the viewer's scope; a response carrying personal data is cacheable.
- An open redirect through a `next` / `returnTo` / `callbackUrl` parameter.
- A webhook without signature verification, or with a non-constant-time comparison.
- A secret committed in any tracked file, including Markdown, fixtures and scripts.

## Investigation

Verify before asserting: the missing check in one file may live upstream — middleware, a
data loader, a wrapper, a database policy. Follow the call to its end before concluding.

If the project overlay names reference primitives (the function that computes the viewer's
scope, the safe-redirect helper, the id validator…), check by grep that they still exist
under that name before reporting that they are not used.

Silent failure modes worth looking for, because they raise nothing:

- an environment flag read loosely (truthy string, "1", "TRUE") where the code expects an
  exact value;
- a build-time variable only set at runtime, which never reaches the production bundle;
- two lists that must mirror each other without being able to import each other;
- an in-memory module cache without TTL, which keeps serving data whose visibility has
  changed.

These are security findings only when they touch an access control or a secret; otherwise
classify them as info.

## Triage

ALWAYS CRITICAL (maximum severity even if exploitation needs a valid account)

- A content read whose scope does not come from the server-side authority, or a scope
  widened on the sole basis of a request parameter or a token claim.
- A secret, password, token or private key in clear in a tracked file.
- A catch that lets a request through in production when a security check, a rate limit
  or a signature verification should have refused it.

HIGH

- 403 (or any message telling "exists" from "does not exist") on an entity the requester may
  not see.
- Open redirect; SSRF; SQL/command/template injection with a reachable input.
- A response carrying personal data that a shared cache may store.

MEDIUM

- Missing rate limit on an endpoint that sends email, calls a paid API or checks a password.
- Session not revoked after a role downgrade or an email change.

NEVER REPORT (generic)

- Public client-side configuration meant to be public (publishable keys, public URLs).
- Test credentials in test fixtures that only target a local or mocked service.
- Dependencies used only in development or tests, unless they run in CI with secrets.
- Theoretical issues with no input reaching them.
- Anything the project overlay lists as a documented, deliberate decision.

## Report

Each finding cites a path and a line and describes a concrete exploitation path: who
(anonymous, lowest role, elevated role, link holder), through which request, to obtain what.
A finding with only the code pattern and no reachability path is classified info.

Open the report by stating what the scan does not cover: the live database (policies actually
deployed, as opposed to those declared in migrations) and the infrastructure (firewall, CDN,
hosting). A clean report says nothing about those surfaces.

## Remediation

SECURITY — in addition to the common rules

- Never weaken a check to fix another one; never replace a server-side verification by a
  cheaper client-side or cached one.
- A fix on an access control comes with a test that exercises the denied path.
- Never rename or rotate a secret as part of a fix: flag it for the user.

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
