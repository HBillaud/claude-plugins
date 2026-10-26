---
type: regex
target: {source: file, path: coastline/guide/guide.css}
pattern: "\\.hero"
match: not_contains
weight: 1
---

The guide's per-page hero overrides are deleted, not edited to new numbers; its .stat layout rule stays, so the file does too.
