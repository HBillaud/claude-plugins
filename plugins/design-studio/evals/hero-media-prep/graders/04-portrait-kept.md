---
type: llm
focus: {source: file, path: lumpia/site/images/portrait.jpg}
weight: 1
---

The current portrait is kept, as the prompt asks: lumpia/site/images/portrait.jpg is still there and still shows the original picture (a colourful test pattern), not the new portrait or a blank image. A missing file fails this grader. (file_exists would not do: it checks the files the run created or changed, and a kept file is neither; a regex grader cannot read an image.)
