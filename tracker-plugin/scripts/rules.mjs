// Command patterns the guard refuses, apart from the hook so that tests can read them.

/** Writing to GitHub: issues, pull requests, labels, releases, or a mutating API call. */
export const GITHUB_WRITE = [
  /\bgh\s+(issue|pr)\s+(create|edit|close|reopen|comment|delete|merge|review|lock|unlock|transfer|pin|unpin|develop|ready)\b/,
  /\bgh\s+(label|release|repo|secret|variable|workflow|run)\s+(create|edit|delete|clone|fork|rename|archive|set|enable|disable|rerun|cancel|upload)\b/,
  /\bgh\s+api\b[^|;&]*(?:-X|--method)\s*['"]?(POST|PATCH|PUT|DELETE)\b/i,
  /\bgh\s+api\b[^|;&]*\s(-f|-F|--field|--raw-field|--input)\s/,
]

// During a triage nothing may change the working tree. Best effort: Bash is a full
// language, so this list stops mistakes, not malice.
export const MUTATING = [
  /\bgit\s+(commit|push|add|rm|mv|reset|checkout|switch|restore|rebase|merge|cherry-pick|revert|stash|clean|tag|branch\s+-[dDmM]|worktree\s+(add|remove))\b/,
  /\b(pnpm|npm|yarn|bun)\s+(format|install|i|add|remove|rm|up|update|dedupe|prune)\b/,
  /\bprettier\b[^|;&]*--write\b/,
  /\b(rm|mv|cp|rmdir|unlink|truncate|chmod|chown)\s/,
  /\bsed\s+(-[a-z]*i|--in-place)/,
  /\btee\b(?![^|;&]*\.tracker\/)/,
  /(^|[^0-9&>=-])>{1,2}\s*(?!\/dev\/null|&|\s*[^\s]*\.tracker\/)[^\s&]/,
]
