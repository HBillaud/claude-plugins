#!/usr/bin/env python3
"""Build the static site this eval hands to the agent: python3 make_site.py <new-dir>

Three pages, /, /guide/ and /why-florida/, share styles.css, but each inner page carries its own
hero rules that drifted from the home page:
  role            home (the reference)          /guide/                    /why-florida/
  hero h1         56px/1.1, 500                 48px/1.15, 500             52px/1.1, 600
  eyebrow         12px, 0.2em tracking          12px, 0.14em tracking      13px, 0.2em tracking
  hero body       18px/1.6                      17px/1.7                   18px/1.6
  section title   36px (shared)                 36px (shared)              32px (page rule)
The right fix aligns both inner pages to the home page (not to an average, not the other way round)
through shared classes or tokens in styles.css, and deletes the per-page overrides. guide.css and
why.css also hold one layout rule each (.stat), which is not type and stays.
The site is a git repository on main, so the fix can go on a branch. Python 3.9+, standard library only; needs git.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

SHARED = """:root{--ink:#14202b;--sand:#f5efe4;--serif:Georgia,'Times New Roman',serif;--sans:Helvetica,Arial,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--sand);color:var(--ink);font-family:var(--sans)}
.hero{padding:96px 24px 64px;max-width:1100px;margin:0 auto}
.section{padding:64px 24px;max-width:1100px;margin:0 auto}
.section h2{font-family:var(--serif);font-size:36px;line-height:1.2;font-weight:500;margin:0 0 16px}
.section p{font-size:17px;line-height:1.65;max-width:62ch}
.stat-value{font-family:var(--serif);font-size:48px;line-height:1}
/* home hero */
.home .hero .eyebrow{font-size:12px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 20px}
.home .hero h1{font-family:var(--serif);font-size:56px;line-height:1.1;font-weight:500;margin:0 0 24px}
.home .hero p.intro{font-size:18px;line-height:1.6;max-width:56ch}
@media (max-width:640px){
  .home .hero h1{font-size:38px}
  .section h2{font-size:28px}
}
"""

GUIDE_CSS = """/* guide hero, written when the guide shipped */
.guide .hero .eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 20px}
.guide .hero h1{font-family:var(--serif);font-size:48px;line-height:1.15;font-weight:500;margin:0 0 24px}
.guide .hero p.intro{font-size:17px;line-height:1.7;max-width:56ch}
@media (max-width:640px){.guide .hero h1{font-size:34px}}
/* not type: the guide's figure sits in a ruled box */
.guide .stat{border-left:2px solid var(--ink);padding-left:16px}
"""

WHY_CSS = """/* why-florida hero */
.why .hero .eyebrow{font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 20px}
.why .hero h1{font-family:var(--serif);font-size:52px;line-height:1.1;font-weight:600;margin:0 0 24px}
.why .hero p.intro{font-size:18px;line-height:1.6;max-width:56ch}
.why .section h2{font-size:32px}
@media (max-width:640px){.why .hero h1{font-size:36px}}
/* not type: the figure is centred on this page */
.why .stat{text-align:center}
"""


def page(cls: str, css: str, eyebrow: str, title: str, intro: str, h2: str, body: str, stat: str) -> str:
    extra = f'<link rel="stylesheet" href="{css}">' if css else ""
    return f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} | Coastline Capital</title><link rel="stylesheet" href="/styles.css">{extra}</head>
<body class="{cls}">
<main>
  <section class="hero">
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <p class="intro">{intro}</p>
  </section>
  <section class="section">
    <h2>{h2}</h2>
    <p>{body}</p>
    <div class="stat"><span class="stat-value">{stat}</span></div>
  </section>
</main>
</body>
</html>
"""


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.splitlines()[0], file=sys.stderr)
        return 2
    root = Path(sys.argv[1])
    root.mkdir(parents=True, exist_ok=False)
    (root / "styles.css").write_text(SHARED, encoding="utf-8")
    (root / "guide").mkdir()
    (root / "why-florida").mkdir()
    (root / "guide" / "guide.css").write_text(GUIDE_CSS, encoding="utf-8")
    (root / "why-florida" / "why.css").write_text(WHY_CSS, encoding="utf-8")
    (root / "index.html").write_text(page("home", "", "Real estate investment", "Patient capital for Florida property",
        "We buy, renovate and hold residential property in South Florida for investors who think in decades rather than quarters.",
        "Our approach", "Every acquisition is underwritten against a ten-year hold, with renovation budgets fixed before closing and reported quarterly.", "$42M"), encoding="utf-8")
    (root / "guide" / "index.html").write_text(page("guide", "/guide/guide.css", "Investor guide", "The investor's guide to Florida",
        "What to know before you commit capital: taxes, insurance, hurricane codes and how a hold structure protects you.",
        "Before you invest", "Florida has no state income tax, but property insurance and windstorm codes change the arithmetic of every deal we review.", "12%"), encoding="utf-8")
    (root / "why-florida" / "index.html").write_text(page("why", "/why-florida/why.css", "Market", "Why Florida, why now",
        "Population growth, migration from high-tax states and a constrained housing supply keep demand ahead of new construction.",
        "The numbers", "More than a thousand people move to Florida each day, and permits for new homes have not kept pace for a decade.", "1,000+"), encoding="utf-8")
    env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
    git = lambda *a: subprocess.run(["git", *a], cwd=root, env=env, check=True, capture_output=True)
    git("init", "-q", "-b", "main")
    git("add", "-A")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-q", "-m", "Coastline Capital site")
    return 0


if __name__ == "__main__":
    sys.exit(main())
