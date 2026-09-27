---
date: "2026-08-24"
title: "The keyboard, part three: absorb iOS's scroll, do not undo it"
decided_by: "@cheyras (report), agent"
areas: ["general"]
supersedes: []
---
## 2026-08-24 — The keyboard, part three: absorb iOS's scroll, do not undo it

**Decided by:** @cheyras (report), agent

**Decision:** The `scrollTo(0, 0)` pin is replaced by a compensating
`translateY(scrollY)` applied to every fixed layer that rides iOS's
reveal-scroll — the chat panel, its scrim, and the app header. Nothing writes to
the scroll position any more.

**Why:** *"It comes up mostly properly, but then the page slowly moves downward
for a little bit on its own before stopping."*

Latched off the device at 30ms resolution, the frame after the keyboard opens:

```
  0   scrollY 338   vv 377/337   panel top -273
  1   scrollY 0     vv 377/0     panel top 64
```

The pin works — that is what row 1 is — but iOS ANIMATES that scroll over a few
hundred milliseconds on real hardware, and a listener that snaps to 0 fires
against a moving target for the whole animation. The simulator corrects it in
one frame and shows nothing; a phone shows a drift that settles when iOS stops.
Correcting a value someone else is animating always looks like that.

Cancelling it instead has no such failure mode: the panel rides the scroll, so
translating it back by exactly `scrollY` returns it to where it was, and since
nothing touches the scroll position there is no feedback loop and nothing to
settle. Re-latched after the change, every sample from frame 0 to 23 is
identical.

**Implications:**

- **EVERY fixed layer, not just ours.** Compensating the panel alone left a
  strip of empty page where the app header used to be — the same defect one
  element to the left. `.app-header` is borrowed and returned.
- **He follows for free.** It looks like his canvas needs a matching transform.
  It does not: his mark is measured live in client coordinates and projected
  through the canvas's own live origin, so moving the panel moves the park box
  and the projection finds it where it now is. The `canvasOriginY` fix is what
  makes that true.
- **CLEARING IT IS AS IMPORTANT AS APPLYING IT, and the first version got that
  wrong.** `compensate` early-returned when there was no keyboard, so on
  dismissal the transform simply stayed and left the whole app shifted down by
  the height of a keyboard that was no longer there. Caught on device before
  shipping. It now treats "no keyboard" and "not mounted" as the same
  instruction — asked for zero, it clears — and runs on `kbInset` changing,
  because a keyboard closing is not a scroll and the scroll listener never hears
  about it.
- **Verified on both runtimes**, keyboard up and down, iOS 26.5 / iPhone 17 Pro
  and iOS 18.6 / iPhone 16 Pro.
- **KNOWN, MINOR, NOT FIXED:** with the keyboard up on 18.6 a clipped sliver of
  the transcript's top line can draw over the app header, because the panel is
  `z-25` against the header's `z-20` and its box starts at `--app-header-h`
  (64) while the header actually renders taller than that once its safe-area
  padding is counted. Pre-existing geometry, newly visible because a short panel
  finally has content at its top edge. A top fade on the transcript, or making
  the panel's top agree with the header's real height, would close it.

---

