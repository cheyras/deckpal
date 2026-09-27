---
date: "2026-08-24"
title: "The Deck-E glb is quantised after all: 2850 KB -> 592 KB (1963 KB -> 337 KB on the wire)"
decided_by: "Claude, on the owner's instruction (\"6+ MB load is too hefty an"
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-24 — The Deck-E glb is quantised after all: 2850 KB -> 592 KB (1963 KB -> 337 KB on the wire)
**Decided by:** Claude, on the owner's instruction ("6+ MB load is too hefty an
ask... I want to get it sub 1MB"), with the fidelity claim measured rather than
asserted.

**Decision:**

1. **`KHR_mesh_quantization` is now used, and `shrink.mjs`'s "never quantize"
   ban is retired.** The ban was correct about the SYMPTOM and wrong about the
   cause. `quantize()` parks the de-quantisation on the mesh's NODE, and in this
   glb the mesh nodes ARE the rig nodes — `Hinge_Pin_R_anim`, `Card_Deck_anim`,
   every `Stash_Card_*` — whose whole TRS `riders.ts` and `cards.ts` overwrite
   each frame. That is the `Hinge_Pin_R` "cylinder wider than the character".
   `optimize.mjs` inserts a `__qmesh` wrapper child and moves the mesh onto it
   BEFORE quantising, so the de-quantisation lands somewhere nothing writes and
   the rig node keeps its authored transform.
2. **The second pass is a separate script**, `scripts/decke/optimize.mjs`, run on
   `shrink.mjs`'s output. Tier `bx` is the shipped recipe: 12-bit positions,
   8-bit normals, 256² grain map, 320 px card art.
3. **Morph normals stay.** Dropping them is the one change that is visibly
   worse and it was nearly shipped on a guess.
4. **`/dev/decke-compare`** runs the shipped glb and a candidate side by side,
   in two same-origin iframes, stepped from ONE rAF with the same `dt`.
5. **`decke.glb` IS the tier-b output now** — swapped in after the owner
   reviewed it on `/dev/decke-compare` ("tier B is perfect. It looks great").
   The pre-optimization asset is kept as the gitignored `decke.orig.glb` so the
   compare page still has a "before" to show; it is in git history regardless.
   `decke.opt.glb` / `decke.min.glb` stay gitignored build artifacts.
6. **Quote brotli at q=3, not q=11.** Vercel compresses `model/gltf-binary` on
   the fly at a low quality level. Confirmed on deckpal.app: `Content-Encoding:
   br`, and a real GET of the old asset returned 2010812 bytes — which q=3
   reproduces to within 25 bytes, while node's DEFAULT q=11 claims 1852498.
   Measuring locally with the default and quoting it overstates every saving by
   about 13%; the first numbers reported for this work did exactly that (292 KB
   claimed, 337 KB actual).

**Why:** Measurement, not taste, at every step. The 2.92 MB is 78% morph
targets, and two obvious-looking fixes were killed by measuring them first:
**sparse accessors make it BIGGER** (86.7% of morph cells actually move, so
sparse costs 1432 KB against 1240 KB dense), and the paired body morphs are
**not** negations of each other despite identical max magnitudes (negation
residual 7.9e-2 against a scale of 0.399). What was real is that float32 is
absurd for a character whose largest mesh spans 2.198 BU and who renders at
about 0.01 BU per pixel.

Fidelity was then measured, not claimed: 15 poses rendered from each glb in its
own page and diffed per pixel over the character. Two runs of the same file come
back **bit-exact**, so the instrument has no noise floor. Tier `bx` moves at
worst **1.76/255 mean**, with 2% of his pixels off by more than 8. Dropping
morph normals (tier `c`) moves **31% of his pixels** on `bend_back` — the shell
deforms while shading stays at the base pose, on a body that is metallic 0.85.
Note where that shows: the MOUTH poses stay fine and the whole-body bends fall
apart, which is the opposite of where it was expected.

Two incidental findings worth keeping. The grain map is per-pixel noise
(neighbour delta 4.72 against amplitude 11.18), so shrinking it quietens the
grain rather than blurring it — `optimize.mjs` measures the amplitude loss and
compensates `normalTexture.scale`, and scales the existing tile factor to hold
the grain's on-screen size. And the shipped grain map has been **lossy webp**
(`VP8 `, not `VP8L`) all along despite `shrink.mjs` asking for lossless, so the
"normal maps: lossless only" rule has not actually been in force.

**Implications:**

- Two runtime call sites assumed "the rig node IS the mesh" and no longer may:
  `DeckE.ts`'s eye binding resolves by traversal (and keeps passing the NODE to
  `uEyeObjectInverse`, since a wrapper carries scale), and `eyeSocket.ts`
  composes `geomToLid` into its vertex reads. Both bases of its delta must get
  that transform or the delta is in no space at all.
- `scripts/decke/verify-opt.mjs` is the gate, and it exists because every one of
  its checks failed silently once while this was built. A default `prune()`
  deleted 29 childless `Ctrl_*` empties the rig drives by name; `dedup()` merged
  the two eye materials. It also measures the surface against the original
  (currently within 4.96e-4 BU) in the RIG NODE's space — world space would
  compare the zero-scale stash cards as perfect on any asset at all.
- Never screenshot this renderer from outside the page. It has no
  `preserveDrawingBuffer`, so an out-of-process capture reads an undefined back
  buffer — that produced two wildly different images from controllers a camera
  dump proved were in identical states. Capture with `toDataURL` in the same
  task as the render.
- `DeckE.step(dt)` is public now: `start()`'s tick body, minus the rAF. It is
  also the supported form of the trick `decke/README.md` tells the parity
  harness to do by hand with the private `elapsed` and `update`.
- `/dev/decke-compare` had to be added to `landingRoute.ts`'s `CHROMELESS_PATHS`
  like `/dev/decke`, or the app chrome mounts `ProfileChip`, 401s while signed
  out, and redirects to `/auth`.

