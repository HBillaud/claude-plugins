# Breakpoints

## The default matrix

| Width | Stands for | Why it is in the matrix |
| ---: | --- | --- |
| 375 | iPhone SE, 12/13 mini, older Androids; the narrowest phone still common | where text overflows and grids fail to collapse |
| 390 | iPhone 12 to 15 and most current phones (393, 412 on Android) | the phone most clients look at the site on |
| 768 | iPad portrait; Tailwind `md` | where two-column layouts start, often too early |
| 1024 | iPad landscape, small laptops; Tailwind `lg` | where navigation switches from a menu button to links |
| 1280 | 13-inch laptops; Tailwind `xl` | the most common desktop size |
| 1440 | 15-inch laptops and desktop monitors | where mockups are usually drawn |

Heights: 812 for phones, 900 otherwise. Short viewports matter for reveals: an observer with `threshold: 0.5` on a section taller than twice the viewport never fires.

## Test the edges, not only the middle

Bugs sit one pixel below a breakpoint, where the narrow layout gets the wide layout's content. Read the site's breakpoints and add `<breakpoint> - 1` for each one it uses:

- **Tailwind** (defaults): `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536; custom ones in `tailwind.config.*` under `theme.screens`, or in v4 as `--breakpoint-*` in the CSS `@theme`. So 639, 767, 1023, 1279.
- **Plain CSS**: `grep -rhoE "@media[^{]*(min|max)-width:[^)]*" src app styles | sort | uniq -c`.
- **Container queries**: `@container` rules depend on the container's width, not the viewport's; probe at the widths where that container crosses each threshold.

`--widths 375,639,767,1023,1440` on the runner adds them.

## What emulation cannot show

- **Real device chrome:** the iOS Safari toolbar shrinks `100vh`; use `100svh`/`100dvh` and check on a phone for full-height heroes.
- **Touch behaviour:** hover states that hide content (a menu that opens on hover only) pass every probe and fail on a phone. Look for `:hover`-only reveals in the section's CSS.
- **Fonts loading late:** the probes wait for `load`; a font swap after that can reflow text. The runner waits for network idle as well.
- **Reduced motion in the browser pane:** neither page JavaScript nor the pane's `resize_window` can change it (`resize_window` sets `colorScheme` only). Use the runner, DevTools Rendering, or the OS setting.
- **A hidden browser pane** renders no frames: reveals never fire there. Show it before probing; the probes return a `warning` when it is not rendering.
- **Class-based dark mode** (`next-themes`, `.dark`, `data-theme`): `prefers-color-scheme` emulation changes nothing until the class flips; set it by hand.

## Tap targets

44x44 CSS px is Apple's guideline and WCAG 2.5.5 (AAA); WCAG 2.2's AA minimum (2.5.8) is 24x24 with spacing. The probe uses 44 because the clients' audiences browse on phones; report a 32px target with generous spacing as a warning, not a failure.
