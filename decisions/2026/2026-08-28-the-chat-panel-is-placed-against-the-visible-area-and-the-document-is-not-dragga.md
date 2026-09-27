---
date: "2026-08-28"
title: "The chat panel is placed against the visible area, and the document is not draggable while you type"
decided_by: "Claude (Opus 5), on the owner's report: *\"Odd scroll-up"
areas: ["agents"]
supersedes: []
---
## 2026-08-28 — The chat panel is placed against the visible area, and the document is not draggable while you type
**Decided by:** Claude (Opus 5), on the owner's report: *"Odd scroll-up
behavior, and when the keyboard comes up, deck-e doesn't just stick with the
composer — he ends up higher on the page and then hops"*, with the instruction
that the fix be based on standard practice and verified by piloting a
simulator.

**Decision:** Two changes, replacing the `bottom`-nudging of #129 and its
revert-successor, both of which are deleted.

1. **`panelViewport.ts`** places the phone panel by writing `top` and `height`
   from two measurements taken off the app header — where a `fixed; top: 0` box
   currently lands, and `visualViewport.height`. The panel covers the visible
   area rather than being offset by a keyboard-shaped number.
2. **`panelScrollLock.ts`** refuses a one-finger drag inside the panel while
   the composer has focus, when nothing between the touch and the panel can
   absorb it. A transcript with messages in it still scrolls.

### Why the previous two attempts could not have worked

Both described a KEYBOARD. The thing that moves is a `fixed` LAYER.

iOS does not shrink the layout viewport for the keyboard; it scrolls the
document to reveal the focused input and lets `fixed` layers ride that scroll.
The panel therefore lands on the keyboard *by accident*, and stays there only
until the reader flicks. Measured on iPhone 17 Pro / iOS 26.5 with the
instrument now checked in as `KbDiag.tsx`:

| | `scrollY` | `visualViewport.height` | panel bottom |
|---|---|---|---|
| at rest | 1 | 714 | 714 ✓ |
| composer focused | 338 | 377 | 377 ✓ |
| one flick later | 436 | 377 | **279** ✗ |

The keyboard never moved. The composer went 98px up the screen.

**It cannot be corrected after the fact, and this is the finding that settled
the design.** With a rule drawn on the glass at each candidate coordinate, once
the document has scrolled past iOS's own reveal, BOTH `visualViewport.height`
AND `window.innerHeight` under-report the visible area by exactly the extra
scroll — both rules land under the composer instead of on the keyboard. There
is no number left on the platform that says where the keyboard is. (Related to
the iOS 26 regression in Apple Developer Forums 800125 / WebKit #297779.) So
the scroll has to not happen.

`#129` was right that the scroll is the mechanism and wrong to pin `window.scrollY`
against WebKit every frame. Nothing here writes or pins a scroll position: a
gesture is refused with `preventDefault`, which is what every scroll-locking
drawer on the web does, and WebKit's own reveal is programmatic and unaffected.

### What was tried first and rejected

- `interactive-widget=resizes-content` — still unimplemented in Safari (WebKit
  #259770). `navigator.virtualKeyboard` — Chromium only.
- `bottom = innerHeight - visualHeight - offsetTop`, the formula the web repeats
  to each other. On iOS `window.innerHeight` tracks the VISUAL viewport, not the
  layout one, so on the device it reads -268 in the state it was written to
  leave alone; only its own sanity clamp stopped it moving anything. It never
  fired in the case it existed for.
- `overscroll-behavior: contain` alone, because one CSS line beats a listener.
  Measured: the document still scrolled to 445. Safari does not honour it for
  chaining to the document. The class stays as correct intent; the lock is the
  guarantee.

### Verified

Piloted on both installed runtimes, keyboard up and down, scrolled both
directions, dismissed: **iPhone 17 Pro / iOS 26.5** and **iPhone 16 Pro /
iOS 18.6**. `scrollY` now holds at its reveal value through a flick in either
direction; the panel's floor stays on the keyboard; its ceiling stops being
several hundred pixels above the visible area, which also fixes the greeting
drawing itself over the app header. Filmed at 60fps and read frame by frame,
he does not hop: he is at his final position on the first frame of the
transition and holds it for the keyboard's whole slide-up.

**Not verified on device:** a long transcript scrolling under the lock — this
machine's dev server could not reach the live backend, so no conversation could
be created. `absorbs` is unit-tested for it; the DOM walk around it is 15 lines.

### Follow-up, same day: he trailed the panel, then overshot it

The owner filmed the fixed build on his own phone: the first keyboard-up was
clean, the second had him slide up too far and hop back down. Read frame by
frame at 60fps, the shape was not a bad number — it was a race:

- iOS **animates** the visual viewport up over ~200ms rather than jumping, so
  the panel is re-placed every frame for the length of the keyboard's slide.
- `DeckE` marked his station dirty on document `scroll` and on `resize` only.
  Neither fires during that animation. **`update()`'s own comment claimed a
  `visualViewport` listener that had never existed.** So for ten frames he
  trailed ~150px below the composer, then whatever re-park did fire landed on a
  box measured mid-animation and put him ~190px above it, and he eased back
  down. Whether you saw it depended on where the re-park fell — hence one clean
  entrance and one bad one.

Two changes: `DeckE` now listens to `visualViewport` `resize` and `scroll` (the
comment is true now), so he re-solves from the live rect each frame and TRACKS
rather than flies; and the panel's geometry is written as two CSS custom
properties in the event handler instead of through React state, so it lands in
the same frame as the viewport it was measured from rather than a render later.
React keeps the expressions and their authored fallbacks; the effect owns only
the variables, so the two never fight over one declaration.

Filmed again on the simulator, both entrances: he holds a constant offset to the
composer for the whole slide. No trail, no overshoot, no hop.

