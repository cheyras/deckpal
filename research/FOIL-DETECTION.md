# Foil / variant detection — measurement findings

**Status: round 2 — the approach changed, and the earlier headline number was
partly an artifact. Read `## Round 2` below before anything else.**

**Status (round 1, superseded in part): a real signal, NOT shippable as auto-detection on this evidence.**

Reverse holo separates from normal at **AUC 0.988** when card AND lighting are
held constant. But at scan time you know the card (pHash names it) and you do not
know the light — and the across-lighting spread of the statistic is, for one of
the three cards tested, larger than the foil effect itself. Held-out-lighting
accuracy is 15/17, and **both errors are confident rather than marginal**, so an
abstain band does not catch them.

A collection tracker that confidently mislabels a printing is worse than one that
asks. **Ship the one-tap variant choice** (done — `DECISIONS.md` 2026-08-21) and
treat detection as unproven until the dataset is wider. What follows is what was
measured, including the two dead ends, so this is not re-litigated from scratch.

Dataset: three narrated clips shot by the owner 2026-08-21, 4K, ~4.5 min total
(`~/iPad/IMG_0690.mov`, `IMG_0691.mov`, `IMG_0693.mov`). Ground truth is the
owner's own narration, transcribed with the GPU whisper sidecar and verified
frame by frame. Segment table: `research/foil-segments.json`.

## The capture

Three cards (Weedle, Kakuna, Ninetales) × {normal, reverse holo} × three lighting
conditions (overhead LED, window daylight, dimmed neon sign), handled loosely and
tilted throughout rather than held flat. It carries the adversarial cells that
make the result trustworthy:

| Cell | Why it matters |
|---|---|
| Normal in a **glossy** sleeve | False-positive trap: sleeve gloss makes its own achromatic highlight |
| Reverse holo in a **matte** sleeve | False-negative trap: matte diffuses the foil |
| Reverse holo in a **glossy** sleeve (`dim-kakuna-*`) | Breaks the sleeve/variant confound — without it a classifier could score well by detecting *sleeve finish* |
| Weedle unsleeved, both variants, all three lights | Clean control |

Missing cell: normal + matte sleeve. Unsleeved normal covers "no gloss, no foil",
so this is a gap rather than a hole.

## The discriminator

**`corrLS` — the Pearson correlation between per-pixel luminance and per-pixel
saturation, over the rectified card face, averaged across a ~5-frame window.**

The physics: a specular highlight is **achromatic**. Where foil catches the light
it goes white, so bright pixels are desaturated and luminance anticorrelates with
saturation. On a matte card the bright regions are bright *art*, which keeps its
hue, so the correlation stays near zero or positive.

It is a correlation coefficient — bounded, scale-free, no fitted parameters, no
normalisation. There is nothing in it to leak.

| Feature (5-frame window, leave-one-pair-out) | Mean AUC |
|---|---|
| **`-corrLS`** | **0.988** |
| `-meanSat` | 0.818 |
| `-specFrac` | 0.482 |
| `-hf` | 0.386 |
| `-p99` | 0.328 |

Combining `corrLS` with `meanSat` made it *worse* (0.911) — `meanSat` flips sign
on two pairs. The single feature is the answer.

Window size matters, but NOT for the reason first assumed: per single frame the
statistic is ~0.85, and averaging ~5 frames takes it to ~0.99. That is ordinary
noise reduction on the mean. The *variance* across a window — the "foil swings as
it tilts, matte stays put" idea — carries nothing: measured on the rectified
frames it scores **AUC 0.50 (sd) and 0.52 (rng)**, i.e. exactly chance. Comparing
a card to itself over a window does not work, which is what killed the one
approach that would have needed no reference at all.

## It is RELATIVE, not absolute

A global threshold **fails** — the two classes overlap by 0.431. The baseline is
set by the card's own artwork:

| Card | normal | reverse | Δ |
|---|---|---|---|
| Kakuna (daylight) | +0.160 | +0.125 | −0.035 |
| Ninetales (daylight) | −0.306 | −0.369 | −0.063 |
| Weedle (daylight) | −0.181 | −0.323 | −0.142 |
| Kakuna (dim neon) | −0.095 | −0.282 | −0.187 |
| Ninetales (dim neon) | −0.210 | −0.501 | −0.291 |
| Weedle (dim neon) | −0.055 | −0.309 | −0.254 |
| Kakuna (LED) | +0.089 | −0.088 | −0.177 |
| Weedle (LED) | −0.138 | −0.327 | −0.189 |

Reverse is more negative in **8 of 8** pairs. But a Kakuna reverse holo (+0.125)
scores *higher* than a Ninetales normal (−0.306), so the number is meaningless
without knowing which card it is.

pHash names the card before variant is ever in question, so a per-card reference
is obtainable in principle. **It is not sufficient in practice**, because the
statistic also moves with the light:

| Card | normal across 3 lights | spread | reverse across 3 lights | spread |
|---|---|---|---|---|
| Weedle | −0.181 / −0.055 / −0.138 | 0.126 | −0.323 / −0.309 / −0.327 | 0.017 |
| Kakuna | +0.160 / −0.095 / +0.089 | **0.255** | +0.125 / −0.282 / −0.088 | **0.407** |
| Ninetales | −0.306 / −0.210 | 0.096 | −0.369 / −0.501 / −0.369 | 0.133 |

Weedle and Ninetales stay separable under a fixed per-card threshold. **Kakuna does
not** — its normal in dim light (−0.095) scores *below* its reverse holo in
daylight (+0.125). Leave-one-lighting-out, fitting a per-card threshold on two
lightings and testing the third, gives **15/17**; both failures are Kakuna, and
both miss by 0.17–0.22, far outside any sensible abstain band.

One card in three breaking it, confidently, is disqualifying for a feature whose
entire job is recording what someone owns.

## Lighting: the prediction was backwards

Deltas are **largest under the dimmed neon** (−0.187, −0.291, −0.254) and
**smallest under window daylight** (−0.035, −0.063). A small bright source makes
sharp speculars; broad diffuse daylight illuminates evenly and gives foil nothing
to glint with. Dim *directional* light is the best case, not the worst.

The earlier claim that dim light would be the hard case was wrong. The real hard
case is bright, diffuse, evenly-scattered light.

## Other established facts

**The signal survives the live pipeline.** The live scanner sends a **480 px-wide
JPEG at q0.85** (`apps/web/src/routes/Scan.tsx:121`) and the sheen is plainly
visible at that exact size and quality. No higher-resolution upload path needed.

**It cannot ride the pHash path.** `apps/api/src/scan/phash.ts:99` collapses every
frame to **72×64 greyscale**, destroying both the resolution and the colour the
effect lives in. Detection taps the client-side canvas instead, and can run
entirely on-device — it needs pixels, not the catalog.

**The sheen is intermittent with tilt angle.** The same reverse-holo Weedle is
strongly sheened at t=24/28/40 s and flat at t=32/44/48 s — visually obvious in
the frames. It is why a single still is near a coin flip, and why averaging a
window helps. It is NOT usable as a signal in itself: see the variance result
above, which is chance. Intermittency raises the noise; it does not carry the
information.

**SV-era reverse holo foils the WHOLE card, art window included.** An earlier
assumption — that it foils only the frame, so a region mask could separate
`Holofoil` from `Reverse Holofoil` — is **wrong for this era**. Removes the
dependency on era layout rects in `roadmap/plans/foil-main.md`.

## Two dead ends, recorded so they are not repeated

**1. "Foil adds sparkle texture" is false at these resolutions.** Strong sheen
*bleaches and flattens*: luminance up, fine-grain energy down. Every texture-based
feature (`hf`) scored at or below chance and flipped direction between pairs.

**2. Filtering frames by "is the bounding box card-shaped" selects against the
signal.** A card held flat has a card-shaped projected box; a tilted one does not
— and tilt is what makes foil glint. That filter kept the sheen-free frames and
discarded the informative ones. The tell was `led-weedle-reverse` keeping **0 of
15** frames, which is the segment with the most obvious sheen in the whole
dataset. Rectify the tilt, never reject it.

## Pipeline that produced this

`scratchpad/foil/` — copied to `research/foil-harness/`:

1. `extract_full.mjs` — clips → labelled frames at 1080 px (no crop; cropping
   clipped the card and broke corner detection).
2. `rectify2.mjs` — locate and rectify to canonical 320×448 card space. Card
   detection keys on **focus, not brightness**: the card is what the lens is
   focused on, the background is not. Otsu on luminance merged card, hand and lit
   table into one blob whose corners were not the card's; Sobel energy box-blurred
   into a texture field separates them (131/146 frames).
3. `measure*.mjs` — features, within-pair AUC, leave-one-pair-out.

## What is left

The blocker is no longer "is there a signal" — there is. It is **lighting
invariance**, and it needs data this capture cannot supply.

1. **More cards.** Three is too few to know whether Kakuna is the exception or the
   rule. Its art is a bright saturated sunset, which is exactly the kind of
   high-luminance high-saturation content that should perturb a luminance/
   saturation correlation. That is a hypothesis, not a finding.
2. **A lighting-invariant formulation.** The statistic must be normalised by
   something in-frame that tracks the illumination. The card's white border is the
   obvious candidate and the obvious problem — SV/ME-era reverse holo foils the
   border too.
3. **Catalog images as the reference are NOT worth pursuing yet.** A single flat
   scan cannot track a per-card spread of 0.255 across lighting. It would have to
   come after (2), not before.
4. **Re-shoot through the app's own scan guide.** These are wide handheld shots;
   production frames are card-filling.
5. **The `Holofoil` (holo rare) class is untested** — this dataset is normal vs
   reverse holo only.

## Shipping shape

Detection stays a **confidence-gated preselect**. Under bright diffuse light the
delta shrinks toward the noise floor, so the classifier must be able to abstain,
and the abstain path is a one-tap variant choice.

That one-tap control is also the total-failure fallback. **Build it first**; it is
needed either way, and it turns detection from a gamble into an optional layer.


---

# Round 2 — registration, and measuring change instead of appearance

Prompted by a decision not to give up on this. Three things came out of it: the
round-1 headline was inflated, registration was the thing blocking every idea,
and the right signal is **how the card changes as it tilts**, not how it looks in
any one frame.

## The round-1 number was partly an artifact

`corrLS` scored 15/17 leave-one-lighting-out on the round-1 crops. Those crops
were roughly 40% hand, sleeve and table. Measured on properly registered,
**card-only** pixels, the same feature scores **9/17** — barely above the 8.5/17
coin flip.

Some of that 15/17 was hand and background, which a well-framed production scan
would not contain. Any future claim here has to be made on registered card pixels.

## Registration is solved, and it was the real blocker

Three hand-rolled attempts failed, each looking like a different bug: a focus/
brightness blob that grabbed the sleeve; a similarity search whose range could not
reach the answer (every frame pinned against the scale ceiling); then coordinate
descent that settled into local optima, because card art is repetitive enough —
rows of text, a border, a frame — that a partial overlap scores well.

All three were the same mistake: **trying to find a projective transform without
correspondences.** SIFT + RANSAC against the catalog image registers **139/146
frames** with hundreds of inliers, pixel-accurate. `research/foil-harness/register.py`.

This is a reusable asset independent of foil: it puts any frame into canonical
card space, which is also what a grading pre-check or a centring measurement would
need.

## Dividing the artwork out works — and exposes the next confound

The catalog image is a flat scan, so it approximates the card's diffuse albedo.
Under the dichromatic model `O = A·S·L + R·L`, dividing gives `O/A = L·(S + R/A)`:
the artwork cancels, leaving shading plus specular, with the specular term
amplified where the albedo is dark.

It does what it was meant to. Within a lighting condition, `ratioSpread` is **8/8
unanimous** and `ratioSd` averages **AUC 0.86** — better *consistency* than
`corrLS` ever had, and Kakuna's bright sunset no longer dominates.

But across lighting it scores **10/17**. Removing the art confound exposed an
illumination-geometry confound: a small directional source lays a strong smooth
gradient across the card, diffuse light lays almost none, and the foil term rides
on a base that moves further than it does. Separating the residual by spatial
scale (shading is low-frequency, specular is localised) did not fix it — twelve
scale-separated features, best 11/17.

**No single-frame feature achieves a fixed per-card threshold across all three
lightings for more than one card of three.** That is the shippable requirement,
and single-frame appearance does not meet it.

## What does work: measure the CHANGE, not the appearance

A difference between two frames of the same card under the same light **cancels
the illumination**. What is left is what changed: the hand moved, so a
view-dependent surface redistributes its highlight and a matte surface does not.

Two refinements make it a measurement rather than a motion detector:

- Confine it to **flat regions of the artwork** (from the catalog's own gradient),
  because registration error shows up at albedo edges.
- Normalise by the change **at** those edges. Both scale with how far the hand
  moved and with registration slop; only the flat-region change is inflated by a
  highlight sliding across the card.

| Feature | within-pair | fixed per-card threshold | leave-one-lighting-out |
|---|---|---|---|
| `moveSd` (raw change, flat regions) | **8/8** | 0/3 | 10/17 |
| **`relSd` (flat ÷ edge)** | 7/8 | **1/3** | **13/17** |
| `corrLS` (round 1, on clean data) | — | 0/3 | 9/17 |

`relSd` is the best result on registered data, and it is illumination-normalised
*by construction* rather than by calibration. Three of its four errors are Kakuna;
Ninetales misses a fixed threshold by 0.005, which is a tie, and its overhead-LED
normal cell is missing from the dataset entirely.

## The binding constraint is now data, not ideas

Seventeen segments, one per (card × lighting × variant), several with only two or
three frame-pairs, and one cell absent. A per-card threshold cannot be fitted or
validated from that — every evaluation here derives a threshold from two points.
15/17 versus 13/17 versus 9/17 are two-to-three-item differences with heavily
overlapping confidence intervals; the ranking is indicative, not established.

What would settle it: more **cards** (three cannot tell whether Kakuna is the
exception or the rule), and more **lighting conditions per card**, captured
through the app's own scan guide so the framing matches production.
