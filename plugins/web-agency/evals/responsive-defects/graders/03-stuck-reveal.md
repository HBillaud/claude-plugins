---
type: llm
focus: {source: file, path: RESPONSIVE.md}
weight: 1
---

./RESPONSIVE.md reports that the `.quotes` section ("What clients say") stays invisible (opacity 0) after scrolling through the page at every width, and identifies the cause or the likely cause: reveal.js only observes `.reveal[data-animate]`, which `.quotes` lacks.
