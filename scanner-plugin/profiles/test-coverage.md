# Test coverage

The subject is not the percentage. It is the **invariants nothing protects**: the
authorization rule, the pure function every page relies on, the two lists that must stay in
sync — code whose breakage would pass CI green.

## Description

Test-coverage scan. Axis: authorization and visibility rules without a test on the denied
path, then pure modules with branching logic and no unit test, then invariants between files
(mirrors, allow-lists, config duplicated between build and runtime) with no test comparing
them, then tests that exist but prove nothing (assert nothing, mock the unit under test, snapshot
everything). Every finding names the regression that would go unnoticed.

## Investigation

- For each access-control function or middleware branch: is there a test where access is
  denied, not only granted?
- For each pure module (no I/O) with conditionals: is each branch reached by a test?
- For each pair of lists or constants that must match across files: does a test read both
  and compare them?
- For each hard-coded identifier the code depends on (a root record, a slug, a feature key):
  does a test check that it still exists?
- Read existing tests critically: a test that mocks the module it claims to test, asserts
  only that a function was called, or never awaits the async result, protects nothing.
- Do not report low coverage of trivial code (getters, re-exports, types).

## Triage

HIGH

- An authorization or visibility rule with no test of the denied path.
- A cross-file invariant whose breakage is silent and has no test.

MEDIUM

- A pure module with branching logic and no test.
- A test that proves nothing while looking green.

LOW

- Missing edge cases in an otherwise tested module.

NEVER REPORT (generic)

- Missing tests for generated code, types, configuration files or trivial wrappers.
- End-to-end coverage of flows the project overlay says are covered elsewhere.

## Report

Each finding names the code (path and line), the regression that would pass unnoticed, and
the test to write (unit, integration or end-to-end; what it asserts). Order by the damage the
regression would do, not by file. Do not quote coverage percentages as findings.

## Remediation

TEST COVERAGE — in addition to the common rules

- Write the test so that it fails against a deliberately broken version of the code, and
  check that it does.
- Do not change production code to make it testable unless the finding asks for it.
- Follow the project's existing test layout and helpers.

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
**/*.min.js
**/*.map
```
