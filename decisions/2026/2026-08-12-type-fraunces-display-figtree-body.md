---
date: "2026-08-12"
title: "Type: Fraunces (display) + Figtree (body)"
decided_by: "user, after A/B-ing four pairings on real screens."
areas: ["general"]
supersedes: []
---
## 2026-08-12 — Type: Fraunces (display) + Figtree (body)
**Decided by:** user, after A/B-ing four pairings on real screens.

**Decision.** Fraunces for the display role, Figtree for body/UI. Inter is out.
Both are OFL and vendored via `@fontsource-variable`, which matters: this repo
is AGPL and public, so a licensed webfont (the original Gotham idea) could not
be committed at all.

**The display role is PROPER NOUNS**, not "big text": page titles, section
headings, series/set/card/deck/list names, attack names, empty-state headlines.
This was the substantive finding of the trial — used once per page on the h1
alone, a display face reads as arbitrary decoration. Giving it a consistent
role is what makes it a system.

Deliberately excluded from the role: species names in the Pokedex grid (13px —
a serif goes muddy below ~14px, and that grid is thousands of tiny labels), and
stat values/labels, which are data rather than names.

**Two mechanics that are load-bearing, and easy to break later:**

1. `font-optical-sizing: auto`. The display role spans 14px (a card name in a
   table row) to 48px (the landing hero) and Fraunces carries an `opsz` axis. A
   FIXED opsz cannot serve both — high values are drawn for headlines and go
   spindly at text sizes. SOFT/WONK are set via `font-variation-settings`
   WITHOUT naming opsz, because listing it there silently overrides the
   tracking.
2. `.font-display.font-normal → 500` / `.font-medium → 600`. A serif's hairlines
   are its thinnest strokes and light-on-dark thins strokes optically on top of
   that, so Fraunces at 400 reads spindly where Inter at 400 read solid. The
   components keep their semantic weight; only the light display sites lift.
   Specificity (0,2,0) beats Tailwind's (0,1,0) without `!important`.

Letter-spacing is applied by SIZE (h1/h2 only), not by face — tightening 16px
set names made them cramped. Body carries -0.006em because Figtree is drawn a
touch wider than Inter. `tabular-nums` is forced for prices/numbers/counters:
Figtree does not default to tabular and those align in columns.

**Button labels lift one step** (primary/danger → extrabold, secondary/ghost/
dashed → bold). Figtree is rounder and more open than Inter and reads lighter
at the same numeric weight, and labels are short bursts that must hold against
a saturated fill.

**Still available if small text ever feels weak:** Inter is measurably the most
legible face at 11–13px, and this app has a lot of it. The hybrid — Inter for
`text-3xs`…`text-sm`, Figtree from `text-base` up — was offered and not taken.
Reinstating it is one `@import` plus a size-scoped `--font-sans` override.

---

