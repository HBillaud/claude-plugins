---
type: llm
focus: {source: file, path: coastline/styles.css}
weight: 1
---

coastline/styles.css defines the hero type once for every page's hero, with the home page's values: the eyebrow (12px, 0.2em tracking, uppercase), the h1 (56px, line height 1.1, weight 500, and 38px under 640px) and the intro (18px, line height 1.6). The rules are not scoped to the home page alone (`.home .hero ...`), or they are tokens that every page's hero rules use.
