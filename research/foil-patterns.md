# foil-patterns.md — canonical holofoil pattern specs

The per-pattern reference for the foil shader library (`apps/web/src/foil/`). One section per
pattern the reference video distinguishes — **39 patterns**, each with a stable slug, a corpus
dir under `research/foil-video-reference/<slug>/` (8 keyframes + clip + notes + Gemini vision
spec), and shader notes written against the uniform contract in `apps/web/src/foil/shader.ts`.

Sources, in trust order:
1. **The video**: [All 39 Pokemon Card Holo Patterns Explained](https://youtu.be/wQ2TvnHVdys)
   by **Sleeve No Card Behind** (Jan 2026) — the only source with tilt demos of real cards.
2. **Our eyes on the frames** — every claim below marked *(verified)* was confirmed by a human/agent
   look at the corpus keyframes; claims from the Gemini vision pass that could NOT be confirmed
   (or were contradicted) are marked ⚠ in the per-pattern *Flags*.
3. **Bulbapedia "Holofoil"** — canonical community names (11 named patterns; the video splits finer).
4. Gemini 3.1 Pro vision analyses (`<slug>/gemini-spec.md`) — detail source, never trusted alone.

Usage mapping (which sets/rarities got which pattern) lives in `research/foil-pattern-usage.json`
— this doc only carries one-line usage summaries.

---

## Name reconciliation (video ↔ Bulbapedia ↔ our library)

The video distinguishes **39** patterns. Bulbapedia's Holofoil article names **11**. Mapping:

| Our slug (video name) | Bulbapedia | Notes |
|---|---|---|
| `starlight` | Starlight (syn. **Galaxy**) | "Galaxy" belongs HERE, not to cosmos |
| `starlight-ii` | — (falls under Starlight) | XY Evolutions remake; flat, no parallax |
| `cosmos`, `cosmos-ii-pixel`, `cosmos-iii-smooth` | Cosmos | video splits 3 generations |
| `tinsel`, `tinsel-ii` | Tinsel ("horizontal stripes") | video splits BW original vs 2025 revival |
| `diagonal-sheen-right`, `diagonal-sheen-left` | Sheen | XY/SM diagonal; two mirror rotations |
| `horizontal-sheen` | **Mirage** | SV-era default |
| `vertical-sheen`, `vertical-sheen-rainbow` | — (not named by Bulbapedia) | HGSS-era default; see conflicts below |
| `striped-vertical-sheen` | **Line** | SWSH default |
| `confetti` | **Pixel** (syn. Confetti) | ⚠ name collision: Bulbapedia "Pixel" ≠ video "pixel cosmos" (`cosmos-ii-pixel`) |
| `cracked-ice` | Cracked Ice (syn. Broken Glass, Shards) | |
| `crosshatch` | Crosshatch | |
| `water-web` | Water Web | |
| `sequin` | Sequin | |
| `mirror`, `rainbow-mirror`, `fireworks`, `big-glitter`, `energy-symbols`, `energy-symbols-ii`, `pinwheel`, `ex-emerald`, `pokeball-hologram`, `prism`, `radiant`, `rainbow-glitter`, `rainbow-glitter-sheen`, `ace-spec`, `pokeball-masterball`, `prismatic-pokeball`, `radiant-collection-dots`, `ex-starfoil`, `tcg-classic`, `acid-wash`, `disco` | — | video-only distinctions; no Bulbapedia name |

**The sheen family is one physical product.** Per the video, `vertical-sheen`,
`diagonal-sheen-right`, `diagonal-sheen-left`, and `horizontal-sheen` are the SAME smooth
linear-grating sheet mounted at four rotations; `vertical-sheen-rainbow` is its first (EX-era)
appearance and `striped-vertical-sheen` adds a fine stripe texture. They keep separate slugs
(distinct eras resolve to distinct rotations) with the equivalence recorded here.

## Library mislabel corrections (do NOT rename in apps/ on this branch — later lane on foil/main)

Current `apps/web/src/foil/patterns.ts` + `resolver.ts`, checked against the corpus:

1. **`cosmos` recipe label "Cosmos / Galaxy" is wrong.** "Galaxy" is Bulbapedia's synonym for
   *Starlight* (the WOTC star foil), not for cosmos. The video makes the same point (Lapras
   starlight shown during the "Galaxy naming" aside). Fix: label it "Cosmos", and move the
   Galaxy synonym to the starlight recipe.
2. **`starlight` recipe's `usedOn` ("WOTC holo rares 1999–2003, Base–Skyridge") is too broad.**
   Starlight = **Base Set, Jungle, Fossil only** (international printings). Base Set 2 onward
   English holos are *cosmos* (video + Bulbapedia agree). `resolver.ts` maps ALL wotc-era holo
   variants → `starlight`; correct is Base/Jungle/Fossil → starlight, later WOTC → cosmos.
3. **`sv-holo` implements the wrong rotation.** The recipe renders *vertical* bands
   ("Sheen / vertical-beam foil") but the SV-era default holo is the **horizontal** sheen
   (Bulbapedia *Mirage*) — *(verified: Kyogre frame shows a horizontal band sweeping vertically;
   HGSS Ninetales-era demo shows the vertical band)*. What `sv-holo` actually models is
   `vertical-sheen` (Platinum/HGSS→XY default). Fix: rename the recipe `vertical-sheen`, add a
   band-angle rotation (one uniform or per-recipe constant) and register `horizontal-sheen` as
   the SV default in the resolver.
4. **`reverse-sheet` ("Reverse sheet (SV)") conflates two things.** Its ring+dot stamp grid
   most closely matches `pokeball-masterball` (Black Bolt/White Flare) / the SV pokeball reverse
   stamps; the *sheet between stamps* is the plain `mirror`/`rainbow-mirror` base. Keep as the
   coarse-tier reverse recipe, but the taxonomy string "Mirror / reverse-holo stamped sheet"
   should note that most pre-SV reverses are actually un-stamped sheen/rainbow-mirror sheets
   with different ink masks (see interlude).

## Source conflicts (recorded, not silently resolved)

- **Cosmos end-date vs vertical-sheen start.** Bulbapedia: Cosmos ran "Base Set 2 through Call
  of Legends" as the standard holo. Video: vertical sheen was the default "through Platinum,
  Call of Legends, Black & White, and XY". These overlap in DP/Platinum/HGSS. Best reading
  (see usage JSON rows + findings): cosmos remained the *standard-set holo* into HGSS while
  vertical sheen took over reverses and then standard holos; exact per-set boundary is
  contested — rows carry per-set citations and confidence.
- **Tinsel orientation.** Bulbapedia says "horizontal stripes"; the video demo confirms
  horizontal dashes *(verified on tinsel frames)* — no conflict, noted because the name
  "tinsel" suggests vertical to most readers, and `striped-vertical-sheen` (SWSH "Line") is the
  vertical one people confuse it with.
- **Diagonal orientation.** The two Gemini specs contradict each other (both claim "top-left →
  bottom-right"). *(verified from frames: `diagonal-sheen-right` band rises "/", 
  `diagonal-sheen-left` falls "\").*
- **Legendary Collection reverse coverage.** Gemini claims the fireworks parallel leaves the
  art window non-holo; frame-02 shows bursts continuing over the illustration *(verified)* —
  LC parallels foil the full face, art included.

---

# The 39 patterns

Uniform-contract vocabulary used below: `uTilt` (vec2 −1..1, drives everything), `uP0..uP3`
(recipe params), `hueRamp(t)` (iridescent ramp desaturated by `uSat`), `uScale`, `uHueShift`,
`uHueSpread`, `uArtGate` (luminance gate for WOTC-style dark-background art windows), mask
tiers (layout rect / hand-drawn `uMaskTex`), screen-blend over the scan + shared specular
`sheen()`. "Nearest recipe" refers to the current 5-recipe starter library
(`starlight`, `cosmos`, `sv-holo`, `reverse-sheet`, `cracked-ice`).

## 1. Starlight — `starlight` (0:00)
Bulbapedia: Starlight, syn. Galaxy. **Nearest recipe: `starlight` (implemented — good match).**
- **Demo cards:** Blastoise + Machamp (Base), Flareon (Jungle), uncut star-foil sheet, JP Base
  Charizard (cosmos, for contrast).
- **Static:** scattered sharp stars in three shapes — dots, 4-point crosses, 8-point bursts —
  over a dark, slightly cloudy/milky field; saturated full-spectrum colors. Art-window scope.
- **Tilt:** stars pop bright at narrow angles then dim to cool blues/purples; **true hologram**:
  front star layer shifts laterally against the back layer (3-D parallax) — one of the only
  true holograms in the TCG.
- **Layers:** stock → multi-depth holographic star foil → opaque white ink (subject/borders) →
  translucent CMYK (background tint).
- **Shader:** ≥3 star layers with opposing `uTilt`-driven UV offsets (parallax), SDF star
  glyphs mixed with soft blobs, smooth visibility lobe (never binary blink), dark base +
  additive stars, `uArtGate` on. This is exactly what the current recipe does post-rework.
- **Usage:** Base/Jungle/Fossil, international printings only (JP used cosmos).
- **Flags:** none — Gemini + video + frames agree.

## 2. Cosmos — `cosmos` (0:45)
Bulbapedia: Cosmos. **Nearest recipe: `cosmos` (implemented; label fix needed — see mislabels).**
- **Demo cards:** Pidgeot (Base Set 2, labeled demo), PSA "DRAGONITE-HOLO COSMOS" (Fossil,
  WOTC-employee variant), Ancient Mew, Best-of-Game Electabuzz; swirl aside (JP Blaine's
  Moltres "DOUBLE SWIRL").
- **Static:** solid circular orbs of varying size + small 4-point crosses over a dark cloudy
  field; saturated reds/greens/yellows. Occasional "swirl" die-cut artifacts are collector chase
  marks (not visible in our frames — from narration only).
- **Tilt:** orb clusters brighten/dim IN PLACE (no translation, no parallax); smooth pop-in/out
  as facets align. *(verified on Pidgeot frames)*
- **Layers:** stock → embossed orb foil (single plane) → opaque ink → translucent background ink.
- **Shader:** current recipe's 3-scale disc layers + per-disc hue/phase is right; keep zero
  parallax (that's starlight's differentiator). Consider adding the sparse cross layer.
- **Usage:** the most-used pattern in TCG history: JP Base-era holos, English Base Set 2 →
  (per Bulbapedia) Call of Legends standard holos, plus decades of promos. See usage JSON.
- **Flags:** ⚠ swirls asserted by narration, not visible in frames.

## 3. Fireworks — `fireworks` (1:36)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo cards:** Zapdos (Legendary Collection parallel), regular-vs-fireworks side-by-side,
  Persian reverse, LC booster.
- **Static:** large jagged radial bursts (⅓–½ card width), overlapping, full-spectrum; covers
  the whole face — *(verified: bursts continue over the illustration; Gemini's "art window
  stays matte" claim is contradicted by frame-02)*.
- **Tilt:** bursts are static; a bright band sweeps and each burst hue-rotates through the
  spectrum as its radial grating aligns; edge bursts ignite sequentially.
- **Layers:** radial-grating foil → semi-opaque structural inks → opaque art/text ink (art
  printed translucently enough to keep sparkle).
- **Shader:** scattered burst centers (voronoi seeds) + polar jagged rays (noise over angle);
  anisotropic activation: `dot(rayDir, uTilt)` drives per-ray ignition; hueRamp keyed on
  activation + `uHueSpread`; full-face mask (`uMaskRect` full, no invert).
- **Usage:** Legendary Collection (2002) parallel set only — the TCG's first reverse/parallel set.
- **Flags:** ⚠ Gemini reverse-coverage claim corrected (above).

## 4. Mirror — `mirror` (2:23)
No Bulbapedia entry (it's the blank base). **Nearest recipe: none — gap (trivial).**
- **Demo:** Shining Mewtwo / Shining Raichu (Neo Destiny), blank mirror sheet.
- **Static:** zero pattern — uniform silver metallic; a true mirror (camera reflection visible
  in frames). On Shining cards the SUBJECT is the exposed foil (inverse of normal holos).
- **Tilt:** broad white specular travels; environment reflections move; **no hue shift at all**.
- **Layers:** plain aluminum foil, no embossing; ink windows do all the design work. This is
  the raw stock every other pattern is rolled onto (per interlude).
- **Shader:** no pattern function — near-zero `foilPattern`, high `uSpecular`, `uSat`≈0;
  optionally a faint env-map-ish moving gradient. Cheapest recipe in the set.
- **Usage:** Neo Shining subjects; the underlying base of many later overprint patterns.
- **Flags:** none.

## 5. Rainbow mirror — `rainbow-mirror` (2:53)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Crystal Energy (Aquapolis reverse), Pokémon Nurse (Expedition), raw sheet.
- **Static:** structureless smooth mirror that reflects broad continuous rainbow bands (no
  shapes, no grain). Reverse scope on the e-series cards.
- **Tilt:** bands sweep smoothly and continuously — pure low-frequency diffraction; nothing
  pops.
- **Layers:** smooth unembossed holographic film → white-ink mask → CMYK. Also the BASE layer
  under later overprints (prismatic-pokeball, rainbow-glitter).
- **Shader:** single low-frequency `hueRamp` field over `uv·dir + k·uTilt`; wide smooth lobes
  (avoid tight stripes); high `uSpecular`. Roughly `sv-holo`'s beam term without the band term.
- **Usage:** e-series (Expedition→Skyridge) reverses; staple base sheet ever since.
- **Flags:** none.

## 6. Big glitter — `big-glitter` (3:19)
No Bulbapedia name. **Nearest recipe: `cracked-ice` (facet-activation machinery) — gap.**
- **Demo:** Scizor oversized gold box topper (e-series); the video even finds the wholesale
  foil roll (Alibaba "SinoVinyl Random Star Emboss 35u" listing) — manufacturer stock, not bespoke.
- **Static:** dense uniform field of small homogeneous circular glitter dots (~1–2% card width),
  multi-color at any angle.
- **Tilt:** dots fixed; individual dots twinkle on/off and hue-shift; no sweeping band.
- **Layers:** embossed dot-facet foil → ink windows.
- **Shader:** high-frequency cell grid, per-cell random activation normal, tight
  `dot(n, uTilt)` threshold + hueRamp per cell; density via `uP0`.
- **Usage:** once — e-series oversized box toppers.
- **Flags:** ⚠ Gemini ID'd the card as regular "Scizor (Aquapolis)"; notes/video say it is the
  oversized box topper (scale not judgeable in-frame).

## 7. Energy symbols — `energy-symbols` (4:20)
No Bulbapedia name. **Nearest recipe: none — gap (needs an icon mask texture).**
- **Demo:** Steven's Advice + Pinsir (EX Hidden Legends).
- **Static:** art-window field of distinct Energy symbols (all types) ~1/15 card width, dark
  unreflective gaps between them. First bespoke Pokémon-designed pattern (most others are
  manufacturer stock).
- **Tilt:** symbols fixed; illumination + spatial hue gradient sweeps across them (left-to-right
  color progressions clearly visible across frames).
- **Layers:** foil stamped in symbol shapes (or uniform grating + dark resist) → opaque
  subject/border ink.
- **Shader:** tiled icon mask texture (energy glyph atlas) × sweeping hueRamp field driven by
  `uTilt`; dark base. An SDF atlas beats procedural here.
- **Usage:** EX Hidden Legends.
- **Flags:** none.

## 8. Energy symbols II — `energy-symbols-ii` (4:54)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Marowak, Weedle (EX FireRed & LeafGreen).
- **Static:** like #7 but symbols vary in size (~2–8% width) and rotation, with small sparkle
  dots interspersed — scattered, not grid-like.
- **Tilt:** smooth full-field hue rotation with a broad sweeping sweet-spot; symbols fixed.
- **Shader:** same icon-atlas approach with per-instance scale/rotation jitter + dot layer.
- **Usage:** EX FireRed & LeafGreen.
- **Flags:** ⚠ Gemini misidentified the cards as "e-Reader era, Expedition" — notes/video say
  EX FRLG. Set IDs in this spec are untrusted; visual description checks out.

## 9. Cracked ice — `cracked-ice` (5:07)
Bulbapedia: Cracked Ice (syn. Broken Glass, Shards). **Nearest recipe: `cracked-ice`
(implemented — good match).**
- **Demo:** Raichu LV.39 (DP theme deck), FRLG legendary-bird ex promo trio, Carnivine,
  SWSH Charizard theme deck, Crobat reverse (footage credit: YouTube "Ronge").
- **Static:** irregular sharp polygonal shards (some 10–15% width), silver base, saturated
  green/orange/blue flashes.
- **Tilt:** shards are static facets; individual shards flash on/off abruptly with slight hue
  roll before extinguishing; discrete, not sweeping.
- **Layers:** faceted embossed foil, per-shard grating angle → ink windows.
- **Shader:** current recipe (voronoi + per-cell normal + tight alignment window + edge seams
  + micro-grain) is the right model.
- **Usage:** first on Skyridge acrylic box toppers; FRLG bird promos, POP series; THE
  theme-deck-exclusive holo for years (DP→SWSH); League promos. Rare now (theme decks dead).
- **Flags:** ⚠ Gemini called Crobat "Skyridge Crystal Type"; notes only support "Crobat
  (reverse)" — ID unverified.

## 10. Pinwheel — `pinwheel` (5:41)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Shroomish (EX Deoxys reverse — creator's childhood card), simplified-Chinese
  Sylveon (modern revival).
- **Static:** strict square grid (~1/10 card width per cell); each cell is a pinwheel of
  radial wedges. EX-era version small/flat; zh-CN version big and vivid.
- **Tilt:** old version nearly static (brightness only); revival: diagonal rainbow sweeps
  while individual wedges flash independently → cells appear to "spin".
- **Layers:** grid-embossed foil, per-wedge grating orientation → ink masks.
- **Shader:** `fract(uv·scale)` grid, `atan` wedge index per cell, per-wedge activation normal
  vs `uTilt`, global diagonal hueRamp sweep on top.
- **Usage:** EX Deoxys reverses; revived on simplified-Chinese sets.
- **Flags:** none.

## 11. EX Emerald — `ex-emerald` (6:10)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Swalot (EX Emerald reverse).
- **Static:** scattered Poké Balls (some with burst rings) + starbursts (~1/10 window width)
  PLUS a full-height vertical rainbow band.
- **Tilt:** band sweeps horizontally; icons fixed but pop/hue-shift independently, brightest
  when the band crosses them.
- **Shader:** icon atlas layer + `vertical-sheen`-style band term composited; per-icon
  activation phase.
- **Usage:** EX Emerald only.
- **Flags:** none.

## 12. Pokeball hologram — `pokeball-hologram` (6:31)
No Bulbapedia name. **Nearest recipe: `starlight` (parallax machinery only) — gap.**
- **Demo:** Cyclone Energy + Sunkern (EX Unseen Forces), dark hologram sheet; Tested/Marvel
  b-roll for hologram history.
- **Static:** Poké Balls of many sizes; a TRUE hologram (unique in the TCG beyond starlight's
  weaker version): balls read at different optical depths. A horizontal manufacturing seam
  line crosses mid-card *(visible in frames 4–8)*.
- **Tilt:** balls pop and hue-shift; genuine parallax — deep balls vs floating balls move
  relative to each other. (Parallax hard to fully confirm from stills; narration + slight
  relative shifts support it.)
- **Layers:** stock → true multi-depth holographic foil (with seam) → white ink → translucent
  vortex art.
- **Shader:** 2–3 SDF-pokeball layers with opposing parallax offsets (starlight's approach,
  bigger glyphs); optional static seam line for authenticity.
- **Usage:** EX Unseen Forces.
- **Flags:** ⚠ 3-D depth claim is narration-led (Medium confidence from stills).

## 13. Vertical sheen rainbow — `vertical-sheen-rainbow` (7:49)
No Bulbapedia name. **Nearest recipe: `sv-holo` (vertical band — close).**
- **Demo:** Medicham (EX Crystal Guardians — set ID'd from frames; post-Unseen-Forces, matching
  the "first sheen" claim).
- **Static:** mirror-smooth art-window foil + ONE soft vertical rainbow band; no particles.
- **Tilt:** the band translates horizontally with tilt; hue order preserved inside the band.
- **Layers:** vertical linear-grating foil → ink windows.
- **Shader:** single gaussian band on `uv.x + k·uTilt.x`, hueRamp across band width; the
  current `sv-holo` beam term minus the multi-band term.
- **Usage:** a few EX-era sets after Unseen Forces — the sheen sheet's debut.
- **Flags:** none.

## 14. Vertical sheen — `vertical-sheen` (8:20)
Not named by Bulbapedia (see conflicts). **Nearest recipe: `sv-holo` — this is what `sv-holo`
actually implements; rename target.**
- **Demo:** raw sheet with vertical rainbow band, HGSS-era cards (Ninetales HGSS, Seeker +
  Yanma from Triumphant), zh-CN reverses comparison.
- **Static:** smooth curtain of sharp vertical bands (barcode-like widths) full height;
  saturated spectrum. *(verified: vertical orientation on Ninetales frame)*
- **Tilt:** bands sweep strictly horizontally with `uTilt.x`; pitch does not move them (only
  slight hue change).
- **Layers:** vertical linear grating → ink masks. Per the interlude: this SAME sheet underlies
  MANY visually-different reverse designs (Sceptile/Magneton/… examples) — ink does the rest.
- **Shader:** the current `sv-holo` recipe body (bands + drift + wobble) IS this pattern;
  after rename, add rotation support so 15/19/20/21 share one implementation.
- **Usage:** the long-running default: HGSS era onward through Platinum, Call of Legends, BW,
  into XY (video claim; Bulbapedia disputes the early boundary — see conflicts + usage JSON).
- **Flags:** conflict with Bulbapedia recorded above.

## 15. Cosmos II / pixel cosmos — `cosmos-ii-pixel` (11:11)
Bulbapedia: (Cosmos). **Nearest recipe: `cosmos` (partial).**
- **Demo:** Pachirisu (Platinum era), old-vs-new sheet closeups, Ceruledge promo cosmos border,
  Golduck (SV 151 pixel variant).
- **Static:** cosmos redesigned denser + more silvery: continuous field of tiny "pixel" specks
  filling all space between sparser diamonds/4-point stars/orbs (~1–2% width).
- **Tilt:** pixel field twinkles continuously like fine static; the larger shapes pop abruptly
  at narrow angles with FIXED per-shape colors (no traveling sheen).
- **Layers:** silvery micro-textured foil + stamped facet shapes → ink windows.
- **Shader:** cosmos recipe + a high-frequency twinkle layer (hash noise thresholded by
  `uTilt` alignment) and harder pop thresholds; overall more silver (`uSat` lower).
- **Usage:** introduced in Platinum; became THE default promo pattern (tins, blisters, order
  bonuses); SV era uses cosmos borders on regular cards.
- **Flags:** none.

## 16. Cosmos III / smooth (HD) cosmos — `cosmos-iii-smooth` (12:34)
Bulbapedia: (Cosmos). **Nearest recipe: `cosmos` (partial).**
- **Demo:** dark smooth-cosmos sheet + macro closeups, SVE Fire Energy with "mew tail" swirl,
  Umbreon (Legendary Treasures), Golduck-pixel vs Eevee-smooth side-by-side.
- **Static:** perfectly smooth circular orbs + dots only — no pixels, no stars; dense; darker
  metallic field.
- **Tilt:** vertical specular band sweeps (macro frames); orbs activate smoothly through the
  spectrum as it passes — smoother/"HD" vs pixel cosmos.
- **Shader:** cosmos recipe with euclidean smooth discs, `fwidth` AA, smooth activation
  (`smoothstep`, wide), plus a sweeping specular band term.
- **Usage:** introduced Legendary Treasures (final BW set); dominant for years; modern promos
  ship in either pixel or smooth (master-set chase, e.g. 151).
- **Flags:** none.

## 17. Tinsel — `tinsel` (13:24)
Bulbapedia: Tinsel. **Nearest recipe: none — gap.**
- **Demo:** Meloetta (BW era), raw tinsel sheet.
- **Static:** hundreds of fine HORIZONTAL striations carrying short bright colored dashes
  (1–4% width) — "tinsel" strands. *(verified horizontal on frames — matches Bulbapedia)*
- **Tilt:** dashes slide left/right along their lines at DIFFERENT speeds and directions —
  a two-plane parallax "bounce"; dashes also pop and hue-shift while moving.
- **Layers:** micro-embossed horizontal ridges with ≥2 interleaved grating-angle populations
  (hence the opposing apparent motion) → ink windows.
- **Shader:** two horizontally-stretched noise layers sampled at `uv.x ± uTilt.x·speed`
  (opposing), thresholded to dashes, per-dash hueRamp; high `uv.y` frequency.
- **Usage:** BW (2011) regular holos through Legendary Treasures; BW-era ACE SPECs.
- **Flags:** none.

## 18. Tinsel II — `tinsel-ii` (14:02)
Bulbapedia: (Tinsel). **Nearest recipe: none — gap (shares #17's machinery).**
- **Demo:** Basic Metal Energy + Thundurus (Black Bolt / White Flare, 2025), Tinsel-I-vs-II
  sheets side-by-side, acetone rub revealing raw foil.
- **Static:** denser, darker, more chaotic horizontal static — line thickness varies strongly;
  covers full face including borders.
- **Tilt:** smooth sheen sweeps over the static line texture; hue rotation; no discrete pops.
  (Less parallax than tinsel I in the frames available.)
- **Layers:** ink-over-foil confirmed on camera (acetone dissolves ink → raw foil) — the
  clearest physical-layer evidence in the whole video.
- **Shader:** #17 base with wider thickness variance, lower dash contrast, sheen-driven
  illumination instead of opposing dash motion.
- **Usage:** Black Bolt & White Flare (2025) only — tinsel resurrected for the all-Gen-5 sets.
- **Flags:** ⚠ Gemini dated the cards "Sword & Shield era" and called Thundurus "Groudon" —
  notes/video say Black Bolt/White Flare 2025. Set IDs untrusted; visuals fine.

## 19. Diagonal sheen (right) — `diagonal-sheen-right` (15:12)
Bulbapedia: Sheen. **Nearest recipe: `sv-holo` rotated — gap is one rotation uniform.**
- **Demo:** Moltres EX pack version vs Battle Arena deck variant side-by-side, raw diagonal sheet.
- **Static:** smooth full-face sheen band angled diagonally, rising left→right ("/")
  *(verified from frame-02; Gemini's "\" orientation claim is wrong)*.
- **Tilt:** band translates perpendicular to its axis; spectrum order preserved; no particles.
- **Usage:** first as SECRET deck-exclusive variants (Battle Arena Moltres EX); then default
  holo for XY-era sets. JP cards' diagonal runs bottom-left→top-right per Bulbapedia.
- **Flags:** ⚠ Gemini orientation contradiction (both diagonal specs claimed the same slope).

## 20. Diagonal sheen (left) — `diagonal-sheen-left` (15:34)
Bulbapedia: Sheen. **Nearest recipe: `sv-holo` rotated — gap is one rotation uniform.**
- **Demo:** mirrored raw sheet, Fomantis + Alolan Diglett (SM reverses).
- **Static/Tilt:** mirror image of #19 — band falls left→right ("\") *(verified frame-03)*;
  same smooth translation behavior, applied as SM-era reverse sheet.
- **Usage:** Sun & Moon series reverse holos, heavily.
- **Flags:** as #19.

## 21. Horizontal sheen — `horizontal-sheen` (15:49)
Bulbapedia: **Mirage**. **Nearest recipe: `sv-holo` rotated 90° — this is what `sv-holo`
SHOULD be for SV cards.**
- **Demo:** Gengar (SV), Kyogre (SV/Mega era).
- **Static:** smooth horizontal prismatic band across art window + SV silver borders; dark
  metallic elsewhere; zero particles. *(verified on Kyogre frame)*
- **Tilt:** band travels VERTICALLY with pitch (`uTilt.y`), stays strictly horizontal.
- **Shader:** 1-D band on `uv.y − k·uTilt.y` + hueRamp across band; base low-intensity
  metallic floor so unlit foil doesn't go black.
- **Usage:** the default holo of Scarlet & Violet AND the Mega era standard holos ("what a
  bummer" — creator, on its simplicity).
- **Flags:** none.

## 22. Striped vertical sheen — `striped-vertical-sheen` (16:01)
Bulbapedia: **Line**. **Nearest recipe: `sv-holo` + stripe texture — gap.**
- **Demo:** Leon (SWSH), striped sheet, striped-vs-rotated-tinsel side-by-side.
- **Static:** very fine CONTINUOUS vertical stripes top-to-bottom (vs tinsel's broken dashes)
  in the art window; rainbow where lit.
- **Tilt:** stripes fixed; a rainbow band sweeps horizontally across them; stripes most
  visible inside the lit band.
- **Shader:** high-frequency `sin(uv.x·density)` stripe mask × sweeping band+hueRamp
  (`sv-holo` machinery plus the stripe multiplier).
- **Usage:** Sword & Shield series regular holos; some Trick or Trade.
- **Flags:** none.

## 23. Prism — `prism` (16:28)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Raticate BREAK, graded Carddass Charizard (1996 red prism — pre-dates the TCG by
  ~a month).
- **Static:** rigid uniform micro-grid of tiny square/diamond cells (hundreds across the card);
  full-face on BREAK cards (under the gold art).
- **Tilt:** grid fixed; cells cycle hue rapidly like independent micro-prisms; a broad
  activation region sweeps.
- **Shader:** `floor(uv·N)` cell ids, per-cell hash phase into hueRamp keyed on `uTilt`, macro
  sweep envelope. No parallax.
- **Usage:** Carddass prism stickers (1996, pre-TCG); in the TCG proper only on XY BREAK
  cards; not seen since.
- **Flags:** ⚠ only 2 frames demo the BREAK tilt (Medium confidence on animation).

## 24. Starlight II — `starlight-ii` (17:19)
Bulbapedia: (Starlight). **Nearest recipe: `starlight` with parallax ≈ 0.**
- **Demo:** CGC 8.5 Charizard (XY Evolutions), Lapras (Fossil) original for comparison.
- **Static:** the Base-homage star field — sharper, bolder, more saturated than 1999.
- **Tilt:** stars flash dramatically in place; **NO parallax** ("missing that 3D depth" —
  narration + frames agree); flat single-plane foil.
- **Shader:** starlight recipe with `uP1` (parallax) = 0, higher star gain, crisper glyphs.
- **Usage:** XY Evolutions (2016).
- **Flags:** none.

## 25. Water web — `water-web` (18:13)
Bulbapedia: Water Web. **Nearest recipe: none — gap.**
- **Demo:** raw sheet, Rhyperior (SM), Guzzlord GX.
- **Static:** large organic rippling-liquid contours (¼–½ card width), oil-slick rainbow
  pooling along ridges; no discrete particles.
- **Tilt:** topography fixed; colors FLOW along the contours — smooth, liquid hue migration.
- **Shader:** domain-warped fbm height field → gradient normals → hueRamp keyed on
  `dot(normal, uTilt)`; low frequency, high smoothness.
- **Usage:** Sun & Moon standard holos + GX cards (through Cosmic Eclipse per Bulbapedia).
- **Flags:** none.

## 26. Radiant — `radiant` (18:28)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Radiant Venusaur (Pokémon GO set), Astral Radiance / Lost Origin packs.
- **Static:** large diagonal criss-cross diamond grid (8–10 cells across), lines themselves
  "pixelated"/segmented; full-face including over the art.
- **Tilt:** grid fixed; a soft sheen sweeps and the grid lines flare rainbow where it crosses.
- **Shader:** rotated-45° grid lines via `fract`, blocky segmentation noise on the lines,
  sheen envelope × line mask × hueRamp.
- **Usage:** Radiant-rarity cards, a handful of SWSH sets (Astral Radiance onward).
- **Flags:** none.

## 27. Rainbow glitter — `rainbow-glitter` (18:55)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Phoebe (SWSH hyper/rainbow rare), raw glitter sheet, Crobat VMAX, Vaporeon VMAX.
- **Static:** fine dense shapeless glitter OVER a smooth rainbow-mirror base ("glitter on top
  of a rainbow mirror" — narration, matches frames); on real cards the embossed texture ridges
  break it up further.
- **Tilt:** broad rainbow bands sweep (base layer) while glitter specks twinkle in place
  independently.
- **Layers:** rainbow-mirror film + glitter micro-texture layer + translucent inks + physical
  emboss (cards).
- **Shader:** `rainbow-mirror` field + high-frequency thresholded sparkle layer; optional
  normal-perturb from an emboss map for textured rarities.
- **Usage:** SWSH VMAX / rainbow ("hyper") rares and more.
- **Flags:** none.

## 28. Rainbow glitter sheen — `rainbow-glitter-sheen` (19:21)
No Bulbapedia name. **Nearest recipe: none — gap (shares #27 machinery).**
- **Demo:** glitter sheet with V-shaped rainbow band, Mega Venusaur ex (Mega era).
- **Static/Tilt:** #27's fine glitter but the base sheen is a distinct directional band
  (V-shaped arc on the sheet) that sweeps as one; glitter twinkles inside it.
- **Shader:** #27 with the smooth base swapped for a shaped band (two mirrored diagonal
  gaussians).
- **Usage:** Mega-era Mega EX cards and others.
- **Flags:** ⚠ Gemini ID'd the card as "Mega Venusaur EX (XY Evolutions 2/108)" — notes/video
  say Mega era (2026). Set IDs untrusted.

## 29. Ace spec — `ace-spec` (19:32)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Grand Tree (SV ACE SPEC), raw sheet, zh-CN ACE SPEC trainer, Rock Guard (BW ACE
  SPEC — plain tinsel, for contrast).
- **Static:** bold diagonal square/diamond grid whose clusters form "plus"/cross motifs; thin
  sharp reflective lines, dark silver field; full face incl. pink border. Looks like a
  "zoomed-in radiant" but larger with cross motifs.
- **Tilt:** grid fixed; rainbow gradient flows diagonally across the line-work.
- **Shader:** 45°-rotated grid + cross-motif cell selection mask + traveling diagonal hueRamp.
- **Usage:** SV-era ACE SPEC cards only (BW ACE SPECs used tinsel).
- **Flags:** none.

## 30. Pokeball / masterball — `pokeball-masterball` (20:11)
No Bulbapedia name. **Nearest recipe: `reverse-sheet` (implemented stamp grid — close).**
- **Demo:** Sewaddle (Black Bolt / White Flare poke-ball reverse).
- **Static:** staggered repeating grid of Poké Ball (and on the master-ball variant, Master
  Ball) icons ~1/8–1/10 card width, reverse scope (background only).
- **Tilt:** icons fixed; specular band sweeps; icons hue-rotate as it passes.
- **Shader:** current `reverse-sheet` recipe is this, coarse-tier; upgrade ring+dot to a real
  ball SDF and add the masterball palette variant.
- **Usage:** Black Bolt & White Flare (2025) brought Japan's poke-ball/master-ball reverses to
  English. (JP had them earlier — 151 etc.)
- **Flags:** ⚠ Gemini guessed "SWSH / Pokémon GO set" — notes/video say Black Bolt/White
  Flare. Set ID untrusted.

## 31. Prismatic pokeball — `prismatic-pokeball` (20:20)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Professor's Research (Professor Elm) + Throh (Prismatic Evolutions reverses);
  layer diagram shown in-video.
- **Static:** large Poké Ball watermark inside a dense mosaic of irregular polygons (shattered
  glass look); vibrant spectrum. **NOT a foil embossing**: per the video's layer diagram it is
  physical texture + opaque ink printed over a plain RAINBOW-MIRROR foil.
- **Tilt:** polygon cells act as discrete flat mirrors sampling slightly different hues; broad
  hue sweep with faceted, twinkling structure; ball motif static.
- **Layers:** stock → rainbow-mirror foil → white ink → CMYK → pokeball texture/ink overprint
  (top).
- **Shader:** `rainbow-mirror` base + voronoi facet quantization of the hue (per-cell offset)
  + pokeball SDF overlay mask with its own normal offset.
- **Usage:** Prismatic Evolutions poke-ball reverses.
- **Flags:** ⚠ Gemini guessed "SWSH / Pokémon GO"; notes/video say Prismatic Evolutions.
  Layer claim (overprint not emboss) is video-sourced and consistent with the acetone/diagram
  segments.

## 32. Radiant Collection dots — `radiant-collection-dots` (20:56)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Pikachu (Radiant Collection — Generations RC29/RC32 read from frames; chapter covers
  Legendary Treasures + Generations RC), layer-breakdown diagram, Teddiursa (non-holo RC with
  dot overprint), dextcg.com screenshots.
- **Static:** NOT a unique foil: three stacked tricks — (a) scattered shiny dot OVERPRINT on
  top of everything (including over ink), (b) white-ink shape windows (Pikachu heads, hearts,
  bolts) exposing (c) plain mirror foil beneath. Some RC cards are non-holo but keep the dot
  overprint.
- **Tilt:** dots pop on/off like glitter (they sit above the ink); the shape windows flash
  together as one flat mirror; no hue-band travel.
- **Shader:** three explicit layers — mirror base gated by a shape-window mask, art layer,
  additive dot layer ABOVE the art (dots must ignore `uArtGate`/masks).
- **Usage:** Radiant Collection subsets (Legendary Treasures, Generations).
- **Flags:** none — Gemini, narration, diagram, and frames all agree here.

## 33. ex starfoil — `ex-starfoil` (22:15)
No Bulbapedia name. **Nearest recipe: none — gap (composite of sheen + overprint).**
- **Demo:** Alakazam ex (SV 151), Iron Boulder ex (Temporal Forces).
- **Static:** dense field of small 4-point stars over the WHOLE face ("almost triple printed"),
  visible even unlit; the foil beneath is just a diagonal sheen.
- **Tilt:** 1–2 parallel diagonal sheen bands sweep; stars fixed, igniting in the band's
  colors as it passes under them.
- **Layers:** diagonal-sheen foil → inks → star overprint on top.
- **Shader:** `diagonal-sheen` base + static star-atlas mask multiplied by band intensity;
  stars never parallax.
- **Usage:** SV-era ex cards.
- **Flags:** none.

## 34. Sequin — `sequin` (22:48)
Bulbapedia: Sequin. **Nearest recipe: `cracked-ice` machinery at high density — gap.**
- **Demo:** Pikachu (General Mills 25th-anniversary cereal promo), Cinnamon Toast Crunch box,
  sheet closeup.
- **Static:** densely packed small overlapping discs/polygons ("sequins", 1–2% width) in the
  art window; subset lit in saturated pinks/greens/blues at any angle.
- **Tilt:** individual sequins snap on/off abruptly with very narrow activation angles; no
  traveling band; clusters change color between adjacent frames.
- **Shader:** dense voronoi cells, per-cell random normal, hard threshold (`step`-like) —
  cracked-ice with tiny cells, no edge seams, faster activation.
- **Usage:** General Mills cereal-box promos only (SM + SWSH era waves).
- **Flags:** none.

## 35. Crosshatch — `crosshatch` (23:08)
Bulbapedia: Crosshatch. **Nearest recipe: none — gap.**
- **Demo:** Pokémon Fan Club (League promo), Dusknoir FB LV.50 (SP-era League promo), eBay
  listings b-roll.
- **Static:** fine uniform woven grid of intersecting diagonal lines (fabric-like), art window
  + text box; rainbow rides ON the lines.
- **Tilt:** broad rainbow band sweeps; the line grid stays fixed and lights up under it.
- **Shader:** two mirrored diagonal high-frequency line masks + sweeping band + hueRamp.
- **Usage:** Play! Pokémon / Pokémon League promos exclusively (Pokémon, trainers, energies) —
  plentiful and cheap on eBay per the video.
- **Flags:** none.

## 36. TCG classic — `tcg-classic` (23:47)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Water Energy + Blastoise (TCG Classic premium set), sheet closeup.
- **Static:** very fine dense glitter grain (~1/200 width) + scattered slightly-larger 4-point
  stars (~1/50), strong sweeping rainbow over both; every card in the product is holo.
- **Tilt:** rainbow band sweeps (sometimes curved); grains + stars twinkle abruptly inside it,
  taking the band's local color.
- **Shader:** micro-hash glitter + sparse star SDF layer, both gated by a traveling hueRamp
  band.
- **Usage:** Pokémon TCG Classic (2023 Venusaur/Charizard/Blastoise premium decks) only.
- **Flags:** none.

## 37. Confetti — `confetti` (23:59)
Bulbapedia: **Pixel** (syn. Confetti). **Nearest recipe: `cracked-ice` machinery — gap.**
- **Demo:** Charizard (Celebrations Classic Collection — art-window scope), Bulbasaur
  (McDonald's 2021 — full-face scope), sheet closeups.
- **Static:** dense irregular small flakes — explicitly NOT square pixels (narration corrects
  Bulbapedia's "blocky" description) — 1–2% width, subset lit at any angle.
- **Tilt:** chaotic scattered activation: flakes pop in/out abruptly and hue-roll while lit;
  no cohesive band.
- **Shader:** voronoi flakes + per-flake activation normal + tight threshold + hueRamp; scope
  differs per product (window vs full-face).
- **Usage:** Celebrations (25th anniv.) and EVERY English McDonald's promo set.
- **Flags:** naming collision with Bulbapedia "Pixel" recorded; visual disagreement with
  Bulbapedia's "blocky/square" description noted (video + frames show irregular flakes).

## 38. Acid wash — `acid-wash` (24:29)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** Water Energy (Pokémon League promo, ~2006).
- **Static:** continuous fine mottled/etched-metal texture (frosted sponge look), full
  background; no discrete shapes.
- **Tilt:** texture fixed; broad soft iridescent sheens wash across it (yellow-green →
  blue-purple → white glare across the frames).
- **Shader:** fbm-perturbed normals + broad-lobe specular + hueRamp on `dot(n, uTilt)`; low
  shininess.
- **Usage:** Pokémon League promos ~2006, ENERGY CARDS ONLY; short-lived, hard to find.
- **Flags:** none.

## 39. Disco — `disco` (25:02)
No Bulbapedia name. **Nearest recipe: none — gap.**
- **Demo:** CGC-authenticated factory-prototype Blastoise / Charizard / Mewtwo / Zapdos
  (late-'90s, never released; static shots only — no hand tilt demo).
- **Static:** strict uniform mosaic grid of small squares (~1/40–1/50 width) in the art
  window, each square a different vivid color — disco-ball mosaic.
- **Tilt:** (from the multi-frame static shots) grid fixed; each square cycles hue
  independently at its own threshold; abrupt between squares, smooth within one.
- **Shader:** `floor(uv·N)` grid + per-cell hash phase into hueRamp keyed on `uTilt`; no
  parallax, no sweep.
- **Usage:** never officially released — factory test pattern; authenticated prototypes exist
  (CGC / ex-WOTC employees).
- **Flags:** ⚠ no true tilt demo exists (prototype b-roll only); animation is inferred across
  cuts, Medium confidence.

---

## Implementation gap summary

Implemented today (5 recipes): `starlight` (✓ #1, and #24 with parallax 0), `cosmos`
(✓ #2, partial #15/#16), `sv-holo` (actually #14 `vertical-sheen`; one rotation uniform away
from #13/#19/#20/#21), `reverse-sheet` (≈ #30), `cracked-ice` (✓ #9; its facet machinery
seeds #6/#34/#37). Everything else is a gap; the biggest shared building blocks to add, in
leverage order:
1. **Band-angle rotation** for the sheen family (unlocks 5 slugs incl. the real SV default).
2. **Icon/glyph atlas layer** (energy symbols ×2, ex-emerald, pokeball ×2, ex-starfoil stars).
3. **Overprint layer above the art** (radiant-collection-dots, ex-starfoil, prismatic-pokeball
   — foil that ignores the ink mask).
4. **Grid/facet hue-cycling** (prism, disco, pinwheel, radiant, ace-spec).
5. **Smooth iridescent base** (mirror, rainbow-mirror — also the base of #27/#28/#31).
