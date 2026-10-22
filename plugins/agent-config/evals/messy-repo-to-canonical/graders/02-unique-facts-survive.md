---
type: llm
focus: trace
weight: 1
---

./orbit/AGENTS.md says that generated files under `dist/` are never committed and that database migrations in `db/migrations/` are append-only, and the web client's AGENTS.md still says its API base URL comes from `VITE_API_URL`.
