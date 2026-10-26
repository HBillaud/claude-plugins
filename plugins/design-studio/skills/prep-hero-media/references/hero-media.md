# Hero media: settings and wiring

## Budgets

| Asset | Target | Why |
| --- | --- | --- |
| Poster (WebP, 1920 wide) | under 150 KB | it is the LCP element on a video hero |
| Loop, 1920 wide | under 2.5 MB for 10 to 15 s | loads after `load`, but on a phone's data plan all the same |
| Loop, 1280 wide | under 1 MB | what phones and small laptops get |
| Hero or portrait image | under 200 KB at the largest width | above the fold, so not lazy |
| Gallery or project photos | under 120 KB each at 1280 | the 27.7 MB of photos came down to 720 KB this way |

## Encoding settings, and why

| Setting | Value | Why |
| --- | --- | --- |
| Video codec | H.264 High profile, `yuv420p` | plays everywhere; Safari refuses 4:4:4 and 10-bit H.264 |
| `-movflags +faststart` | always | moves the index to the front, so playback starts before the file finishes downloading |
| `-an` | always | a muted background never plays audio; the track only costs bytes |
| CRF | 26 (H.264), 34 (VP9) | visually clean for slow, soft footage; raise by 2 for busy footage that is still too big |
| `-maxrate` / `-bufsize` | 2500k / 5000k | caps the peaks, so a busy second does not stall a slow connection |
| VP9 WebM | constrained quality (`-crf` with `-b:v` as the ceiling) | 20 to 40% smaller than H.264 in Chrome and Firefox; listed first, the MP4 is the fallback |
| Frame rate | 30 (24 for film-like footage) | 60 fps doubles the size for motion a background does not need |
| Poster | WebP quality 80, cut from the 1920 rendition | matches the loop's first frames exactly, so the fade-in does not jump |
| AV1 video | not by default | encoding is slow and older iPhones cannot decode it in hardware; add it only for a very long or very large loop |

## Plain HTML

```html
<section class="hero">
  <img class="hero-media" src="/media/hero-poster.webp" alt="" width="1920" height="1080" fetchpriority="high" decoding="async">
  <video class="hero-media hero-video" muted playsinline loop preload="none" aria-hidden="true"
         data-sources='[{"w":1280,"webm":"/media/hero-1280.webm","mp4":"/media/hero-1280.mp4"},{"w":1920,"webm":"/media/hero-1920.webm","mp4":"/media/hero-1920.mp4"}]'></video>
  <div class="hero-content">...</div>
</section>
<style>
  .hero { position: relative; min-height: 100svh; overflow: hidden; }
  .hero-media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .hero-video { opacity: 0; transition: opacity 0.8s ease; }
  .hero-video.is-playing { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .hero-video { display: none; } }
</style>
<script>
  (() => {
    const video = document.querySelector(".hero-video");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    if (!video || reduce || saveData) return; // the poster stays; the loop never downloads
    const start = () => {
      const all = JSON.parse(video.dataset.sources).sort((a, b) => a.w - b.w);
      const pick = innerWidth <= 768 ? all[0] : all[all.length - 1];
      for (const [type, src] of [["video/webm", pick.webm], ["video/mp4", pick.mp4]]) {
        if (!src) continue;
        const s = document.createElement("source");
        s.src = src;
        s.type = type;
        video.append(s);
      }
      video.muted = true; // set as a property too: some browsers ignore the attribute for autoplay
      video.addEventListener("playing", () => video.classList.add("is-playing"), { once: true });
      video.load();
      video.play().catch(() => {}); // autoplay refused (Low Power Mode): the poster stays
    };
    if (document.readyState === "complete") start();
    else addEventListener("load", () => (window.requestIdleCallback || setTimeout)(start), { once: true });
  })();
</script>
```

## React (client component)

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

type Rendition = { width: number; mp4: string; webm?: string };

export function HeroVideo({ renditions }: { renditions: Rendition[] }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = ref.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!video || reduce.matches || saveData) return;

    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      const sorted = [...renditions].sort((a, b) => a.width - b.width);
      const pick = window.innerWidth <= 768 ? sorted[0] : sorted[sorted.length - 1];
      video.innerHTML = "";
      for (const [type, src] of [["video/webm", pick.webm], ["video/mp4", pick.mp4]] as const) {
        if (!src) continue;
        const source = document.createElement("source");
        source.src = src;
        source.type = type;
        video.append(source);
      }
      video.muted = true; // React does not reliably render the muted attribute
      video.load();
      video.play().catch(() => {});
    };
    const stopOnReduce = (e: MediaQueryListEvent) => e.matches && video.pause();
    reduce.addEventListener("change", stopOnReduce);

    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
      reduce.removeEventListener("change", stopOnReduce);
    };
  }, [renditions]);

  return (
    <video
      ref={ref}
      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 motion-reduce:hidden ${playing ? "opacity-100" : "opacity-0"}`}
      muted
      playsInline
      loop
      preload="none"
      aria-hidden="true"
      onPlaying={() => setPlaying(true)}
    />
  );
}
```

## Next.js hero, poster first

```tsx
import Image from "next/image";
import { HeroVideo } from "@/components/HeroVideo";
import poster from "@/public/media/hero-poster.webp"; // or src="/media/hero-poster.webp" with width and height

export function Hero() {
  return (
    <section className="relative min-h-svh overflow-hidden">
      {/* The LCP element. `priority` (`preload` on Next.js 16+) adds the preload; fetchPriority is passed through. */}
      <Image src={poster} alt="" fill sizes="100vw" priority fetchPriority="high" className="object-cover" />
      <HeroVideo
        renditions={[
          { width: 1280, webm: "/media/hero-1280.webm", mp4: "/media/hero-1280.mp4" },
          { width: 1920, webm: "/media/hero-1920.webm", mp4: "/media/hero-1920.mp4" },
        ]}
      />
      <div className="relative z-10">{/* hero content */}</div>
    </section>
  );
}
```

If the site's `next.config` does not list `image/avif`, `next/image` serves WebP; that is fine for a poster already in WebP. For a static export (`output: "export"`) or a Vite SPA, use the plain `<img>` with `fetchpriority="high"` instead.

## Responsive images

```html
<img src="/images/portrait-1280.webp"
     srcset="/images/portrait-640.webp 640w, /images/portrait-1280.webp 1280w, /images/portrait-1920.webp 1920w"
     sizes="(min-width: 1024px) 560px, 100vw"
     width="1280" height="1798" alt="The founder at her atelier" loading="lazy" decoding="async">
```

With AVIF as well, wrap it in `<picture>` with a `<source type="image/avif" srcset="...">` before the `<img>`. `sizes` must describe the layout: `100vw` on a 560px column makes phones download the 1920 file. Above the fold, drop `loading="lazy"` and add `fetchpriority="high"` to the one image that is the LCP.

## Checks that catch the usual misses

- The poster and the first frame match (cut from the same rendition), or the fade-in jumps.
- The `<video>` has no `src` and no `<source>` in the server HTML; otherwise the browser starts downloading before `load`, whatever `preload` says.
- The hero still reads with the video off: text contrast is checked against the poster, not only against the moving footage.
- Portrait swaps keep the focal point: set `object-position` (`50% 20%` keeps a face in a tall crop) and check it at 390 and 1440.
