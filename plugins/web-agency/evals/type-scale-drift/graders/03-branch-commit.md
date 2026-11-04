---
type: regex
target: {source: file, path: coastline/.git/logs/HEAD}
pattern: "checkout: moving from main to [^\\n]+[\\s\\S]*\\tcommit: "
weight: 1
---

The fix is committed on a branch: HEAD's reflog shows a checkout from main to another branch, then a commit.
