# design-studio

Four skills for the design half of client work: redesigning a section from mockups to a verified build, checking it at every breakpoint, measuring typography across pages, and preparing hero media.

## Install

```text
/plugin marketplace add HBillaud/claude-plugins
/plugin install design-studio@hadrien-labs
```

## Use

| Skill | Ask for | What it does |
| --- | --- | --- |
| `redesign-section` | "mockups and motion design ideas for the Pillars section", `/design-studio:redesign-section <route> <section>` | Finds the section, its content module and every other route rendering the same content; publishes one canvas with the current section and 3 to 6 directions (desktop and 375px artboards, motion notes with reduced-motion states); writes a contract for the pick; builds it on `redesign/<section>`; verifies each breakpoint against the mockup |
| `check-responsive` | "check mobile", "text gets cut off", `/design-studio:check-responsive <route> [selector]` | Runs one probe script at 375 to 1440px with reduced motion on and off: horizontal overflow, clipped text, reveals stuck at opacity 0, tap targets under 44px, upscaled images, motion that ignores reduced motion, hydration errors; compares against production |
| `audit-type-scale` | "the font sizes don't match across pages", `/design-studio:audit-type-scale --reference / <routes...>` | Measures each type role on each route and prints a table of deltas against the reference page, then aligns the others to it through shared tokens or classes |
| `prep-hero-media` | "use this video as the hero background", `/design-studio:prep-hero-media <file>` | Transcodes video to MP4 and WebM without audio plus a WebP poster, images to WebP and AVIF; wires the hero poster-first with the loop after `load` and none under reduced motion or Save-Data |

`redesign-section` calls `check-responsive` in its last phase, and `audit-type-scale` runs its measurement through `check-responsive`'s runner.

## What is inside

| Path | What it is |
| --- | --- |
| `skills/redesign-section/scripts/find-twins.mjs` | follows imports from a section's component to its content module, to every other file reading it, and up to the routes; then searches for the same copy elsewhere |
| `skills/redesign-section/references/` | the motion patterns picked before, and the contract template |
| `skills/check-responsive/scripts/probes.js` | the probes, as one script for the browser pane's JavaScript tool |
| `skills/check-responsive/scripts/run-matrix.mjs` | runs a page script across routes, widths, reduced motion and color schemes in headless Chromium; tables, screenshots of failures, a production baseline |
| `skills/check-responsive/references/breakpoints.md` | the matrix, framework breakpoints, what emulation cannot show |
| `skills/audit-type-scale/scripts/measure-type.js` | computed type per role on one page |
| `skills/audit-type-scale/scripts/type-table.mjs` | the role-by-route table against the reference |
| `skills/prep-hero-media/scripts/transcode.sh` | `probe`, `video` and `image` modes over ffmpeg |
| `skills/prep-hero-media/references/hero-media.md` | budgets, encoding settings, wiring for HTML, React and Next.js |
| `evals/` | one end-to-end case per skill: a scaffold builds a fixture site, the agent works on it, graders check the result |

The scripts need Node 18 or later; the runner also needs the `playwright` package and its Chromium (check-responsive's SKILL.md says how to get them without touching the project), and `transcode.sh` needs ffmpeg (`brew install ffmpeg`). Every script also works without the runner, through the browser pane.

To re-run the cases after changing a skill, from this directory:

```bash
claude plugin eval . --scaffold --ablation none --allow-tools Bash Write Edit
claude plugin eval . --scaffold --ablation none --allow-tools Bash Write Edit --case responsive-defects
```

## Where it comes from

The method comes from 39 sessions on three client sites (August to October 2026): 13 mockup-pick-build sessions and 11 merged PRs for section redesigns, five or more rounds of visual fixes after builds, about eight turns aligning three pages' type by eye, and hero media that was the largest Core Web Vitals finding on every site.
