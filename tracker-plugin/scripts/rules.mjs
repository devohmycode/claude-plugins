// Command patterns the guard refuses, apart from the hook so that tests can read them.

/** Writing to GitHub: issues, pull requests, labels, releases, or a mutating API call. */
export const GITHUB_WRITE = [
  /\bgh\s+(issue|pr)\s+(create|edit|close|reopen|comment|delete|merge|review|lock|unlock|transfer|pin|unpin|develop|ready)\b/,
  /\bgh\s+(label|release|repo|secret|variable|workflow|run)\s+(create|edit|delete|clone|fork|rename|archive|set|enable|disable|rerun|cancel|upload)\b/,
  /\bgh\s+api\b[^|;&]*(?:-X|--method)\s*['"]?(POST|PATCH|PUT|DELETE)\b/i,
  /\bgh\s+api\b[^|;&]*\s(-f|-F|--field|--raw-field|--input)\s/,
]

// The end of a git subcommand: whitespace, a shell operator or the end of the command.
// Not `\b`, which also ends `merge` in `merge-base`.
const END = String.raw`(?=[\s;&|)]|$)`
const gitRule = (rest) => new RegExp(String.raw`\bgit\s+` + rest)

// During a triage nothing may change the working tree. Best effort: Bash is a full
// language, so this list stops mistakes, not malice.
export const MUTATING = [
  gitRule(
    String.raw`(commit|push|add|rm|mv|reset|checkout|switch|restore|rebase|merge|cherry-pick|revert|clean|worktree\s+(add|remove))${END}`
  ),
  /\bgit\s+branch\s+-[dDmM]\b/,
  // `stash` alone pushes; `stash list` and `stash show` only read.
  gitRule(String.raw`stash${END}(?!\s+(list|show)${END})`),
  // `tag` alone, `tag -l|--list`, or only filters (`--contains X`, `--points-at X`…) list;
  // a name argument or `-a`, `-d`, `-f`, `-m`, `-s` writes.
  gitRule(
    String.raw`tag${END}(?![^;&|)\n]*\s(-l|--list)${END})` +
      String.raw`(?!(\s+(--(contains|no-contains|points-at|merged|no-merged)(=\S+|\s+[^-\s;&|)][^\s;&|)]*)?|--(sort|format|color|column)(=\S+)?|--no-column|-n\d*|-i|--ignore-case))*\s*([;&|)]|$))`
  ),
  /\b(pnpm|npm|yarn|bun)\s+(format|install|i|add|remove|rm|up|update|dedupe|prune)\b/,
  /\bprettier\b[^|;&]*--write\b/,
  /\b(rm|mv|cp|rmdir|unlink|truncate|chmod|chown)\s/,
  /\bsed\s+(-[a-z]*i|--in-place)/,
  /\btee\b(?![^|;&]*\.tracker\/)/,
  /(^|[^0-9&>=-])>{1,2}\s*(?!\/dev\/null|&|\s*[^\s]*\.tracker\/)[^\s&]/,
]
