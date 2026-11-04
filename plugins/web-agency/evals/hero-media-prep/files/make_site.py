#!/usr/bin/env python3
"""Build the site and the incoming media this eval hands to the agent: python3 make_site.py <new-dir>

  <new-dir>/site/                 a static site (git repository on main) whose hero plays
                                  media/old-hero.mp4 straight from a <video src autoplay> tag,
                                  and whose about section shows images/portrait.jpg
  <new-dir>/incoming/raw-hero.mov 2560x1440, 8 s, 30 fps, near-lossless H.264 with a stereo AAC track
  <new-dir>/incoming/new-portrait.jpg  700x980: under twice the 560px it renders at, so it must be flagged
The prompt asks to keep the current portrait. Python 3.9+; needs git and ffmpeg.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

INDEX = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumpia House | Filipino kitchen</title><link rel="stylesheet" href="/styles.css"></head>
<body>
<section class="hero">
  <video class="hero-video" src="/media/old-hero.mp4" autoplay muted loop playsinline></video>
  <div class="hero-content"><h1>Lumpia House</h1><p>Filipino home cooking, six days a week.</p></div>
</section>
<section class="about">
  <img class="portrait" src="/images/portrait.jpg" alt="Chef Marisol in the kitchen">
  <p>Marisol opened Lumpia House in 2019 with her mother's recipes and a six-seat counter.</p>
</section>
</body>
</html>
"""

STYLES = """*{box-sizing:border-box}
body{margin:0;font-family:Helvetica,Arial,sans-serif;background:#fffaf2;color:#2a1d14}
.hero{position:relative;min-height:100svh;display:grid;place-items:center;overflow:hidden;color:#fff}
.hero-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-content{position:relative;text-align:center}
.hero h1{font-size:64px;margin:0}
.about{max-width:600px;margin:0 auto;padding:64px 20px}
.portrait{display:block;width:100%;max-width:560px;height:auto}
"""


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.splitlines()[0], file=sys.stderr)
        return 2
    if not shutil.which("ffmpeg"):
        print("make_site.py: ffmpeg is required", file=sys.stderr)
        return 1
    root = Path(sys.argv[1])
    site = root / "site"
    incoming = root / "incoming"
    for d in (site / "media", site / "images", incoming):
        d.mkdir(parents=True, exist_ok=True)
    (site / "index.html").write_text(INDEX, encoding="utf-8")
    (site / "styles.css").write_text(STYLES, encoding="utf-8")
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-t", "4", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", str(site / "media" / "old-hero.mp4"))
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=600x840", "-frames:v", "1", "-q:v", "3", str(site / "images" / "portrait.jpg"))
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=2560x1440:rate=30", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000",
           "-t", "8", "-ac", "2", "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p", "-c:a", "aac", str(incoming / "raw-hero.mov"))
    ffmpeg("-f", "lavfi", "-i", "mandelbrot=size=700x980", "-frames:v", "1", "-q:v", "2", str(incoming / "new-portrait.jpg"))
    env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
    git = lambda *a: subprocess.run(["git", *a], cwd=site, env=env, check=True, capture_output=True)
    git("init", "-q", "-b", "main")
    git("add", "-A")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-q", "-m", "Lumpia House site")
    return 0


if __name__ == "__main__":
    sys.exit(main())
