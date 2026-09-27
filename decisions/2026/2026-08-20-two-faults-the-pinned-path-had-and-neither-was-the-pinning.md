---
date: "2026-08-20"
title: "Two faults the pinned path had, and neither was the pinning"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-08-20 — Two faults the pinned path had, and neither was the pinning

Review of the compositor change above: *"It's fucking GREAT — for the most part."*
Two defects, both mine, both introduced by the change and neither by its idea.

**He went to the wrong place when the target changed, then snapped right on the
next scroll.** Reported precisely: "sometimes when I change where he is on the
screen, he will go to the wrong place, and then as soon as I scroll a little bit
he snaps to the right place… this happens when I scroll a little, then change
targets." The last clause is the diagnosis. While pinned, the camera carries an
off-axis frustum worth the distance scrolled since he parked, and `parkBeside`
unprojects through whatever frustum it is handed — so `flyTo` computed its
destination `drift` pixels wrong. `launch` unpins, but it runs AFTER the
destination has been computed. With no scrolling the offset is zero and the bug is
invisible, which is exactly the condition the reviewer identified.

`flyTo` and `returnHome` now unpin before they solve. `returnHome` had the same
fault by a narrower route: `homeCorner(...)` is evaluated as an ARGUMENT to
`launch`, so however early `launch` unpins, the solve has already happened. An
audit of every camera-projection consumer then found a third, down a path that
looked like it had already handled it: `resize` unpins immediately, but the
re-park is a 250 ms trailing debounce and `repin` runs every frame, so by the time
the timer fires he has usually pinned again.

**He juddered on the way into the viewport, at both edges.** The canvas is one
viewport tall and draws nothing outside itself, so `canPin` refused to pin until
his whole silhouette was comfortably inside the VIEWPORT — which meant his entire
entrance, a body height of scrolling at each end, ran on the hand-tracked path.
The fix is to stop assuming the canvas has to line up with the viewport. It is
pinned to a document offset, and nothing says that offset must be the current
scroll position: slide it off the edge by `pinShift` and it still contains him
while he is half on screen, with the overhang simply unseen. The frustum offset
that already carries the drift carries this too — an aligned pin is the
`shift === 0` case of the same line, not a second path — so the change is a
clamp in `canPin` and one subtraction in `repin`.

Measured on Chromium, WebKit and Firefox: walking him in from the bottom edge and
down from the top, **zero frames where he is visible and not pinned**, and zero
tracking-error spread across the whole entry. Switching targets after a 200 px
scroll now lands him with no correction on the following scroll.

Both faults share a shape worth naming: the frustum offset is a RENDERING concern
that leaks into SOLVING, because `viewportToBlender` inverts through the live
projection. Every solve outside `syncPinned` has to run unpinned, and that is now
stated at all three call sites rather than left as a thing to notice.

