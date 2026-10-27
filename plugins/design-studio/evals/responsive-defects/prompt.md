---
tags: [design-studio, check-responsive]
max_turns: 120
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Check mobile on the home page of the site in ./harbor (it's static: `python3 -m http.server` from that folder serves it). I keep finding regressions between desktop and mobile by eye. Don't fix anything yet; write what you find to ./RESPONSIVE.md.

Input files: harbor/
