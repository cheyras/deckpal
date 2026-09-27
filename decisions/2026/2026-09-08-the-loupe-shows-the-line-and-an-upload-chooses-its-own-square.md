---
date: "2026-09-08"
title: "The loupe shows the line, and an upload chooses its own square"
decided_by: "@cheyras: *\"Love the magnifiers when I'm dragging a point. Can"
areas: ["general"]
supersedes: []
---
## 2026-09-08 — The loupe shows the line, and an upload chooses its own square

**Decided by:** @cheyras: *"Love the magnifiers when I'm dragging a point. Can
we make it so that I can see the line in the magnifier too? Thin line in there
[for] pinpoint accuracy."* and *"ensure that when I upload an image, I can choose
exactly how to save the crop so I can position the card however I want in an
uploaded one."* Implemented by Claude Opus 5.

### The loupe was magnifying the wrong half of the question

It showed the card's pixels at 5x and the reader's own quad at 1x, in the main
view, which is the resolution the loupe exists to escape. But a corner is
correct when the two LINES meeting at it lie along the printed border — so the
reader was aiming a crosshair at an edge by eye and hoping.

The quad is now drawn inside it: the two edges meeting at the dragged corner in
amber, the far pair faint (a quad that has gone non-convex shows here before
anywhere else). Both are **one DEVICE pixel**, set as `1 / dpr` inside a
DPR-scaled transform rather than 1 CSS pixel — a 3x phone renders a CSS-space
hairline as a 3 px smear, which would cover the exact boundary it is meant to
help find.

**The loupe's backing store is now at device resolution too.** It was a 132 px
bitmap stretched across 132 CSS px, so on a phone the one component whose entire
job is to show more pixels than the screen was showing fewer. That was not part
of the request and is the larger share of the sharpness gain.

### An upload's centre square was a camera constraint applied where it does not hold

`buildWorkingFrame` took the centre square unconditionally, and the design goal
that produced it was right: a camera frame and an upload should be
indistinguishable downstream. But the REASON only binds the camera —
`EngineState.frame`'s working-frame invariant makes the canonical frame a pure
function of the stream, so a live frame the reader could re-aim afterwards would
break the guarantee that a label and a runtime detection describe one square.

A photo is already taken. Nothing is guaranteed by cropping its middle, and the
cost was silent: every card sitting off-centre was discarded, and a landscape
photo became a strip through the middle of itself.

So upload mode gains a crop step (`CropStage`) between decode and editor — drag
to move, pinch or scroll to resize, with the standard `reticleForAspect` card
guide drawn inside the square so the reader can see how the card will sit
relative to what the detector aims at. **The guide does not constrain the
choice**: a card that is small in frame, rotated, or half out of it is a
legitimate row, and a crop tool that refused those would bias the corpus toward
the easy ones. `Skip` takes the centre square in one tap.

**No new schema.** `QuadLabelBase.crop` has recorded `{x, y, size}` on every row
since the schema was written, so a harvest can already tell a hand-framed row
from a centred one.

**`clampCrop` is where the rule lives**, in `workingFrame.ts` and therefore
inside the frame-derivation import fence — the UI cannot reach past it. A square
hanging off the photo's edge would draw transparent black into the canonical
frame: a region the detector never saw in training and the reader cannot label,
indistinguishable in the corpus from a genuinely dark card edge. Size is capped
to the SHORTER edge and only then is the offset clamped; the reverse order lets
the square escape. Pinned in `labeler/__tests__/crop.test.ts`.

**Verification:** `tsc --noEmit` clean; `deckpal-web test:scan` 678/678, 0
skipped (7 new); `deckpal-web build` clean.

