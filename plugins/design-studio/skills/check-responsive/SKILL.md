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

- **Local:** find the dev server in `package.json` scripts or `.claude/launch.json`; start it if nothing answers (`npm run dev`) and note the port. A static site (plain HTML, or a built `dist/`) needs no server with the runner: `--serve <folder>` answers its requests from disk. Use that too when starting a server fails because binding a port is not allowed (`EPERM` in a sandbox).
- **Baseline:** the production URL (from `vercel.json`, `README.md`, the canonical URL in the layout, or ask). Probing it with the same matrix separates what this change broke from what was already broken. Skip it when the route does not exist in production yet, or when production still serves another site (an old builder's pages: the runner warns when no finding matches).
- **Themes:** the site themes if its CSS has `prefers-color-scheme`, `dark:` utilities, `next-themes`, or a `data-theme`/`.dark` switch. Class-based themes ignore media emulation; toggle the class instead (below).

## 2. Run the matrix

Pick the first path that is available.

### A. Headless, through the runner (preferred when Node and Playwright are present)

```bash
node <skill-dir>/scripts/run-matrix.mjs --base http://localhost:3000 --routes /about \
  --scope '#pillars' --baseline https://example.com --shots <scratchpad>/responsive --json <scratchpad>/responsive.json
```

For a static site, `--serve ./site` replaces `--base`. Defaults: widths `375,390,768,1024,1280,1440`, reduced motion `both`, scheme `light` (`--scheme both` for themed sites). It needs the `playwright` package resolvable from the project or globally; if it is missing, install it outside the project, `npm i --prefix <scratchpad>/pw playwright@1.63.0 && npx --prefix <scratchpad>/pw playwright install chromium` (ask first: it downloads a browser), then prefix the command with `NODE_PATH=<scratchpad>/pw/node_modules`. Inside a macOS sandbox Chromium cannot start its helper processes; the runner says so and retries in single-process mode by itself. It prints a table per route, the findings with selectors, and the screenshot paths. With `--baseline`, findings production lacks are marked **new**.

### B. In the browser pane

When the user works in the desktop app's browser pane, or the page needs a logged-in session:

1. **Show the pane first.** A hidden pane runs the page as a background tab that renders no frames, so no scroll-triggered reveal can fire; the probes detect this, skip the hidden probe and return a `warning` saying so. If you cannot show it, use the runner for that half, or ask the user to bring the pane into view.
2. Navigate to the route. For each width in the matrix, `resize_window` with `width` and `height` (812 under 768px wide, else 900). The pane follows the app's light or dark theme, so pass `colorScheme: "light"` (or `"dark"` for the dark half) on the same call.
3. Read `<skill-dir>/scripts/probes.js` and pass its whole text to the JavaScript tool. To scope it, run `globalThis.__DS_PROBE_OPTS = { scope: "#pillars" }` first. The tool awaits the promise and returns the JSON string; it takes a few seconds, longer when reveals are re-checked. If a tool hands back a pending promise or nothing instead, read `globalThis.__DS_PROBE_RESULT` with a second call.
4. Read the console (`read_console_messages` with `onlyErrors: true`) for hydration and runtime errors after each load.
5. Reduced motion cannot be emulated in the pane. Use the runner for that half of the matrix, or ask the user to set it in DevTools (Rendering, "Emulate CSS media feature prefers-reduced-motion") or in the OS, then re-run the probe. Say which you did.
6. For class-based dark mode, run `document.documentElement.classList.add("dark")` (or the site's attribute) and probe again.
7. **Reset the viewport when you finish:** `resize_window` with `preset: "desktop"`, which clears the emulation. Setting 1440x900 instead would leave a fixed emulated size behind, and the pane keeps an emulated size across reloads.

## 3. Triage

The probes over-report on purpose; you decide what is a defect. Read the element before calling it one.

| Probe | A real defect when | Not a defect when |
| --- | --- | --- |
| **overflow** (`cause=box` or `text`) | with the document's `scrollWidth > clientWidth`, anything at 375 or 390: the page scrolls sideways on a phone. Without it, a fixed or clipped bar whose end is cut off (nav links pushed past the edge at exactly 768) | the element sits inside a deliberate horizontal scroller (the probe already skips `overflow-x: auto` ancestors) |
| **clipped** | `intended=false`: a fixed `height` or `max-height` with `overflow: hidden` cutting text as lines wrap, or a panel narrower than its text at one width | `intended=true` (`line-clamp`, `text-overflow: ellipsis`, or a marquee looping inside a clipped strip) and the full text is reachable elsewhere |
| **hidden** (opacity 0 after the scroll-through) | a reveal whose observer never fired, a threshold the section can never reach on a short viewport (a tall form that only fails at one width), or a JS-only initial state with no fallback | an inactive carousel slide, a hover overlay, a scroll cue that fades once the page has scrolled: check that it becomes visible through its own interaction. Transparent elements with `pointer-events: none` (a closed menu) are already skipped |
| **targets** under 44px (widths up to 1024) | icon buttons, nav links, carousel dots, close buttons, footer link rows | inline links in running text and links inside a closed menu (both already skipped), or a small visual whose padding makes the hit area 44px (re-measure the padded element). A wide link only short of 44px tall (a 270x39 logo) is a warning |
| **images** `severity=fail` (density under 1) | always: the image is upscaled; ask for a larger original or render it smaller | — |
| **images** `soft-here` or `warn` (density under 2) | portraits and hero imagery, where softness shows on retina screens | thumbnails, logos with an SVG alternative, deliberately blurred backdrops |
| **motion** (only when reduced motion is on) | anything infinite, parallax, autoplaying video, scroll-jacking; an infinite loop on an element the probe found hidden still plays for visitors at the top of the page | finite animations of 200ms or less are already skipped |
| **console** hydration errors, error overlays | always on a production build; on a dev server, confirm with `next build && next start` before reporting | warnings from browser extensions; a CMS's live-preview endpoint refusing `localhost` (CORS errors from `api.sanity.io` and the like) |

A reveal stuck at opacity 0 has a standard fix: content is visible by default, and the hidden initial state applies only once JavaScript has run and motion is allowed (`html.js-motion .reveal { opacity: 0 }`), with a timeout that reveals everything if the observer never fires. Text cut off has one too: replace fixed heights with `min-height`, or let the grid row size to content.

## 4. Report

One table per route: one row per width and reduced-motion setting (as the runner prints it, or say plainly which rows had reduced motion on), a ✅/⚠️/❌ and the count in every probe cell (not counts alone), and with a baseline the number of **new** findings. Then, for each finding you kept:

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
