---
type: regex
target: {source: file, path: lumpia/site/images/portrait.jpg}
pattern: "[\\s\\S]"
weight: 1
---

The current portrait is kept, as the prompt asks: images/portrait.jpg still exists and is not empty. (A file_exists grader would not do: it checks the files the run created or changed, and a kept file is neither.)
