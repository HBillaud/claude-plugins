#!/usr/bin/env python3
"""Build the client site this eval hands to the agent: python3 make_site.py <new-dir>

A static site with ES modules (serve it with `python3 -m http.server`), a git repository on main.
The Pillars section the prompt names is rendered in two places, and only one is obvious:
  - /pillars/ renders src/components/pillars.js, which reads src/data/pillars.js
  - / renders "The Aurelle Standard" through src/components/standard.js, a different component
    that reads the same src/data/pillars.js: a twin found by following the data import, not the component
  - public/llms.txt repeats one pillar's copy by hand
Traps: .claude/launch.json is untracked and not ignored (it must stay out of every commit);
the hero and testimonials sections on / must not change; there is no reduced-motion handling yet.
Python 3.9+, standard library only; needs git, and ignores the user's git configuration.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

FILES = {
    "index.html": """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maison Aurelle | Wedding planning in Provence</title>
<link rel="stylesheet" href="/src/styles/tokens.css"><link rel="stylesheet" href="/src/styles/site.css"></head>
<body>
<header class="site-header"><a class="brand" href="/">Maison Aurelle</a><nav><a href="/pillars/">Our pillars</a></nav></header>
<main>
  <section class="hero" id="hero">
    <p class="eyebrow">Wedding planning in Provence</p>
    <h1>Weddings that feel like you</h1>
    <p class="lede">From the first visit to the last dance, one planner and one standard.</p>
  </section>
  <section class="standard" id="standard"></section>
  <section class="testimonials" id="testimonials">
    <h2>Client endorsements</h2>
    <blockquote>"Every detail was considered before we thought to ask." <cite>Claire and Tom, 2026</cite></blockquote>
  </section>
</main>
<script type="module" src="/src/pages/home.js"></script>
</body>
</html>
""",
    "pillars/index.html": """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Our pillars | Maison Aurelle</title>
<link rel="stylesheet" href="/src/styles/tokens.css"><link rel="stylesheet" href="/src/styles/site.css"></head>
<body>
<header class="site-header"><a class="brand" href="/">Maison Aurelle</a><nav><a href="/pillars/">Our pillars</a></nav></header>
<main>
  <section class="page-intro"><p class="eyebrow">How we work</p><h1>Our pillars</h1></section>
  <section class="pillars" id="pillars"></section>
</main>
<script type="module" src="/src/pages/pillars.js"></script>
</body>
</html>
""",
    "src/data/pillars.js": """// The four pillars, as the client wrote them. Copy is the client's: do not reword it.
export const pillars = [
  { id: "listen", title: "We listen first", body: "Before a single venue is booked, we spend an afternoon learning how you two actually like to celebrate." },
  { id: "curate", title: "We curate, not collect", body: "Three suppliers we trust for every role, never a catalogue of fifty you have to sort through yourselves." },
  { id: "protect", title: "We protect the day", body: "A written plan for rain, delays and late guests, so nothing on the day lands on your shoulders." },
  { id: "remember", title: "We remember the details", body: "Your grandmother's favourite song, the cousin who cannot sit near the speakers: written down and handled." },
];

export const pillarsIntro = "Four promises we make to every couple, whatever the size of the wedding.";
""",
    "src/components/pillars.js": """import { pillars, pillarsIntro } from "../data/pillars.js";

// Full Pillars section on /pillars/: one card per pillar.
export function renderPillars(el) {
  el.innerHTML = `
    <p class="section-intro">${pillarsIntro}</p>
    <div class="pillar-grid">
      ${pillars.map((p, i) => `
        <article class="pillar-card">
          <span class="pillar-number">0${i + 1}</span>
          <h2>${p.title}</h2>
          <p>${p.body}</p>
        </article>`).join("")}
    </div>`;
}
""",
    "src/components/standard.js": """import { pillars } from "../data/pillars.js";

// "The Aurelle Standard" on the home page: the pillar titles as a compact list.
export function renderStandard(el) {
  el.innerHTML = `
    <h2>The Aurelle Standard</h2>
    <ol class="standard-list">
      ${pillars.map((p) => `<li><strong>${p.title}</strong></li>`).join("")}
    </ol>
    <a class="text-link" href="/pillars/">How we work</a>`;
}
""",
    "src/pages/home.js": """import { renderStandard } from "../components/standard.js";

renderStandard(document.getElementById("standard"));
""",
    "src/pages/pillars.js": """import { renderPillars } from "../components/pillars.js";

renderPillars(document.getElementById("pillars"));
""",
    "src/styles/tokens.css": """:root{
  --ivory:#faf6f0;--ink:#2b2522;--rose:#b4786c;--sage:#8a9a85;--line:#e4dccf;
  --serif:'Cormorant Garamond',Georgia,serif;--sans:'Jost',Helvetica,Arial,sans-serif;
  --space-1:8px;--space-2:16px;--space-3:24px;--space-4:40px;--space-5:64px;--space-6:96px;
  --ease-out:cubic-bezier(.22,1,.36,1);
}
""",
    "src/styles/site.css": """*{box-sizing:border-box}
body{margin:0;background:var(--ivory);color:var(--ink);font-family:var(--sans);font-size:17px;line-height:1.6}
.site-header{display:flex;justify-content:space-between;align-items:center;padding:var(--space-3) var(--space-4)}
.site-header a{color:inherit;text-decoration:none;padding:12px 0;display:inline-block}
.brand{font-family:var(--serif);font-size:24px}
h1,h2{font-family:var(--serif);font-weight:500}
.eyebrow{text-transform:uppercase;letter-spacing:.18em;font-size:12px;color:var(--rose)}
.hero{padding:var(--space-6) var(--space-4);max-width:1100px;margin:0 auto}
.hero h1{font-size:64px;line-height:1.05;margin:0 0 var(--space-3)}
.page-intro{padding:var(--space-5) var(--space-4) 0;max-width:1100px;margin:0 auto}
.page-intro h1{font-size:52px;margin:0}
.standard,.pillars,.testimonials{padding:var(--space-5) var(--space-4);max-width:1100px;margin:0 auto}
.standard h2,.testimonials h2{font-size:40px;margin:0 0 var(--space-3)}
.standard-list{columns:2;padding-left:1.2em}
.pillar-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-3)}
.pillar-card{border-top:1px solid var(--line);padding-top:var(--space-3)}
.pillar-number{font-family:var(--serif);color:var(--rose);font-size:20px}
.pillar-card h2{font-size:28px;margin:var(--space-1) 0}
.text-link{color:var(--rose)}
""",
    "public/llms.txt": """# Maison Aurelle

> Wedding planning in Provence.

## How we work

- We listen first: Before a single venue is booked, we spend an afternoon learning how you two actually like to celebrate.
- See /pillars/ for all four pillars.
""",
    "docs/BRAND_IDENTITY_GUIDE_AURELLE.md": """# Maison Aurelle brand guide

- Palette: ivory #faf6f0 ground, ink #2b2522 text, dusty rose #b4786c accent, sage #8a9a85 secondary.
- Type: Cormorant Garamond for headings, Jost for text. Headings sentence case, eyebrows uppercase and tracked.
- Motion: slow and soft. Nothing bounces; nothing loops. Eases out, 600 to 900 ms.
- Imagery: film grain, natural light, never staged.
""",
    ".gitignore": "node_modules/\n.DS_Store\n",
}


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.splitlines()[0], file=sys.stderr)
        return 2
    root = Path(sys.argv[1])
    root.mkdir(parents=True, exist_ok=False)
    for name, text in FILES.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
    git = lambda *a: subprocess.run(["git", *a], cwd=root, env=env, check=True, capture_output=True)
    git("init", "-q", "-b", "main")
    git("add", "-A")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-q", "-m", "Maison Aurelle site")
    # Local preview config the desktop app writes: untracked, not ignored, never to be committed.
    (root / ".claude").mkdir()
    (root / ".claude" / "launch.json").write_text('{"configurations":[{"name":"site","runtimeExecutable":"python3","runtimeArgs":["-m","http.server","4321"]}]}\n', encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
