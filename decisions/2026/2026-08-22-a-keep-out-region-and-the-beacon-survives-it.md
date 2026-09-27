---
date: "2026-08-22"
title: "A keep-out region, and the beacon survives it"
decided_by: "Claude."
areas: ["general"]
supersedes: []
---
## 2026-08-22 — A keep-out region, and the beacon survives it
**Decided by:** Claude.
**Decision:** solved positions are clamped into a region whose bands the HOST
measures from CSS and the engine applies. The clamp applies to placements and
**not** to per-frame scroll tracking.

**Why:** his canvas sits above the app chrome deliberately, so excluding the
header from the scrim does not exclude it from him. And the off-screen beacon
exists *because* he can leave the viewport vertically while riding a scrolling
element — an unconditional clamp would hold him at the band for ever and make that
chip unreachable code with nothing failing to say so.

**Implications:** it is a clamp, not a veto — asked to present a nav item in the
header he is pushed down until his head rests on the band, still in the item's
column and still turned back across it. The bottom band is zero while the chat is
open, because his phone park box deliberately overlaps the composer. A band of
zero is no band, so every non-host caller keeps today's behaviour to the bit.

