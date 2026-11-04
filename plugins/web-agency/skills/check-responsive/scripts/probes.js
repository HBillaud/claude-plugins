// Responsive and motion probes for one page at the current viewport.
//
// Paste the whole file into the browser pane's JavaScript tool, or let
// run-matrix.mjs inject it. It evaluates to a promise of a JSON string.
// Options go on globalThis.__DS_PROBE_OPTS before it runs:
//   scope        CSS selector; only elements inside it are reported (default: whole page)
//   settleMs     wait after the scroll-through, for reveal transitions to finish (default 900)
//   stepMs       wait per scroll step, for IntersectionObserver callbacks (default 140)
//   revealMs     longest wait for an element still transparent once scrolled into view (default 2500:
//                staggered reveals with a delay of a second or more are common)
//   minTarget    smallest tap target in CSS px, applied at widths up to 1024 (default 44)
//   limit        maximum findings reported per probe (default 25)
// It scrolls the page top to bottom and back (and to each element still transparent after that),
// so run it after the page has loaded.
(async (opts = globalThis.__DS_PROBE_OPTS || {}) => {
  const settleMs = opts.settleMs ?? 900;
  const stepMs = opts.stepMs ?? 140;
  const revealMs = opts.revealMs ?? 2500;
  const minTarget = opts.minTarget ?? 44;
  const limit = opts.limit ?? 25;
  const scope = opts.scope ? document.querySelector(opts.scope) : document.body;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Instant, whatever the page says: with scroll-behavior: smooth, each scrollTo starts an animation
  // the next one interrupts, and the page never reaches the sections a reveal is waiting for.
  const jump = (y) => scrollTo({ top: y, behavior: "instant" });
  const vw = document.documentElement.clientWidth;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;

  if (!scope) {
    return JSON.stringify({ error: `scope selector matched nothing: ${opts.scope}` });
  }
  // A page that renders no frames (a hidden browser pane, a background tab) never fires the
  // requestAnimationFrame and IntersectionObserver callbacks reveals wait for: every reveal would be
  // reported as stuck, so the hidden probe is skipped and the result says why.
  const rendering = await new Promise((r) => {
    requestAnimationFrame(() => r(true));
    setTimeout(() => r(false), 1000);
  });

  // A selector that querySelector() resolves back to this element.
  const cssPath = (el) => {
    if (!(el instanceof Element)) return "";
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      let part = node.localName;
      const cls = [...node.classList].filter((c) => /^[A-Za-z_-][\w-]*$/.test(c)).slice(0, 2);
      if (cls.length) part += cls.map((c) => `.${c}`).join("");
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.localName === node.localName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  };
  const text = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  const snippet = (el) => text(el).slice(0, 60);
  const inScope = (el) => scope.contains(el);
  const box = (r) => ({ x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) });

  // Rendered and not deliberately hidden (sr-only, closed dialogs, aria-hidden).
  const rendered = (el) => {
    if (el.closest("[aria-hidden='true'], [hidden], dialog:not([open]), template, noscript")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    return true;
  };

  // Out of reach for a visitor right now: transparent, or not taking pointer events (a closed menu).
  const untouchable = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (parseFloat(cs.opacity) <= 0.05 || cs.pointerEvents === "none") return true;
    }
    return false;
  };

  // Scroll through so lazy images load and scroll-triggered reveals fire, then come back.
  const startY = scrollY;
  const maxY = () => document.documentElement.scrollHeight - innerHeight;
  for (let y = 0; y <= maxY(); y += Math.max(200, Math.round(innerHeight * 0.6))) {
    jump(y);
    await sleep(stepMs);
  }
  jump(maxY());
  await sleep(stepMs);
  jump(startY);
  await sleep(settleMs);

  const all = [...scope.querySelectorAll("*")];

  // 1. Horizontal overflow: the document, and the outermost element pushing past the viewport.
  const doc = { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw };
  const scrollsX = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox !== "visible") return true;
    }
    return false;
  };
  const overflow = [];
  for (const el of all) {
    if (overflow.length >= limit) break;
    if (!rendered(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 1 && r.left >= -1) continue;
    if (scrollsX(el)) continue; // inside a carousel or a clipped container: contained
    const p = el.parentElement && el.parentElement.getBoundingClientRect();
    if (p && p.right > vw + 1 && el.parentElement !== document.body && inScope(el.parentElement)) continue;
    overflow.push({ selector: cssPath(el), cause: "box", right: Math.round(r.right), left: Math.round(r.left), viewport: vw, text: snippet(el), box: box(r) });
  }
  // Text spilling out of a box that fits (nowrap, a long word, a fixed width): the box is fine, its content is not.
  for (const el of all) {
    if (overflow.length >= limit) break;
    if (el.scrollWidth <= el.clientWidth + 1 || getComputedStyle(el).overflowX !== "visible") continue;
    if (![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
    if (!rendered(el) || scrollsX(el)) continue;
    const r = el.getBoundingClientRect();
    const right = r.left + el.scrollWidth;
    if (right <= vw + 1) continue;
    overflow.push({ selector: cssPath(el), cause: "text", right: Math.round(right), left: Math.round(r.left), viewport: vw, text: snippet(el), box: box(r) });
  }

  // 2. Clipped text: overflow hidden or clip, with content taller or wider than the box.
  const clipped = [];
  for (const el of all) {
    if (clipped.length >= limit) break;
    const cs = getComputedStyle(el);
    const hidesX = cs.overflowX === "hidden" || cs.overflowX === "clip";
    const hidesY = cs.overflowY === "hidden" || cs.overflowY === "clip";
    if (!hidesX && !hidesY) continue;
    if (!rendered(el) || !text(el)) continue;
    const overX = hidesX && el.scrollWidth > el.clientWidth + 1;
    const overY = hidesY && el.scrollHeight > el.clientHeight + 1;
    if (!overX && !overY) continue;
    // Clipped decoration (an image or a pseudo-element bleeding out) is not clipped text.
    const textNodes = [...el.querySelectorAll("*"), el].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
    const er = el.getBoundingClientRect();
    const cut = textNodes.some((n) => {
      if (n === el) return true;
      const r = n.getBoundingClientRect();
      return (overY && r.bottom > er.bottom + 1) || (overX && r.right > er.right + 1);
    });
    if (!cut) continue;
    // A marquee (a track looping inside a clipped strip) is clipped on purpose.
    const marquee = overX && !overY && el.getAnimations && el.getAnimations({ subtree: true }).some((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity);
    const intended = cs.textOverflow === "ellipsis" || (cs.webkitLineClamp && cs.webkitLineClamp !== "none") || marquee;
    clipped.push({
      selector: cssPath(el),
      axis: overX && overY ? "both" : overX ? "x" : "y",
      scroll: `${el.scrollWidth}x${el.scrollHeight}`,
      client: `${el.clientWidth}x${el.clientHeight}`,
      intended: Boolean(intended),
      text: snippet(el),
    });
  }

  // 3. Content still invisible after the scroll-through: a reveal that never fired. A fast scroll can
  //    pass a reveal before its observer reports it, and scroll-linked motion hides what is out of view,
  //    so each candidate is then scrolled into view on its own: only what stays transparent there is reported.
  const candidates = [];
  for (const el of rendering ? all : []) {
    if (candidates.length >= limit) break;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.opacity) > 0.05) continue;
    // Transparent and not taking pointer events is a toggled state (a closed menu, a scroll cue
    // hidden once the page has scrolled), not a reveal that never fired.
    if (cs.pointerEvents === "none") continue;
    if (!rendered(el)) continue;
    if (!text(el) && !el.querySelector("img, svg, video, picture, canvas") && !/^(img|svg|video|picture|canvas)$/.test(el.localName)) continue;
    // Report the outermost transparent element only.
    let outer = false;
    for (let n = el.parentElement; n && n !== scope.parentElement; n = n.parentElement) {
      if (parseFloat(getComputedStyle(n).opacity) <= 0.05) { outer = true; break; }
    }
    if (outer) continue;
    candidates.push(el);
  }
  const hidden = [];
  for (const el of candidates) {
    el.scrollIntoView({ block: "center", behavior: "instant" });
    let cs = getComputedStyle(el);
    for (let waited = 0; waited < revealMs && parseFloat(cs.opacity) <= 0.05; waited += 100) {
      await sleep(100);
      cs = getComputedStyle(el);
    }
    if (parseFloat(cs.opacity) > 0.05) continue;
    hidden.push({ selector: cssPath(el), opacity: cs.opacity, transform: cs.transform === "none" ? null : cs.transform, text: snippet(el), box: box(el.getBoundingClientRect()) });
  }
  if (candidates.length) {
    jump(startY);
    await sleep(stepMs);
  }

  // 4. Tap targets under minTarget on touch-sized viewports. Inline links in running text are exempt (WCAG 2.5.8).
  const targets = [];
  if (vw <= 1024) {
    const interactive = scope.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [tabindex]:not([tabindex='-1'])");
    for (const el of interactive) {
      if (targets.length >= limit) break;
      if (!rendered(el) || untouchable(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= minTarget && r.height >= minTarget) continue;
      const parent = el.parentElement;
      const inline = el.localName === "a" && getComputedStyle(el).display === "inline" && parent &&
        [...parent.childNodes].some((c) => c !== el && c.nodeType === 3 && c.textContent.trim().length > 1);
      if (inline) continue;
      targets.push({ selector: cssPath(el), size: `${Math.round(r.width)}x${Math.round(r.height)}`, text: snippet(el) || el.getAttribute("aria-label") || "" });
    }
  }

  // 5. Images drawn larger than their pixels allow. scale is CSS px per image px; above 1 is upscaled,
  //    above 1/devicePixelRatio is soft on this screen. Below 2x density is a warning on retina.
  const images = [];
  const dpr = devicePixelRatio || 1;
  for (const img of scope.querySelectorAll("img")) {
    if (images.length >= limit) break;
    if (!img.complete || !img.naturalWidth || !rendered(img)) continue;
    if (/\.svg(\?|#|$)/i.test(img.currentSrc || img.src)) continue;
    const r = img.getBoundingClientRect();
    const fit = getComputedStyle(img).objectFit;
    const sx = r.width / img.naturalWidth;
    const sy = r.height / img.naturalHeight;
    const scale = fit === "contain" || fit === "scale-down" ? Math.min(sx, sy) : Math.max(sx, sy);
    const density = 1 / scale; // image px per CSS px
    if (density >= 2) continue;
    images.push({
      selector: cssPath(img),
      src: (img.currentSrc || img.src).split("/").pop().slice(0, 80),
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      rendered: `${Math.round(r.width)}x${Math.round(r.height)}`,
      density: Math.round(density * 100) / 100,
      severity: density < 1 ? "fail" : density < dpr ? "soft-here" : "warn",
    });
  }

  // 6. Motion that keeps running while the user asked for reduced motion.
  const motion = [];
  if (reduced) {
    for (const a of document.getAnimations ? document.getAnimations() : []) {
      if (motion.length >= limit) break;
      if (a.playState !== "running") continue;
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
      const target = a.effect && a.effect.target;
      if (target && !inScope(target)) continue;
      // A finite animation of 200ms or less (a progress bar easing, a quick fade) is not motion to suppress.
      if ((t.duration || 0) <= 200 && t.iterations !== Infinity) continue;
      motion.push({ selector: target ? cssPath(target) : "(document)", name: a.animationName || a.transitionProperty || a.id || a.constructor.name, duration: t.duration, iterations: String(t.iterations) });
    }
    for (const v of scope.querySelectorAll("video")) {
      if (!v.paused && rendered(v)) motion.push({ selector: cssPath(v), name: "video playing", duration: v.duration, iterations: v.loop ? "Infinity" : "1" });
    }
  }

  // 7. Framework error overlays left on the page (hydration and runtime errors).
  const overlays = [];
  // Next.js dev mode always mounts <nextjs-portal> for its badge; an error shows inside its shadow root as
  // an open dialog, a badge with data-error="true", or (Next 13 and 14) a toast counting errors.
  const nextError = [...document.querySelectorAll("nextjs-portal")].some((p) => {
    const root = p.shadowRoot || p;
    if (root.querySelector("[data-nextjs-dialog], [data-error='true']")) return true;
    const toast = root.querySelector("[data-nextjs-toast]");
    return Boolean(toast && !root.querySelector("[data-next-badge]") && /\d+\s+(error|issue)/i.test(toast.textContent || ""));
  });
  if (nextError || document.querySelector("[data-nextjs-dialog]")) overlays.push("Next.js error overlay");
  if (document.querySelector("vite-error-overlay")) overlays.push("Vite error overlay");

  const fails = {
    overflow: doc.scrollWidth > doc.clientWidth + 1 ? Math.max(1, overflow.length) : overflow.length,
    clipped: clipped.filter((c) => !c.intended).length,
    hidden: hidden.length,
    targets: targets.length,
    images: images.filter((i) => i.severity === "fail").length,
    motion: motion.length,
    overlays: overlays.length,
  };
  // Kept on the page too, for a JavaScript tool that does not await the promise: read it with a second call.
  return (globalThis.__DS_PROBE_RESULT = JSON.stringify({
    url: location.href,
    viewport: { width: vw, height: innerHeight, dpr },
    reducedMotion: reduced,
    ...(rendering ? {} : { warning: "the page renders no frames (a hidden pane or background tab): reveals cannot fire, so the hidden probe was skipped. Show the page and run again." }),
    colorScheme: dark ? "dark" : "light",
    scope: opts.scope || null,
    document: doc,
    fails,
    overflow,
    clipped,
    hidden,
    targets,
    images,
    motion,
    overlays,
  }));
})();
