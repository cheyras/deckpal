---
date: "2026-08-24"
title: "The keyboard, part four: stop, and accept the scroll"
decided_by: "@cheyras"
areas: ["general"]
supersedes: []
---
## 2026-08-24 — The keyboard, part four: stop, and accept the scroll

**Decided by:** @cheyras

**Decision:** Revert `DeckeChat.tsx` to its 2026-08-24 "canvas origin" state.
Removed: `kbInset` and the panel's keyboard-fitted floor, the `scrollTo(0, 0)`
pin, the compensating `translateY(scrollY)` on the fixed layers, the non-passive
`touchmove` refusal, `overscroll-contain` on the transcript, and the `min-h-0`
changes that only existed to make a short panel survive. Kept: the canvas-origin
projection fix, the `overflow: hidden` page hold, `holdElastic`, and
desktop-only auto-focus.

**What we give up, deliberately:** with the keyboard up the reader can scroll the
panel further than there is anything to see. That is the behaviour this whole
chain of fixes was chasing.

**Why:**

> *"Every fix we do makes some issue somewhere else. Now we have a drift after a
> message is sent and the keyboard goes away. Let's just not care about having
> the ability to scroll down further when the keyboard is up. I think I was
> getting too in the weeds with needing that to be gone. It was really fine
> before we started trying to fix that."*

The record supports the call exactly. Fitting the panel to the keyboard required
pinning the scroll so the two would not compound; pinning fought a gesture, so
the gesture had to be refused; refusing the gesture needed the transcript
exempted, which needed `min-h-0` and `overscroll-contain`; and the pin still
fought iOS's ANIMATED scroll, which needed a compensating transform on three
fixed layers, which needed its own teardown, which had its own bug, and produced
a new drift on send. Six mechanisms deep, each one load-bearing for the last, all
of it in service of a scroll nobody minded.

The cost/benefit inverted somewhere around the second mechanism and nobody
noticed because each individual step was justified by the step before it. The
owner noticing from outside the stack is the correction.

**Implications:**

- **The canvas-origin fix stays and is untouched.** It is the one that fixed the
  reported bug — he vanished and drifted at twice the page rate because
  `viewportToBlender` assumed the canvas sits at client (0,0). Everything
  reverted here was built on top of that, not part of it.
- **iOS's reveal does the work again, and it is not always reliable** — measured
  firing on one tap and not the next. When it does not fire, the composer is
  behind the keyboard until the reader scrolls or dismisses. That is the
  accepted cost, and it is what "it was really fine before" refers to.
- **Verified after reverting**, on iOS 26.5 / iPhone 17 Pro and iOS 18.6 /
  iPhone 16 Pro: opens with no keyboard, tapping the composer puts it above the
  keyboard with him beside it, typing works, dismissing restores exactly, and
  there is no drift on send.
- **The follow-ups this closes rather than defers:** the `z-25`-over-header
  sliver from part three only existed because the panel got short. There is no
  short panel now.

