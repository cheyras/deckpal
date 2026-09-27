---
date: "2026-08-24"
title: "The keyboard, part two: the panel fits, and the scroll is pinned"
decided_by: "@cheyras (report), agent"
areas: ["general"]
supersedes: []
---
## 2026-08-24 — The keyboard, part two: the panel fits, and the scroll is pinned

**Decided by:** @cheyras (report), agent

**Decision:** Reverses the "let the platform reveal it" call from earlier today.
The panel now fits above the keyboard by construction, and three things make
that hold:

1. `kbInset` — `documentElement.clientHeight - visualViewport.height`, rejected
   unless the page is unzoomed and the occlusion is plausibly a keyboard —
   moves the panel's FLOOR. `offsetTop` is still deliberately absent.
2. The document's scroll is PINNED at 0 while the chat is open. A `scroll`
   listener snaps it back, because `overflow: hidden` stops the reader and does
   not stop iOS.
3. The empty-state transcript may shrink: `shrink-0` became `min-h-0`, and the
   populated case gained `min-h-0` beside its `flex-1`.

**Why:** *"I can still scroll down a bunch and create a pretty big gap when the
keyboard is up."*

The earlier entry concluded that iOS's reveal-the-focused-input scroll produces
the right result on its own, and left it alone. Measured again on an iPhone 17
Pro / iOS 26.5, that is only true SOMETIMES: the same tap on the same build
reveals on one attempt and does nothing on the next, leaving the composer behind
the keyboard with the panel's empty upper half on screen. That empty half is the
"gap" — it is not a spacer, it is the transcript's unused space seen because
everything in it is below the keyboard. A behaviour that works on most attempts
is not a layout.

So the panel fits on its own now, which was tried and rejected earlier in the
day for a good reason: iOS reveals whether or not the input is already visible,
so the resize and the scroll compounded and put the composer near the top of the
screen. Pinning the scroll removes that second term. With the panel already
correct, the reveal has nothing to reveal and the snap-back is invisible.

**Implications:**

- **`min-h-0` was the hidden requirement, and it is worth stating plainly.** A
  flex item's automatic minimum size is its content, so `flex-1` alone will not
  shrink past it and an `overflow-y-auto` child never gets to scroll. The empty
  state was additionally `shrink-0`, which refuses to give up any height at all.
  In a full-height panel neither mattered; in a short one the greeting rode up
  THROUGH the panel's own header and the two drew on top of each other — which
  is the "top chrome of the chat is intersecting with stuff" from the report,
  finally explained. It was never a positioning bug.
- **`reflow` needed `kbInset` too, and `composerTop` was not enough.**
  `composerTop` is measured from the panel's floor, so it does not change when
  the floor itself moves — the one case that moves the park box relative to the
  transcript. Without it every `data-clear` decision went stale the moment the
  keyboard opened and he was drawn over the greeting.
- **Verified on BOTH runtimes with a real software keyboard.** iOS 26.5 /
  iPhone 17 Pro and iOS 18.6 / iPhone 16 Pro: opens with no keyboard; tapping
  the composer fits the panel above the keyboard with him beside it and the text
  indented clear of him; three hard scroll attempts in each direction move
  nothing; dismissal restores exactly. The stranding recorded in the previous
  entry is also gone, since the document no longer scrolls at all.
- **The canvas-origin fix from the previous entry is still the load-bearing
  one.** Everything here is layout; without `canvasOriginY` he would still be
  drawn 268px above his mark the moment anything scrolled.
- **Vite served stale modules twice more during this pass**, silently
  invalidating two experiments — a panel that "did not shrink" was a panel whose
  code had never reached the browser. Restart the dev server and confirm with
  `curl … | grep -c <newSymbol>` before believing any on-device result.

### 2026-08-24, same day — refuse the gesture, do not correct it

*"It keeps trying to snap back down while scrolling so it flickers back and
forth in a way that feels glitchy."*

The scroll pin added above is a CORRECTION: the page moves, then it is put back.
That is invisible for the single scroll iOS performs on its own, and awful for a
drag — the finger moves the page, the listener yanks it home, and the two race
for as long as the gesture lasts. A correction cannot answer a continuous
gesture. The gesture has to not scroll in the first place.

So a `touchmove` listener with `passive: false` refuses it. The non-passive flag
is the whole trick: a passive listener may not call `preventDefault`, and iOS
11.3+ makes document-level touch listeners passive BY DEFAULT — which is also
why this is a real `addEventListener` and not a React prop, since React attaches
at the root, passively. The pin stays for iOS's own programmatic scroll, where
there is no gesture to fight.

THE TRANSCRIPT IS EXEMPT, because it is the one thing that should scroll. The
test is "did the touch start inside it, and does it actually have somewhere to
go" — a transcript shorter than its box would otherwise chain its unused scroll
to the document, which is the same drag by another route. `overscroll-contain`
on the element closes the other end of that: chaining when it hits its limits.

Verified on both runtimes: dragging outside the transcript moves nothing at all
(no movement, so nothing to snap back), dragging inside it scrolls the transcript
smoothly and the page stays put.

---

