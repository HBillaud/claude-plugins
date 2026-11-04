# Motion patterns

The patterns below are the directions picked in past redesigns: the invitation fan, the rose stem and the arches (Love By Eliza), the sieve and the capital bridge (Miami Square Capital). Each recipe is taken from the shipped component, which stays the reference: the pointer under each title says where it lives. Reuse its timings, and update the recipe here when the shipped version changes.

## House rules

- **Content is visible without motion.** Render the finished state on the server; hide a block only on the client, only when motion is allowed, and only when it starts below the fold (Love By Eliza's rule: its top is below 92% of the viewport height). Then a reveal that never fires leaves the content where it was. A section stuck at `opacity: 0` is the bug this prevents (Miami Square Capital's `FadeIn` predates the rule: it renders `opacity-0` until its observer fires).
- **One idea per section.** A section has one signature motion; everything else is at most a short fade.
- **Durations**: 600 to 1000ms for entrances, 300 to 400ms for hover, focus and switching between items, staggers of 80 to 180ms. A whole entrance may take up to about 2.4s when it draws something in stages (the arches). Continuous loops are slow (3 to 6s a cycle).
- **Easing**: a long ease-out for things that arrive (`cubic-bezier(0.2, 0.7, 0.2, 1)`, `cubic-bezier(0.22, 0.61, 0.36, 1)`), a symmetric ease for lines being drawn (`cubic-bezier(0.65, 0, 0.35, 1)`), linear for loops that travel at constant speed. A soft overshoot (`cubic-bezier(0.34, 1.56, 0.64, 1)`) only for small things that unfurl.
- **Animate `transform`, `opacity` and `clip-path`.** Stroke drawing uses `clip-path: inset()` or `stroke-dashoffset`; accordions use `grid-template-rows: 0fr → 1fr`. Glows on `box-shadow` are acceptable on one element (the bridge's hub), never on a list.
- **Trigger once.** Entrances run the first time the block is reached and do not replay on scrolling back up. A data attribute holds the phase (`waiting`, `playing`, then back to `rest` once the last keyframe has landed, so hover transitions are not held by an animation's fill).
- **Scroll-linked motion** writes progress to CSS custom properties and data attributes inside one `requestAnimationFrame` per scroll, against geometry measured on resize only; it never re-renders on scroll. Whatever sits above the progress point is shown, so nothing can be stranded hidden, and the bottom of the document counts as fully scrolled.
- **Ambient loops** (the sieve, the bridge) are allowed for diagrams that explain a flow: negative delays so they are already running on first sight, paused while off-screen (`animation-play-state` from an observer), and removed under reduced motion.
- **Mobile**: the same idea, re-laid for a narrow column, never a squeezed desktop. A row becomes a deck, a swiped row, a vertical rail or a stepper; touch gets a swipe or a tap where desktop had hover.
- **Reduced motion**: the finished state, at rest, or a still frame that tells the same story. No loops, no scroll-linked transforms, no entrance, no autoplaying video. Hover transitions off too (`transition: none`).

## The invitation fan

*Love By Eliza, memberships on the home page: `Love-By-Eliza:components/invitation-fan.tsx`, styles under "the invitation fan" in `app/globals.css`.*

Four membership cards held like invitations: fanned side by side on a wide screen, gathered into a deck on a phone. Choosing one brings it forward and shows its text and its Begin button underneath.

- **Trigger**: once, when the block crosses 92% of the viewport height (an `IntersectionObserver` with `rootMargin: 0 0 -8% 0`, plus a check on `load`). Only a block that starts below the fold is hidden first.
- **Motion**: the cards wait in a pile (`opacity: 0; translateY(2.5rem)`), then are dealt into place: `transform` 1s `cubic-bezier(0.65, 0, 0.25, 1)`, `opacity` 0.6s, staggered `120ms + i × 110ms`; the phase returns to rest after 1.5s. In the fan each card sits at `translateX(slot × 19.5cqi) rotate(slot × 6deg)` around an origin below the card; the chosen one lifts (`translateY(-1.375rem) scale(1.05)`) and its neighbours step aside by 1.75rem. Hover lifts a card 0.625rem; switching cards is a 0.75s transform. The chosen card's text fades up 0.5rem over 0.6s.
- **Mobile** (under 900px): a deck: the chosen card in front, the others peeking above it, rotated ±5deg and scaled down by depth; arrows and pips below; the front card follows a horizontal swipe (48px to turn a card) and springs back otherwise. Layout is pure CSS from `--slot` (fan) and `--depth` (deck) on each card, so choosing moves only transforms.
- **Reduced motion**: the fan (or deck) at rest with the most popular membership chosen; no deal. Choosing still works, without transitions.
- **Good for**: tiers and memberships, three to five items of equal weight where one is recommended.

## The rose stem

*Love By Eliza, the methodology on /philosophy: `Love-By-Eliza:components/rose-stem-methodology.tsx`, styles under `.rose-method` in `app/globals.css`.*

The brand's rose stem grows down the page as the reader scrolls. As its tip passes each stage, two leaves unfurl, the node pulses once and the stage settles in; at the end the stem resolves into a rose that opens petal by petal, and the calls to action follow.

- **Trigger**: scroll position. The tip rides 62% of the way down the viewport; a stage is reached when the tip passes its node, the rose blooms when the tip reaches the end of the stem (or the page is scrolled to the bottom). The client arms it by setting `data-motion="on"` before paint, only when motion is allowed.
- **Motion**: the gold stem is clipped to `--tip-y`; per stage, the leaves scale in with the overshoot ease (the second 120ms later), the node pulses once (1.6s ring), the card fades and rises 1rem (`opacity` 0.7s and `transform` 0.95s, `cubic-bezier(0.2, 0.7, 0.2, 1)`, 140ms delay) and the large numeral fades in as its letter-spacing closes. The rose's 15 petals open over three rings (1.2s each, delays 0 to about 655ms), the core follows at 820ms, the calls to action 1s after the bloom (0.8 to 0.9s). Scrolling back up un-reaches stages, and reaching them again replays the pulse.
- **Mobile** (under 900px): the stem runs down the left gutter with every stage to its right, the stage number moved into the eyebrow. From 900px the stem takes the centre line and the stages alternate sides.
- **Reduced motion**: the default render: the stem fully drawn, every stage visible, the rose open, the calls to action shown. The calls to action also show as soon as a keyboard focuses them, bloom or not.
- **Good for**: a methodology, a sequence of steps read in order, a story with an ending.

## The arches

*Love By Eliza, the pillars: `Love-By-Eliza:components/pillar-arches.tsx` (`PillarArches` on /philosophy, `PillarArchLinks` on the home page's "The Eliza Standard"), entrance hook `components/ui/use-entrance.ts`, styles under "pillar arches" in `app/globals.css`.*

The pillars drawn as a row of arches (`border-radius: 999px 999px 2px 2px`), the same arch as the site's photographs, each with a gold inner line and a Roman numeral. On /philosophy one arch is open at a time and widens to carry its full text; on the home page three equal arches link to their pillar on /philosophy.

- **Trigger**: once, for a row that starts below the fold (`useEntrance`, the same 92% band); `data-entrance` goes `waiting` → `playing` → `rest` after 2.4s.
- **Motion**: each arch's gold line rises (`clip-path: inset(100% 0 0 0)` to `inset(0)`, 1400ms, `cubic-bezier(0.22, 0.61, 0.36, 1)`, `i × 180ms` stagger); the numeral fades up 1.5rem at `400ms + i × 180ms` and the copy at `700ms + i × 180ms` (900ms each); the base line draws from the left (`scaleX`, 1200ms, from 1100ms). Opening an arch on /philosophy: `flex-grow` 0.8s and the hidden text by `grid-template-rows` 0.7s, its opacity 0.4s after 0.25s. Hover lifts an arch 6 to 8px over 0.6s.
- **Mobile** (under 64rem): /philosophy stacks the arches, each open; the home page turns them into a horizontal swiped row with dots.
- **Reduced motion**: the arches at rest, no entrance, all transitions off, no hover lift.
- **Good for**: three to five principles or pillars, testimonials, portraits; anything that should read as part of the house rather than as cards.

## The sieve

*Miami Square Capital, Selection Criteria (PR #20): `Miami-Square-Capital:src/components/Criteria.tsx`, keyframes `sieve-*` in `tailwind.config.ts`.*

A stream of dots (sourced opportunities) runs through one gate per criterion. Most stop at a gate and fall away; a few turn gold and reach the exit ("presented to investors").

- **Trigger**: none: an ambient loop, already flowing on first sight (negative delays), paused while the section is off-screen. The block itself fades in with the site's `FadeIn` (0.7s ease-out, 24px rise).
- **Motion**: 26 dots, each assigned the gate it stops at or "pass". A dot travels to its gate at constant speed (duration `1.4s + share of the lane × 5.4s`), then drops 30px and fades (`sieve-*-drop`, 4s cycle); passing dots ride to the exit and turn gold (`sieve-*-pass` and `sieve-gild`, 6s cycle); easing `cubic-bezier(0.45, 0.05, 0.55, 0.95)`. The exit hub glows (`hub-glow`, 3.2s).
- **Mobile** (under 1024px): the same sieve turned vertical: a rail on the left with the dots running down it, the six criteria listed beside their gates, the exit at the bottom.
- **Reduced motion**: the moving dots are removed (`motion-reduce:hidden`) and a still frame takes their place: 17 dots thinning out gate by gate, the exit hub filled gold, no glow.
- **Good for**: selection criteria, a vetting process, "how we choose", any funnel where most items are filtered out.

## The capital bridge

*Miami Square Capital, How we work (PR #18): `Miami-Square-Capital:src/components/Model.tsx`, keyframes `flow-left`, `flow-right` and `hub-glow` in `tailwind.config.ts`.*

Florida developers on one side, European investors on the other, Miami Square Capital as the hub between them; two lanes carry deals one way and capital the other. The model's steps sit below as cards, with the last one spanning the whole bridge.

- **Trigger**: none for the flow: an ambient loop. The bridge fades in at 100ms and the step cards follow (`FadeIn` with `200ms + i × 80ms` delays, 0.7s ease-out).
- **Motion**: on each lane, three 6px dots travel the full width (navy dots right, the deals; gold dots left, the capital), 3.2s linear, staggered by a third of the cycle, fading in and out at the ends. The hub glows on the same 3.2s cycle (`box-shadow` 0 to 12px). Step cards brighten their border on hover (300ms).
- **Mobile** (under 768px): a vertical stepper instead of the bridge: numbered 44px circles on a line, one step open at a time, opened by a `grid-template-rows` accordion (300ms ease-out), with the line gilded along the steps before the open one.
- **Reduced motion**: the lanes as still hairlines, no dots (`motion-reduce:hidden`), no hub glow (`motion-safe:` only). The stepper is unchanged: its 300ms accordion is a response to a tap, not an entrance.
- **Good for**: an investment model, a two-sided marketplace, any process where two parties exchange through an intermediary.
