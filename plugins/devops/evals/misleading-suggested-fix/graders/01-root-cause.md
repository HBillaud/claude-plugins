---
type: llm
focus: {source: file, path: REPORT.md}
weight: 1
---

./REPORT.md names the early return in the discount branch of normalize() in orders/importer.py as the root cause: discounted orders return before their currency is copied. It treats the export's lookup as where the failure surfaced, not as the cause.
