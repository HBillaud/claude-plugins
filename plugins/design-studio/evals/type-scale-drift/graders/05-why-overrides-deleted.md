---
type: regex
target: {source: file, path: coastline/why-florida/why.css}
pattern: "\\.hero|\\bh2\\b"
match: not_contains
weight: 1
---

Why Florida's per-page hero overrides and its 32px section-title override are deleted; its .stat layout rule stays, so the file does too.
