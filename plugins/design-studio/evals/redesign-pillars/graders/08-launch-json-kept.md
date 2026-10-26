---
type: regex
target: {source: file, path: aurelle/.claude/launch.json}
pattern: "configurations"
weight: 1
---

.claude/launch.json still exists in the working tree. (A file_exists grader would not do: it checks the files the run created or changed, and a kept file is neither.)
