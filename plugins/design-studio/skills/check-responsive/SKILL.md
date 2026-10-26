---
name: check-responsive
description: Breakpoint and motion QA for a page or section in a real browser. Runs one probe script at 375, 390, 768, 1024, 1280 and 1440px, with reduced motion on and off and dark mode when the site themes, and reports horizontal overflow, clipped text, reveal sections stuck at opacity 0, tap targets under 44px, images drawn larger than their pixels, motion that ignores prefers-reduced-motion, and hydration errors, with the selector of each failing element and screenshots of failures only. Compares against production to separate regressions from old debt. Use after building or changing a section, at the end of redesign-section, or when the user says "check mobile", "text gets cut off", "regressions between desktop and mobile", "does it work on phones", or "/design-studio:check-responsive <route> [selector]".
argument-hint: "<route> [selector]"
---

# Check responsive

Find the visual regressions the user would otherwise find by eye: text cut off as the viewport narrows, a section that never fades in, a portrait gone soft, a button too small to tap. Measure them in a browser, at every breakpoint, with one script, and report each failure with the selector that fixes it.

`<skill-dir>` below is the directory this SKILL.md is in.

## 1. Resolve what to check

From `$ARGUMENTS` and the conversation: the **route** (default `/`), an optional **selector** that scopes the report to one section (`#pillars`, `section.testimonials`), and the **site URL**.

- **Local:** find the dev server in `package.json` scripts or `.claude/launch.json`; start it if nothing answers (`npm run dev`, `python3 -m http.server` for a static site) and note the port.
- **Baseline:** the production URL (from `vercel.json`, `README.md`, the canonical URL in the layout, or ask). Probing it with the same matrix separates what this change broke from what was already broken. Skip it when the route does not exist in production yet.
- **Themes:** the site themes if its CSS has `prefers-color-scheme`, `dark:` utilities, `next-themes`, or a `data-theme`/`.dark` switch. Class-based themes ignore media emulation; toggle the class instead (below).

## 2. Run the matrix

Pick the first path that is available.

### A. Headless, through the runner (preferred when Node and Playwright are present)

```bash
node <skill-dir>/scripts/run-matrix.mjs --base http://localhost:3000 --routes /about \
  --scope '#pillars' --baseline https://example.com --shots <scratchpad>/responsive --json <scratchpad>/responsive.json
```

Defaults: widths `375,390,768,1024,1280,1440`, reduced motion `both`, scheme `light` (`--scheme both` for themed sites). It needs the `playwright` package resolvable from the project or globally; if it is missing, install it outside the project, `npm i --prefix <scratchpad>/pw playwright@1.63.0 && npx --prefix <scratchpad>/pw playwright install chromium` (ask first: it downloads a browser), then prefix the command with `NODE_PATH=<scratchpad>/pw/node_modules`. It prints a table per route, the findings with selectors, and the screenshot paths. With `--baseline`, findings production lacks are marked **new**.

### B. In the browser pane

When the user works in the desktop app's browser pane, or the page needs a logged-in session:

1. Navigate to the route. For each width in the matrix, `resize_window` to it (height 812 under 768px wide, else 900).
2. Read `<skill-dir>/scripts/probes.js` and pass its whole text to the JavaScript tool. To scope it, run `globalThis.__DS_PROBE_OPTS = { scope: "#pillars" }` first. It scrolls the page through and back, then returns a JSON string. If the tool hands back a pending promise or nothing, call it again with `globalThis.__DS_PROBE_RESULT`.
3. Read the console (`read_console_messages`, errors only) for hydration and runtime errors after each load.
4. Reduced motion cannot be emulated from page JavaScript. Use the runner for that half of the matrix, or ask the user to set it in DevTools (Rendering, "Emulate CSS media feature prefers-reduced-motion") or in the OS, then re-run the probe. Say which you did.
5. For class-based dark mode, run `document.documentElement.classList.add("dark")` (or the site's attribute) and probe again.
6. **Reset the viewport to desktop when you finish** (1440x900, or the size it had before). The pane keeps an emulated size, and the user's next look at the site would be at 375px.

## 3. Triage

The probes over-report on purpose; you decide what is a defect. Read the element before calling it one.

| Probe | A real defect when | Not a defect when |
| --- | --- | --- |
| **overflow** (`cause=box` or `text`) and the document's `scrollWidth > clientWidth` | anything at 375 or 390: the page scrolls sideways on a phone | the element sits inside a deliberate horizontal scroller (the probe already skips `overflow-x: auto` ancestors) |
| **clipped** | `intended=false`: a fixed `height` or `max-height` with `overflow: hidden` cutting text as lines wrap | `intended=true` (`line-clamp`, `text-overflow: ellipsis`) and the full text is reachable elsewhere |
| **hidden** (opacity 0 after the scroll-through) | a reveal whose observer never fired, a threshold the section can never reach on a short viewport, or a JS-only initial state with no fallback | a closed menu, an inactive carousel slide, a hover overlay: check that it becomes visible through its own interaction |
| **targets** under 44px (widths up to 1024) | icon buttons, nav links, carousel dots, close buttons | inline links in running text (already skipped), or a small visual whose padding makes the hit area 44px (re-measure the padded element) |
| **images** `severity=fail` (density under 1) | always: the image is upscaled; ask for a larger original or render it smaller | — |
| **images** `soft-here` or `warn` (density under 2) | portraits and hero imagery, where softness shows on retina screens | thumbnails, logos with an SVG alternative, deliberately blurred backdrops |
| **motion** (only when reduced motion is on) | anything infinite, parallax, autoplaying video, scroll-jacking | a fade of 200ms or less that only changes opacity |
| **console** hydration errors, error overlays | always on a production build; on a dev server, confirm with `next build && next start` before reporting | warnings from browser extensions |

A reveal stuck at opacity 0 has a standard fix: content is visible by default, and the hidden initial state applies only once JavaScript has run and motion is allowed (`html.js-motion .reveal { opacity: 0 }`), with a timeout that reveals everything if the observer never fires. Text cut off has one too: replace fixed heights with `min-height`, or let the grid row size to content.

## 4. Report

One table per route: widths as rows, a ✅/⚠️/❌ per probe, the counts, and with a baseline the number of **new** findings. Then, for each finding you kept:

- the breakpoint(s), the probe, the **selector**, what it measured (`574px wide in a 375px viewport`, `natural 240x320 drawn at 560x747`), and the likely fix (`file:line` when you can find the rule);
- a screenshot only for failures (the runner's `--shots`, or a pane screenshot at that width).

List what you dismissed during triage and why in one line each, so the user can overrule you. End with what was not checked (a theme, reduced motion in the pane, a route behind a login).

When this runs at the end of `redesign-section`, also place each breakpoint's screenshot beside the matching mockup artboard and check the contract items there (that skill's phase 5).

## Files

| File | Use it when |
| --- | --- |
| `scripts/probes.js` | the probes, for the browser pane's JavaScript tool or the runner |
| `scripts/run-matrix.mjs` | the matrix in headless Chromium; also runs other page scripts (`--script`), as `audit-type-scale` does |
| [references/breakpoints.md](references/breakpoints.md) | choosing widths beyond the default matrix, framework breakpoints, devices, emulation limits |
