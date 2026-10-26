---
type: llm
focus: trace
weight: 1
---

The about section now shows the new portrait as WebP (with AVIF too if the agent's ffmpeg could make it) through `srcset` and a `sizes` attribute matching its 560px slot, with `width` and `height` attributes; lumpia/site/images/portrait.jpg still exists; and MEDIA.md warns that the new portrait (700px wide) is under twice the width it renders at, suggesting a larger original.
