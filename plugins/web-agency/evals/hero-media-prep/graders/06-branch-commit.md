---
type: regex
target: {source: file, path: lumpia/site/.git/logs/HEAD}
pattern: "checkout: moving from main to [^\\n]+[\\s\\S]*\\tcommit: "
weight: 1
---

The changes are committed on a branch of lumpia/site: HEAD's reflog shows a checkout from main to another branch, then a commit.
