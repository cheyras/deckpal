---
date: "2026-09-09"
title: "The loupe was measuring in pixels; the thing it magnifies is a card"
decided_by: "Not recorded"
areas: ["catalog"]
supersedes: []
---
## 2026-09-09 — The loupe was measuring in pixels; the thing it magnifies is a card

**Reported by:** @cheyras: *"it's honestly a bit too zoomed in such that when I
have the corner selected and I'm dragging it around and I'm trying to put it on
the corner, it's so zoomed in that I can't even see the actual edges that I'm
trying to line it up with. All I can see is the very tip of the rounded corner."*
Fixed by Claude Opus 5.

### The number, because it settles it

`LOUPE_ZOOM = 5` was a fixed multiplier on `reference` pixels, giving a
`132 / 5 = 26.4 px` window. `reference` is up to 1600 px of whatever resolution
the photo happened to be, so a constant multiplier shows a constant number of
PIXELS and a wildly varying amount of card.

Against the real geometry (`lib/cardGeometry.ts`: a 3 mm radius on a 63 mm short
edge = 4.76% of it):

| reference | card short edge | corner radius | window ÷ radius |
|---:|---:|---:|---:|
| 800 | 560 px | 26.7 px | 0.99 |
| 1200 | 840 px | 40.0 px | 0.66 |
| 1600 | 1120 px | 53.3 px | 0.49 |

**In every realistic case the window was smaller than the corner radius.** Not
"a bit tight" — there was no straight edge in the loupe at all, at any
resolution, ever. The report is the arithmetic.

Worth naming the shape of this failure: nothing broke. The picture was sharp,
correctly aligned, correctly scaled, and useless, because the quantity that
mattered was never checked against the object being magnified. The addition of
the quad's own lines to the loupe the day before made it *look* more useful
while the window stayed too small to contain them.

### The fix: measure in cards

The window is now a fraction of the card's own short edge, taken off the live
quad — the quad's shorter side IS the card's width, which is what a correct quad
means. `LOUPE_CARD_FRACTION = 0.24` spans about five corner radii: the arc, plus
roughly a radius and a half of each straight edge to align against.

That fraction is identical at 800, 1200 and 1600 px of reference, which is the
tell that the card and never the pixel was the right unit.

### And a stepper, because 0.24 is an estimate

Derived from geometry; the reader's number is measured by eye, on their device,
on real cards, mid-session. `LOUPE_STEPS` gives six stops from 12% to 67% of the
card's width (2.5 to 14 corner radii), persisted in `localStorage` — a
preference re-set on every one of two hundred frames is not a preference.

The control sits top-right of the photo view, opposite the orientation legend
and away from the bottom-left corner handle a right-handed thumb would cover it
with. **Mind the sign**: a larger step is a WIDER window and therefore LESS
magnification, so "zoom out" walks the index up.

`LOUPE_SIZE` also goes 132 → 156. A phone can afford it, and it buys resolution
back that the wider window spends.

**Verification:** `tsc --noEmit` clean; `deckpal-web test:scan` 715/715, 0
skipped (6 new in `labeler/__tests__/loupe.test.ts`, which assert the window in
CORNER RADII rather than pixels and pin that the old constant could not have
worked at any resolution); `deckpal-web build` clean. The rendering itself still
wants a device — the arithmetic is pinned, the pixels are not.

