---
tags: [agent-config]
max_turns: 250
timeout_seconds: 3600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Our repo in ./orbit grew its agent config for Claude Code only, and half the team now uses Codex, which sees none of our skills and only part of our instructions. Refactor the repo's agent config so Claude Code and Codex get the same instructions and the same skills. Nobody uses Cursor or Gemini any more. Work on a branch in that repo and commit phase by phase; don't push anywhere. When you're done, write the pull request description to ./PR.md.

Input files: orbit/
