---
name: audit-type-scale
description: Measure typography across routes in a real browser and align it to a reference page. Collects the computed font-size, line-height, letter-spacing, weight and family of each role (hero h1, eyebrow, lede, section label, section title, subtitle, body, figures, dividers) at desktop and mobile widths, prints a role-by-route table with deltas in px and as ratios against the reference (the home page unless told otherwise, never an average), then fixes the drift with shared tokens or classes so the pages cannot drift again. Use when the user says "font sizes don't match", "align typography", "the heroes don't look aligned", "type scale", "deep dive into the titles and body text", or "/design-studio:audit-type-scale --reference / <routes...>".
argument-hint: "[--reference /] <routes...>"
---

# Audit type scale

"The font sizes still do not look aligned" took eight turns to settle by eye. A measurement settles it in one: what every role computes to on every route, next to the reference, with the difference in pixels.

`<skill-dir>` below is the directory this SKILL.md is in; `<plugin-dir>` is two levels up.

## 1. Resolve the reference and the routes

From `$ARGUMENTS`: `--reference <route>` and the routes to compare. Without them, the reference is `/` and the routes are the ones the user named, else every top-level route in the router or sitemap.

**The reference is a decision, not a statistic.** Align to the page the user names; when they name none, the home page. Never to an average or a compromise between pages, and never the reference to the others ("I wanted all hero sections to align on the main page, not the other way around, nor an in-between"). If the user's wording leaves the direction unclear, ask once before changing anything.

## 2. Measure

At two widths at least, desktop (1440) and mobile (390), plus any width where the site's fluid type (`clamp()`, `vw` units) or breakpoints change a size.

**Headless**, through check-responsive's runner:

```bash
node <plugin-dir>/skills/check-responsive/scripts/run-matrix.mjs --base http://localhost:3000 \
  --routes /,/guide,/why-florida --widths 1440,390 --reduced off \
  --script <skill-dir>/scripts/measure-type.js --json <scratchpad>/type.json > /dev/null
node <skill-dir>/scripts/type-table.mjs <scratchpad>/type.json --reference /
```

For a static site, `--serve <folder>` replaces `--base` and needs no server. (Playwright setup and fallbacks: check-responsive's SKILL.md, step 2.)

**In the browser pane:** for each route and width, navigate, `resize_window` (`width`, `height`), pass the text of `scripts/measure-type.js` to the JavaScript tool, which returns the JSON string (re-read `globalThis.__DS_TYPE_RESULT` if a tool does not await), and collect each result as `{"route": "/guide", "width": 1440, "result": <the JSON string or object>}` in an array in a scratchpad file; `type-table.mjs` reads that file the same way. Reset the viewport afterwards with `resize_window` and `preset: "desktop"`.

**Classification** is by tag, position and class, never by size: the first visible `h1`; the short label before it (eyebrow) or before an `h2` (section label); the paragraph right after the `h1` (lede); `h2` and `h3`; body as the paragraph style carrying the most text; figures by class name (`stat`, `metric`, `figure`, `number`, `kpi`, `counter`, `value`) or as short numeric text set large; dividers as `hr` and elements named `divider`, `rule` or `separator`. When a site's markup defeats it (a hero title in a `div`, labels without a class), pass overrides before the script runs: `globalThis.__DS_PROBE_OPTS = { roles: { "hero-h1": ".hero-title", "section-label": ".kicker" } }`, or `--opts '{"roles":{...}}'` on the runner. Say which overrides you used.

## 3. Report

The table `type-table.mjs` prints, per width: one row per role, the reference column first, and each other cell's style with ✅ or ❌ and the deltas (`size -8px (0.86×), lh 1.15 vs 1.1`). Under it:

- **More than one style for a role on the same route**: drift inside a page (two body sizes, a stray `h2` override), which is fixed before drift between pages. When the reference is a landing page with many (eight body styles, five kinds of `h3` card titles), its dominant style is not a fair reference for an article page's running text: say so, compare the hero roles, and scope the rest (`--opts '{"scope":"#overview"}'`) or ask which component should set the body.
- **Dividers**: thickness, width, color and margins per route, when the user asked about section dividers.
- **Where each mismatched style comes from**: selectors and classes, which lead to the rules to change.

Then trace each ❌ to its source rule (`file:line`): a page-specific class (`.guide .hero h1`), a one-off utility (`text-[48px]`), an inline style, a component prop. Present the table and the sources before editing anything when the user asked for an audit; go straight on to the fix when they asked for alignment.

## 4. Fix

Align every route to the reference, role by role, at every width measured.

1. **Make the reference's values the shared definition.** Put them where every page reads them: design tokens (`--text-hero`, `--leading-hero`, `--tracking-eyebrow` in `globals.css` or the Tailwind theme), or one shared class or component per role (`.hero-title`, `<Eyebrow>`, `<SectionTitle>`). Prefer the site's existing pattern: if it already has a `<SectionHeading>` component, every hero uses it; if it uses Tailwind tokens, add `fontSize` entries with their line height and tracking.
2. **Point every page at it and delete the per-page overrides**, rather than editing them to new numbers. A page-specific rule edited to match is the drift of next month.
3. **Keep the responsive steps the reference has.** If the home hero is 56px on desktop and 38px under 640px, the shared definition carries both; measure mobile again to prove it.
4. **Re-run the measurement** on every route and both widths. Done is a table with ✅ in every cell, or the cells left ❌ listed with the reason the user gave (a deliberately larger figure on one page).

Work on a branch from `main` unless the user is already on one. Visual changes beyond type (spacing, colors) are out of scope unless asked: list them as observations.

## Files

| File | Use it when |
| --- | --- |
| `scripts/measure-type.js` | measuring one page at one width, in the pane or through the runner |
| `scripts/type-table.mjs` | turning the results into the role-by-route table against the reference |
