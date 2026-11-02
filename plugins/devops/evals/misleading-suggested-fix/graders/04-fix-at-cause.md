---
type: llm
focus: trace
weight: 1
---

The final code change makes normalize() in orders/importer.py keep the currency of discounted orders, and the agent did not add a default currency to orders/export.py.
