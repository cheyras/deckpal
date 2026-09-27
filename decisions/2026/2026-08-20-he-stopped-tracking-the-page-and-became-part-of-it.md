---
date: "2026-08-20"
title: "He stopped tracking the page and became part of it"
decided_by: "Not recorded"
areas: ["frontend"]
supersedes: []
---
## 2026-08-20 — He stopped tracking the page and became part of it

The previous entry ended with a specification and no implementation: our frame
costs 5 ms and the browser calls us every 36, so the only fix that survives is to
stop needing a frame in order to track. This is that change, and it landed
differently from the sketch in two ways that were only visible once it was built.

**Document flow, not `animation-timeline: scroll()`.** The sketch offered both.
The bar the reviewer set was "buttery smooth no matter what device is used", and
scroll-driven animations are WebKit-only from Safari 26.0 and only threaded from
26.4 — so that path needs a fallback, and the fallback would then be the thing
that had to be right. Absolute positioning at a document offset needs no feature
detection, no version gate and no second code path: it is how every engine has
laid out in-flow content since before any of them had a compositor. `pageAnchor.ts`
pins the canvas and the highlight layer at the document offset the viewport
currently occupies; from that moment the compositor carries both, at the display's
rate, with no main thread involvement at all. Verified identical under headless
Chromium, WebKit and Firefox: the canvas holds its document offset to the pixel
through 300 px of scroll, the ring's error against its element is 0 at every
sample, and `scrollHeight` does not grow.

It also gets the rubber band for free on **both** engines, including Chrome —
where the offset is deliberately unreadable from script and `followElastic` can
therefore never see it. Content in document flow bounces because the bounce is a
transform on the scrolling contents. Reasoned, not yet measured; noted below.

**Freezing him was wrong, and the measurement that said so.** The obvious
implementation is to stop solving: his document position is constant, so there is
nothing to compute. That is what the first version did, and it silently deleted
the vertical parallax — "at the top of the page it's like he's above the camera,
at the bottom of the page it's like he's below the camera". The cue lives in the
FRUSTUM, not in the quaternion (see `framing.ts`), so nothing in the framing solve
notices its absence, and no test caught it. Rendered side by side at the same
place on screen, the frozen version shows the top of his head where the tracked
one is looking up at him from below.

So the world solve stays, at full rate. What goes is the forced layout — the
element's box inside a pinned canvas is a constant, so `parkBeside` is handed a
cached rect and the camera's frustum is shifted by the drift instead. Measured:
**2.95 forced layouts per frame while tracking, 0.32 while pinned**, and none of
the remainder is per-frame. The division of labour is the point: his POSITION,
which is what the eye reads as chunk, is moved by the compositor at the display's
rate; his PERSPECTIVE, a gradual foreshortening, is updated at whatever rate the
browser gives us, because nobody has ever seen a foreshortening stutter.

**The frustum offset cost two wrong turns, both silent on screen.** First,
`viewportToBlender` unprojects through the camera's CURRENT projection, so
solving before applying the offset double-compensates — he still drew exactly on
his element and still slid off it by one frame's drift (-40 px at 120 px of
scroll, -120 at 240). Second, the offset's SIGN does not affect his position at
all, because the solve inverts through whatever frustum it is handed; what it
inverts is the lighting and the foreshortening, so the wrong sign lit him from
below while he climbed the screen. Both are now pure tests: the pinned solve must
equal the un-pinned solve at every drift, to 1e-6.

**What pinning does to a lagging scroll offset, stated honestly.** The first
version of that test asserted immunity and failed, which was the test being wrong
and worth keeping. `parkBeside` drops him half a body in world Z to stand him on
his feet, and that drop is not along the view ray, so a sheared frustum projects
it slightly differently. Measured at 300 px of staleness: **10.7 px of residual,
against 289 px on the tracked path.** A stale scroll offset used to move him
almost its full value — that is "on a fast scroll he'll lose it entirely" — and
now costs about a thirtieth of a body width.

**On the owner's iPhone**, via the LAN dev server and the instrument:

    PIN    absolute  drift 120px  true 120   y 2241  pin 2121
    TRACK  spread 30.0px  worst 30.0px  now 0.0
    VIEW   inner 821  canvas 781  vv 821  dpr 3

`drift` and `true` agree exactly — the canvas rode the page by precisely the
amount scrolled — and the error settles to 0. The 30 px spread is repeatable and
is at least partly the instrument measuring itself: it reads the element's rect
in its own frame while the runtime read `scrollY` in another, and on iOS those are
two different points of the same gesture. It is NOT established that the number is
entirely artefact, and it is recorded here rather than explained away.

**`?present=<selector>` on the dev page**, because the phone is the only place
this reproduces and it took a dozen mis-aimed taps through iPhone Mirroring to get
from a cold tab to "parked and scrolling" — every time. A URL that arrives already
presenting turns the setup into one paste. That is an instrument, not a feature,
and it earned its keep inside the same session that added it.

**Not verified.** Nobody has driven the phone through a rubber band while pinned,
so the claim that document flow bounces for free is reasoning rather than
measurement on the device that matters. Firefox's `ResizeObserver` is a frame or
two slower to report a reflow than the other two, which the 400 ms backstop covers
and which is why the backstop is still there. And the acceptance test for this
work is a human looking at a phone; the numbers say the mechanism is right, they
do not say it feels right.

