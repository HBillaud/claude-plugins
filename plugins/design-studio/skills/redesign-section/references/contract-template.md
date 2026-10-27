# Contract: <section> on <route(s)>

Direction picked: **<name>** (<date>), from <canvas link or path>. Mix, if any: <"direction 2 with the numbers from 4">.

Every item is something the build is checked against in phase 5. Write it from the artboards, not from memory, and keep it concrete enough that a screenshot settles it.

## Layout and alignment (desktop)

| # | Item | Mockup says |
| --- | --- | --- |
| L1 | Text anchoring inside its box | e.g. pinned to the top margin, not the bottom |
| L2 | Columns and their ratio | e.g. 5/7 split, image left |
| L3 | Section padding, top and bottom | e.g. 96px / 96px (`--space-6`) |
| L4 | Gaps between items | e.g. 24px between cards, 40px label to title |
| L5 | Alignment lines shared with neighbours | e.g. left edge aligns with the hero title |

## Type

| # | Role | Mockup says |
| --- | --- | --- |
| T1 | Section label | e.g. 12px uppercase, 0.18em tracking, rose |
| T2 | Title | e.g. serif 40/44, weight 500 |
| T3 | Body | e.g. 17/1.6, max 62ch |

## Motion

| # | Element | Trigger | Duration and easing | Reduced-motion state |
| --- | --- | --- | --- | --- |
| M1 | e.g. cards | enter viewport at 20% | 700ms, `--ease-out`, 80ms stagger | visible at rest, no stagger |
| M2 | e.g. signature | after the last card | 1200ms stroke draw | drawn, static |

## Mobile (375)

| # | Item | Mockup says |
| --- | --- | --- |
| R1 | Order of elements | e.g. label, title, image, cards |
| R2 | Layout of repeating items | e.g. one column, numbers inline with titles |
| R3 | What is hidden or changed | e.g. decorative arch hidden; carousel instead of grid |
| R4 | Tap targets | e.g. dots 44px hit area |

## Twins

| # | Where | How it changes |
| --- | --- | --- |
| W1 | e.g. `/` "The Standard" list | same titles, new ordinals from the data module; layout unchanged |

## Easy to drop

| # | Detail |
| --- | --- |
| D1 | e.g. the signature that reveals at the end |
| D2 | e.g. hairline divider between cards, 1px `--line` |

## Out of scope (agreed)

- e.g. the hero above, the testimonials below.

---

## Phase 5 check

| # | ✅ / ❌ | Note (breakpoint, what differs) |
| --- | --- | --- |
| L1 | | |
