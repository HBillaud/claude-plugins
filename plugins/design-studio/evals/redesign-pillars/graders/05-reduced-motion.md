---
type: llm
focus: trace
weight: 1
---

The branch's diff adds a reduced-motion path for every animation it introduces (`@media (prefers-reduced-motion: reduce)`, `matchMedia("(prefers-reduced-motion: reduce)")` or equivalent), and the pillars content is visible without JavaScript-triggered motion: no element of the section can stay at `opacity: 0` if the animation never runs.
