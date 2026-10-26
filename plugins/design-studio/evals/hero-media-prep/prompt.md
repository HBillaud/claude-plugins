---
tags: [design-studio, prep-hero-media]
max_turns: 150
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Use lumpia/incoming/raw-hero.mov as the hero background video of the site in lumpia/site, and replace the about portrait with lumpia/incoming/new-portrait.jpg. Do not delete the current picture. The site is static (`python3 -m http.server` from lumpia/site serves it). Work on a branch of lumpia/site and commit; don't push. Write a short summary with the file sizes to ./MEDIA.md.

Input files: lumpia/
