---
type: regex
target: {source: file, path: acme/.git/worktrees/add-login-retry/gitdir}
pattern: "acme/\\.claude/worktrees/add-login-retry/\\.git"
weight: 1
---

Git registered the new worktree directly under the primary checkout, not inside add-search.
