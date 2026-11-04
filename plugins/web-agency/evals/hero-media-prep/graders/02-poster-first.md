---
type: llm
focus: {source: file, path: lumpia/site/index.html}
weight: 1
---

In lumpia/site/index.html, the hero's first visual is an `<img>` poster with `fetchpriority="high"`, the `<video>` element has no `src` attribute and no `<source>` children in the HTML, and script adds the video sources only after the window `load` event (or later, such as requestIdleCallback after load). The script may be inline or in a file the page references; if it is external, the HTML must reference it and still carry no video source. (Whether the change is committed is graded separately.)
