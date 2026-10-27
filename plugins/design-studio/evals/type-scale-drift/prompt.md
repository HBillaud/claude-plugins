---
tags: [design-studio, audit-type-scale]
max_turns: 150
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

The font sizes on the hero sections of ./coastline still don't look aligned across the home page, the guide and Why Florida. I want all hero sections to align on the main page, not the other way around, nor an in-between. Deep dive into the titles, labels and body text, fix it on a branch (commit, don't push), and write what you measured before and after to ./TYPE.md. Serve it with `python3 -m http.server` from that folder.

Input files: coastline/
