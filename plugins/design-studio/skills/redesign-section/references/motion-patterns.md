# Motion patterns

The patterns below are the directions picked in past redesigns: the invitation fan, the rose stem and the arches (Love By Eliza), the sieve and the capital bridge (Miami Square Capital). They are written as reusable recipes. Where a client repository already ships one of them, its component is the reference: read it, reuse its timings, and update the recipe here if the shipped version differs.

## House rules

- **Content is visible without motion.** The hidden starting state of any reveal applies only once script has run and motion is allowed (`html.motion-ok .reveal { opacity: 0 }`, or Framer Motion's `initial` gated on `useReducedMotion()`), and a timeout reveals everything if the observer never fires. A section stuck at `opacity: 0` is the bug this prevents.
- **One idea per section.** A section has one signature motion; everything else is at most a short fade.
- **Durations**: 500 to 900ms for entrances, 150 to 250ms for hover and focus, staggers of 60 to 120ms, never more than about 1.2s before the last item settles. Long, slow motion belongs to backgrounds only.
- **Easing**: ease-out for entrances (`cubic-bezier(.22, 1, .36, 1)`), ease-in-out for scroll-linked motion, no bounce or overshoot unless the brand guide asks for it.
- **Animate `transform` and `opacity` only.** Stroke drawing uses `stroke-dashoffset` on SVG; clip-path reveals are fine on a few elements, never on a long list.
- **Trigger once.** Entrance animations run the first time the element enters the viewport (`threshold` 0.15 to 0.3, `rootMargin: "0px 0px -10% 0px"`) and do not replay on scrolling back up.
- **Scroll-linked motion** (progress-driven) uses CSS scroll-driven animations (`animation-timeline: view()`) where supported, with a static fallback, or a single `requestAnimationFrame` loop; never a scroll handler doing layout reads.
- **Mobile**: the same idea, simplified. Fewer moving parts, shorter distances (16 to 24px instead of 40 to 60), no hover-dependent reveals, nothing pinned that fights the address bar.
- **Reduced motion**: the end state, at rest. At most an opacity fade of 200ms or less. No parallax, no loops, no scroll-linked transforms, no autoplaying video.

## The invitation fan

Cards (tiers, services, offers) start stacked like a closed set of invitations and fan out into a row as the section enters.

- **Trigger**: the section entering the viewport at 25%.
- **Motion**: each card from `translateX(<offset to the stack's center>) rotate(<-6deg..6deg>)` to its place at `rotate(0)`, 800ms ease-out, 90ms stagger from the center outwards. A slight `translateY` lift on hover (4px, 200ms).
- **Mobile**: no fan; the cards stack vertically and each fades and rises 16px as it enters.
- **Reduced motion**: the row at rest.
- **Good for**: tiers and memberships, three to five items with equal weight.

## The rose stem

A single SVG line grows down the section as the visitor scrolls, and each item (a step, a pillar, a value) blooms from it when the line reaches it.

- **Trigger**: scroll progress through the section (scroll-driven `animation-timeline: view()` on the path, or an observer per item).
- **Motion**: the stem's `stroke-dashoffset` from its length to 0 across the section; at each node a small bloom (scale 0.6 to 1 and opacity, 500ms ease-out) and the item's text fading in 12px from the side.
- **Mobile**: the stem runs along the left edge, items to its right, in one column.
- **Reduced motion**: the stem drawn in full, every node and item visible.
- **Good for**: a methodology, a sequence of steps, pillars read in order.

## The arches

Images or panels sit inside arched frames (a rounded top, `border-radius: 999px 999px 0 0`, or an SVG `clipPath`), and the image rises inside its arch as the section enters.

- **Trigger**: each arch entering the viewport at 20%.
- **Motion**: the image from `translateY(12%) scale(1.08)` to rest inside the fixed arch, 900ms ease-out; the caption fades in after 150ms.
- **Mobile**: arches in a single column or a horizontal snap scroller; the same rise, shorter.
- **Reduced motion**: images at rest in their arches.
- **Good for**: testimonials, journal entries, press, portraits; anything with an image per item.

## The sieve

Many items pass through a filter and few remain: the visual form of selection criteria.

- **Trigger**: the section entering at 30%, then a short sequence.
- **Motion**: a field of small items (dots, tiles or labels for the candidates) falls toward a horizontal line; most fade out at the line, the ones that pass continue and settle into a short row below it, where each criterion's label appears beside the stage that filtered them. About 1.2s overall; individual items 400 to 600ms.
- **Mobile**: fewer items in the field, and the criteria as a vertical list below the result.
- **Reduced motion**: the result row and the criteria, with a static count ("12 of 400 properties reviewed meet all five").
- **Good for**: selection criteria, a vetting process, "how we choose".

## The capital bridge

Two columns (the investor and the asset, the problem and the outcome) joined by an arc or a bridge drawn between them, with the stages of the model on the bridge.

- **Trigger**: the section entering at 25%.
- **Motion**: the arc's `stroke-dashoffset` drawn left to right over 900ms ease-in-out; each stage label rises onto the bridge as the stroke passes it (60ms after); the right column's figures count up once the stroke arrives (number tween, 800ms, ending exactly on the stated value).
- **Mobile**: the bridge turns vertical: the columns stack, and the arc becomes a vertical line between them with the stages beside it.
- **Reduced motion**: the bridge drawn, the stages and final figures shown, no counting.
- **Good for**: an investment model, a before and after, a two-sided process.
