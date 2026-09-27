---
date: "2026-08-18"
title: "Deck-E: parentage beats analysis, three times over"
decided_by: "Claude (measured), for @cheyras."
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-18 — Deck-E: parentage beats analysis, three times over
**Decided by:** Claude (measured), for @cheyras.

Three separate placement errors in the port turned out to be the same mistake:
a relationship the `.blend` expresses as **parentage** had been reimplemented
analytically. Each was found by measuring one pose against the live file, and
each is now driven the way the file drives it.

**1. The lid pivot is a matrix pair.** `Lid_Hinge = Cf·MouthRot` and
`DeckBox_Lid = Cf⁻¹·T(H_rest)` — that much was already known — but the port set
only `rotation.x` on each node and left both *positions* at their rest values.
`DeckBox_Lid.location` is keyed in the file and reaches `(0, 0.152263, -0.117046)`
at the full gape: it is `R(-Cf)·(H_rest − F)`, the counter-translation that keeps
the lid's origin on the hinge once the field has moved the hinge to `F`. Ignoring
it put the lid **0.313 BU** out of place. Driving both nodes as full local
matrices reproduces the file to 2e-6 at frame 1834 and 4e-6 at frame 716, and
took `card_stash` from IoU 0.830 / 18.5 px to **0.904 / 10.0 px**. Taking only the
X euler of `Cf` also discarded its lean and twist; frames 300 and 700 carry real
Y and Z rotations on both nodes, as exact negatives of each other.

**2. `Eye_Rig` is VERTEX_3-parented to the *morphed* lid** (verts 1975/2095/1935),
so it tracks the shape keys, which the analytic field cannot represent. On the
rider system it sat ~0.05 BU proud of the lid panel, and since the eyeball is a
shallow lens only 0.012 BU behind that panel, that was enough to draw the face on
the **inside of the open lid**. Two facts made a portable implementation possible:
Blender's `ob_parvert3` builds its frame from *local* vertex coordinates and
premultiplies the parent's world matrix (so the lid's non-uniform world scale,
0.92/1.12/0.99 at the gape, applies after, not before); and an orthonormal basis
built from the triangle the obvious way equals `tri_to_quat` **exactly** —
solving for the residual gives the identity at rest and a pure uniform 0.97971 at
the gape, which is the rig's own `delta_scale` driver rather than a frame
mismatch. Result: `Eye_Rig`'s world matrix matches the file to **1e-6**.

**3. The brow sockets hang off `Eye_Rig`, not off the lid**, and so inherit that
morph tracking for free. Riding them on the field cost up to **0.36 BU**; at
`card_stash` the error was 0.2602, exactly `Eye_Rig`'s own morph displacement
there. Letting them inherit dropped 23 of 27 states below 0.07 BU, most below 0.02.

**Also settled:**
- **Ship meshopt, never quantize.** `KHR_mesh_quantization` parks a
  de-quantisation transform on each mesh's *node*, and the rider system writes the
  whole TRS of those nodes, discarding it — `Hinge_Pin_R` inflates into a cylinder
  wider than the character and every parity frame loses 5–10 IoU points at a
  uniform area ratio of 1.08. meshopt alone ships the asset at **2.92 MB** (from
  7.48 MB). Quantizing would reach 1.39 MB and is not worth it. Reproducible via
  `scripts/decke/shrink.mjs`.
- **Blink and idle float are deliberately NOT frame-matched.** Both are seeded
  procedural layers in the port and baked curves in the file. This is the largest
  remaining parity residual (~0.069 BU of centroid error, and up to 0.05 IoU on
  the two frames that catch a blink) and it is correct behaviour — he has to idle
  and blink indefinitely, not replay 5211 frames.

**The lighting residual was an unported EEVEE setting, not missing occlusion.**
It had been recorded for weeks as "shadows 24-37% too bright", which pointed at
occlusion, and that was wrong. What found it was bucketing the residual by
**surface normal** instead of by pixel: `rest`'s up-facing lid top was **+44%**
while its front face was +5%, and the lid top is unoccluded, so no shadow or AO
term can touch it. Inverting AgX put that in linear terms — 7.3x too bright.

The cause is `scene.eevee.clamp_surface_indirect = 10.0` (with
`clamp_surface_direct = 0.0`). It is a **firefly clamp, so it acts per SAMPLE,
not on the result**, and that distinction is the entire fix. Capping the finished
IBL lookup at 10 moves this scene by 0.08%. Capping the HDRI **texels** that feed
the lookup changes it enormously, because `studio_small_09` runs to radiance 560
against a sphere mean of 0.86 — a handful of lamp texels dominate any wide
roughness lobe that happens to contain them. On the lid top the raw sample along
the reflection vector is 0.24, but the roughness-0.30 GGX lobe around it
integrates to **6.37**; per-texel capping brings that to 1.09 (Blender measures
~1.5) while leaving the front face 1.127 -> 1.122 and the right face
0.073 -> 0.072 untouched. That SELECTIVITY is the evidence: the residual had
exactly that shape, and no uniform brightness correction reproduces it.

`clampEnvironmentTexels()` in `stage.ts` runs one pass over the source texels at
load, before `PMREMGenerator`. **Zero per-frame cost** — no extra draw call, no
pass, no texture memory; the prefiltered cube is unchanged in size. Colour
transfer on `rest` went 1.123/1.089/1.083 -> **1.039/1.038/1.035**, with all six
stable IoUs held within 0.003.

The constant is Blender's measured 10.0 and is deliberately NOT tuned. A clamp of
5 scores better on three frames and worse on `card_stash`; tuning a measured
constant to absorb an unrelated error is how this project got burned before.

There IS still a real occlusion residual underneath, now that the larger error is
out of the way, and it was bounded rather than fixed. Zeroing the area lights
gives the maximum any shadow system could achieve: `rest` 0.870 and `stash_gape`
0.932 both bracket 1.0, so direct-light shadows could help there — but
`card_present`'s blue is **1.055 even fully shadowed**, so part of the remainder
is necessarily ENVIRONMENT occlusion, roughly 15-30% AO by the crude
`environmentIntensity` test. Neither half was judged affordable: three's
`RectAreaLight` cannot cast shadows at all, and the two dominant lights are 6x6
and 7x7 softboxes whose shadows are very soft, so approximating them with hard
shadow maps would likely hurt parity rather than help; and the environment half
needs GTAO (a post stack) or a baked `aoMap` that could not follow the 115 degree
lid anyway. Against an explicit "must run smoothly on mobile" requirement, that
is not a trade worth making for a few percent.

**A dev-only route needs its `import()` gated, not just its `beforeLoad`.** The
route was correctly unreachable in production — `beforeLoad` throws `notFound()`
outside `import.meta.env.DEV` — but the lazy `import()` was still reachable in the
module graph, so rollup emitted the chunk, and **`vite-plugin-pwa` put it in the
precache manifest**. Every production user was downloading 945 kB of three.js
they could never reach. Moving the whole route construction (the `import()`
included) inside a `if (!import.meta.env.DEV) return []` guard makes the chunk
genuinely absent: the precache went from 26 entries / 2887.59 KiB to 25 /
1963.86 KiB, and the difference is exactly the chunk. Unreachable is not the same
as unshipped, and the PWA manifest is where that distinction bites.

**Correction to the entry above:** that entry says the "105.10 : 9.85 share" was
fitted from one frame and is wrong everywhere else. That stands, but the numbers
deserve their explanation: at frame 1834 the pivot correction `Cf` genuinely is
9.85°, because the field's pitch at the hinge is `bend · z_hinge / H` and the
authored bend there works out to exactly that. The share model reproduces that one
frame for a real reason, which is why it survived inspection.

