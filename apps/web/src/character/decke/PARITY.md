> **Status note (2026-08-20): the gaze in these stills is no longer what the port
> renders.** Every still and clip below was captured while the pupils sat at their
> glb bind pose, which nobody had noticed was a BAKED SAMPLE of a camera-tracking
> constraint that never exported — see `look.ts`. The pupils now aim, so any frame
> where the gaze has since moved is a comparison against a different thing. That
> is intended: the frozen pose was the defect.
>
> It is also worth recording HOW this survived. A frozen constraint and a
> correctly-evaluated one agree *exactly* at the frame the freeze was taken, and
> every still here is taken at the staging camera — the frame it was frozen on.
> Fourteen poses, three clips and a 0.991 IoU on `alert_star` could not see it,
> and no tighter tolerance would have. What found it was a human watching him
> turn his head.
>
> **Status note — this report is a snapshot, and all six of its defects are now
> resolved.** The body below is preserved as written, because the reasoning in it
> is still how each defect was found. What follows is where things stand.
>
> | # | Defect as reported | Now |
> |---|---|---|
> | 1 | root `pz` discarded | **fixed** |
> | 2 | brow travel under-applied | **fixed** — three separate causes, see below |
> | 3 | alert glyph torn and smeared | **fixed** — three causes, none of them the atlas |
> | 4 | eyes render on the inner face of the gaping lid | **fixed** |
> | 5 | shading contrast compressed | **fixed** — it was an unported EEVEE clamp, not occlusion |
> | 6 | pupil oversized | refuted in the report itself |
>
> ### Current parity
>
> 14 states, silhouette IoU and the per-channel colour transfer ratio. These are
> **reproducible**: two consecutive runs are bit-identical (see "determinism"
> below).
>
> | state | IoU | colour (R/G/B) | state | IoU | colour (R/G/B) |
> |---|---|---|---|---|---|
> | `alert_star` | 0.991 | 1.067 / 1.074 / 1.064 | `sad_hold` | 0.947 | 1.065 / 1.043 / 1.042 |
> | `boot_pop` | 0.985 | 1.036 / 1.042 / 1.040 | `travel_far` | 0.934 | 0.880 / 0.926 / 0.931 |
> | `loading` | 0.983 | 1.051 / 1.108 / 1.088 | `point` | 0.928 | 0.959 / 1.013 / 1.016 |
> | `card_present` | 0.983 | 1.054 / 1.147 / 1.335 | `confused` | 0.920 | 1.015 / 1.037 / 1.030 |
> | `sleep` | 0.982 | 1.041 / 1.049 / 1.046 | `happy_peak` | 0.912 | 1.096 / 1.074 / 1.063 |
> | `curious_hold` | 0.964 | 1.178 / 1.025 / 1.014 | `card_stash` | 0.904 | 1.128 / 1.112 / 1.079 |
> | `thinking` | 0.961 | 1.004 / 1.026 / 1.025 | | | |
> | `rest` | 0.957 | 1.039 / 1.038 / 1.035 | | | |
>
> Colour was 1.08-1.17 across the board before the environment fix below; it is
> now 1.00-1.07 on eleven of fourteen. The three that are not: `curious_hold`'s
> red (Blender is mid-blink at that frame and the port is not, so the port shows
> far more white sclera), `card_present`'s blue (AgX desaturation on a saturated
> amber card amplifying a ~5% brightness excess — red is 1.054, so calling it a
> 34% gap would overstate it), and `travel_far`, where the port is *darker* on a
> small distant figure.
>
> ### Determinism
>
> The sweeps pin two pieces of procedural state that otherwise survive the page
> warm-up: the blink schedule's monotonic cursor, and the idle float's integrated
> clock. Unpinned, two identical runs differed by **up to 0.045 IoU** — enough to
> hide a real regression or invent one. `card_stash` alone swung 0.907 <-> 0.952.
> Pinned, consecutive runs are bit-identical. This does **not** make the port
> match Blender's baked float; nothing can, and it should not.
>
> ### Coverage
>
> Beyond the 14 stills, **3 clips compared frame-by-frame**, six samples each,
> because a pose error shows up in a still and a TIMING error does not:
>
> | clip | IoU across the sequence | centroid drift |
> |---|---|---|
> | `alert_dizzy` (a spin) | 0.985 - 0.992 | <= 0.8 px |
> | `nod_yes` (a fast head shake) | 0.895 - 0.952 | <= 7.8 px |
> | `talk` (mouth cycling) | 0.918 - 0.963 | <= 6.8 px |
>
> `alert_dizzy` is the sharp instrument: a rotation makes any phase error obvious,
> and it tracks to under a pixel for 1.7 seconds. `nod_yes` and `talk` are worst
> in the MIDDLE of the motion and best at both ends, the signature of a small
> amplitude difference rather than a rate error — a rate error diverges
> monotonically, which is exactly how `travel_far` was caught.
>
> Also verified: **37 draw calls / 26,752 triangles**, median frame 5.5 ms on
> desktop and 5.8 ms (10.9 ms p95) at 390x844, 3x DPR, **6x CPU throttling**. All
> 30 state buttons driven with zero console errors; facing checked against the
> file (settled yaw at `facing = -1` is 80.39 deg in Blender, 80.4 deg in the
> port); `flyTo` verified against a DOM selector, raw x/y, and both depths; the
> LLM JSON console both applying a batch and REJECTING an unknown state with the
> legal list. **48 unit and parity tests.**
>
> ### What the fixes were
>
> **Defect 5 was not what it was filed as.** It had been recorded as "shadows
> 24-37% too bright", which points at occlusion, and that was wrong. Bucketing the
> residual by SURFACE NORMAL rather than by pixel showed `rest`'s up-facing lid
> top at +44% against its front face's +5% — and the lid top is unoccluded, so no
> shadow or AO term can touch it. The cause is
> `scene.eevee.clamp_surface_indirect = 10.0`, a **firefly clamp, which acts per
> SAMPLE and not on the result**. Capping the finished IBL lookup moves this scene
> 0.08%; capping the HDRI *texels* that feed it changes it enormously, because
> `studio_small_09` runs to radiance 560 against a sphere mean of 0.86. Zero
> per-frame cost — one pass over the source texels before PMREM.
>
> **Defect 4, and the brows with it, were three parentage errors.** The lid pivot
> is a MATRIX pair, not an angle pair (`DeckBox_Lid.location` is keyed and reaches
> `(0, 0.152263, -0.117046)` at the full gape; leaving it at rest put the lid
> 0.313 BU out). `Eye_Rig` is VERTEX_3-parented to the MORPHED lid, so it must
> follow the shape keys — `eyeSocket.ts` now reproduces the file's world matrix to
> 1e-6. And the brow sockets are children of `Eye_Rig`, not lid riders, plus they
> carry a keyed follow-through of their own; modelling both took the worst brow
> error from 0.36 BU to 0.006.
>
> ### What is knowingly not matched
>
> | Residual | Size | Why |
> |---|---|---|
> | idle float and blink phase | ~0.069 BU, and most of the residual centroid error | both are **seeded procedural layers** in the port and baked curves in the file. Unmatchable by construction, and correct: he has to idle and blink indefinitely, not replay 5211 frames. |
> | occlusion | shadows still somewhat light | bounded, not fixed. Zeroing the area lights (the maximum any shadow system could achieve) brackets 1.0 for `rest` and `card_stash`, so direct shadows would help there — but `card_present`'s blue is **1.055 even fully shadowed**, so part of the remainder is necessarily ENVIRONMENT occlusion, roughly 15-30% AO. `RectAreaLight` cannot cast shadows in three, and the two dominant lights are 6x6 and 7x7 softboxes whose shadows are very soft, so hard shadow maps would likely hurt parity; the environment half needs GTAO or a baked `aoMap` that could not follow the 115-degree lid. Neither is affordable against an explicit mobile requirement. |
> | right-brow offset on `happy` / `sad` | <= 0.11 BU | a slow sway in the `.blend` over frames ~240-540 drifting monotonically **across three state markers**, coupled to `Body_Twist_R`. Not per-state data, so a per-state playbook cannot carry it. |
> | `confused` brow phase | up to 0.04 IoU | the state alternates its brows every 140 ms, so sub-frame jitter flips which brow is up |
> | hinge twist at frames 153 / 298 | <= 1.7 deg | a small Z rotation on `Lid_Hinge` that is **not** the twist morph — `Body_Twist_*` reads exactly 0 at frame 153. Source unidentified. |
>
> ### One place the file and the port disagree, where the PORT is right
>
> **`travel_far`'s flight is baked into the `.blend` at 2x speed** and finishes
> 4.4 s early, leaving the rest of its slot idle. The port at t = 667 ms
> reproduces the file's frame 2262 to four decimal places, and at t = 1334 ms its
> frame 2272 — an exact factor of two, so the path is identical and only the time
> parameterisation differs. Marker spacing settles it: across the whole timeline
> markers sit at `duration + ~900 ms` (happy 1560 -> 2467, curious 1420 -> 2300,
> point 1920 -> 2833), and `travel_far`'s 7833 ms slot implies ~6933 ms against
> the playbook's 6917. Compared at matching POSE time the frame scores 0.934;
> compared at matching wall-clock it scores 0.263 with a 69 px centroid error.

---

# Deck-E three.js port — frame-by-frame parity verification

Eight Blender reference frames compared against the three.js port driven to the
same state and intra-state time, at 720x720 through Blender's own camera and
backdrop (`?parity=1`).

Gateway spend for the vision second opinions: **$0.0725** (9 calls, `google/gemini-3-flash`
on all eight frames plus `openai/gpt-5.4` on two).

---

## 1. Headline

| # | Finding | Severity | Confidence |
|---|---------|----------|------------|
| 1 | Root translation `pz` is silently discarded for every state | **Major** | Certain |
| 2 | Brow / antenna-bolt travel is under-applied, badly so downward | **Major** | High |
| 3 | Alert star glyph is torn and vertically smeared | **Major** | High |
| 4 | At full gape the eyes render on the visible inner face of the lid | **Major** | High |
| 5 | Body shading contrast is compressed (shadows lifted, highlights dimmed) | Moderate | High |
| 6 | Pupil marginally oversized (not undersized) | Minor | Low — under concurrent edit |

**The `curious` sign canary is CLEAN.** He leans the same way in both. Details in §3.

Two previously recorded beliefs are **refuted**: the body is not uniformly
4–5% brighter (§7.5), and the pupil is not too small (§7.6).

---

## 2. Per-frame metrics

Whole-silhouette numbers from `compare.mjs`. `dx,dy` is the candidate centroid
minus the reference centroid, in pixels. Colour ratio is candidate/reference
over pixels both agree are the subject.

| Frame | IoU | area | centroid dx,dy | bbox Δ L,T,R,B | colour R,G,B | meanAbs |
|---|---|---|---|---|---|---|
| rest_0001 | 0.9511 | 0.997 | -1.4, 3.9 | 1, 6, -1, 3 | 0.986, 1.014, 1.013 | 13.1 |
| boot_pop_0035 | 0.9781 | 1.000 | 0.3, -0.2 | 1, -1, 1, 0 | 0.973, 1.012, 1.011 | 13.0 |
| thinking_0153 | 0.9610 | 0.999 | -2.8, -0.1 | -4, -3, -3, 0 | 0.890, 0.976, 0.981 | 13.0 |
| happy_peak_0298 | 0.8377 | 0.961 | 0.1, **29.7** | -1, 69, -1, 22 | 1.251, 1.167, 1.126 | 15.0 |
| sad_hold_0410 | 0.8627 | 1.014 | 1.3, **-19.0** | 6, -25, 4, -16 | 0.944, 1.013, 1.030 | 13.4 |
| curious_hold_0710 | 0.9599 | 0.989 | -1.8, 0.6 | -7, -1, -2, 0 | 1.004, 0.985, 0.989 | 7.9 |
| alert_star_1052 | 0.8529 | 0.960 | -0.7, **33.7** | 1, 74, -2, 26 | 1.383, 1.312, 1.256 | 17.6 |
| card_stash_gape_1834 | 0.8272 | 0.990 | **14.6, 14.8** | 4, 15, 4, 7 | 1.282, 1.486, 1.391 | 19.4 |

The four frames with IoU ≥ 0.95 and sub-4 px centroids (rest, boot, thinking,
curious) are as close as the unalignable idle-float phase allows. Every one of
the four poor frames is explained below, and three of them by a single bug.

### Substitution: frame 716 → 710

`curious_hold_0716.png` **caught a blink** and had to be re-shot. Reading the
lid controller straight off the rig, `Ctrl_LidU_L_anim` world Z holds ~2.14
across frames 700–714, collapses to 1.51 at 716–718, and recovers to 2.10 by
722 — a 6-frame transient, matching the 220 ms blink curve (70 close / 30 hold /
120 open). The `curious` clip itself only keys `lid_l 0.18`, so the closure is
the procedural blink layer, whose phase cannot be aligned by design.

I rendered a clean replacement at **frame 710** (still inside the curious hold,
lids stable at 2.14/1.95) and used it for all curious comparisons. I checked the
other seven frames the same way; none are contaminated. The .blend was left
untouched — `bpy.data.is_dirty == False` after every call, and every render
setting was snapshotted and restored.

---

## 3. The sign canary: does `curious` lean the same way?

**Yes. The lean sign is correct.** Established three independent ways.

### 3.1 Rig level — the decisive evidence

`lean` is not a rotation; it drives a shape key. Comparing the named morph
directly on both sides at frame 710:

| | Blender | three.js port |
|---|---|---|
| `Body_Lean_R` | **0.5673** | **0.5668** |
| `Body_Bend_Fwd` | 0.2686 | 0.2684 |
| `Mouth_Curve` | -0.28 | -0.28 |
| `Mouth_S` | 0.38 | 0.38 |

Same morph, same sign, agreeing to four decimals (the 0.0005 gap is the 1/30 s
sampling). There is no sign flip. Nothing about `Body_Lean_L` is active in
either.

### 3.2 Pixel measurement, in plain words

Horizontal centre of the body silhouette in the top decile of his height versus
the bottom decile (bolts excluded, since they swing independently):

| | top centre x | bottom centre x | top − bottom | reading |
|---|---|---|---|---|
| REF rest (baseline) | 365.4 | 378.9 | -13.5 | top tilts left of base |
| CAND rest (baseline) | 364.4 | 377.0 | -12.6 | top tilts left of base |
| **REF curious** | 338.3 | 368.3 | **-30.0** | top tilts left of base |
| **CAND curious** | 336.2 | 367.4 | **-31.2** | top tilts left of base |

In both images **the top of his body tilts toward the LEFT of frame**, and the
curious lean deepens that tilt relative to rest by -16.5 px in the reference and
-18.6 px in the candidate. Same direction, near-identical magnitude.

### 3.3 Control experiment — proving the detector can see a flip

A detector that says "matches" is worthless unless it would say "differs" when
the thing breaks. I forced `lean` to the same magnitude with the sign inverted
and re-measured:

| curious @ 710 | tilt (top − bottom) | IoU vs reference | centroid dx |
|---|---|---|---|
| reference | -30.0 | — | — |
| candidate as shipped | **-31.2** | **0.9599** | -1.8 |
| candidate, `lean` inverted | -17.2 | **0.8312** | -11.4 |

Inverting the sign drops IoU by 0.13 and moves the tilt measure 14 px. The
shipped build sits on top of the reference; a flip would have been loud.

### 3.4 Vision models

All nine judgements across both model families returned
`lean_same_direction: true`.

Caveat worth recording: the models are unreliable on *absolute* chirality —
gemini called rest "toward the right of frame" and curious "toward the left",
and gpt-5.4 called curious "right". They contradict each other and the pixels.
Their agreement that the two images match is meaningful; their absolute
direction calls are not. The measured answer is left, per §3.2.

---

## 4. Defect 1 — root translation `pz` is discarded (MAJOR)

`apps/web/src/character/decke/DeckE.ts:468-473`:

```js
} else {
  this.pose.px = this.anchor.x
  this.pose.py = this.anchor.y
  this.pose.pz = this.anchor.z
}
```

When no flight track is active, `evalState` fills `px/py/pz` from the clip and
then this branch **overwrites all three with the home anchor (0,0,0)**, throwing
away every authored root motion. The playbook data is correct; only the port
discards it.

Blender's rig versus what the port resolves:

| Frame | State | Blender `DeckE_Root` z | Port `pose.pz` | Playbook key |
|---|---|---|---|---|
| 1 | rest | 0.0000 | 0 | — |
| 298 | happy | **+0.2000** | **0** | `230:0.2` |
| 410 | sad | **-0.1500** | **0** | `1500:-0.15` |
| 710 | curious | +0.0016 | 0 | (≈0 here) |
| 1052 | alert_star | **+0.2400** | **0** | `330:0.24` |
| 1834 | card_stash | **+0.12** | **0** | `1900:0.12` |

Exactly the frames where Blender's root is non-zero are the frames that failed,
and the frames where it is ~zero are the frames that passed.

### Fix simulation

`overrides` are applied after the clobber, so pinning `pz` to Blender's value
shows what a fixed build draws:

| Frame | IoU before | IoU after | centroid dy before | dy after |
|---|---|---|---|---|
| happy_peak_0298 | 0.8377 | **0.9060** | +29.7 | **+4.4** |
| sad_hold_0410 | 0.8627 | **0.9493** | -19.0 | **-1.6** |
| alert_star_1052 | 0.8529 | **0.9281** | +33.7 | **+3.4** |

The vertical error collapses into idle-float noise (±5 px) in all three. Root
cause confirmed.

### Blast radius

**17 of 27 states** author root translation the port throws away:

```
listening pz[0.02..0.03]     happy pz[-0.04..0.2]      sad pz[-0.15..0.02]
curious pz[0.04..0.05]       proud pz[0.08..0.1]       card_stash pz[-0.08..0.14]
card_show pz[0.06]           card_present pz[0.05]     sleep pz[-0.14..-0.05]
alert_money / alert_star / alert_warn / alert_error / alert_dizzy /
  alert_scribble    px[-0.024..0.024]  pz[-0.06..0.42]
travel_point  px[-1.413..0.0377]  pz[-0.0208..0.2991]
travel_far    px[-10.09..0.099]   py[-0.050..11.836]  pz[-5.251..0.009]
```

The six alert states lose a 0.42 BU anticipation crouch/pop — the largest
non-travel excursion in the playbook, and the one that makes the mode switch
read. The travel states are spared only while a flight track is driving them.

---

## 5. Defect 2 — brow / antenna-bolt travel under-applied (MAJOR)

The gold lightning bolts are the *brows* (`Brow_L_anim` / `Brow_R_anim`, driven
by the `brow` channel). Comparing their world position directly, with `pz`
re-injected so this is not confounded by Defect 1:

| Frame | `brow` | Blender Brow_L z | Port Brow_L z | travel vs rest (Blender → port) | port / Blender |
|---|---|---|---|---|---|
| 1 (rest) | 0.00 | 2.4347 | 2.4030 | — | — |
| 298 happy | +1.00 | 3.5790 | 3.2939 | +1.144 → +0.891 | **78%** |
| 1052 alert | +0.95 | 3.8748 | 3.6050 | +1.440 → +1.202 | **83%** |
| 410 sad | -0.78 | 2.1286 | 2.3347 | -0.306 → -0.068 | **22%** |

Raising is ~20% short; **lowering is 4.5× short**. The asymmetry suggests the
downward half of the brow curve is clamped or mis-scaled rather than a single
uniform gain error.

Also at `sad`, Blender's two brows sit at different heights (L 2.1286, R 2.0066
— a 0.122 BU tilt) while the port holds them level; a per-side brow asymmetry is
not being applied.

This is the residual the vision models kept describing as "the antennae sit much
lower / float much higher". After the `pz` fix the bolt centroid is still off by
+40 px (happy), -40 px (sad) and +88 px (alert_star).

In calm states the bolts are fine — gold-mask centroid delta is +2.3 px (rest),
+2.6 px (boot), -1.0 px (thinking), -3.2 px (curious). The defect only shows
where `brow` travels.

---

## 6. Defects 3 and 4 — eyes

### 6.1 Alert star glyph is torn (MAJOR)

Blender draws a clean, complete five-pointed gold star centred in each eye with
a thin lid line across it. The port draws the star **vertically smeared and torn**:
the lower half degenerates into a dithered pale streak, a hard black horizontal
bar replaces the thin lid line, and the whole glyph sits too high in the eye.
gemini independently flagged "vertically compressed with a distinct horizontal
artifact line crossing through the center". Crop: `alertglyph.png`.

### 6.2 Eyes render on the inside of the gaping lid (MAJOR)

At `card_stash` full gape the lid hinge angle is **exact** — Blender
`Lid_Hinge_anim.rotation.x = -105.102°`, port `-105.102°`. But Blender shows a
plain teal inner lid panel, while the port draws **both eyes and the mouth line
on the lid's visible inner face**.

Eye world position (Blender axes) at frame 1834:

| | x | y | z |
|---|---|---|---|
| Blender `Eyeball_L_anim` | -0.3917 | **+0.5836** | 3.5625 |
| Port | -0.4122 | **+0.7812** | 3.5063 |

The port's eye sits **0.198 BU further back**, pushing it through the lid onto
the side facing camera. At rest the same eye agrees to 0.03 BU, so this is
specific to the extreme hinge angle. gemini flagged it independently ("displays
eyes and a mouth line on the interior of the lid"). Crop: `lid_check.png`.

---

## 7. Confirmations, refutations and non-defects

### 7.1 Gape angle — matches exactly
`-105.102°` on both sides. The gape itself is correct; the card textures and
flight inside the mouth are the known-unimplemented items.

### 7.2 Squash / stretch — correct
| Frame | Blender squash | Port squash |
|---|---|---|
| 298 happy | 1.2200 | 1.2194 |
| 1052 alert_star | 1.3000 | 1.2969 |
| 410 sad | 1.0000 | 1.0000 |

Within 0.25%. An early reading of mine that the candidate was "9% shorter" was
**wrong** — the body bounding box was being pinned by the bolts' anti-aliased
fringe, which fails a strict gold test and got counted as body. With the gold
mask dilated by 4 px the body heights agree to within 2 px on every calm frame.
Recorded because it is exactly the class of error this project keeps hitting.

### 7.3 Lean/bend morphs — correct
See §3.1. `Body_Lean_R`, `Body_Bend_Fwd`, `Mouth_Curve`, `Mouth_S` all match to
four decimals at frame 710.

### 7.4 Bolts in calm states — correct
Within 3 px on rest, boot, thinking, curious.

### 7.5 REFUTED: "body is a uniform ~4–5% brighter, no hue shift"

Not what I measure. Luminance percentiles over body pixels only
(registration-free, ~65k pixels per frame), candidate / reference:

| Frame | p05 | p25 | p50 | p75 | p95 | mean |
|---|---|---|---|---|---|---|
| rest_0001 | 1.591 | 1.696 | 0.753 | 0.903 | 0.929 | **0.989** |
| thinking_0153 | 1.650 | 1.624 | 0.754 | 0.840 | 0.933 | **0.982** |
| curious_0710 | 1.125 | 1.109 | 0.897 | 0.842 | 0.987 | **0.937** |
| happy_0298 * | 1.728 | 1.797 | 0.924 | 0.948 | 1.122 | **1.101** |
| sad_0410 * | 1.655 | 1.547 | 0.892 | 0.888 | 1.010 | **1.015** |
| alert_star_1052 * | 1.780 | 1.710 | 0.894 | 0.838 | 0.964 | **1.043** |

\* measured on the `pz`-aligned capture.

The **mean matches within 1–10%** — there is no uniform 4–5% brightening. What
is real and highly consistent is a **contrast compression**: the shadow end is
55–80% brighter in the browser while the midtones and lit surfaces are 6–16%
dimmer. The reference body spans p05 52.7 → p95 173.5; the candidate spans
83.8 → 161.3, about 35% less range. This reads as ambient/IBL doing too much of
the work relative to the key light — plausibly the Blender scene's dedicated
`FaceLight` (and `FaceLight_mir`) not being reproduced.

Worth re-triaging: the old "uniform 5% brighter" note should be replaced.

### 7.6 REFUTED: "pupil may be too small"

Measuring the pupil as the hole in the sclera (no brightness threshold — the
pupil carries a strong gradient in both renderers, so any darkness cutoff
measures the gradient instead), left eye at rest:

| | eye H | pupil H | pupil H / eye H |
|---|---|---|---|
| Reference | 141 | 110 | **0.780** |
| Candidate | 138 | 114 | **0.826** |

The candidate pupil is **6% larger** relative to eye height, not smaller.
gemini agreed unprompted ("the blue iris/pupil regions are significantly larger
in the candidate"). Blender's own value, 0.78 of eye height, is close to the
~70% recorded in the wiki.

Low confidence on persistence: another agent was editing `eyes/eyeMaterial.ts`
throughout this session, so this measures a moving target.

### 7.7 Process note — a transient broken build

My first capture batch caught the eye shader mid-edit: the eyes rendered as
red/green RGB dither noise with no shader warning in console. `eyeMaterial.ts`
had been written two minutes earlier. I discarded that batch and re-captured
everything after the shader recovered.

Every number in this report comes from one consistent pass. I re-shot frame 1 at
the end of that pass and diffed it against frame 1 at the start: **IoU 1.00000,
meanAbsDiff exactly 0** — the build held still and the frame pinning is fully
deterministic.

---

## 8. Method notes

- **Pinning.** `shoot.mjs` waits 1.5 s after running its script, during which a
  free-running rAF loop would advance `elapsed` by 1.5 s — three whole clips for
  a 640 ms state. `capture.mjs` cancels the loop and re-renders the *same*
  instant on a 40 ms timer until the shutter. Verified deterministic (above).
- **Idle float.** Rather than leave the phase wherever page load put it, I
  reconstruct Blender's integral — `tau(F) = ∫ float_rate dt` from frame 1,
  walking the marker timeline — and pin `proc.float.tau` to it. This makes runs
  reproducible; it does not make the phase provably correct, so a few pixels of
  residual position noise remain expected and are not reported as defects.
- **Instrument discipline.** Two of my own measurements gave confident wrong
  answers before being caught: a gold-bolt classifier that swallowed the eye
  region (when the eyes were rendering as noise) and led me to "the bolts fly
  70 px higher", and a body bounding box pinned by bolt anti-aliasing that led
  me to "the body is 9% shorter". Both were caught by dumping the mask and
  looking at it. Every classifier used here writes its mask out.
- The .blend was treated as read-only throughout: settings snapshotted and
  restored in `finally`, `bpy.data.is_dirty == False` verified after every call.

## 9. Suggested fix order

1. **`pz` clobber** (`DeckE.ts:468-473`) — one branch, 17 states, three of the
   four failing frames. Highest value by a wide margin.
2. **Brow travel gain**, especially the downward half.
3. **Alert glyph tearing** — affects all six alert states.
4. **Eye depth at extreme lid angles** — cosmetically severe but only at full gape.
5. **Shading contrast / missing face light** — systematic but subtle.
6. **Pupil size** — currently ~6% large; coordinate with whoever is editing the
   eye material.
