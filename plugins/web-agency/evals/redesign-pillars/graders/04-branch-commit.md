---
type: regex
target: {source: file, path: aurelle/.git/logs/HEAD}
pattern: "checkout: moving from main to redesign/[^\\n]*pillar[^\\n]*[\\s\\S]*\\tcommit: "
weight: 1
---

The work is on a branch named redesign/<something naming the pillars>, cut from main, with at least one commit: HEAD's reflog shows the checkout from main, then a commit.
