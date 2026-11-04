---
type: regex
target: {source: file, path: acme/.git/worktrees/add-login-retry/HEAD}
pattern: "ref: refs/heads/feature/[a-z-]*login-retry"
weight: 1
---

The new worktree is on a feature/ branch naming the task, as the repository's other branches are.
