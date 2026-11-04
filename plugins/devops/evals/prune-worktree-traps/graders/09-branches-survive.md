---
type: regex
target: {source: file, path: acme/.git/refs/heads/feature/unpushed-local}
pattern: "^[0-9a-f]{40}"
weight: 1
---

The branch of the removed unpushed-local worktree still exists.
