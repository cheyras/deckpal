---
date: "2026-08-28"
title: "REVERTED: the keyboard-inset panel (#129). It was worse on the device."
decided_by: "@cheyras, on a real phone. Reverted by Claude (Opus 5)."
areas: ["catalog"]
supersedes: []
---
## 2026-08-28 — REVERTED: the keyboard-inset panel (#129). It was worse on the device.

**Decided by:** @cheyras, on a real phone. Reverted by Claude (Opus 5).

**What was reverted.** #129 lifted the chat panel's floor by the measured
keyboard height and pinned `window.scrollY` at 0, to stop the panel riding
WebKit's reveal-scroll and its slow unwind.

**What it actually did**, reported from the device:

> *"Now the drift is happening while the keyboard is up, and deck e is BEHIND
> the keyboard. It feels incredibly glitchy and just shitty."*

Both symptoms are the same cause and both were foreseeable from the design:

- **The pin fights WebKit continuously.** WebKit re-issues its reveal-scroll;
  the effect resets it every frame; neither wins. The `PIN_GIVE_UP` budget did
  not help, because `pinMisses` resets to 0 every time `scrollY` returns to 0 —
  so a fight the pin keeps *winning* momentarily never counts as a failure and
  the loop never stops. That tug-of-war IS the new drift, and it happens while
  the keyboard is up, which is a phase the old code never had a problem in.
- **His canvas was never lifted.** The panel's floor moved; the character canvas
  is a separate `fixed inset-0 h-[100lvh]` layer and stayed full height. With
  the document held at 0 rather than scrolled, the bottom of that canvas sits
  under the keyboard — so he is drawn behind it.

**The lesson, and it is about verification rather than about keyboards.** The
probe faked `visualViewport` and asserted the panel's floor. It could not
exercise WebKit's reveal-scroll, that limitation was written down in the probe's
own header and in the entry this replaces — and the change was merged and
deployed anyway on a green probe. **A stated limitation is not a mitigation.**
For a defect whose entire mechanism is one engine's behaviour, "verified" means
verified on that engine; nothing else is evidence, and shipping on the strength
of a test that cannot see the mechanism is how two consecutive passes reached
production without fixing what was reported.

**Implications.**
- The original drift is back and remains open. It is the ANIMATED UNWIND after
  dismissal, and the next attempt should touch only that — not the keyboard-up
  path, which worked, and not `scrollY` on a repeating timer.
- Anything targeting this must be checked on the owner's phone against a
  preview deployment BEFORE it is merged. No further keyboard change ships on
  a headless green tick.

