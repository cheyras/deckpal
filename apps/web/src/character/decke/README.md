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

**A state is something he STAYS in.** Every clip runs as
`intro → sustain → outro`: it plays in, then loops a window of ITSELF until
something else is asked for. Without that, a clip plays once and holds its last
beat — and because almost every clip's last beat is the rest pose, "be happy"
means "be briefly happy, then be nothing". `sustain.ts` owns the windows and
why each one is where it is. Only `boot` and the two `travel_*` clips end by
themselves.

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
| `sustain.ts` | the loop window per state, the synthesized `idle`/`sleep`/outro clips |
| `look.ts` | where the pupils point — the camera constraint that could not export |
| `entry.ts` | the entrance: the whole-body scale on the rig root, and its centre pivot |
| `framing.ts` | how he is SEEN wherever he stands: canonical yaw, no lean, vertical angle by height |
| `beacon.ts` | where the off-screen chip goes, and how far to scroll to bring him back |
| — | the highlight ring is `components/ui/elementHighlight.ts`, in the design system |
| `commands.ts` | the JSON surface an LLM drives |
| `eyeSocket.ts` | `Eye_Rig`'s VERTEX_3 parenting to the morphed lid |
| `materials.ts` | fixups for what the glTF exporter flattened |
| `eyes/` | the analytic eye shader |

## Driving him

```ts
decke.setState('happy')                        // ...and STAY happy
decke.setState('nod_yes', { mode: 'once' })    // one nod, then idle
decke.setState('thinking', { durationMs: 4000, then: 'listening' })
decke.setOverlay('talk', 1)                    // an overlay, never a base state
decke.setFacing(-1)                            // continuous [-1, +1], over 495ms
decke.flyTo({ selector: '#deck-list' }, { then: 'point' })   // fly, ring it, point
decke.highlight('#deck-list')                  // ring it without moving
decke.setChannel('bend', 0.37)                 // pin a raw channel; null releases it
decke.playKeyframes(beats, { loop: true })     // an agent-authored clip, as a state
decke.setStashCount(9)                         // 9 cards, on the placeholder art
decke.setStashCards(cards, { autoClose: true })  // THESE cards, batched, closing at the end
decke.setCardArt('card_r', card)               // the card he holds up in card_present
decke.scrollIntoView()                         // bring him back when he has scrolled off

decke.setEntryScale(0)                         // absent: no body, not a faded one
decke.playEntry()                              // grow from nothing where he stands -> returns ms
decke.playEntry({ from: 1, to: 0 })            // the same curve the other way: a shrink, on its own clock
decke.flyTo(chip, { scaleTo: 0, arrived: tuck })  // the EXIT: shrink rides the flight, gone == landed
decke.setReducedMotion(true)                   // the HOST reads the media query; this is the answer
decke.flyTo(mark, { centre: true, facing: -1 })  // face the composer, not away from it
decke.flyTo(mark, { instant: true })           // arrive without travelling (ring, `then`, station: yes)
```

**The entrance** is CONCURRENT, not sequential — this changed in the 2026-08-24
animation pass, on the owner's ruling: *"he should just be scaling up during
the hop, really, so that it feels snappy."* Place him (`flyTo` the launcher's
rect, `instant: true`) with `setEntryScale(0)` already holding him absent, then
`playEntry()` immediately — and launch the travel leg as soon as its
destination is measurable, WITHOUT waiting for the grow to land. Scale
(`entryNow`) and flight (`track`) are independent per-frame machines that
`applyPose` composes every frame, so the grow's tail overlapping the hop is
supported, on purpose. (`playEntry({ onDone })` still exists and still fires on
the landing frame; it is simply no longer how the entrance sequences travel.)

**The exit** is the entrance's mirror, and it lives in ONE call: `flyTo` the
launcher's rect with `scaleTo: 0`. The shrink is driven by the flight's own
progress — eased toward the destination end, so he flies most of the way at
size and dives into the target — which makes "gone" and "landed" the same
frame by construction. Never approximate this with a timer against a flight
whose duration is solved, not chosen; that is the 520 ms mid-air wink-out the
`arrived` callback was built to end. A flight replaced before it lands fires
its `arrived` with `aborted: true` and skips the ring and the `then` state.

The scale is on `DeckE_Root` and pivots about his CENTRE —
`setCharacterHeight` is the wrong knob for this and always will be, it dollies
the camera, so scaling toward zero sends the camera toward infinity. (The
dolly grew up too: `DeckE.setCharacterHeight` — the public one, not the
`Stage` internal — re-solves his station in the same frame, so the "measure,
THEN move" hand-ordering call sites used to carry is now the engine's own
invariant.) See `entry.ts`.

**Reduced motion** is a flag in, never a media query here: the host owns the
query, the engine owns the behaviour. `reduced` (an option, or `setReducedMotion`)
turns every flight into a CUT — he still lands, still takes the station, still
turns, still rings and still enters `then` — and makes `playEntry` a no-op at
full size. `{ instant }` on the call overrides it either way.

Or declaratively, which is what the eventual tool call carries:

```jsonc
{ "commands": [
    { "op": "state",  "value": "happy" },
    { "op": "facing", "value": "left" },
    { "op": "flyTo",  "selector": "#deck-list", "then": "point" },
    { "op": "talk",   "value": true }
] }
```

`state` carries `mode: "once"`, `durationMs` and `then`, so the model can say
either "hold this" or "do this for a beat and go back to idle" — which for
`nod_yes` and `shake_no` is the whole difference between a nod and nodding.
`highlight` / `clearHighlight` ring the element under discussion, and
`keyframes` lets a model author a clip of its own when nothing in the roster
fits; it compiles through the same path as the playbook, so it is a state like
any other.

`cardArt` puts a specific catalog card on one of the four faces he shows, and
`state` on `card_stash` takes `cards: ["sv3pt5-25", …]` — card IDS, never image
URLs, so a model cannot express "load this arbitrary image into the page". Any
length: past twelve it plays in batches, and `autoClose` decides whether the last
batch hangs (the default) or he finishes and shuts the lid.

`runCommands()` is **async**, because naming cards is a catalog lookup and the
rule below only works if an unresolvable id can be waited for and reported.

It **rejects rather than clamps** — an unknown state comes back with the list of
legal ones. A model that gets silently corrected learns nothing. The exceptions
are the ones where the request is REASONABLE but cannot be honoured in full: a
`count` or a `cards` list longer than a run can carry clamps, and says what it
dropped in `notes[]`. An agent that has just added two hundred cards is not wrong
to say two hundred — but it must not be left believing all two hundred went in.

---

## Where he is, and how he is seen

Two different problems, and conflating them is what made him lean.

**Where he stands** is a STATION — `home`, or a promise to stay beside a DOM rect
— not a coordinate. It is re-solved when the page scrolls or resizes, so a
presentation stays pinned to the thing it is presenting, and home follows the
viewport. He starts at home.

**How he is seen** is `framing.ts`. The Blender camera is fixed and aimed at the
origin, so parking him anywhere else changes the 40.195-degree 3/4 angle the
facing system is defined against, and a camera pitched down keystones anything
off to one side into a lean. Every position therefore gets its own view frame and
he is rotated into it — and then the ELEVATION part of that correction is given
back on purpose, so his vertical angle still follows his height on the page: high
on screen you look up at him, low on screen you look down. The lighting rig and
the environment take the same transform.

At the world origin the whole solve is the identity. That is what keeps
`PARITY.md` meaningful, and `__tests__/framing.test.ts` pins it.

Scroll him out of the viewport and a **beacon** appears at the edge: a 52 px chip
with a pointer aimed at him and a live second render of the scene inside it, so
it shows what he is actually doing. Clicking it smooth-scrolls him back to
centre. The second render is a scissored pass on the same canvas — never a second
`WebGLRenderer`, which would mean a second GL context on a canvas that already
enforces one instance.

---

## Things that will bite you

Each of these cost someone a debugging pass, upstream or here.

- **`playbook.json` is generated, and it now carries hand edits.** The generator
  has been broken since 2026-08-16, so `thinking`'s gaze was fixed in the
  committed JSON by hand. The file lists every such edit in its own top-level
  `hand_edits` array and `playbook.ts` repeats them; fixing the generator without
  porting them first silently reverts shipped work. `__tests__/gaze.test.ts`
  fails if that happens.
- **The gaze is camera-relative, and at this staging it is SATURATED.** The
  camera sits 45.6° off each eye's axis where the eye saturates at 24.2, so both
  pupils are pinned at `PUPIL_ROAM.x` in every state — a lateral `gx` smaller
  than about 5 units moves them by exactly zero. A gaze change that reads fine as
  a number and does nothing on screen is the default outcome here, not an
  unlucky one; measure the pupil, not the offset.

- **Never read `window.innerWidth`/`innerHeight` in here.** `viewport.ts` is the
  one answer, set from the canvas's own box in `DeckE.resize`. On an iPhone
  `innerHeight` is the VISUAL viewport and moves by the toolbar's height —
  measured on iOS 18, `100lvh` is 760 while `innerHeight`, `100svh`, `100dvh`, a
  `fixed inset-0` box and `documentElement.clientHeight` are all 678. Sizing the
  drawing buffer from one of those and stretching it into a box sized by another
  is what "he becomes more thin" was.
- **A crossfade has to cover the MODULATION, not just the pose.** The float's
  phase keeps advancing while its amplitude is zero, so a state that hands over
  from `float_amp: 0` to `1` makes the hover appear at whatever point of its cycle
  it silently reached. Every authored channel is continuous across boot -> idle
  and it still popped: 0.0174 units in one frame against a 0.0012 ceiling.
- **Pace is `travelRate()`, never the cruise speed.** It ramps with the length of
  the leg — short hops play slower and depth changes faster, because the review
  asked for both at once and a single number cannot do both. A depth change is
  24-27 world units where every same-depth leg is under 3, so distance alone
  separates them and nothing needs to know what kind of leg it is. The flight solver integrates
  until it arrives, so raising `shapeFor`'s cruise looks like the pace knob. Past
  about 2x, the stopping-distance law overshoots its settle window every frame and
  the leg runs to the 600-frame guard instead of landing — 3067 ms became
  20167 ms, measured.
- **`durationMs` and the sample index share a time base, and it is not frames.**
  `sampleTrack` must index by progress. `(tMs / 1000) * FPS` is the same thing
  only at a rate of 1; when they disagree the past-the-end guard fires
  early and he teleports the rest of the leg, with every duration still correct.
- **Headless Chromium runs rAF at about 1 Hz**, so his loop is frozen and
  `await`ing a wall-clock delay measures a still frame. Stop the loop and step it:
  `d.stop()`, then `d.elapsed += 1/60; d.update(1/60)`. A float measurement taken
  the other way reported the deal-in flight and could not tell a 42% amplitude cut
  from no change at all.

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
- **Nothing that has to keep turning may be driven from the LOOPED clip clock.**
  The card orbit was the first casualty (2700 ms period against an 1800 ms loop);
  `sym_spin` was the second, and it is why `alert_dizzy`'s authored spin ramp
  could not survive the state being made loopable. Both now integrate unwrapped
  state time against a rate from `symbol_atlas`.
- **The symbol spins about BLENDER'S Y, which is three's −Z.** The glyph lives in
  the eye's X-Z plane, so the only axis that turns it in that plane is the plane
  normal. Spinning about three's Y instead tips it edge-on — the spiral "isn't
  rotating, it's getting all warpy" — and the same 180° right-eye phase becomes a
  horizontal MIRROR, which is invisible on a star and reads as a backwards `$` on
  the money glyph. Two reported defects, one axis.
- **`Ctrl_Target` is a childless ROOT node in the glb.** The constraint that
  aimed the pupils at it did not export, so writing the gaze onto it moves
  nothing. `look.ts` rebuilds the aim; the pupils' bind pose is a baked SAMPLE of
  that constraint, not a rest position, and freezing it is what left him staring
  up and to the right through every state and every turn. Note that this is
  invisible to parity: a frozen constraint and a live one agree exactly at the
  frame the freeze was taken.
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
# unit + parity tests -- also runs in CI (this also covers character/host)
pnpm --filter deckpal-web test:decke

# regenerate the playbook, or assert it still matches its sources
# READ `playbook.ts`'s header FIRST: the generator has been broken since
# 2026-08-16 and the shipped JSON now carries HAND EDITS, listed in its own
# `hand_edits` array. Regenerating without porting them reverts shipped work.
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

That got the card back to *legible* but not to *holographic*, because a constant
glow is the one thing foil never is. The sheen itself is now
`KHR_materials_iridescence` — thin-film interference is the physics foil actually
works by — over a roughness of 0.38. **The roughness is part of the fix and is
the same class of defect as the emissive:** `Card_Front_*` carries no
`roughnessFactor` at all, so three takes glTF's default of 1.0, and at roughness
1 the specular lobe covers the whole hemisphere, which spreads any tint flat
across the card as a haze instead of a travelling band.


### Real card art

The baked textures are AI-generated placeholders — "BLOBULON, 70 HP" — and they
are the FALLBACK now, not the picture. `cardArt.ts` puts the user's actual cards
on the four faces he shows and on every card in the stash fan, and `cardSource.ts`
is the one file in this directory that knows the product's API exists.

Three things about the asset decide the whole design of `cardArt.ts`:

- **The front materials are SHARED.** `Card_Front_Rose3` is one material used by
  `Card_Loose_Rose_anim` *and* all five `Stash_Card_*` meshes, and the pool clones
  those meshes for batches past five — three clones share materials by reference.
  Assign a texture naively and every card shows the same card. Each card node
  therefore gets its own material, cloned at bind time.
- **The V axis is glTF's.** The unwrap is a clean 0..1 across both faces, but a
  texture you make yourself defaults to `flipY = true` and comes out upside down.
- **`map` and `emissiveMap` move together**, always — the foil above is tinted by
  the artwork, so leaving `emissiveMap` behind makes a card glow in the shape of a
  card it is not showing.

The card BACK is the real Pokémon TCG back at
`public/models/decke/card_back.webp`; provenance is in that directory's
`CREDITS.md`, and it is the only asset here that is not ours.

**Images carry a `?decke=1` marker and it is not superstition.** Card images come
from the same-origin `/deckpal/images/…`, which on cloud 302s to Supabase Storage
on another origin. Every `<img>` in the app fetches those with no `crossOrigin`,
leaving an OPAQUE cache entry, and WebGL will not upload an image that is not
origin-clean — so a texture fetch of a URL the card grid has already rendered
fails, on cloud only, and never in dev. The marker gives the texture its own cache
entry. Same trap, same fix as the bug reporter's screenshots (`DECISIONS.md`,
2026-08-10).

### Batches

`card_stash` shows at most `BATCH_MAX` (12) cards at once, because that is where
the fan stops being collision-free — `__tests__/cards.test.ts` proves the layout
for every n up to `MAX_STASH`, and `__tests__/batches.test.ts` asserts
`BATCH_MAX === MAX_STASH` so that proof keeps covering batching. More than twelve
plays as a RUN of batches, up to `MAX_RUN` (48, four batches), past which the rest
are dropped loudly.

Every batch but the last is a self-contained cycle on its own clock — launch,
hang `holdMs`, gather, file in — and the top of the deck in his box becomes
whichever card most recently finished its dive. **The last batch is exactly the
animation that was reviewed:** it hangs, and its close is the state's outro, so
the lid shutting and the final cards diving in stay one authored beat. The card
system never closes him; it raises `wantsClose()` and the state machine does.

The fan's no-interpenetration claim is now measured rather than approximated:
`__tests__/cards.test.ts` computes the closest approach between the two card
QUADS, in Blender coordinates. The two earlier versions of that assertion both
modelled a card as an axis-aligned box, which is nearly half again the real
footprint once `splayPerX` turns it — and an over-strict proxy is not harmless,
because satisfying it made the real minimum separation worse. Driven through the
render pipeline for forty seconds of hang, the closest two cards ever come is
0.050 units against a card 0.006 thick.

`batchSchedule` is pure and exported because both bugs this code has produced
were arithmetic and invisible in a still — a launch span that made twelve cards
spend 1.4 s merely appearing, and an `endMs` equal to the last dive, which let the
next batch win the frame and made the deck's top face skip a card at every batch
boundary.
