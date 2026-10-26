---
name: prep-hero-media
description: Prepare a hero video or image for the web and wire it in without hurting Core Web Vitals. Video is transcoded with ffmpeg to H.264 MP4 and VP9 WebM at one or two widths, without audio and with a capped bitrate, with a WebP poster cut from a chosen frame; it is wired poster-first (the poster is the LCP element, fetchpriority high), the loop loads after the page's load event, and it is skipped under prefers-reduced-motion or Save-Data. Images are checked for natural size against the largest rendered size (warns under 2x), converted to WebP and AVIF at the widths the layout needs, and the previous asset is kept when asked. Can also write a text-to-video prompt from a reference clip. Use when the user says "use this video as the hero background", "replace the hero image with", "the hero video is too heavy", "swap the portrait", or "/design-studio:prep-hero-media <file>".
argument-hint: "<file>"
---

# Prep hero media

Hero media was the largest performance finding on every client site: a 19 MB loop, a 2.9 MB poster, 27.7 MB of project photos. The fix is always the same, and so are the details that get missed: a poster that is not the LCP element, a loop that competes with the page for bandwidth, audio tracks nobody hears, a portrait too small for a retina screen.

`<skill-dir>` below is the directory this SKILL.md is in. Recipes and the wiring snippets: [references/hero-media.md](references/hero-media.md).

## 1. Inspect the source and the slot

1. **The file.** From `$ARGUMENTS` or the conversation; files dropped into `~/Downloads` usually carry the camera or generator name. Run `bash <skill-dir>/scripts/transcode.sh probe <file>`: dimensions, duration, codecs, whether there is audio, size.
2. **The slot it goes into.** Find the hero component and the asset it uses now (`grep -rn "\.mp4\|\.webm\|poster=\|hero" src app components --include=*.tsx`), then measure the largest size it renders at: in the browser at 1440 and 390 wide (check-responsive's image probe gives `natural` vs `rendered`), or from the CSS (`100vw` by `100svh` for a full-bleed hero; a portrait column's max width). Multiply by 2 for retina: that is the width the source must reach.
3. **Say what you found before converting**: "The clip is 3840x2160, 24 s, 186 MB with a stereo track; the hero renders at most 1440x900, so 1920 and 1280 renditions cover it." If the source is under 2x the rendered size, say so now and ask whether a larger original exists ("the portrait is 578x812; it renders at 560 wide, so it will look soft on retina: is there a larger export?").

## 2. Transcode

**Video**:

```bash
bash <skill-dir>/scripts/transcode.sh video <file> public/media --name hero --widths 1920,1280 \
  --poster-at 2.5 [--start 4 --duration 12] [--crf 26 --maxrate 2500k]
```

- **Widths**: 1920 and 1280 for a full-bleed hero; one width (1280) for a contained one. The script never upscales.
- **Length**: background loops read best at 8 to 15 s. Trim with `--start` and `--duration` to a stretch that loops without a visible jump, and check the cut by watching the first and last second.
- **Poster frame**: pick a calm, representative frame (`--poster-at` in seconds); it is what most visitors see first and what reduced-motion visitors see only. Look at it before wiring it in.
- **Budget**: aim for under 2.5 MB per rendition at 1920, under 1 MB at 1280, and under 150 KB for the poster; the script flags what is over. `--maxrate` is the ceiling at 1920 and scales down with each smaller width. A busy clip (a city skyline, water) sits at that ceiling, where raising `--crf` changes little: lower `--maxrate` instead (2000k took Miami Square Capital's 18.5 MB loop to 2.0 MB and 932 KB). For a quiet clip, raise `--crf` by 2 at a time. A poster over budget wants a calmer frame or a lower `--quality`. If a WebM comes out larger than its MP4, ship the MP4 alone at that width.
- Audio is always stripped: a muted autoplay background never plays it, and it costs bytes.

**Image**:

```bash
bash <skill-dir>/scripts/transcode.sh image <file> public/images --name portrait --widths 640,1280,1920
```

It writes WebP and AVIF (when the local ffmpeg can) per width, skips widths above the source, and warns when the source is under twice the largest width.

The source file is never modified. **Keep the previous asset** when the user says so ("do not delete the current picture"), and by default too: rename nothing, delete nothing, and list the now-unused files for the user to remove.

## 3. Wire it in

Use the snippets in [references/hero-media.md](references/hero-media.md) (plain HTML, React, Next.js), adapted to the component that renders the hero now. The rules they encode:

1. **Poster first.** The poster is an `<img>` (or `next/image` with `priority`) with `fetchpriority="high"`, sized to the slot: it is the LCP element. Preload it only if it is not discoverable in the HTML.
2. **The loop loads after `load`.** No `src` on the `<video>` in the HTML; a script adds the sources after `window.load` (or `requestIdleCallback`), then plays it, and fades it in over the poster on `playing`. `preload="none"`, `muted`, `playsinline`, `loop`, `autoplay` set in script, and `aria-hidden="true"` for a decorative loop.
3. **Skip it when the visitor asked for less.** `matchMedia("(prefers-reduced-motion: reduce)")` or `navigator.connection.saveData`: keep the poster, never load the video. Reduced-motion visitors get a still, not a paused first frame.
4. **Small screens get the small rendition**, chosen in the script by `innerWidth` (the `<source media>` attribute is not reliable for video).
5. **Responsive images** get `srcset` with the generated widths and a `sizes` that matches the layout (`(min-width: 1024px) 560px, 100vw`), `width` and `height` attributes to prevent layout shift, and `loading="lazy"` unless the image is above the fold.

## 4. Verify

- Sizes: the before/after table the script prints, and the bytes the page now loads before `load` (DevTools Network, or `performance.getEntriesByType("resource")` in the pane).
- The poster is the LCP element: `new PerformanceObserver(l => console.log(l.getEntries().at(-1).element)).observe({type: "largest-contentful-paint", buffered: true})`.
- The loop starts after `load`, and does not start with reduced motion on (check-responsive's runner with `--reduced on` reports a playing video as a motion failure).
- Images: check-responsive's image probe at 390 and 1440 shows no `fail` and no `soft-here` on the hero.

Report the table, the wiring change by `file:line`, and what is left for the user (a larger original, a frame choice to confirm).

## Optional: a prompt for a video generator

When the user wants a new loop generated from a reference clip (they used Omni 1.1 Flash before), watch the reference (extract frames: `ffmpeg -i ref.mp4 -vf fps=1 <scratchpad>/frame-%02d.png` and look at them), then write one prompt with: the subject and setting in concrete nouns, light and time of day, palette from the brand guide, and the camera. Default for backgrounds: **static or a very slow push-in or pan, no cuts, no people facing the camera, no text, nothing that moves fast**, 8 to 10 s, and an end that matches the start so it loops. Give the aspect ratio of the slot (16:9 for a full-bleed hero, 4:5 or 9:16 for mobile crops). Then run the generated clip through step 2 like any other source.

## Files

| File | Use it when |
| --- | --- |
| `scripts/transcode.sh` | `probe`, `video` and `image` modes; bash 3.2 compatible, needs ffmpeg, and `cwebp` when ffmpeg has no libwebp (`brew install ffmpeg webp`) |
| [references/hero-media.md](references/hero-media.md) | wiring snippets for HTML, React and Next.js, encoding settings and why, budgets |
