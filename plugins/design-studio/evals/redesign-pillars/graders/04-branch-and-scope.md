---
type: llm
focus: trace
weight: 1
---

In ./aurelle, a branch named `redesign/pillars` (or `redesign/<something naming the pillars>`) starts from `main` and carries the work in one or more commits. `git diff main...<branch>` changes the pillars rendering and leaves the hero section and the testimonials ("Client endorsements") markup and styles untouched. The pillar titles and bodies still live in src/data/pillars.js, unchanged in wording, and are not hard-coded in components or HTML.
