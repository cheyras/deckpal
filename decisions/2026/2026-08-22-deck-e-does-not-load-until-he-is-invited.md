---
date: "2026-08-22"
title: "Deck-E does not load until he is invited"
decided_by: "owner (his stated number-one complaint), executed by Claude."
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-22 — Deck-E does not load until he is invited
**Decided by:** owner (his stated number-one complaint), executed by Claude.
**Decision:** the idle/`requestIdleCallback` warm in `DeckeHost` is deleted. The
character loads on `DeckeButton`'s `onWarm` (pointer-enter, touch-start, focus)
and on `onOpen`, and on nothing else.

**Why:** measured on the wire, **5,905,250 bytes** of character assets were
fetched on every page by every entitled visitor whether or not they ever spoke to
him, plus the ~1.14 MB runtime chunk in a production build. It is a
**restoration, not a reversal**: the launcher is hidden while the chat is open
because "two Deck-Es is the exact thing the whole well design exists to avoid",
and the timer broke that invariant from the other side — the 3D body and the chip
were on screen together in the default state of every page. `vite.config.ts`'s
precache exclusion rests on the premise that "the cost is paid only by whoever
actually opens it", which was false and is now true.

**Implications:**
- A phone has no hover and `touchstart` beats `click` by ~100 ms, so mobile
  trades "already there" for "tap, then wait". Nobody who never taps pays
  anything. The launcher's waking state is load-bearing UI now and stays mounted
  until he has actually arrived.
- Loading finishes at **entry scale 0**. Warming is a hover, so without that a
  visitor who hovered and did not click would have him appear beside his own
  chip — the same defect through the new door.
- **A question asked before he arrives is now held**, shown on the transcript
  within a frame of the press, and asked when he lands. `send` has always begun
  `if (!decke) return`, which was harmless while he was pre-warmed and silently
  dropped the message once he was not.
- Payload reduction is explicitly not part of this. Gate 18 pins the behaviour.

