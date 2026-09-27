---
date: "2026-08-20"
title: "The strip at the bottom, and one pace for every leg"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-08-20 — The strip at the bottom, and one pace for every leg

**His feet were being cut off, and the previous pass had written down why and
called it a cost.** Reported as two symptoms: "it's always cut off at the bottom
where the full height of the bottom bar in Safari would be… and then sometimes
he's just cut off a bit at the bottom even in the middle of the screen." They are
one defect. The canvas was `100svh` — the viewport with Safari's toolbars showing
— so the moment they slid away there was a bar's height of visible screen with no
drawing surface in it. The clip line therefore sat well ABOVE the bottom edge,
which is exactly what "even in the middle of the screen" describes.

`svh` was chosen deliberately last pass, over `100lvh`, because pinning him to
the large viewport puts his lower body behind the toolbar whenever it is showing.
Both of those are true, and the mistake was thinking one unit had to serve both
jobs. The canvas is now `100lvh` so coverage never runs out, and he is PLACED
against a `100svh` strut so he never stands behind the toolbar. Both units are
stable; `innerHeight`, the one that moves as the toolbars slide, is used for
neither — which is the rule `viewport.ts` was written to enforce and this keeps.

The projection follows: NDC spans the canvas, not the viewport, so
`viewportToBlender` divides by the surface height while every placement decision
— `parkBeside`'s clamps, `homeCorner`, `beaconRect`, the dolly — keeps the
viewport height. The frustum covers the taller surface through the same off-axis
shift the pinned path already uses, so there is one `setViewOffset` call in the
codebase (`Stage.setViewShift`) carrying both the surface and the scroll drift.
Keeping `camera.aspect` at the FRAME's ratio rather than the surface's is what
keeps pixels square once the two differ. Verified with the two heights forced
apart by 60 px: the canvas bottom stays flush with the screen, his apparent size
follows the stable height and not the surface, and the tracking error stays 0.

**One rate for every leg was the other thing that was wrong.** "Let's make his
foreground to background and vice versa travel even a bit more fast, and let's
make his short travel a bit slower (it feels a little fast currently)." Those pull
in opposite directions, so `TRAVEL_RATE = 2.2` could not satisfy both.

They separate on DISTANCE by an order of magnitude, which is what makes a single
ramp enough. Measured at the shipped framing on a 1280x900 page: a tiny nudge is
0.40 world units, a short hop 1.06, right across the page 2.69 — and a depth
change is 24.4 to 26.9, because the background plane sits at three times the
camera distance. So `travelRate(distance)` ramps from 1.7 to 2.95 and nothing has
to know what KIND of leg it is looking at; a depth change is simply the long end.
Resulting pace: the nudge 242 -> 309 ms, the hop 303 -> 377, across the page
470 -> 553, and a depth change 1424 -> 1062.

`shapeFor`'s cruise is still not the pace knob and still switches at 4 units — the
solver integrates until it arrives, and raising the cruise past about 2x runs the
leg to its 600-frame guard. That remains the reason pace is applied by scaling the
finished track.

**A test premise that was wrong.** "A solved leg is played more than twice as
fast" had been true of every leg and is now deliberately true only of the long
ones; the short legs in that table are the other half of the same review. The
assertion is scoped rather than loosened, and the ramp gets its own test — short
rates below 2.0, depth changes pinned at the top of the ramp, and monotone in
between so nothing speeds up as it gets shorter.

