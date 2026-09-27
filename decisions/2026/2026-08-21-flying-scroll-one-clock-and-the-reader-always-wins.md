---
date: "2026-08-21"
title: "Flying scroll: one clock, and the reader always wins"
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["general"]
supersedes: []
---
## 2026-08-21 — Flying scroll: one clock, and the reader always wins
**Decided by:** Claude Opus 5 on behalf of @cheyras.
**Decision:** `flyTo(..., { scrollWith: true })` drives `window.scrollTo` every
frame from the flight's own normalised progress, so the page and the character
share one clock. Any scroll the character did not write cancels the drive
immediately.

**Why it had to be built.** "Scrolling should look like flying" was in the brief
and absent from the engine: the only writes to scroll position in
`character/decke/` are two native `scrollTo({behavior:'smooth'})` calls inside
`scrollIntoView()`, reachable only by clicking the beacon chip, and nothing calls
it from `flyTo`, `launch`, `update` or `onArrive`. What existed was the inverse —
the reader scrolls and he follows, via the compositor.

**Why not native smooth scrolling, which this file prefers everywhere else.**
`scrollIntoView`'s comment gives three good reasons for it: eased, interruptible,
and it respects `prefers-reduced-motion` without this module knowing that exists.
All still true — and a native scroll cannot be slaved to a flight's progress,
which is the entire effect. Driving it per frame is what makes the page appear to
move BECAUSE he is moving rather than alongside him.

**The cancel is the important half.** Between frames `window.scrollY` should
equal what the drive last wrote; anything else is the reader's wheel, trackpad or
keyboard, and a driven scroll that fights them is worse than none at all.
Verified: mid-flight the drive had reached 222, a simulated reader jumped to 622,
and the page stayed at 622 for the remainder of the flight.

**Only when it is needed.** The drive arms only if the destination is outside the
middle 60% of the viewport — a target already comfortably in view needs no
scroll, and driving one anyway makes a short hop lurch. `scrollToCentre` clamps
to the document's own range, so a target near either end simply gets as centred
as it can. Verified: 0 -> 2480 on a page with somewhere to go.

**Queued legs inherit the drive** rather than restarting it, so a background-first
journey scrolls once across both legs instead of twice.

---

