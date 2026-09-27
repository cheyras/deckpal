---
date: "2026-08-20"
title: "The iPhone measurement: it is not our frame, it is the browser's"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-08-20 — The iPhone measurement: it is not our frame, it is the browser's

Second pass on the two things the last round did not fix, this time with the
character running on the owner's actual iPhone over mirroring, and with an
instrument on the page (`/dev/decke?diag=1`) because that device has no console
a harness can drive and headless Chromium runs rAF at about 1 Hz.

**The numbers, from the phone.** Idle, nothing tracking, no flight in the air:

    FRAME  37/s   p95 gap 36.0ms   worst 358ms
    OURS   tick p95 5.0ms   worst 7.0ms   render @2x
    VIEW   inner 781  canvas 781  vv 781  dpr 3

Our whole frame — update, render, the beacon's second pass — is **5 ms**, and the
browser calls us every **36**. We spend 31 ms of every frame idle. He is not
fill-rate bound, he is not CPU bound, and no amount of making the loop cheaper
can close a gap that exists above our code.

That was worth proving rather than assuming, and the proof cost a wrong turn:
the obvious move was to cut fill rate, so `maxPixelRatio` went from 2 to 1.5 —
44% of the pixels at `dpr 3`. The frame interval did not move by a millisecond
(37.0 -> 36.0 ms p95, inside the noise), and the tick was 5.0 ms either way. The
cap was reverted. A quality reduction that buys nothing measured is the same
mistake as tuning the fan against a proxy, and it is recorded here so the next
person does not reach for it either.

**So the tracking fix is architectural, and it is now specified rather than
guessed.** The page scrolls on WebKit's own scrolling thread at the display's
full rate; the character is redrawn by `requestAnimationFrame` at whatever the
device feels like giving — 27 fps here, on a phone that is not in Low Power Mode.
Nothing that reads a rect and snaps a scene inside a rAF callback can track a
120 Hz compositor scroll. The fix is to stop needing a frame in order to track:
while he is parked on an element and on screen, his position in DOCUMENT space is
constant, so the canvas can be handed to the compositor — a scroll-driven
animation (`animation-timeline: scroll()`, WebKit since Safari 26.0, threaded
since 26.4) or document-flow positioning — and his world position solved once at
park instead of every frame. The complication that has to be designed around, not
discovered later, is the beacon: its inset pass draws into the canvas at the
chip's coordinates, so the canvas must be viewport-fixed whenever the chip is
showing. Parked-and-visible is compositor mode; everything else stays as it is.

**Overscroll is followed now, where it can be.** The last round concluded it was
unobservable, and that was right for Chrome and wrong as a general statement.
Chrome's rubber band is a compositor paint transform that never touches the
layout tree — `scrollY` is clamped, and `FixedElementsDontOverscroll` shipped
deliberately in 2022 so a fixed layer is pinned through it by design. WebKit is
the opposite and MDN says so plainly: "Safari responds to overscrolling by
updating scrollY beyond the maximum scroll position". So the answer is per-engine
and the code does not have to pick one: `elasticOffset()` returns the offset
where it exists and zero where it does not, the canvas and the highlight layer
take the same `translate3d` so they cannot disagree with each other or with the
page, and the `overscroll-behavior-y` lock is now a FALLBACK that releases itself
the first frame an engine admits to a bounce. Chrome keeps the lock, which is
correct there; WebKit gets its bounce back and the character rides it.

**Not verified.** The bounce-following was measured into place on Chrome (offset
always 0, lock stays) but the phone had not been driven through a rubber band at
the time of writing — the `OVER` line in the instrument reports it the moment it
happens. And macOS Safari is known to move `position: fixed` elements during the
bounce itself (an open WebKit bug, five years unresolved); if it does, the
translate would double there. Both are one reading of the instrument away.

