---
date: "2026-08-23"
title: "Deck-E's placement beside the composer, and the frame `screenRect` was projecting in"
decided_by: "Claude."
areas: ["agents","decks","frontend"]
supersedes: []
---
## 2026-08-23 — Deck-E's placement beside the composer, and the frame `screenRect` was projecting in
**Decided by:** Claude.
**Decision:** three changes to where he stands and how we know. (1) A
composer-position watch in `DeckeHost` re-parks him when the composer MOVES.
(2) `anchor: 'optical'` with `OPTICAL_OVERLAP = 0.09` of his drawn height,
honoured in `FlyOptions`, the station and `solvePark`. (3) `screenRect()`
converts Blender→three before projecting.

**Why (1):** the empty→conversation transition drops `justify-center`, which
moves the composer 310.5 px without changing the window, the keep-out bands, the
scroll offset, or the composer's own SIZE. Every existing trigger watches one of
those; `ResizeObserver` fires on size and the size is identical. Measured: his
drawn box did not change by a pixel, `resize 0 / setKeepOut 0 / flyTo 0`, and
forcing a station re-solve by hand put him exactly right. The solve was never
wrong, only the trigger was missing. Reported twice by the owner in two
recordings: *"he should have gone down with this and he did not."*

**Why (2):** `anchor: 'bottom'` aligned the composer's baseline to the POINT his
silhouette tapers to — the bottom face of the box in three-quarter view — which
is the owner's *"strictly aligned with his very bottom corner, which makes him
look like he's kind of above the thing."* The corner he pointed at is ~0.25 of
his height. **0.25 does not fit:** in a conversation there are exactly 20 px
between the composer's baseline and the bottom of his canvas at every desktop
viewport, because his height is capped by the composer rather than the window.
Offsets ≥28 px are visibly flat-cut at the window edge, which re-opens the
"cut off" complaint this replaced. 0.09 × 214 = 19 px, clear of his 6 px idle
float and inside the padding. **To go higher up his body the composer must
lift**, which is a `DeckeChat.tsx` change.

**Why (3):** `base` is a Blender-frame vector and `bodySpan` extends it along
Blender's +Z, but the camera is three.js — so the raw projection treated his UP
as the camera's DEPTH. Measured against his silhouette: a 37×51 box for a
character drawn 167×214, about 90 px from where he is. Verified after the fix by
drawing the box onto the page and photographing it; it now lands on him.

**Implications:** `screenRect` had two real callers — the speech bubble's
placement and `himX` in `uiTools`, which decides whether a hop travels via the
background. Both were reading a wrong box, so hop-distance behaviour may shift
slightly; `hopProfile.test.ts` stubs `screenRect` and therefore never saw this.
The dismissal flight was fixed in the same pass: he flew home to a corner 240 px
from the launcher chip, and was scaled to zero on a fixed 520 ms timer during a
~1300 ms trip — a third of the way across, the rest flown by nobody. The timer
is now a 3000 ms guard behind an `arrived` callback, because a guard that fires
first IS the defect.

