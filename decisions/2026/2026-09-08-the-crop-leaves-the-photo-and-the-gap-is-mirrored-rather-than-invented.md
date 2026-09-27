---
date: "2026-09-08"
title: "The crop leaves the photo, and the gap is mirrored rather than invented"
decided_by: "@cheyras, who asked for AI outpainting via the Vercel AI Gateway"
areas: ["general"]
supersedes: []
---
## 2026-09-08 — The crop leaves the photo, and the gap is mirrored rather than invented

**Decided by:** @cheyras, who asked for AI outpainting via the Vercel AI Gateway
to fill blank space when the crop square is pushed off the edge of a photo, and
— after the objection below — chose *"Mirror/edge padding first, Keep or
generate option follow-up. Fast and easy by default, option to do something that
feels more natural if desired."* and, on corners landing in filled pixels,
*"Just allow it. It will never be used to generate parts of the actual card,
only for filling in backgrounds."* Implemented by Claude Opus 5.

### The objection, recorded because the decision turns on it

The blank space only exists if `clampCrop` is relaxed — the guard added the same
morning, whose stated reason was that padding draws "a region the detector has
never seen in training and the reader cannot label".

Outpainting does not remove that problem; it **hides** it. A black rectangle is
obviously synthetic and a harvest can filter it mechanically. A photorealistic
fill is indistinguishable from camera pixels, so nothing downstream can tell
which parts of the corpus a sensor produced — and if the card itself runs off
the photo, the fill invents CARD, and a corner placed on it trains the detector
to find corners that were never photographed. That is the same hallucination
loop `too_obscured` was defined to avoid, pointed the other way.

**A feasibility fact that also mattered:** `generateImage` in the pinned
`ai@7.0.66` takes `{model, prompt, size, aspectRatio, seed, …}` and accepts
**no input image and no mask**. There is no provider-agnostic outpaint through
the SDK this repo already uses; it would need a provider-specific fill call,
seconds per adjustment, and per-call spend.

### What shipped: reflection

Every padded pixel is a real pixel of this photograph, mirrored — the `reflect`
border mode every vision toolkit ships, for exactly this reason. It is
deterministic (same photo, same crop, same square, forever — which a generative
fill is not), costs nothing, needs no network, and introduces no new
distribution: the texture on both sides of the seam is the same texture.

`clampCropAllowingPad` replaces `clampCrop` on the upload path. It no longer
pulls the square inside; it caps the square at the photo's LONGER edge and keeps
**at least half of each axis** over real photograph. That bound is not taste:
the mirror reflects the real content outward, so a gap wider than the content it
mirrors would have nothing left to copy.

**The live path is untouched.** No `chosen` crop still means the centre square
of the stream, `pad` all zero. A camera frame cannot be padded, and the
working-frame invariant holds exactly as before.

**The preview is the real thing.** `CropStage` draws the mirrored square through
the same `drawSquarePadded` the working frame uses, positioned under the crop
outline — the point of showing it is to choose a crop by looking at the result,
and a preview that could disagree with the result is worse than none.

### Recorded, not forbidden

`pipeline.pad = {left, top, right, bottom, mode: 'mirror'}` is written only when
there IS one, so "was this padded?" stays a presence test rather than a numeric
one. Sides are in source pixels, matching `crop`, so a harvest can convert to
canonical fractions and know precisely which region of the saved PNG is
reflected.

Nothing is blocked on it. Per the owner's ruling a corner may sit inside a
mirrored region, on the grounds that the region is background the card was never
in — which is true of the case the feature exists for, and is now a property of
the corpus that is discoverable rather than assumed.

### What is NOT built

The "generate instead" follow-up. It needs three things this session could not
supply on its own: a fill-capable model id reachable through the Gateway
(`generateImage` cannot express the call, so it is a provider-specific request),
a decision to spend per crop adjustment, and — under B9 and B11 — the owner's
approval plus a `DEPLOYMENT.md` entry for whatever key it reads. The mirrored
default stands on its own until then.

**Verification:** `tsc --noEmit` clean; `deckpal-web test:scan` 706/706, 0
skipped (9 new in `labeler/__tests__/pad.test.ts`); `deckpal-web build` clean.
The mirror fill itself is canvas work and is NOT browser-verified — the
arithmetic that decides where it happens is pinned, the pixels are not.

