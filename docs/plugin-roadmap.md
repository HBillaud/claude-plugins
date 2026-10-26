# Plugin roadmap: what to port from the client sites

> [!NOTE]
> Drawn from the three client repositories (Love-By-Eliza, Miami-Square-Capital, Tastes-Philippines: 102 commits, about 60 PRs) and 39 past Claude Code sessions scoped to them (August 30 to October 25, 2026). Each candidate is ranked by how often the work recurred, how much it cost each time, and how much of the method is specific to how you work rather than already covered by an installed plugin (`marketing:seo-audit`, `searchfit-seo`, `design:*`, `ui-ux-pro-max`).
>
> Target repository: `HBillaud/claude-plugins` (`~/Documents/Hadrien-Labs/Claude`), marketplace `hadrien-labs`.

## What the sessions show

Nearly every session follows one of five loops:

1. **Mockup, pick, build** (13 sessions, 11 merged PRs). "Act as a professional UI/UX designer/developer and come up with multiple mockups and motion design ideas for X." You pick a direction on an Artifact canvas, then ask for it "end to end, mobile included, in a new branch."
2. **Client feedback to code** (6 sessions). Eliza's "Website Changes" emails read through Gmail, long pasted feedback, bilingual content for Miami Square Capital, then "give me a 1:1 map of desired changes to the codebase" and "audit whether anything was left out."
3. **SEO and GEO passes** (all three repos). `llms.txt` and `llms-full.txt`, named AI crawlers in `robots.ts`, JSON-LD entity graphs, prerendering a Vite SPA, and the question of why AI agents still quoted Tastes' old hours.
4. **Visual QA after the build.** "You might have overlooked dynamic rendering, text gets cut off", "the text is pinned to the bottom, the mockup pins it to the top", and five rounds aligning the type scale across three Miami Square Capital pages.
5. **Ship it.** "Work in your own branch", then "push, open PR". Your PR descriptions follow one shape: the problem, what changed, verification, what is not in this PR, and what needs the client's attention.

> [!WARNING]
> The marketplace's own description already promises some of this: `web-agency` says it covers "launch checks, and domain verification", but only `audit-dns` exists today.

## Ranking

| #   | Skill                                                                                           | Plugin              | Evidence                                                                | Why it ranks here                                                                                            |
| --- | ----------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | [`redesign-section`](#1-redesign-section--mockups-a-pick-and-an-end-to-end-build)         | new `design-studio` | 13 sessions, 11 PRs, 2 repos                                            | Your most frequent loop by far, and its failures (mobile, mockup fidelity, reduced motion) repeat every time |
| 2   | [`map-client-changes`](#2-map-client-changes--client-feedback-to-a-traced-verified-change) | `web-agency`        | 6 sessions, PRs Love #13 #16 #19, MSC #14 #16                           | High stakes (client wording is verbatim), and you asked for the traceability map by hand three times         |
| 3   | [`audit-geo`](#3-audit-geo--what-answer-engines-actually-see)                               | `web-agency`        | 3 repos, 7+ PRs                                                         | Recurs on every site; the answer-engine view is what installed SEO plugins do not cover                      |
| 4   | [`check-responsive`](#4-check-responsive--breakpoint-and-motion-qa-in-the-browser-pane)     | `design-studio`     | 5+ follow-up corrections                                                | Catches the regressions you currently find by eye                                                            |
| 5   | [`check-launch`](#5-check-launch--pre-launch-and-post-merge-checklist)                      | `web-agency`        | promised in the marketplace; env-var and analytics gating in every repo | Fills a gap the plugin already advertises                                                                    |
| 6   | [`audit-type-scale`](#6-audit-type-scale--measure-typography-across-routes)                 | `design-studio`     | 2 sessions, about 8 rounds                                              | A long, expensive back-and-forth that a measurement would settle in one turn                                 |
| 7   | [`wire-inquiry-form`](#7-wire-inquiry-form--server-side-lead-capture-through-resend)        | `web-agency`        | Love #10, MSC #21, MSC guide gate                                       | Same Resend pattern built three times; pairs with `audit-dns`                                                |
| 8   | [`prep-hero-media`](#8-prep-hero-media--video-and-image-prep-for-heroes)                    | `design-studio`     | hero videos on all 3 sites, portrait swaps                              | Media weight was the largest Core Web Vitals finding (19 MB loop, 27.7 MB photos)                            |
| 9   | [`audit-business-facts`](#9-audit-business-facts--one-set-of-facts-on-and-off-the-site)     | `web-agency`        | Tastes #14 #15 #16, stale-hours question                                | Local-business clients need it; nothing installed checks off-site facts                                      |
| 10  | [`add-bilingual-content`](#10-add-bilingual-content--en-and-fr-with-parity-checks)          | `web-agency`        | MSC #8 #16, FR guide still pending                                      | Narrower (one client today), but every MSC change pays the cost                                              |

---

## 1. redesign-section — mockups, a pick, and an end-to-end build

**Why.** This is the work you did most in October: Our Strengths, Contact, Selection Criteria, the Investment Model and the heroes for Miami Square Capital ([#17](https://github.com/HBillaud/Miami-Square-Capital/pull/17) to [#21](https://github.com/HBillaud/Miami-Square-Capital/pull/21)), and memberships, pillars, methodology, testimonials, press and the journal for Love By Eliza ([#17](https://github.com/HBillaud/Love-By-Eliza/pull/17), [#21](https://github.com/HBillaud/Love-By-Eliza/pull/21) to [#25](https://github.com/HBillaud/Love-By-Eliza/pull/25)). The same prompt opens each session. The same corrections close it:

- Mobile is forgotten until you say so ("do not forget to take mobile rendering into account" appears in four prompts).
- The build drifts from the chosen mockup ("in the renderings the text is pinned to the top margin, in your implementation to the bottom").
- A pick touches more than one place ("the pillars also appear in THE ELIZA STANDARD section on the main page").
- Details from the mockup are dropped ("you did not include the revealing signature at the end of the article").
- Reduced motion is requested separately ("with a fallback for reduced motion").

**Design.**

- **Trigger:** "mockups for", "redesign the X section", "motion design ideas", `/design-studio:redesign-section <route> <section>`.
- **Phase 1, read:** locate the section's component and its data file, every other route that renders the same content (grep the data import, not just the component), the design tokens (Tailwind config, `globals.css`) and the live copy from production. Stop and list the twins you found; they are where "I forgot to mention" came from.
- **Phase 2, mock:** publish one Artifact canvas with the current section as artboard 0 and 3 to 6 directions. Each direction ships a desktop and a 375px artboard and a motion note (trigger, duration, easing, and its reduced-motion state). Real copy only, never lorem ipsum; your brand guides (`docs/BRAND_IDENTITY_GUIDE_*.md`) are inputs.
- **Phase 3, contract:** when you pick, write down what the mockup fixes: anchoring and alignment, spacing ratios, every animated element, and the mobile layout. Save it to the scratchpad. This is what the build is checked against.
- **Phase 4, build:** start a branch from `main` (`redesign/<section>`), implement, honor `prefers-reduced-motion`, and keep content in the existing data modules.
- **Phase 5, verify:** run `check-responsive` (skill 4) at 375, 768, 1024 and 1440, then place a screenshot of each breakpoint beside the mockup artboard and check each contract item.
- **Bundled:** `references/motion-patterns.md` (the patterns you liked: the invitation fan, the rose stem, the arches, the sieve, the capital bridge), `references/contract-template.md`, `scripts/find-twins.sh`.
- **Guardrails:** never replace a section you did not name (Testimonials: "do not replace the hero section but CLIENT ENDORSEMENTS"); keep `.claude/launch.json` out of commits.
- **Eval:** a fixture site with a section rendered on two routes; graders check that both were found, that a 375px artboard exists, and that a reduced-motion branch is in the diff.

## 2. map-client-changes — client feedback to a traced, verified change

**Why.** Eliza's feedback comes as emails and pasted documents with exact wording, and her email asked for 20+ distinct edits across nine pages. After the build you asked three separate times for "a 1:1 mapping between changes in the codebase and changes described in the original email" and an audit of what was left out. That audit found real gaps: CMS posts still had em dashes, the press features still said "Love by Eliza", and PR #17's matrix had hidden her tier bullets. The PR format that came out of it ([Love #16](https://github.com/HBillaud/Love-By-Eliza/pull/16)) is good enough to make standard: verbatim copy, a list of fixed typos, "Not in this PR", and "For Eliza's attention".

**Design.**

- **Trigger:** "client email", "website changes from", "client feedback", pasted feedback longer than a few paragraphs, `/web-agency:map-client-changes`.
- **Intake:** from a Gmail search (subject, sender, date), a pasted block, or an attached `.md`/`.docx`. Split it into numbered atomic requests, each with the client's exact text, the target page, and a type: copy, layout, content in the CMS, or question.
- **Plan:** for each request, the file and line it lands on, plus the knock-on places that state the same fact (the FAQ, JSON-LD, `llms.txt`, homepage cards). Flag anything that edits production CMS content or third-party words (press quotes) and ask before touching it.
- **Build:** use the copy verbatim. Fix only typos, and list every one. Whole-site sweeps (no em dashes, brand casing) go through an AST pass over string literals and JSX text so comments stay untouched, as was done for the 121 replacements in #16.
- **Trace:** produce the 1:1 table (request, client text, `file:line`, status: done, partial or deferred) without being asked, and paste it into the PR body.
- **Re-audit mode:** `--against <branch>` re-checks every request against a later branch, to catch a later PR undoing an earlier one.
- **Bundled:** `references/pr-template.md` (Across the site, By page, Keeping the site consistent, Typos fixed, Not in this PR, For the client's attention, Verification), `scripts/replace-in-strings.ts` (the AST sweep).
- **Eval:** a fixture email with 12 requests, one of them a CMS edit and one conflicting with existing copy; graders check the table has 12 rows, the CMS row is deferred, and the conflict appears under "For the client's attention".

## 3. audit-geo — what answer engines actually see

**Why.** All three sites went through the same work separately: `llms.txt` plus `llms-full.txt`, explicit AI-crawler rules, JSON-LD `@graph`s with `sameAs`, and canonical and hreflang checks ([MSC #9](https://github.com/HBillaud/Miami-Square-Capital/pull/9), [MSC #14](https://github.com/HBillaud/Miami-Square-Capital/pull/14), [Love #11](https://github.com/HBillaud/Love-By-Eliza/pull/11), [#12](https://github.com/HBillaud/Love-By-Eliza/pull/12), [#15](https://github.com/HBillaud/Love-By-Eliza/pull/15), [Tastes #10](https://github.com/HBillaud/Tastes-Philippines/pull/10)). The most useful finding, MSC's `/fr` serving an empty English shell that canonicalized to `/en`, came from fetching the page the way a crawler does, not from reading the source. `marketing:seo-audit` and `searchfit-seo` cover keywords and on-page basics; neither renders the as-served view or checks that `llms.txt` and JSON-LD agree with the page.

**Design.**

- **Trigger:** "GEO", "AI search", "answer engines", "llms.txt", "why does ChatGPT say", `/web-agency:audit-geo <url>`.
- **Layer 1, as served:** fetch every sitemap URL with JS off and with GPTBot, ClaudeBot and PerplexityBot user agents; report the visible text length per route (MSC went from 0 to 5,213 characters), `<html lang>`, canonical, hreflang pairs and `noindex`.
- **Layer 2, crawler policy:** `robots.txt` against a maintained list of AI agents, grouped into retrieval and training as Tastes' `robots.ts` does; check that the CDN or firewall isn't blocking them.
- **Layer 3, agreement:** extract the facts from JSON-LD, `llms.txt` and the visible page (name, hours, prices, tiers, FAQ) and diff them. This is the class of bug where #16 had to update tier claims in three places.
- **Layer 4, snippets:** port Love-By-Eliza's `scripts/audit-seo.mjs` (description 135 to 160 characters, title length before the brand suffix, duplicate snippets, ALL-CAPS titles) as a generic script that takes the base URL and brand suffix as arguments.
- **Output:** the same three buckets as `audit-dns` (critical issues, gaps and hardening, unknowns), plus an optional fix-it branch.
- **Bundled:** `scripts/as-served.mjs`, `scripts/audit-snippets.mjs`, `references/ai-crawlers.md` (dated, so it can be refreshed), `references/llms-txt.md` (a single shared source for both briefs, per Love's `lib/llms.ts`), `references/spa-prerender.md` (the MSC approach).

## 4. check-responsive — breakpoint and motion QA in the browser pane

**Why.** Most "fix it" follow-ups after a build were visual and found by you: text cut off as the viewport narrows, alignment against the mockup, the gold underline over the "z" of the signature, and reveal sections stuck at `opacity: 0` (MSC #14 added a guard for it). The sessions already use the browser pane's `resize_window` and `javascript_tool` heavily (43 JS calls and 36 resizes in the pillars session alone), but improvised each time.

**Design.**

- **Trigger:** runs at the end of `redesign-section`, or "check mobile", "regressions between desktop and mobile", `/design-studio:check-responsive <route> [selector]`.
- **Matrix:** 375, 390, 768, 1024, 1280 and 1440 widths, light and dark if the site themes, and `prefers-reduced-motion` on and off.
- **Probes (one injected script):** horizontal overflow (`scrollWidth > clientWidth` on the document and on each element), clipped text (`overflow: hidden` with `scrollHeight > clientHeight`), elements still at `opacity: 0` after scrolling through, tap targets under 44px, images rendered larger than their natural size (the soft 578×812 portrait), and console hydration errors.
- **Output:** a table per breakpoint, screenshots only for failures, and the selector of each failing element. Compare against `main` by running the same probes on the production URL.
- **Bundled:** `scripts/probes.js`, `references/breakpoints.md`.
- **Guardrail:** reset the viewport to desktop afterwards (the pane keeps an emulated size).

## 5. check-launch — pre-launch and post-merge checklist

**Why.** The `web-agency` description promises launch checks and domain verification. The repos show what one should cover: four Vercel env vars for the MSC guide gate (`GUIDE_SESSION_SECRET`, `RESEND_API_KEY`, `GUIDE_LEAD_FROM`, `GUIDE_LEAD_TO`), without which "the gate still unlocks but no lead email is sent"; GA gated to production plus a valid measurement ID; the Tastes `openForBusiness` and `ORDERING_LIVE` flags; security headers in `vercel.json`; permanent redirects for renamed routes.

**Design.**

- **Trigger:** "ready to launch", "go live", "launch checklist", "after merging, is production right", `/web-agency:check-launch <domain>`.
- **Code side:** read `.env.example` and every `process.env.*` read, then compare with the Vercel project's env vars by name (the Vercel MCP `filter_project_envs`, names only, never decrypting values). Also check feature flags still set to pre-launch, analytics mounted on every route (MSC's was home-only), the OG image, favicon family, 404 page and `noindex` left on.
- **Live side:** domain attached and verified in Vercel, TLS, apex and `www` redirect, security headers present, every redirect in `vercel.json` returning 308 to a 200 page, and the latest production deployment built from `main`'s head.
- **Hands off:** call `audit-dns` for mail and DNS, and `audit-geo` layer 1 for indexability.
- **Output:** a go/no-go list in the `audit-dns` buckets.

## 6. audit-type-scale — measure typography across routes

**Why.** On the Miami Square Capital heroes it took about eight turns to align three pages: "I wanted all hero sections to align on the main page, not the other way around, nor an in-between", then "the font sizes still do not look aligned, deep dive into the section dividers, titles and body text". The Guide's body size had already needed its own PR ([#15](https://github.com/HBillaud/Miami-Square-Capital/pull/15)). Measuring once would have settled it.

**Design.**

- **Trigger:** "font sizes don't match", "align typography", "type scale", `/design-studio:audit-type-scale --reference / <routes...>`.
- **Measure:** in the browser pane, at desktop and mobile widths, collect the computed `font-size`, `line-height`, `letter-spacing`, weight and family for each role: hero H1, eyebrow, section label, section title, body, and figures. Classify by semantic tag and class, not by guessing.
- **Report:** a role-by-route table with the reference route marked, and the deltas in px and as a ratio.
- **Fix:** always align to the reference you name (the default is the home page, never an average), preferably by introducing shared tokens or utility classes so the pages cannot drift again.
- **Bundled:** `scripts/measure-type.js`.

## 7. wire-inquiry-form — server-side lead capture through Resend

**Why.** You built this three times: Love By Eliza's three inquiry kinds with attachments ([#10](https://github.com/HBillaud/Love-By-Eliza/pull/10)), the MSC contact redesign ([#21](https://github.com/HBillaud/Miami-Square-Capital/pull/21)) and the MSC guide lead email. The good decisions are already in the code and worth keeping: construct the Resend client lazily so `next build` doesn't crash, treat the dossier to the owner as the submission and the confirmation to the client as a courtesy, carry the inquiry kind into the subject line, and remember that the sender must be on a verified domain.

**Design.**

- **Trigger:** "contact form", "inquiry form", "send with Resend", "lead email", `/web-agency:wire-inquiry-form`.
- **Detect the stack:** a Next.js server action or a Vercel function under `api/`, plus zod or react-hook-form if present.
- **Scaffold:** schema validation shared by client and server, a honeypot field and a minimum fill time, a size budget for attachments, HTML and text templates in the brand's tokens, and an honest failure state: never show a confirmation if the owner's copy failed.
- **Verify:** check the sender domain's Resend DKIM and SPF through `audit-dns`, confirm the env vars exist in Vercel, and send a test when the user approves.
- **Bundled:** `references/delivery-semantics.md`, templates for Next.js and Vercel functions.

## 8. prep-hero-media — video and image prep for heroes

**Why.** Every site has a hero video (MSC [#13](https://github.com/HBillaud/Miami-Square-Capital/pull/13), Love [#18](https://github.com/HBillaud/Love-By-Eliza/pull/18), Tastes [#2](https://github.com/HBillaud/Tastes-Philippines/pull/2)). The biggest performance fixes in MSC #14 were media: a 19 MB loop deferred until after `load`, a poster cut from 2.9 MB to 340 KB, and project photos from 27.7 MB to 720 KB. Portrait swaps from `~/Downloads`, with cropped variants and a too-small source, took a whole session.

**Design.**

- **Trigger:** "use this video as the hero background", "replace the hero image with", `/design-studio:prep-hero-media <file>`.
- **Video:** transcode with `ffmpeg` to H.264 MP4 plus WebM at one or two widths, strip audio, cap the bitrate, and extract a WebP poster from a chosen frame. Wire it in as poster-first (the poster is the LCP element, with `fetchpriority="high"`), load the loop after `load`, and skip it on `prefers-reduced-motion` or `Save-Data`.
- **Images:** report the natural size against the largest rendered size (warn below 2x), generate WebP or AVIF, and keep the previous asset when asked ("Do not delete the current picture").
- **Optional:** write a text-to-video prompt from a reference clip for a generator (the Omni 1.1 Flash session), with a static, slow-camera default for backgrounds.
- **Bundled:** `scripts/transcode.sh`, `references/hero-media.md`.

## 9. audit-business-facts — one set of facts on and off the site

**Why.** After Tastes changed its hours ([#14](https://github.com/HBillaud/Tastes-Philippines/pull/14)), AI agents kept quoting the old ones. The cause was off-site: Google Business Profile, the Toast ordering page, Apple Business Connect, Yelp. The site itself already pulls hours from Toast ([#15](https://github.com/HBillaud/Tastes-Philippines/pull/15)), and the ordering URL changed in Toast without notice ([#16](https://github.com/HBillaud/Tastes-Philippines/pull/16)). Any local-business client has the same exposure.

**Design.**

- **Trigger:** "AI gives the wrong hours", "NAP consistency", "update hours everywhere", `/web-agency:audit-business-facts`.
- **Read:** the site's canonical facts (`src/lib/restaurant.ts`, `lib/site.ts`, JSON-LD `openingHoursSpecification`, `llms.txt`) and every `sameAs` profile it links.
- **Compare:** name, address, phone, hours, ordering and booking URLs across each reachable public profile. List profiles that block fetching (Toast returned 403) as manual checks with the exact dashboard path.
- **Output:** a fact-by-source matrix and an update order (GBP first), plus the repo edits if the site is the source that is wrong.
- **Bundled:** `references/sources.md` (where each platform keeps hours), `references/toast.md` (Toast API scopes `restaurants:read` and the menus scope, link-out-only ordering, and the URL slug).

## 10. add-bilingual-content — EN and FR with parity checks

**Why.** Miami Square Capital is bilingual through a custom `i18n.tsx`, with localized slugs, hreflang and per-locale `llms.txt`. Each new page (Guide, Why Florida) arrived as pasted text in both languages, with "stick to the vocabulary used in both versions". The French guide still aliases English (`docs = { en, fr: en }`).

**Design.**

- **Trigger:** "in both French and English", "new tab in both versions", "translate the guide", `/web-agency:add-bilingual-content`.
- **Ingest:** paired source texts, aligned paragraph by paragraph. Flag any paragraph that has no counterpart instead of translating it silently.
- **Wire:** both dictionaries or locale getters, the route table entry with localized slugs, permanent redirects for unprefixed paths, sitemap and hreflang pairs, and the language switcher mapping slug to slug.
- **Check:** a parity script that fails on keys present in one locale only, on FR falling back to EN, and on hreflang pairs that don't reciprocate.
- **Translate mode:** when only one language is given, draft the other and mark it for client review. Never ship it as final.

---

## Honorable mentions

- **A `.claude/launch.json` guard (a hook, not a skill).** Excluding it from a commit came up in three sessions ("gitignore it", "leave `.claude/launch.json` out"). A small PreToolUse hook on `git add` or `git commit` could warn about it, or the hook could add it to `.gitignore` once. It could live in `session-band` or a tiny `git-hygiene` plugin.
- **A house-style PR body.** The desktop app's Create PR button already handles the mechanics, so the value is only the template from skill 2. Ship it there.
- **A monthly client analytics report.** MSC has a password-gated Vercel Analytics dashboard (`api/analytics/*`). A skill using the Vercel MCP's `aggregate_pageviews` could produce a monthly one-page report per client. No session asked for it yet, so it is speculative.
- **Design-sync notes for Next.js apps.** `.design-sync/NOTES.md` in Tastes records hard-won fixes (module shims, no comment keys in the shim tsconfig, a dark canvas provider). These could become a reference inside `design-studio` if you sync more client design systems.
- **Ignoring Vercel bot comments.** Auto-fix woke up three times just for `vercel[bot]` preview comments (MSC #17, #21; Love #17). This is app behavior, not a plugin, but worth reporting as feedback.

## Suggested packaging and build order

| Plugin | Skills | Notes |
|---|---|---|
| `web-agency` (exists) | `audit-dns`, then `check-launch`, `audit-geo`, `map-client-changes`, `wire-inquiry-form`, `audit-business-facts`, `add-bilingual-content` | Skills that hand off to each other (`check-launch` calls `audit-dns` and `audit-geo`) belong in one plugin |
| `design-studio` (new) | `redesign-section`, `check-responsive`, `audit-type-scale`, `prep-hero-media` | Shares the browser-pane probe scripts; `redesign-section` calls `check-responsive` |

> [!TIP]
> Build order: `check-responsive` first, because it is small, has the scripts the other design skills reuse, and makes the next one better. Then `redesign-section`, `map-client-changes`, `audit-geo` and `check-launch` (which completes what the `web-agency` description already promises). The rest follow as client work calls for them. Give each one an `evals/` case in the shape `agent-config` uses: a scaffolded fixture repository, a prompt, and graders.

## Progress

- [ ] `redesign-section`
- [ ] `map-client-changes`
- [ ] `audit-geo`
- [ ] `check-responsive`
- [ ] `check-launch`
- [ ] `audit-type-scale`
- [ ] `wire-inquiry-form`
- [ ] `prep-hero-media`
- [ ] `audit-business-facts`
- [ ] `add-bilingual-content`
