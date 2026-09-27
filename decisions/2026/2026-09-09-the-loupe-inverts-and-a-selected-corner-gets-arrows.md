---
date: "2026-09-09"
title: "The loupe inverts, and a selected corner gets arrows"
decided_by: "@cheyras: *\"The quad lines in the loupe are near impossible to"
areas: ["general"]
supersedes: []
---
## 2026-09-09 — The loupe inverts, and a selected corner gets arrows

**Decided by:** @cheyras: *"The quad lines in the loupe are near impossible to
see - make it so that they invert the pixels behind them."* and *"on mobile,
it's hard to position the nodes accurately… let's make it so the loupe appears
when you select a node, not just when you're dragging it. let's put small up
down left right buttons above, below and to the sides of the loupe, that nudge
the selected node a tiny bit in that direction. Then the user taps the loupe to
confirm and deselect the node… Selecting a different node confirms and deselects
the current node and selects the new one as well. Saving also confirms."*
Implemented by Claude Opus 5.

### Inversion, because no fixed colour can win that argument

The edges were amber and translucent white, picked on the reasoning that card
art is "overwhelmingly not amber". That reasoning cannot hold: a fixed colour
has to beat EVERY background a card can present, at one device pixel wide, and
full-art cards are saturated in every hue including amber.

`globalCompositeOperation = 'difference'` against white gives `255 - pixel` per
channel, so the line is the photometric opposite of whatever it crosses —
contrast by construction rather than by a bet about the artwork. It is why
selection marquees have inverted in imaging tools for forty years.

Colour is no longer available to separate the two pairs of edges, so DASH
carries it: the dragged corner's own edges solid, the far pair dashed. The
crosshair inverts for the same reason and is now GAPPED at the centre — the one
pixel being placed should not be painted over by the marker pointing at it.

### The loupe existed only while a finger was covering the corner

That is the whole defect behind *"hard to position the nodes accurately"*. A
finger is ~8 mm across; the corner is a fraction of a millimetre on screen; and
the magnifier — the one thing that could have helped — was scoped to the drag,
so it vanished at exactly the moment the corner became visible again.

Selection owns it now. A corner is selected by tapping, dragging or tabbing to
it, and the loupe **and its pad stay** until confirmed. Four 44 px arrows sit
above, below and either side of the glass, stepping the corner one working-frame
pixel at a time; the loupe itself is the confirm button, because it is the
largest target in the cluster and the reader is already looking at it.

**One nudge implementation.** The arrows and the arrow keys call the same
`nudgeCorner`, including its clamp. Two would drift the first time one learned a
new bound — and the desktop keyboard has had this exact affordance since the
editor shipped, which is also why the pad is offered on desktop: a mouse is no
better at sub-pixel dragging than a thumb is.

**The placement rule is the load-bearing part.** The cluster sits in the
opposite quadrant from the corner it magnifies, computed from the corner's own
NORMALIZED coordinates — not from the screen. A screen-space rule would need
recomputing inside `syncVisuals`, which writes the DOM directly and never
re-renders, so the pad would lag a pan by a whole gesture. It also does not
follow the finger: a control that moves while you reach for it is one you miss.

Confirming is therefore three things that are all the same thing: tapping the
glass, selecting another corner (the handle's own `pointerdown` sets the
selection, so there is no second rule), and saving.

### What the tests pin

Both new rules fail *silently* and photograph fine: a pad on the wrong side
covers the corner it magnifies, and an arrow wired to the wrong sign moves the
corner away from where the reader pointed. `loupePad.test.ts` asserts the
quadrant mapping for all four corners, that "up" is negative y (screen
coordinates, the sign a maths-trained reader flips), that placement reads no
screen measurement at all, that the pad renders off `selectedCorner` rather than
a drag, that `submit` clears the selection, and that both nudge callers route
through the one implementation.

**Verification:** `tsc --noEmit` clean; `deckpal-web test:scan` 722/722, 0
skipped (7 new); `deckpal-web build` clean. Rendering and touch both still want
a device — `difference` compositing in particular is asserted to be REQUESTED,
not to look right.

