---
date: "2026-08-21"
title: "Deck-E's chat: he stands on the page, not inside the panel"
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["agents","decks","frontend"]
supersedes: []
---
## 2026-08-21 — Deck-E's chat: he stands on the page, not inside the panel
**Decided by:** Claude Opus 5 on behalf of @cheyras.
**Decision:** opening the chat darkens and freezes the page, opens a panel
(bottom-right on desktop, full-screen below the 1068 px `nav` breakpoint), and
flies Deck-E to a spot on the PAGE beside it at his normal size. The panel does
not contain him.

**Why not inside the panel — this was tried and reverted.** The first design cut
a transparent "well" into the panel for him to stand in, reasoning from the
off-screen beacon, which is "a hole, not a picture" with the canvas above it.
That part was right and it works. What does not generalise is the sizing:

**`setCharacterHeight` does not scale him — it dollies the camera.** Shrinking
him to fit a 210 px well moved the camera from 18.26 to 69.18 world units, which
changes the pixel-to-world mapping for the ENTIRE scene, so any position solved
at one distance lands somewhere else at another. `framing.ts` then rotates him
into a per-position view frame — correct for a character standing on a page, and
it reads as a dramatic tilt inside a small box in the corner. Measured
calibration, for anyone who needs it: his on-screen silhouette is about **2.4x**
the `setCharacterHeight` value (170 -> 416 px, 120 -> 289, 90 -> 213, 70 -> 165,
linear across the range), because `BODY_H` is the deck box and the bolts, lid
and eyes sit outside it. Setting it to the pixel height you want lands him at
roughly two and a half times that.

Standing on the page needs no new engine behaviour, keeps one size everywhere,
and reads better: the canvas is above the scrim, so he stays sharp while the page
blurs behind him — he has stepped forward to talk.

**Implications and the things that bit:**

- **One writer for character height.** The chat set it and the host's
  ResizeObserver set it straight back; the observer won because opening the panel
  resizes things. `characterHeightFor()` in `DeckeHost` is now the only caller.
- **Entrance animations need `fill-mode: both`.** Without it the panel was in the
  DOM, `opacity: 1` computed, and invisible in a screenshot — the animation's
  `from { opacity: 0 }` with no retained end state. Same class of bug `Sheet.tsx`
  documents for transforms. Every entrance here now ends in `_both`.
- **`parkOn()` is new** (`dom.ts`), reached by `flyTo(..., { centre: true })`.
  `parkBeside` puts him OUTBOARD of a target with a gap, which is right for
  presenting an element and wrong for "stand here" — it left him ~150 px outside
  a 393 px panel. Verified: target x=1046 -> actual x=1046.
- **`lockScroll`/`unlockScroll` are exported from `Sheet.tsx`** so the overlay
  shares one refcount. Two independent locks race on `body.style` and the second
  to unlock restores a stale position. Note that a held lock pins the body with
  `position: fixed`, so `window.scrollY` reads 0 — anything computing a delta
  against a recorded scroll offset must be released before locking.
- **The button does not load the runtime.** It is a CSS chip in the product's own
  brand hues; the 5.7 MB character warms on pointer-enter/touch or when the page
  goes idle. Verified: the button renders with `window.__decke` still undefined.
- **The transport is hand-rolled**, not `@ai-sdk/react`'s `useChat`. The
  interesting part of the stream is the `data-decke` parts, which must reach the
  engine immediately and never touch the transcript; a reader we own makes that
  split explicit and impossible to break by upgrade.

**Not settled:** his exact stand point. Measured on a 390x844 phone, a requested
`y: 0.3` lands him at about `0.67` — there is a systematic downward offset
(`parkOn` drops him by half a body, and the canvas is `100lvh` against a `100svh`
placement height) that has not been characterised. It looks fine; it is not
understood, and it is the owner's eye that should settle it.

---

