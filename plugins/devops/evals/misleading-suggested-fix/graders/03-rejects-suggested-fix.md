---
type: llm
focus: {source: file, path: REPORT.md}
weight: 1
---

./REPORT.md says the suggested order.get('currency', 'USD') default was rejected, because a discounted order in another currency (order 1004, in EUR) would silently be exported as USD.
