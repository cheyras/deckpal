---
date: "2026-09-04"
title: "The follow bridges rebirths; the clutter gate keeps its trade"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-09-04 — The follow bridges rebirths; the clutter gate keeps its trade

Round 5 of the e2e drive proved the display fix (reticle centre within 0.2px,
painted quad = canonical quad to 0.01px) and exposed what the identity-gated
region follow costs: the tracker re-ids a continuously present card every few
seconds, a region anchored to the dead id freezes, expires under the card,
and duplicates follow (same clip as round 4: captures 5 to 10, regionsExpired
3 to 9). Fix: REGION_BRIDGE_MS=1.5s — a track standing on a region within
the bridge of the card's last sighting re-anchors it (a rebirth); past the
bridge nothing adopts (a swap). Sized between the tracker's 240ms grace and
the owner session's 3.6s fastest measured swap; the first-swap fence and all
eight rescued manual presses hold in the replays.

Rejected with numbers: the round-5 recommendation to restore the saturation
gate to 0.13 (envelopes sit at 0.092-0.093, drive cards at 0.328+). The owner
session recorded four REAL cards at 0.079-0.126 — below the envelope band —
so no scalar separates mail from dull cards, and refusing real cards silently
is the worse failure. 0.06 stays; two mail captures per clutter pass remain
the priced, swipe-dismissable trade.

