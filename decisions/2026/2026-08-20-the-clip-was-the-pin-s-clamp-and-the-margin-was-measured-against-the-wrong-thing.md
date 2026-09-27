---
date: "2026-08-20"
title: "The clip was the pin's clamp, and the margin was measured against the wrong thing"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-08-20 — The clip was the pin's clamp, and the margin was measured against the wrong thing

The previous entry fixed a real defect — the `100svh` canvas left a strip of
screen with no drawing surface once the toolbar collapsed — and did not fix the
one that was reported. The next review said so precisely enough to name the
cause: "he's still cut off on the bottom. It's whenever he comes in from the
bottom edge. It rectifies itself if I scroll him out of the top edge and then
scroll him back in from the top."

Directional, and self-correcting on a re-entry from the other side. That is not a
CSS unit; that is state, and the state is `pinShift`.

**The clamp was permanent.** The shift is chosen once, at the instant he becomes
pinnable — which, entering from an edge, is the instant he is MOST constrained, so
it lands exactly on its clamp. Nothing revisited it. Measured on a 420x820 page
walking him in from each side:

    from the bottom   shift +194    32 px of surface below his feet
    from the top      shift -277   526 px of surface below his feet

So a bottom entry pinned him one margin from the canvas edge and kept him there
for the life of the pin — and as he scrolled inward the canvas edge travelled up
into the middle of the screen with him. A top entry landed nowhere near its
clamp, which is why the same code looked correct from one direction only, and
why re-entering from the top "rectified" it.

The pin now relaxes back to aligned the moment aligned is legal. Re-pinning is
the ordinary path and is invisible for the same reason the first pin is, so this
is one condition in `syncPinned` rather than a new mechanism.

**And the margin was measured against his body, which is not his size.**
`screenHalf` is half of `BODY_H`, projected. What reaches the canvas is more, and
guessing at how much more was the second half of this defect — 0.6 half-heights
"looked generous". Read back from the rendered pixels, at a half-height of 112:

    idle           21 px above,   25 px below
    happy          65 px above,   26 px below
    card_present   25 px above,   66 px below
    alert_star    136 px above,   46 px below
    card_stash    148 px above,   41 px below

The stash cards and the alert reel ride a long way outboard, so the old margin
was under half of what the worst state needs. 1.6 half-heights covers it with
headroom, and it stays affordable because he is sized from the viewport: his full
height is about 0.3 of it, so the span this demands is around 0.78 of a screen.

Verified by reading pixels rather than by trusting the arithmetic: walking him in
from both edges in `card_stash`, on Chromium, WebKit and Firefox, he never
reaches the first or last row of the canvas while the canvas edge is inside the
visible screen. The distinction matters — reaching the bottom row of a canvas
that is FLUSH with the viewport is just him being half off the screen, which is
what entering looks like, and an earlier version of that check reported it as a
failure.

**What this pass got wrong is worth keeping.** A defect was reported, a plausible
cause was found, fixed, verified, and shipped — and it was a different defect
that happened to produce a similar symptom. The `svh` strip was real and is
genuinely fixed. It was not what the reviewer was looking at. The tell was in the
report all along: "whenever he comes in from the bottom edge" describes a
direction, and a CSS length has no direction.

