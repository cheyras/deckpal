# Foil / variant detection — measurement findings

**Status: a working discriminator, with one dependency.** Reverse holo separates
from normal at **AUC 0.988** (leave-one-pair-out, 5-frame window, worst pair 0.95)
using a single parameter-free statistic — *provided* a per-card baseline is
available. It does not work as an absolute threshold. Details below.

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

Window size matters, and this is the temporal payoff: per single frame the same
statistic is only ~0.85. Averaging over ~5 frames takes it to ~0.99, because the
sheen fires intermittently and one frame may catch the card at a dead angle.

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

**This is fine, because the scanner already knows.** pHash identifies the card
before variant is ever in question, so the comparison can be made against a
per-card reference. The obvious source is the catalog image of the normal
printing — a flat digital scan with no specular component, i.e. exactly the
"no highlight" baseline. Establishing that reference is the remaining work.

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
strongly sheened at t=24/28/40 s and flat at t=32/44/48 s. This is why the window
matters and why a single still is near a coin flip.

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

1. **A per-card `corrLS` reference.** Compute it over catalog images and check
   that catalog-vs-photo baseline shift is smaller than the foil delta. If it is
   not, derive the reference from user scans instead.
2. **Re-shoot through the app's own scan guide.** These clips are wide handheld
   shots; production frames are card-filling. Rectification bridges the gap but a
   native capture removes a whole class of doubt.
3. **The `Holofoil` (holo rare) class is untested** — the dataset is normal vs
   reverse holo only.

## Shipping shape

Detection stays a **confidence-gated preselect**. Under bright diffuse light the
delta shrinks toward the noise floor, so the classifier must be able to abstain,
and the abstain path is a one-tap variant choice.

That one-tap control is also the total-failure fallback. **Build it first**; it is
needed either way, and it turns detection from a gamble into an optional layer.
