---
name: redesign-section
description: Redesign one section of a client site from mockups to a verified, end-to-end build. Reads the section, its content module and every other route that renders the same content; publishes one canvas with the current section and 3 to 6 directions, each with a desktop and a 375px artboard and a motion note (trigger, duration, easing, reduced-motion state), in the brand's tokens and real copy; writes down what the picked mockup fixes as a contract; builds it on its own branch with reduced-motion support and the content kept in its data module; then checks every breakpoint against the mockup with check-responsive. Use when the user says "act as a UI/UX designer and come up with mockups for", "redesign the X section", "motion design ideas for", "make it end to end, mobile included", or "/design-studio:redesign-section <route> <section>".
argument-hint: "<route> <section>"
---

# Redesign a section

The loop is always the same: mockups, a pick, a build. So are its failures: mobile forgotten until the user says so, the build drifting from the mockup it was picked from, the same content on a second route left behind, a detail of the mockup dropped, reduced motion asked for separately. Each phase below closes one of those.

`<skill-dir>` below is the directory this SKILL.md is in; `<plugin-dir>` is two levels up.

**Guardrails, for every phase:**

- Redesign only the section the user named. A neighbouring section with a similar role is not it ("do not replace the hero section but CLIENT ENDORSEMENTS"). When the name is ambiguous, ask which one, with both candidates' headings.
- Use the client's copy verbatim, from the data module or production. No lorem ipsum, no rewording; a typo you fix is listed in the report.
- Keep `.claude/launch.json` out of every commit: stage files by path, never `git add -A` or `git add .`, and check `git status --short` before each commit.

## Phase 1. Read

1. Locate the section: the route's page file, the component that renders the section, and the module its content comes from (`data/`, `content/`, `lib/`, a CMS query, `messages/` for i18n).
2. Find its twins, every other place that renders the same content, by following the **data import**, not just the component:

   ```bash
   node <skill-dir>/scripts/find-twins.mjs --root . --section <name> [--component <file>] [--text "<a phrase of its copy>"]
   ```

   It lists the components reading the same content module, the routes that render each of them, and where the same copy appears again (hard-coded duplicates, JSON-LD, `llms.txt`). A twin can look nothing like the section: the pillars also appeared as a compact list in "The Eliza Standard" on the home page.
3. Read the design system: tokens in the Tailwind config or `globals.css` (colors, type, spacing, easing), the components the section can reuse, and the brand guides (`docs/BRAND_IDENTITY_GUIDE_*.md` or similar), which set the voice and the motion character.
4. Read the live section: open the production URL in the browser (or the dev server) at 1440 and 375, and screenshot both. That is artboard 0.

**Stop and list what you found** before mocking: the component and data files, every twin with its route and the name the page gives it, every copy hit, and what you will treat as in scope. Each twin either changes with the redesign or is named as out of scope by the user. This is where "I forgot to mention it also appears on..." came from. Write the list in your reply before the canvas even when the user is away or told you to decide on your own: then it is the record of what you chose to cover, and it goes into the report's "What changed" and "Not in this PR".

## Phase 2. Mock

Publish **one canvas**: the current section as artboard 0, then 3 to 6 directions. Each direction has:

- a **desktop artboard** (1440 wide) and a **375px artboard**, side by side, both with the real copy at its real length;
- a **motion note**: each animated element with its trigger (on load, on entering the viewport at a threshold, on scroll progress, on hover), duration, easing, and its **reduced-motion state** (what a visitor with reduced motion sees instead: usually the end state, or a short opacity fade);
- a name and one sentence on the idea, so the user can pick by name.

Directions must differ in idea (layout, rhythm, what moves), not only in color. Draw from [references/motion-patterns.md](references/motion-patterns.md), the patterns this user picked before, and from the brand guide's motion character; at least one direction should be the quiet one, with almost no motion.

Where the canvas goes: an Artifact (run the Artifact tool's quickstart with the `design` intent and use the Design type when it is offered; otherwise one HTML page with the artboards laid out on a grid). Build artboards as real HTML and CSS in the site's tokens and fonts, with the motion running, so the user can watch it. Without an Artifact tool, write the canvas to `<scratchpad>/mockups/<section>.html`, open it in the browser, and give the user the path. Then wait for the pick. When the user picks a mix ("2, with the numbers from 4"), restate the mix in one line before building.

## Phase 3. Contract

When the user picks, write down what the mockup fixes, from the artboards themselves, in `<scratchpad>/contracts/<section>.md` from [references/contract-template.md](references/contract-template.md): anchoring and alignment (text pinned to the top or the bottom of its box), spacing ratios, type roles, every animated element with its motion note, the mobile layout element by element, every twin and how it changes, and the details that are easy to drop (a signature that reveals at the end, a hairline divider, a number's unit). Number every item. Show the contract to the user in a few lines; the build is checked against it, item by item.

## Phase 4. Build

1. Branch from the latest `main`: `git fetch origin main && git switch -c redesign/<section> origin/main` (or a worktree, if the user prefers to keep the current checkout).
2. Implement the picked direction in the existing component, or a new one beside it, replacing only the named section. Apply the change to each in-scope twin, from the same content module.
3. **Content stays in its data module.** Add fields there (an ordinal, a short label) rather than hard-coding copy in JSX. If the design needs copy that does not exist yet, ask for it, and mark any placeholder as such in the report.
4. **Reduced motion, always**: every animation has the reduced-motion state the contract names, through `@media (prefers-reduced-motion: reduce)`, Tailwind `motion-safe:`/`motion-reduce:`, or `useReducedMotion()`/`<MotionConfig reducedMotion="user">` with Framer Motion. Content is visible without JavaScript and without motion: the hidden initial state of a reveal applies only once script has run and motion is allowed, so a section can never stay stuck at `opacity: 0`.
5. Mobile is part of the build, not a follow-up: implement the 375 artboard as drawn, not as whatever the desktop layout collapses into.
6. Run the project's own checks (`lint`, `typecheck`, `build`) before calling it built.

## Phase 5. Verify

1. Run check-responsive on every route that renders the section or a twin, scoped to the section, at 375, 768, 1024 and 1440, with reduced motion on and off: follow `<plugin-dir>/skills/check-responsive/SKILL.md` (the runner: `node <plugin-dir>/skills/check-responsive/scripts/run-matrix.mjs --base <dev-url> --routes <routes> --widths 375,768,1024,1440 --scope <selector> --shots <scratchpad>/verify`). Fix what it finds.
2. Screenshot the built section at each breakpoint (the runner's `--capture <selector>` saves one per width, for the section and each twin) and place each one beside the matching mockup artboard (add a "Built" row to the canvas, or compare side by side in the browser). Go through the contract: each item is ✅, or ❌ with what differs. Fix every ❌ that is not a deliberate change the user agreed to.
3. Watch the motion once at desktop: trigger, duration and easing as noted, nothing janky, and with reduced motion on, the stated reduced state.

## Report

Commit when the user asked for a branch (they usually do: "in a new branch"); push and open a pull request only when asked. The report, which doubles as the pull request body:

- **The problem**: what the section was and what the user wanted from it.
- **What changed**: the direction picked and the files, including each twin.
- **Verification**: the contract table (item, ✅/❌, note), the check-responsive table, and the side-by-side screenshots.
- **Not in this PR**: twins and neighbours deliberately left alone, ideas from other directions not taken.
- **For the client's attention**: copy that is missing or placeholder, typos fixed, anything that changes how the content reads.

## Files

| File | Use it when |
| --- | --- |
| `scripts/find-twins.mjs` | phase 1: the component, its content module, twins, routes, copy elsewhere |
| [references/motion-patterns.md](references/motion-patterns.md) | phase 2: the motion patterns picked before, and the house rules for motion |
| [references/contract-template.md](references/contract-template.md) | phase 3: the contract the build is checked against |
