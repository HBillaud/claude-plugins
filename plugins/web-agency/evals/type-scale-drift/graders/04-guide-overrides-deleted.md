---
type: regex
target: {source: file, path: coastline/guide/guide.css}
pattern: "(^|[{}])\\s*[^/*{}\\n]*\\.hero[^{}]*\\{"
flags: "m"
match: not_contains
weight: 1
---

The guide's per-page hero overrides are deleted, not edited to new numbers; its .stat layout rule stays, so the file does too. Only rules count: a comment that mentions the hero is fine.
