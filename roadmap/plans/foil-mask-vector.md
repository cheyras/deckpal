# foil/mask-vector — intent, not handwriting

Branch plan. Chey, 2026-08-08 (chat), the whole reason this lane exists:

> "I edited a whole bunch of the reverse holofoil masks. Let's learn from these. I want to
> make sure that what the system is really learning is not 'give these a hand drawn quality'
> but what I draw is intent. Generated masks should feel like they're derived from clean
> vectors, with straight lines and crisp curves/rounded corners following the artwork. I'm
> hoping what we've learned from reverse holofoils will make the system smarter for other
> eras and card types as well. Let's now apply known good masks we already have to every
> other modern holofoil with the same layouts. Make sure they're marked not reviewed or
> whatever, but we'll call modern reverse holofoils tentatively done for now and in the next
> run we'll move on to modern holos (non reverse)."

And, correcting the scale of the deliverable mid-run:

> "We don't need 3,454 vector masks. All of these share the same 2 layouts really."

## THE BAR — stated before `vector-template@1` produced a single number

Committed to git before the generator existed; `git log` is the proof.

- **Leave-one-out mean IoU ≥ 0.94, and no held-out card below 0.90.**

Justification for picking exactly this. The previous class (`region-learn@1`, 3 exemplars)
shipped on mean ≥ 0.90 / min ≥ 0.85. Re-run today against all 11 exemplars it scores
**mean 0.9757, worst 0.9519** — so 0.90/0.85 is no longer a real threshold, it is a
formality. 0.94/0.90 is the raised bar: comfortably above the old one, and still an honest
test for a **template**, which is deliberately a generalisation. A single geometry applied
to every card should be expected to give up a little per-card IoU against a per-card tracer
in exchange for correctness, reviewability and cost. If `vector-template@1` lands materially
below `region-learn@1` on IoU, that trade must be stated plainly and not hidden — the bar is
the ship/no-ship gate, not a claim of superiority.

**Vector-ness is a separate, non-promoting measure.** Like boundary distance and edge
adherence before it, it must never promote a class on its own: a perfectly clean vector
boundary in the wrong place is still wrong. IoU gates; vector-ness describes.

## What "vector-ness" means here, and why his masks should score LOW

His strokes encode WHICH REGIONS carry foil. They do not encode how a boundary should look.
The measure (`vectorness()` in `apps/api/src/foil/vector-template.ts`) fits lines and
circular arcs to a boundary at a sub-pixel tolerance and reports:

- `explained` — fraction of boundary length covered by primitives within tolerance;
- `primitivesPerKpx` — primitives per 1000px of boundary (fewer = more vector-like);
- `curvatureNoise` — RMS residual turning, deg/px, after the fitted model is removed.

A hand mask and a livewire-traced mask both score low, for different reasons: his brush
leaves round-cap scallops and his corners are blobs; a traced path hugs gradient noise pixel
by pixel. A mask derived from fitted primitives scores high by construction. The contrast
between (a) his masks, (b) `region-learn@1`, (c) `vector-template@1` — at equal or better
IoU — is the evidence that the system learned his intent and not his handwriting.

## The deliverable

One **parameterised vector template** per modern-sv/sheet layout, committed as small
reviewable JSON, applied at render time. Not 3,454 rasters. Per-card rasters are a cache,
not an artifact; per-card committed masks exist only as exceptions (human masks, or cards
that genuinely deviate beyond tolerance).
