---
type: regex
target: {source: file, path: aurelle/.git/index}
pattern: "\\.claude/launch\\.json"
match: not_contains
weight: 1
---

.claude/launch.json is not tracked on the checked-out branch: the git index does not list it.
