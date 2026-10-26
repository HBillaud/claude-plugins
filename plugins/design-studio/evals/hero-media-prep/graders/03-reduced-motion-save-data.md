---
type: llm
focus: trace
weight: 1
---

The hero's script never loads or plays the video when `prefers-reduced-motion: reduce` matches or when `navigator.connection.saveData` is true; in both cases the poster stays visible. The video is muted, plays inline, and is hidden from assistive technology (`aria-hidden="true"`) or otherwise marked decorative.
