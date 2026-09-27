---
date: "2026-08-21"
title: "The phone chat is glass, and the layout gets out of his way"
decided_by: "user, from a screenshot of the shipped panel."
areas: ["agents","frontend"]
supersedes: []
---
## 2026-08-21 — The phone chat is glass, and the layout gets out of his way
**Decided by:** user, from a screenshot of the shipped panel.
**Decision:** On a phone the Deck-E chat panel has no background of its own —
the scrim below it darkens and blurs the page and the reader can still see where
they are. He shrinks to **half** his page size, parks in the **bottom-left
corner** on a DOM mark the panel lays out for him, and the conversation reserves
a `--decke-gutter` beside him: the composer is indented past him, message boxes
are capped to the width remaining, and his own replies indent while they are
level with him and **animate** back to the left edge once they clear his head.
Messages are bottom-aligned; the reader's are right, his are left.

**Why the gutter rather than a z-index:** he is painted by a WebGL canvas at
z-30, above everything the panel lays out at z-25, and that is not incidental —
it is what makes him one render pass instead of a second copy of the character
inside a box. Nothing the panel draws can ever stack in front of him, so the
column leaves him room instead of fighting for it.

**Implications and the traps found on the way:**
- **One writer for his size.** `characterHeightFor(w, h, compact)` in
  `DeckeHost` is the only thing that sets it, and the chat is an ARGUMENT to it
  rather than a second caller. The earlier version had the panel set its own
  height and every `ResizeObserver` fire — a phone toolbar sliding is enough —
  put the page's value back.
- **Resize, then solve.** `setCharacterHeight` dollies the camera, so it moves
  the pixel-to-world mapping for the whole scene. The chat effect applies the
  height BEFORE solving a destination against it, and restores it before
  `returnHome`.
- **`flyTo(centre: true)` was only honoured by the LAUNCH.** The station kept
  the target, depth and side but not the intent, so the first re-solve answered
  with `parkBeside` and moved him — and `parkBeside`'s edge exception flips him
  to the far side of anything hanging off the screen, so a mark in the
  bottom-left corner threw him a body's width RIGHT, onto the text. Fixed by
  `solvePark` in `dom.ts`: one function, both callers, and `centre` carried on
  the `Station`. Covered by `__tests__/park.test.ts`, verified red-then-green.
- **The mark is his SILHOUETTE, not `BODY_W` x `BODY_H`.** The bolts sit outside
  the deck box and the 3/4 view turns his depth into width. Measured off a
  composite at 390x844: 103 x 136 against a nominal 78 x 107.
- **Bottom alignment is `mt-auto` on the list**, never `justify-end` on the
  scroller — that makes overflow past the start edge unreachable, which has
  already cost this codebase one unusable panel (see the Sheet primitive).
- The panel takes no pointer events on a phone except on the header button, the
  message list and the composer, so a tap on the blurred page dismisses him.
- The chat's animations moved from `fill-mode: both` to `backwards`, per the
  existing rule: `both` retains an interpolated matrix, which makes the element
  a containing block for `position: fixed` descendants.

**Verified** with Playwright at 390x844 against `pnpm dev` (live backend, QA
account) and at 1280x800: his drawn footprint measured inside the mark and on
screen, the gutter and composer inset measured, and the slide observed turn by
turn as each reply crossed his head (`772:110px` -> `552:0px`). Desktop
unchanged: no mark, gutter `0px`.

**Harness note, because it cost three runs and a wrong conclusion:** silencing
`requestAnimationFrame` to stop software-WebGL starving the main thread must
happen AFTER the chat opens. `DeckeHost` schedules the park as
`setTimeout(320)` -> `requestAnimationFrame`, so a no-op rAF means the flight is
never issued at all — and he then stands where he booted, which reads exactly
like a layout bug in the thing under test.

