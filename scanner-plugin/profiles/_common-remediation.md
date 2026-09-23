# Common remediation

Shared by every profile. Frames how a finding gets fixed, not how it is found. A
profile's own "Remediation" section and the project overlay add to it; the project
overlay wins on conflict.

## Remediation

BRANCH AND COMMITS

- Start from the base branch given in the prompt, never from a branch that deploys to
  production. Work on the fix branch given in the prompt.
- Conventional commits (fix:, perf:, refactor:, test:, chore:), one per finding or per group
  of findings sharing a cause.
- The only author is the git author. Do not add agent attribution (Co-authored-by trailers,
  session links, "Generated with …") unless the project overlay explicitly asks for it.
- Stage files by name. Never `git add -A` or `git add .`.
- Never push. Opening a pull request is the user's decision.

SCOPE

- Fix the finding and nothing else: no neighbouring refactor, no renames, no dependency
  upgrade that was not asked for.
- Never edit generated files (build output, lockfiles unless the fix is a dependency bump,
  generated clients or schemas, vendored code) nor content/data files that are not code.
- Never run a repository-wide formatter. Format only the files you touched.
- A fix that would contradict an entry of the profile's "never report" list is not a fix:
  stop and explain.
- Lists that must stay in sync across files (mirrors, allow-lists, config duplicated in
  CI and runtime) change together, never one side only.

VERIFICATION

- Run the type checker and the tests covering the touched files.
- Add a test that fails without the fix whenever possible, and check that it does fail
  without it.
- Never disable, skip or loosen a test to make it pass.

REPORT

- The finding fixed (run and id), its cause, the fix, what was verified and how, and what
  could NOT be verified — in particular behaviour that only shows up in a production build
  or at runtime.
