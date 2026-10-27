// Measure the type scale of one page at the current viewport, by role.
//
// Paste the whole file into the browser pane's JavaScript tool, or run it through
// check-responsive's run-matrix.mjs with --script. It evaluates to a promise of a JSON string.
// Options go on globalThis.__DS_PROBE_OPTS before it runs:
//   roles   {role: selector} overrides, merged over the built-in classification, e.g.
//           {"figure": ".stat-value", "section-label": ".kicker"}. A selector wins over the heuristics.
//   scope   CSS selector to measure inside (default: main, else body)
//
// Roles, classified by tag and class, never by size alone:
//   hero-h1        the first visible h1
//   eyebrow        the short label right before the h1 (previous sibling, or the first child of its header group)
//   section-label  the short label right before an h2
//   section-title  h2
//   subtitle       h3
//   body           p, li and blockquote text in the content flow (not nav, header, footer, buttons)
//   lede           the paragraph right after the h1 (the hero's body copy), whatever its size
//   figure         numbers set large: class names like stat, figure, metric, number, kpi, counter,
//                  or text that is mostly digits, currency or % at 1.5x body size or more
//   divider        hr and elements named divider, rule or separator (thickness, width, color, margins)
(async (opts = globalThis.__DS_PROBE_OPTS || {}) => {
  const root = (opts.scope && document.querySelector(opts.scope)) || document.querySelector("main") || document.body;
  const overrides = opts.roles || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Instant, whatever the page says: with scroll-behavior: smooth, each scrollTo starts an animation
  // the next one interrupts, and the page never reaches the sections a reveal is waiting for.
  const jump = (y) => scrollTo({ top: y, behavior: "instant" });
  await document.fonts.ready;
  // Let scroll-triggered reveals and fluid type settle.
  jump(document.documentElement.scrollHeight);
  await sleep(250);
  jump(0);
  await sleep(400);

  const cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id) { parts.unshift(`#${CSS.escape(n.id)}`); break; }
      let part = n.localName;
      const cls = [...n.classList].filter((c) => /^[A-Za-z_-][\w-]*$/.test(c)).slice(0, 2);
      if (cls.length) part += cls.map((c) => `.${c}`).join("");
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [];
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
      parts.unshift(part);
    }
    return parts.join(" > ");
  };
  const text = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && !el.closest("[hidden], [aria-hidden='true']");
  };
  const px = (v) => (v === "normal" ? null : Math.round(parseFloat(v) * 100) / 100);
  const style = (el) => {
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === "normal" ? null : parseFloat(cs.lineHeight);
    const ls = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing);
    return {
      fontSize: px(cs.fontSize),
      lineHeight: lh === null ? "normal" : Math.round(lh * 100) / 100,
      lineHeightRatio: lh === null ? null : Math.round((lh / size) * 100) / 100,
      letterSpacing: Math.round(ls * 100) / 100,
      letterSpacingEm: Math.round((ls / size) * 1000) / 1000,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      textTransform: cs.textTransform,
      fontStyle: cs.fontStyle,
      color: cs.color,
    };
  };
  const signature = (s) => [s.fontSize, s.lineHeight, s.letterSpacing, s.fontWeight, s.fontFamily, s.textTransform, s.fontStyle].join("|");
  const shortLabel = (el) => {
    if (!el || !visible(el)) return false;
    if (/^(h1|h2|h3|img|picture|svg|figure|ul|ol|form|nav|button)$/.test(el.localName)) return false;
    const t = text(el);
    return t.length > 0 && t.length <= 60 && !el.querySelector("h1, h2, h3, p + p");
  };
  // The element that actually sets the text: a label wrapper (a flex row with a decorative rule and a
  // span) inherits its own font size from the page, so descend to the child carrying all of its text.
  const innermost = (el) => {
    let n = el;
    for (;;) {
      const child = [...n.children].find((c) => visible(c) && text(c) === text(n));
      if (!child) return n;
      n = child;
    }
  };
  // A short row of items (a rule, the label, a reading time) before a heading: its first piece of text is the label.
  const firstLeaf = (el) => {
    if (!el || !visible(el) || text(el).length > 120 || el.querySelector("h1, h2, h3, img, picture, svg, button, a")) return null;
    const leaf = [...el.querySelectorAll("*")].find((n) => visible(n) && text(n) && ![...n.children].some((c) => text(c)));
    return leaf || null;
  };
  // The short element right before a heading: its previous sibling, or the last short child of the wrapper before it.
  const labelBefore = (h) => {
    let prev = h.previousElementSibling;
    while (prev && !visible(prev)) prev = prev.previousElementSibling;
    if (prev && shortLabel(prev)) return innermost(prev);
    if (prev && firstLeaf(prev)) return firstLeaf(prev);
    if (!prev && h.parentElement && h.parentElement !== root) {
      let up = h.parentElement.previousElementSibling;
      if (up && shortLabel(up)) return innermost(up);
    }
    return null;
  };

  const found = new Map(); // element -> role
  const assign = (el, role) => { if (el && !found.has(el)) found.set(el, role); };

  for (const [role, sel] of Object.entries(overrides)) {
    for (const el of root.querySelectorAll(sel)) if (visible(el)) assign(el, role);
  }

  const h1 = [...document.querySelectorAll("h1")].find(visible);
  assign(h1, "hero-h1");
  if (h1) assign(labelBefore(h1), "eyebrow");
  for (const el of root.querySelectorAll("[class*='eyebrow' i], [class*='kicker' i], [class*='overline' i], [class*='pretitle' i]")) {
    if (!visible(el) || found.has(el)) continue;
    const next = el.nextElementSibling;
    assign(innermost(el), h1 && (next === h1 || el.closest("header, section") === h1.closest("header, section")) ? "eyebrow" : "section-label");
  }
  for (const h of root.querySelectorAll("h2")) {
    if (!visible(h)) continue;
    assign(h, "section-title");
    assign(labelBefore(h), "section-label");
  }
  for (const h of root.querySelectorAll("h3")) if (visible(h)) assign(h, "subtitle");

  const outside = "nav, header nav, footer, button, [role=button], label, figcaption, form";
  const paragraphs = [...root.querySelectorAll("p, li, blockquote, dd")].filter(
    (el) => visible(el) && !found.has(el) && !el.closest(outside) && text(el).length >= 40 && ![...el.children].some((c) => /^(p|ul|ol|div)$/.test(c.localName)),
  );
  // Body is the paragraph style carrying the most text; the paragraph right after the h1 is the lede.
  const tally = new Map();
  for (const p of paragraphs) {
    const k = getComputedStyle(p).fontSize;
    tally.set(k, (tally.get(k) || 0) + text(p).length);
  }
  const bodySize = parseFloat([...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "16");
  // The lede is the first paragraph after the h1, also when it sits in a wrapper (div > p), before any h2.
  if (h1) {
    for (let next = h1.nextElementSibling; next; next = next.nextElementSibling) {
      if (!visible(next)) continue;
      if (/^h[1-3]$/.test(next.localName) || next.querySelector("h2")) break;
      const p = next.localName === "p" ? next : [...next.querySelectorAll("p")].find(visible);
      if (p && text(p).length >= 20) { assign(p, "lede"); break; }
    }
  }
  for (const p of paragraphs) assign(p, "body");

  const figureClass = /(^|[-_\s])(stat|stats|figure|metric|number|kpi|counter|value)([-_\s]|$)/i;
  for (const el of root.querySelectorAll("*")) {
    if (found.has(el) || !visible(el) || el.children.length > 2) continue;
    const t = text(el);
    if (!t || t.length > 16) continue;
    const named = figureClass.test(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className);
    const numeric = /^[~≈<>+$€£¥]?\s?[\d.,]+\s?(%|[kKmMbB]|\+|x|yrs?|years?|€|\$)?$/.test(t);
    if ((named && /\d/.test(t)) || (numeric && parseFloat(getComputedStyle(el).fontSize) >= bodySize * 1.5)) {
      if (el.children.length === 1 && text(el.children[0]) === t) continue; // measure the innermost element
      assign(el, "figure");
    }
  }

  const dividers = [];
  for (const el of root.querySelectorAll("hr, [class*='divider' i], [class*='separator' i], [class*='rule' i]")) {
    if (!visible(el) || found.has(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    dividers.push({
      selector: cssPath(el),
      height: Math.round(r.height * 100) / 100,
      width: Math.round(r.width),
      borderTop: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      background: cs.backgroundColor,
      marginBlock: `${cs.marginTop} ${cs.marginBottom}`,
      text: text(el).slice(0, 40),
    });
  }

  const roles = {};
  for (const [el, role] of found) {
    const s = style(el);
    const sig = signature(s);
    roles[role] = roles[role] || {};
    const bucket = (roles[role][sig] = roles[role][sig] || { ...s, count: 0, chars: 0, examples: [] });
    bucket.count++;
    bucket.chars += text(el).length;
    if (bucket.examples.length < 3) bucket.examples.push({ selector: cssPath(el), classes: el.className && typeof el.className === "string" ? el.className.slice(0, 120) : "", text: text(el).slice(0, 50) });
  }
  // Dominant style first: the one carrying the most text (body), or the most instances (everything else).
  const out = {};
  for (const [role, sigs] of Object.entries(roles)) {
    out[role] = Object.values(sigs).sort((a, b) => (role === "body" ? b.chars - a.chars : b.count - a.count || b.chars - a.chars));
  }
  // Kept on the page too, for a JavaScript tool that does not await the promise: read it with a second call.
  return (globalThis.__DS_TYPE_RESULT = JSON.stringify({
    url: location.href,
    path: location.pathname,
    viewport: { width: document.documentElement.clientWidth, height: innerHeight },
    rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
    bodySize,
    roles: out,
    dividers,
  }));
})();
