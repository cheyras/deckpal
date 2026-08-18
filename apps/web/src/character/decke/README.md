# Deck-E — three.js character runtime

A stylized robot deck box who will eventually be the AI assistant's body: the LLM
drives his animation from the conversation, and when he presents part of the UI
he parks beside that element facing inward.

**Preview:** `/dev/decke` — always in dev, owner-only in production. **Status:** complete and measured against the `.blend`; see `PARITY.md` for what is and is not matched.

He is authored in Blender in a separate working directory —
`~/Documents/DeckPal Character/` — which carries its own extensive wiki. That
wiki is the design record; **the `.blend` is the authority** (its regeneration
chain died on 2026-08-17, so several wiki pages are stale — see below).

---

## How he works

```
playbook.json ──> pose (47 normalised channels) ──> rig ──> morphs + nodes + shader uniforms
                        ▲            ▲
      procedural layers ┘            └ flight solver / LLM channel overrides
```

There is **no `AnimationMixer` and no glTF animation.** The `.glb` carries
geometry, materials and morph targets only. Every frame we evaluate a
47-channel pose and fan it out. `DECISIONS.md` (2026-08-18) records why; the
short version is that one channel drives several rig targets through non-linear
mappings, and an `AnimationClip` cannot answer "40% of the way to a frown".

| File | Does |
|---|---|
| `DeckE.ts` | the controller. Owns the loop and the public API. Never imports React. |
| `stage.ts` | renderer, camera, colour management, the six-light rig |
| `rig.ts` | binds glTF nodes; applies a pose to them |
| `field.ts` | the analytic deformation field |
| `riders.ts` | keeps everything that is not a shell attached to the shells |
| `cards.ts` | the orbit, the hands, the presented card and the stash flight |
| `playbook.ts` / `curve.ts` | the 27 states, and Blender-compatible curve evaluation |
| `procedural.ts` | idle float, blink, gaze — seeded and deterministic |
| `flight.ts` / `dom.ts` | travel, and choosing where beside an element to stand |
| `commands.ts` | the JSON surface an LLM drives |
| `eyeSocket.ts` | `Eye_Rig`'s VERTEX_3 parenting to the morphed lid |
| `materials.ts` | fixups for what the glTF exporter flattened |
| `eyes/` | the analytic eye shader |

## Driving him

```ts
decke.setState('happy')
decke.setOverlay('talk', 1)          // an overlay, never a base state
decke.setFacing(-1)                  // continuous [-1, +1], animated over 867ms
decke.flyTo({ selector: '#deck-list' }, { depth: 'foreground', side: 'auto' })
decke.setChannel('bend', 0.37)       // pin a raw channel; null releases it
```

Or declaratively, which is what the eventual tool call carries:

```jsonc
{ "commands": [
    { "op": "state",  "value": "happy" },
    { "op": "facing", "value": "left" },
    { "op": "flyTo",  "selector": "#deck-list", "depth": "foreground" },
    { "op": "talk",   "value": true }
] }
```

`runCommands()` **rejects rather than clamps** — an unknown state comes back with
the list of legal ones. A model that gets silently corrected learns nothing.

---

## Things that will bite you

Each of these cost someone a debugging pass, upstream or here.

- **Drive morph targets by NAME across every mesh.** `DeckBox_Base` exports as
  two primitives split by material, each with its own full copy of all ten
  targets. Drive one and not the other and the shell tears down the mouth.
- **The field is a BODY-SPACE operation.** Applying `field_matrix` as an absolute
  world transform makes the parent-inverse cancel the root's travel, and every
  rider stays behind at the origin — on screen, two characters.
- **A crossfade must snapshot the BASE pose, not the composited one.** `pose`
  accumulates the talk overlay, the procedural layers, the resolved facing and
  the parked anchor. Snapshot that as the blend's `from` and every one of them
  gets applied twice — measured at 1.4 world units of teleport on any `setState`
  while parked, which is the flyTo-then-emote path exactly. `basePose` exists
  for this.
- **Never scale wall-clock by a rate; integrate the rate.** `IdleFloat.advance`
  says so and the blinker did it anyway: with `t * rateMul` and a monotonic
  cursor, lowering the rate makes the clock jump backwards and he stops blinking
  for minutes. The same shape of bug is waiting in any layer with a schedule.
- **Facing resolution must run AFTER the procedural layers.** Resolve first and
  the gaze flits bypass the `gx` negation, so every glance goes the wrong way at
  `facing = -1`.
- **`mouth` is a composite** — hinge, whole-body tip, and a back-arch morph. The
  arch has to feed the deformation field or riders drift off the shells on every
  syllable of talk — and it SATURATES at `mouth = 1`, as does the whole-body tip;
  only the hinge angle keeps opening to the 2.09 gape.
- **The lid pivot is a MATRIX pair, not an angle pair.** `Lid_Hinge = Cf·MouthRot`,
  `DeckBox_Lid = Cf⁻¹·T(H_rest)`, so the composite rotates about the *deformed*
  hinge and collapses to `T` at mouth 0. Two ways to get this wrong, both of which
  happened: fitting a fixed "105.10 : 9.85 share" from one frame (it invents a lid
  rotation on every mouth-open pose that has no bend); and setting only
  `rotation.x`, which leaves out `Cf`'s lean/twist AND both nodes' translations.
  `DeckBox_Lid.location` is keyed and reaches `(0, 0.152263, -0.117046)` at the
  full gape — leaving it at rest put the lid **0.313 BU** out of place.
- **`Eye_Rig` is VERTEX_3-parented to the MORPHED lid**, so it follows the shape
  keys and no analytic field can stand in for it. Off by 0.05 BU the eyeball —
  a shallow lens sitting 0.012 BU behind the panel — pushes through and the face
  draws on the inside of the open lid. `eyeSocket.ts` owns this.
- **The brow sockets are children of `Eye_Rig`, not of the lid**, and they carry a
  small keyed follow-through of their own: as the body bends they COUNTER-rotate,
  about 0.104 rad per unit of effective bend, about a fixed pivot. `rig.ts` models
  it (`BROW_FOLLOW`) and `__tests__/brows.test.ts` pins it. Putting them in the
  rider list instead cost up to 0.36 BU; inheriting but ignoring the
  follow-through still cost 0.067. Note the character wiki says something else
  entirely here — it lists them as lid riders at `H_mouth * field(P)` — and the
  file contradicts it twice: the parentage, and the fact that their world
  position is measurably not `field(P)`.
- **The SDF glyph atlas must stay 16-BIT.** It is the largest single asset after
  the mesh (1.07 MB, 2560x1024 RGB16) and looks like an obvious thing to shrink;
  an 8-bit greyscale version is 0.18 MB. It does not work. The eye shader maps
  the glyph edge over `[0.4985, 0.5020]` — a band **0.0035** wide, narrower than
  one 8-bit step (0.0039), so the entire antialiased edge collapses to a single
  quantisation level. The channels are also not duplicates: `.r` is the glyph and
  `.g` is a second layer (`.b` is unused).
- **Never quantize the glb.** `KHR_mesh_quantization` parks a de-quantisation
  transform on each mesh's *node*, and `riders.ts` overwrites the whole TRS of
  those nodes. `Hinge_Pin_R` inflates into a cylinder wider than the character.
- **Cameras convert differently from objects.** Objects are `C·R·C⁻¹`; a camera
  is `C·R`, because Blender and glTF cameras already share the −Z-forward
  convention. Getting it wrong aims the camera along its up axis.
- **`alert` is a reel POSITION, not an opacity.** Values outside [0,1] are legal
  and are what produce the bounce. Never clamp it, never multiply the symbol by it.
- **One renderer per canvas.** React 19 StrictMode double-invokes effects, and two
  `WebGLRenderer`s on one canvas silently share a GL context.
- **Blender's EEVEE firefly clamp has to be ported onto the HDRI TEXELS.**
  `clamp_surface_indirect = 10.0` acts per sample, not on the result: capping the
  finished IBL lookup moves this scene 0.08%, capping the source texels before
  PMREM changes it enormously, because `studio_small_09` runs to radiance 560
  against a sphere mean of 0.86. Unported, his up-facing surfaces were 7.3x too
  bright in linear terms. `clampEnvironmentTexels()` in `stage.ts`.
- **Diagnose lighting residuals by SURFACE NORMAL, not by pixel.** That is what
  identified the above: the up-facing lid top was +44% while the front face was
  +5%, which is not a shape any occlusion term can produce, and the residual had
  been mis-filed as "missing shadows" for weeks on the strength of a per-pixel
  read.
- **The environment and the lights are both required.** He is metallic 0.85;
  with nothing to reflect he renders near-black, and Blender's area lights were
  *trimmed* when the HDRI was added rather than removed.

## Wiki pages that are stale

The `.blend` wins. Verified wrong at the time of writing:

| Page says | Actually |
|---|---|
| environment strength 2.6 | **0.6**, with no multiply node |
| HDRI rotation 215°, static | **261°**, and *driven by facing* to 341.4° |
| gaze flit amplitude 0.16 / 0.11 | **0.68 / 0.46** (recalibrated; the old value moved the pupil ~1px) |
| pupil roam 0.0570 × 0.1420 | **±0.115 × ±0.225** |
| `Eye_Stabilize` exists, defaults 0 | **does not exist in the file at all** |
| `thinking` is a stepped register | rebuilt as a spring rock with **zero** step beats |
| the grain normal map was never wired | it **is** wired (a different 2-node material was inspected) |
| the brow sockets are lid riders at `H_mouth · field(P)` | they are children of `Eye_Rig`, with a keyed follow-through of their own |

---

## Verifying it

Parity is checked against ground truth, not vibes. The fixtures are produced by
**executing the character wiki's own Python**, not by re-transcribing it.

```bash
# unit + parity tests (48)
node --import tsx --test "apps/web/src/character/decke/__tests__/*.test.ts"

# regenerate the playbook, or assert it still matches its sources
python apps/web/scripts/decke/gen-playbook.py [--check]
blender -b "$BLEND" -P apps/web/scripts/decke/gen-cards.py -- [--check]
python apps/web/scripts/decke/gen-field-fixture.py
python apps/web/scripts/decke/gen-proc-fixture.py
```

Current: field matches to **1e-9** on position and **1e-6** on the rider matrix;
PRNG, idle float and blink curve to **1e-12**; `Eye_Rig`'s world matrix under
VERTEX_3 parenting to **1e-6**; the lid pivot pair to **2e-6**.

Silhouette IoU across **14** reference poses runs **0.90–0.99**, plus three clips
compared frame-by-frame (a spin, a head shake, mouth cycling) because a pose
error shows in a still and a TIMING error does not. `PARITY.md` has the per-state
numbers and, more usefully, the list of what is knowingly *not* matched.

The sweeps pin the blink cursor and the idle float's clock. Without that, two
identical runs differ by up to **0.045 IoU** — `card_stash` alone swung 0.907 to
0.952 — which is enough to hide a regression or invent one.

The harness itself is in `apps/web/scripts/decke/parity/`; it needs Playwright,
which is deliberately not a repo dependency.

For image comparison, `/dev/decke?parity=1` puts the browser on Blender's exact
camera and backdrop. `markers.json` maps every Blender timeline frame to its
state, which is what makes frame-by-frame comparison possible.

## The cards

Built last, because the per-card XYZ waypoints are **absent from every source** —
`gen-playbook.py` says so in as many words. They are not absent from the `.blend`,
so `scripts/decke/gen-cards.py` reads them back out of the baked F-curves into
`public/models/decke/cards.json`, and `cards.ts` consumes that. Five things there
will bite you, and each cost someone a debugging pass:

- **Existence is SCALE, not opacity.** `card_l`/`card_r`/`single` at 0 mean the
  card is genuinely despawned.
- **`hand_l`/`hand_r` are a 3-POINT path** — 0 stowed, 0.5 out to his side at
  |x| = 2.05, 1.0 presented in front. Lerping 0 → 1 drives the card through his
  body. (Verified: all 15 authored `Hand_R_Ctrl` keys reproduce from those three
  waypoints to 4.7e-07.)
- **Orbiting, flying and stashed cards get NO facing compensation.** Two earlier
  attempts to keep them camera-facing both made it worse.
- **The presented card takes a gated self-mirror**, `k = 1 - present·(1 - facing)`
  applied to `loc.x`/`rot.y`/`rot.z` at *every* node of the chain. It is a mirror,
  not an un-turn, and there are **three** loose-card beats of which only
  `card_present` and `travel_point` are presentations.
- **The orbit is ONE continuous rotation** on `Orbit_Root`, 2700 ms per turn —
  deliberately not the 1800 ms `loading` loop, so it must be driven from
  *unwrapped* state time.

The `Card_Front_*` materials needed one fixup (`materials.ts`): glTF flattened a
58-node holographic graph down to an `emissiveFactor` of `[1,1,1]` at full
intensity, so the card emitted pure white and the artwork washed out completely.
Driving the emissive from the base colour map at Blender's own Emission Strength
of 0.25 restores both things that matter — the sheen is weak, and it is tinted by
the artwork rather than by white.
