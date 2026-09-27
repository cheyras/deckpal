---
date: "2026-09-08"
title: "Two more rejection classes, and the line every gate is drawn on"
decided_by: "@cheyras: *\"Let's add some more tags: too obscured (i want it to"
areas: ["general"]
supersedes: []
---
## 2026-09-08 — Two more rejection classes, and the line every gate is drawn on

**Decided by:** @cheyras: *"Let's add some more tags: too obscured (i want it to
work if there is some finger/thumb overlap but not if the thumb/finger is
covering too much of the card or too much of what actually makes it
identifiable) [and] too bent"*, plus the question that shaped the whole entry:
*"at what point is it genuinely too blurry for a good detect? should it be just
blurry enough that OCR will fail? Only blurry enough that the artwork isn't
legible at all?"* Implemented by Claude Opus 5.

### The answer to the question, because it governs all ten classes

Neither. **A rejection is a claim about the QUAD, not about the scan.**

A negative row is `corners: null`, and what it trains is a detector that emits
nothing for frames like this one. OCR, the pHash and the CLIP embedding all read
the card's INTERIOR; the detector reads its BOUNDARY. So a frame whose artwork is
mush but whose border is still a crisp line is one the detector should quad, and
is among the more valuable positives in the corpus — it teaches the boundary task
independently of the identification task.

The gate on every `unquaddable` class is therefore one question — *can a human
confidently place the four corners?* — and the tag only names the obstacle.

**The asymmetry is what makes this worth writing down.** A wrong rejection
teaches the detector to give up, and nothing downstream can act on a quad that
was never emitted. A frame quadded but not identifiable costs one round trip and
the next frame lands. The tie-break is fixed: when in doubt, place the corners.
The picker's guidance box now leads with that sentence, and `HARVEST.md` §6
carries the per-class table.

### `too_obscured` is deliberately not two tags

The owner's framing named two things — "too much of the card" and "too much of
what actually makes it identifiable" — and they are different heads.

* A thumb **over a corner** is unquaddable: the model at inference has to SEE
  that corner. A human can infer it from the other three and the fixed 63:88
  aspect, and labelling that inference would teach the detector to hallucinate
  corners under occlusion — a failure that then has to be unlearned.
* A thumb **over the middle** is perfectly quaddable, and a positive.

The second case may well be unidentifiable, which is a real product problem that
belongs to a future identifiability head. Folding it in here would put
`corners: null` on frames whose corners are plainly visible. The gate shipped is
the first one: a corner you cannot see, or an edge more than about a third
hidden — enough edge has to survive to fit a line through.

### `too_bent` is the one class where good corners still mean no

Every other rejection says the corners are unavailable. This one can have four
crisp corners and still be right, because `rectify.ts` solves a homography that
is exact **only for a plane**: a bowed card yields a warped crop from perfect
corners, and the ground truth itself goes ill-defined, since the card's boundary
stops being the quadrilateral joining its corners.

The gate is therefore stated on the EDGE, not the curve: sight the straight line
between two adjacent corners, and if the card's edge visibly bows off it, tag
it. A gentle bow is the normal state of a card in a hand and is a positive — the
detector must not learn to fear the common case.

**A count to watch.** If `too_bent` stays rare it is doing its job as a
severe-curl class. If it starts taking a large share of hand-held frames, the
gate has drifted toward "any curve" and the corpus is being taught to refuse the
normal case. Noted in HARVEST.md so a future harvest checks it rather than
discovering it in a training run.

### No v1 or v2 population

Like `not_a_card` before them, both classes start here, and a harvest must not
back-fill them from older rows: a labeler without the button cannot have meant
it. `LEGACY_REASON_MAP` can only ever produce the three names it knows, and
`taxonomy.test.ts` now asserts that neither new class is reachable through it.

**Verification:** `tsc --noEmit` clean; `deckpal-web test:scan` 693/693, 0
skipped (2 new); `deckpal-web build` clean.

