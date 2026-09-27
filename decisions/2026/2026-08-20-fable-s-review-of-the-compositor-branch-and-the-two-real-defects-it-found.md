---
date: "2026-08-20"
title: "Fable's review of the compositor branch, and the two real defects it found"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-08-20 — Fable's review of the compositor branch, and the two real defects it found

An independent frontier-model review before merge. It confirmed the coordinate
algebra by hand — the `setViewOffset` composition, `camera.aspect` at the frame
ratio, NDC over the canvas, `worldPerPx` over the viewport, `applyDolly(frameH)`
— and found no fourth sibling to the two frustum bugs already fixed. What it
found instead were failures of the PREMISE rather than of the arithmetic, which
is the more useful half.

**A `sticky` or `fixed` target breaks the premise outright.** The whole hand-off
rests on "his position in document space is constant while he is parked", and a
stuck header is exactly the case where that is false: its document position
changes with every scrolled pixel. Nothing would notice quickly either, because a
stuck element resizes nothing, so the `ResizeObserver` never fires and only the
400 ms poll corrects — a slide-and-snap cycle that is worse than the hand-tracked
path it replaced, which handles these perfectly because their rect is constant in
the space it works in. `parkBeside`'s own edge exception names "the nav over here
on a standard page" out loud, and navs are the canonical sticky element.
`ridesThePage()` now refuses them, beside the existing inner-scroller guard.

**A pin near the end of the document grows the page.** The pinned canvas is an
absolutely positioned box, so any part of it hanging below the document's own end
extends the scrollable range. Measured on Chromium by parking beside a footer:
the page grew by **219 px** of blank space the reader can scroll into, which
snaps shut again the moment he unpins. The earlier claim that `scrollHeight` does
not grow was verified through 300 px of MID-PAGE scroll, where the canvas bottom
is nowhere near the document end — true, and not a test of the case that fails.
`pinWindow` now takes `roomBelow` and refuses rather than overhanging. That costs
nothing where it bites: it bites at the bottom of a page, where there is no
scrolling left to be chunky during.

**Fixing it put a forced layout back, and that had to be caught too.** The room
check needs `scrollHeight`, which forces layout, and the relax check calls it
every frame — precisely the cost this whole restructure exists to remove.
`documentHeight()` now caches it on the same 250 ms TTL `elasticOffset` was
already using for the same read, and both callers share it. Measured with both
`getBoundingClientRect` and `scrollHeight` hooked: **0.04 forced layouts per
frame** while pinned, against 2.95 on the tracked path.

**Three smaller ones, all correct.** The ring layer froze EVERY ring while
pinned, not just the anchored one — `highlightElement` is a design-system
primitive with other callers coming, and the pin says one element holds still in
the page, nothing about any other. `pinToPage` rounded the canvas width up, which
on a fractional viewport overflows the root by half a pixel and lets the page
scroll sideways for the life of the pin; it floors now. And two comments had
become lies: `RectLike` described a derived-rect mechanism the code no longer
uses, and `elementHighlight`'s header still claimed the layer is always fixed.

**Two tests were worthless and one of them was a lie.** "A derived rect parks him
where a measured one would" compared `parkBeside(x)` against `parkBeside(x)` —
the two rects were identical expressions — so it could not fail under any change,
and the mechanism it claimed to check is not what the runtime does. Deleted. The
pin-window tests re-implemented `idealShift` inline with the constants hardcoded,
so they would have stayed green through any edit to the real formula; the
geometry moved into `pageAnchor.ts` as pure exported functions and the tests call
those.

The lesson worth keeping is the shape of what a fresh reviewer found: not the
algebra, which had been measured to death, but the assumptions underneath it —
which targets hold still, and what an absolutely positioned overlay does to the
document it is placed in. Neither is visible from inside the change.

---

