---
date: "2026-08-20"
title: "Movement-engine pass: the pace, the pop, the phone"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-08-20 — Movement-engine pass: the pace, the pop, the phone

Second review round on the character runtime, from a screen recording. Nine
notes; the interesting thing about them is that four had causes nowhere near
where they were seen.

**The boot "frame skip" was not a frame skip, and not in the pose.** "On the boot
animation when he's done there's a hard jump back into idle... like a frame skip,
and it happens every time." Every authored channel is continuous across that
handoff, and the camera, the anchor and the framing quaternion are byte-identical
either side of it — so the pose crossfade was never the problem. `boot` runs at
`float_amp: 0` and `idle` at `1`, the 320 ms crossfade only ever covered the POSE,
and the float's PHASE keeps advancing while its amplitude is zero. On the frame
boot ended, the hover appeared at whatever point of its cycle it had silently
reached: 0.0174 units of travel in one frame against a 0.0012 ceiling for an
ordinary one, and 0.98 rad on `rx`. Measured as rendered pixels it was a
single-frame spike 13.3x the idle floor. The modulation now rides the same
crossfade the pose does; the spike is 1.8x, which is the hover easing in.

**Pace is not the cruise speed, however much it looks like it.** Travel was
2733 ms foreground, 3067 background, 4200 home, and the ask was "less than half".
The flight solver has no duration input — it integrates a velocity profile until
it arrives — so the obvious knob is `shapeFor`'s cruise. It does not work: the
controller brakes on a stopping-distance law that assumes a continuous velocity,
and past roughly 2x the discrete step overshoots the settle window every frame.
Raising the long cruise 0.08 -> 0.185 turned a 3067 ms leg into 20167 ms, which is
the 600-frame iteration guard exactly. Pace is now `TRAVEL_RATE = 2.2` scaling the
FINISHED track: every velocity scales uniformly, the arc, bow, overshoot and the
reviewed accel:decel asymmetry are untouched, and there is no feedback left to
destabilise. Measured 1277 ms / 1477 / 1909 — 45-47% of what they were.

**And that change shipped a worse bug for an hour.** `sampleTrack` indexed the
track with `(tMs / 1000) * FPS`, which is the same thing as progress ONLY while a
track is played at the rate it was solved at. Scaling `durationMs` broke the
pairing silently: the past-the-end guard fired while the index was still less
than halfway down the samples, so he flew 47% of the leg and teleported onto the
mark on the final frame. Every duration measurement was correct throughout —
1277 ms was really 1277 ms — because the duration was right and the POSITION was
wrong, and nothing was looking at the position. It was found by asking what else
consumed `durationMs`, not by watching him. The sampler now indexes by progress,
which is identical arithmetic at rate 1.

**One viewport, measured once, from the canvas.** Two mobile complaints, one
cause. Measured on iOS 18 Safari: `100lvh` is 760 and `100svh`, `100dvh`,
`innerHeight`, a `fixed inset-0` box and `documentElement.clientHeight` are ALL
678 — an 82 px toolbar, and five of the six metrics ride it. Every part of the
runtime read `window.inner*` for itself, at the moment it needed it: the drawing
buffer, the camera aspect, the dolly that sets his apparent height, the
unprojection, the home corner, the beacon inset. So the buffer was sized from one
number and stretched into a box sized from another, and the two do not update on
the same frame — the transient "he becomes more thin" before the resize handler
catches up and he "snaps back to his proper size". `viewport.ts` is now the single
answer, set once per resize from the canvas's own client box, and nothing under
`character/decke/` may read `window.inner*` again. The canvas is pinned to
`100svh`: `svh` and `lvh` are both stable and only `svh` keeps him out from behind
the toolbar, which `lvh` does not (checked on the simulator). A resize that
changes nothing now returns early, because Safari's toolbars fire `resize` on
every fast scroll and the debounced re-park behind it launches a FLIGHT — that is
"he's down lower and then he has to re-travel up to the element".

**Overscroll cannot be followed, so it is prevented.** "When I scroll beyond the
limit, that highlight and him don't go down with it." Because they cannot: elastic
overscroll is done in the compositor, the content is drawn translated without
anything in the document model moving, and both live in `position: fixed` layers.
Measured past the top of a document through a synthesised compositor gesture,
every metric a follow could read is pinned flat — `scrollY` 0,
`getBoundingClientRect().top` 0, `visualViewport.offsetTop` 0 and `.pageTop` 0.
There is no offset to read. The disagreement is removable even though the bounce
is not observable: `overscroll-behavior-y: none` while he is mounted, restored on
dispose. It is his constraint, not the app's.

**The vertical cue is clamped, and the beacon has none.** The parallax is a
function of where he is on the page and the page is taller than the window, so an
unbounded rule kept tilting him further the further he scrolled past the edge —
"we're like looking at him almost completely from the top down here". It is now
clamped to half the vertical fov, which IS the frame edge, so nothing inside the
window changes and the angle simply holds once he leaves. Clamped on `e`, not on
`e - e0`: they differ by the staging ray's own elevation, and clamping the
difference starts cutting the cue while he is still on screen — the existing
framing test caught that within one run. The beacon chip re-solves at
`pitchFollow = 0` and renders him at the staging elevation: measured 0.00 deg of
swing over a ±14-unit sweep, against 38.19 for the main view.

**The stash float is 42% of what it was**, measured rather than asserted: mean
peak-to-peak travel per card over a full 0.27 Hz cycle in the hang, 0.3676 units
before and 0.1534 after. `hz` was deliberately not touched — velocity here is
amplitude times frequency, so cutting the amplitude already cut the speed by the
same factor, and slowing the sine as well would have taken the motion out twice.

**A note on measuring this character at all.** Headless Chromium runs
requestAnimationFrame at about ONE TICK PER SECOND, so his own loop is
effectively frozen: `d.elapsed` advances 0.1 s per wall-clock second and he never
leaves `boot`. Any harness that flies him somewhere and then `await`s is measuring
a still frame and will report whatever the first frame happened to be — the first
attempt at the float numbers above came back as 2.81 units with old and new
constants within 2% of each other, which is the deal-in flight frozen mid-air and
not a float at all. Everything here is measured by stopping the loop and stepping
it (`d.stop()`, then `d.elapsed += 1/60; d.update(1/60)`), which is deterministic
and is the only way these numbers mean anything.

**Colour was the tone curve, not the lights.** "The card art feels a little bit
washed out... I don't know that I would turn down the light strength." It is AgX:
against a synthetic sRGB patch chart the mean deltaE76 is 38.4 and saturated
primaries lose 25-65 points of HSV saturation, and turning tone mapping off alone
takes it to 5.6. Environment intensity and the 0.25 emissive lift each move it by
under 2%. So the lights were right and the response curve was the whole of it.

`toneMapped = false` on the CARD FRONTS ALONE — never on the character, whose
whole calibration is against Blender's own AgX render and must not move. That
alone clips, though: skipping the curve skips its highlight rolloff, and 4.6% of
card pixels blew to a flat 255. Environment intensity does not touch that (swept
1.0 -> 0.4, no change) because the emissive term is additive and uncapped once
the curve that used to absorb it is gone. Only `CARD_EMISSION_STRENGTH` does:
0.25 -> 0.06 takes clipping to 0.44% and costs deltaE 5.6 -> 8.8, which is the
right side of that trade — 8.8 is still a quarter of what shipped, and a blown
white slab is a defect where a small hue error is not.

**The sheen was already there and could not be seen.** "Give them a little bit of
sheen, like they've got a little bit of sheen to them, so they look like real
cards." Every `Card_Front_*` material already carries clearcoat 0.35 and
iridescence 0.9 — there is no foil/non-foil split in the asset or in `CardArt`,
which has no rarity field, so the "foil" treatment is simply what every card
gets. The mechanism works (pushed to clearcoat 1.0 it gives a clear
angle-dependent 15-24/255 lift over a 40 degree arc) and at 0.35 it is worth
single-digit luminance points — real, and completely invisible underneath a curve
that was flattening the whole card anyway. Nothing was added: a genuine
foil-versus-plain distinction would need the catalog's rarity to reach the
character, which is a `cardArt.ts`/`cardSource.ts` change and a product decision,
not a material constant to guess at.

**Three things the code review caught, one of them mine.** Pinning the canvas to
`100svh` split the beacon: `beaconRect` is top-anchored from `viewHeight()` and
the DOM chip was positioned with CSS `bottom`, which resolves against the LAYOUT
viewport — the same 82px, and this time as daylight between the hole in the chip
and the character drawn into it, with no way to close it because the canvas ends
above where the chip is. `beaconRect`'s own comment claims "one function so the
two can never disagree by a pixel"; the chip now actually uses it. The command
path's `card_stash` default awaited up to three serial network rungs with no
bound, on the surface an agent drives and inside a serialized turn — now bounded
at 700 ms, the same as the dev page always was. And `devicePixelRatio` was never
observed at all: moving a window to a second display changes it without changing
the canvas's CSS box, so the ResizeObserver never fires and he keeps rendering at
the old resolution. That one is pre-existing and its fix is UNVERIFIED — Chromium's
device-metrics override changes `devicePixelRatio` and updates `matches` on a
`resolution` query but fires no `change` event, and a `device-pixel-content-box`
observer does not fire under it either, so the emulator cannot exercise the path.

**Not fixed, and why.** The residual iOS scroll jutter is a frame-rate problem
between a compositor-driven scroll and a JS-driven character in a fixed canvas,
and one frame of lag is structural there. The re-travel half of it is fixed above.
The bounce-following half of the overscroll note is prevented rather than
followed. Neither the toolbar collapse nor a momentum scroll could be exercised
this pass: `xcrun simctl` has no input injection, so the metrics above are from
the real engine at rest and the gesture behaviour is unverified.


