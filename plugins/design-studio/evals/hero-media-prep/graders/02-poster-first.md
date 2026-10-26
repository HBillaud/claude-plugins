---
type: llm
focus: trace
weight: 1
---

In the committed lumpia/site/index.html (and any script it loads), the hero's first visual is an `<img>` poster with `fetchpriority="high"`, the `<video>` element has no `src` attribute and no `<source>` children in the HTML, and script adds the video sources only after the window `load` event (or later, such as requestIdleCallback after load).
