#!/usr/bin/env python3
"""Build the static site this eval hands to the agent: python3 make_site.py <new-dir>

One page, /index.html, seeded with defects the probes must report, and look-alikes they must not:
  defects                                              look-alikes (no finding expected)
  - .hero h1 is nowrap and overflows at 375px          - .logos is a horizontal scroller (overflow-x: auto)
  - .plan p has a fixed height and overflow: hidden    - .teaser p is clamped with -webkit-line-clamp (intended)
  - .quotes is a reveal no observer ever fires         - .reveal.features fires on scroll as it should
  - .menu-toggle is a 28x28 tap target                 - the "terms" link sits inline in running text
  - img.portrait is 240x320, drawn at up to 560px wide
  - .marquee animates forever, even with reduced motion
Python 3.9+, standard library only.
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path


def png(width: int, height: int) -> bytes:
    """A plain gradient PNG, so the image has real pixels to upscale."""
    rows = b"".join(
        b"\x00" + b"".join(bytes((x * 255 // width, y * 255 // height, 160)) for x in range(width))
        for y in range(height)
    )

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


INDEX = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harbor Studio</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="nav">
  <a class="brand" href="/">Harbor Studio</a>
  <button class="menu-toggle" aria-label="Open menu">&#9776;</button>
</header>
<main>
  <section class="hero">
    <p class="eyebrow">Architecture and interiors</p>
    <h1>Spaces that outlast their brief</h1>
    <p class="lede">We design homes and studios along the coast, from the first sketch to the last fitting.</p>
  </section>
  <section class="logos" aria-label="Clients">
    <div class="logo">Northwind</div><div class="logo">Bluewater</div><div class="logo">Saltmarsh</div>
    <div class="logo">Kestrel</div><div class="logo">Ferrybank</div><div class="logo">Lighthouse</div>
  </section>
  <section class="reveal features">
    <h2>What we do</h2>
    <div class="feature">Residential design</div>
    <div class="feature">Studio fit-outs</div>
    <div class="feature">Planning and permits</div>
  </section>
  <section class="plans">
    <article class="plan">
      <h3>Consultation</h3>
      <p>A two-hour site visit, a written assessment of what the building allows, and a fee proposal for the full design, with planning risks named up front.</p>
    </article>
    <article class="teaser">
      <h3>From the journal</h3>
      <p>How we restored a 1920s boathouse without losing the salt-stained timber that made it worth saving, and what it cost to keep it.</p>
    </article>
  </section>
  <section class="about">
    <img class="portrait" src="portrait.png" alt="The studio's founder at her desk">
    <p>Founded in 2011. Read our <a href="/terms">terms</a> before booking a visit.</p>
  </section>
  <section class="reveal quotes">
    <h2>What clients say</h2>
    <blockquote>They listened before they drew a single line.</blockquote>
  </section>
  <div class="marquee" aria-hidden="false"><span>Now booking spring 2027 site visits</span></div>
</main>
<script src="reveal.js"></script>
</body>
</html>
"""

STYLES = """*{box-sizing:border-box}
body{margin:0;font-family:Georgia,serif;color:#1d2a33;background:#f7f4ee}
.nav{display:flex;justify-content:space-between;align-items:center;padding:16px 20px}
.brand{font-size:18px;color:inherit;text-decoration:none;display:inline-block;padding:12px 0}
.menu-toggle{width:28px;height:28px;border:0;background:#1d2a33;color:#fff;font-size:14px}
.hero{padding:48px 20px}
.hero .eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:13px}
.hero h1{font-size:44px;white-space:nowrap;margin:0}
.logos{display:flex;gap:24px;overflow-x:auto;padding:20px}
.logo{flex:0 0 140px;padding:12px;background:#e6e0d4;text-align:center}
.reveal{opacity:0;transform:translateY(24px);transition:opacity .5s ease,transform .5s ease}
.reveal.is-visible{opacity:1;transform:none}
.features{padding:32px 20px}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;padding:32px 20px}
.plan p{height:3em;overflow:hidden;margin:0}
.teaser p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0}
.about{padding:32px 20px;max-width:600px}
.portrait{display:block;width:100%;height:auto}
.quotes{padding:32px 20px}
.marquee{overflow:hidden;white-space:nowrap;padding:12px 0;background:#1d2a33;color:#fff}
.marquee span{display:inline-block;animation:slide 12s linear infinite}
@keyframes slide{from{transform:translateX(0)}to{transform:translateX(-50%)}}
"""

REVEAL = """// Reveal sections on scroll. Only sections marked data-animate are observed.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
}, { threshold: 0.2 });
document.querySelectorAll(".reveal[data-animate]").forEach((el) => io.observe(el));
document.querySelector(".features").setAttribute("data-animate", "");
io.observe(document.querySelector(".features"));
"""


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.splitlines()[0], file=sys.stderr)
        return 2
    root = Path(sys.argv[1])
    root.mkdir(parents=True, exist_ok=False)
    (root / "index.html").write_text(INDEX, encoding="utf-8")
    (root / "styles.css").write_text(STYLES, encoding="utf-8")
    (root / "reveal.js").write_text(REVEAL, encoding="utf-8")
    (root / "portrait.png").write_bytes(png(240, 320))
    return 0


if __name__ == "__main__":
    sys.exit(main())
