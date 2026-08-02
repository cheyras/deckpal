# Foil shader verification — Gemini vision vs. the 39-pattern reference corpus

**Run:** Ringer `foil-gemini-verification` (33 tasks + 1 re-judge), judge =
`google/gemini-3.1-pro-preview` via OpenRouter (`research/foil-video-reference/pipeline/gemini_vision.py`),
worker harness = OpenCode/GLM-5.2. Validator: `check_verdict.py` (schema + score range +
verdict/score/discrepancy consistency; executed as each task's check).
**Dates:** 2026-08-02. The original run was interrupted twice by a host crash mid-flight;
it was resumed with a trimmed 31-task manifest and the 2 already-verified verdicts
(`starlight`, `starlight-ii`) reused untouched. All 31 resumed tasks passed first try.
**Artifacts:** frames + verdicts live OUTSIDE the repo at `~/.legacy-dev-hub-legacy/foil-verify/`
(render tilt sweeps under `frames/<pattern>/render-0*.jpg`, verdicts under
`verify-<pattern>/verdict.json`, machine summary `verdicts-summary.json`). Reference
keyframes are the committed corpus at `research/foil-video-reference/<pattern>/frame-0*.jpg`.

**How to read the verdicts.** Each render is a deterministic 8-frame tilt sweep
(x −0.9 → +0.9, y = 0.6·x, workbench defaults) of a real catalog scan, judged against the
video-corpus keyframes on four 0–5 dimensions (static appearance / tilt motion / layer
character / color travel); `match=true` requires every dimension ≥ 3. Patterns without an
implemented recipe render through their labeled nearest-recipe fallback, so a **nay on a
gap-fallback row is the expected result — it is confirmed-gap signal, not a regression.**
The interesting rows are: implemented recipes that fail, and gap fallbacks that score
*high* (the fallback may be closer than assumed).

**Scoreline: 4 yay / 30 nay (counting diagonal-sheen-left's post-fix re-judge; 3/30 before
it) / 6 patterns not judged (below).** Sum column dims: S/T/L/C = static/tilt/layer/color.

## Verdict table

| Pattern | Exemplar card | Judged as | Match | S/T/L/C | Key discrepancies | Frames |
|---|---|---|---|---|---|---|
| `cosmos` | Pidgeot — Base Set 2 (base4-14) | implemented | nay | 1/1/2/1 | color_travel; static_appearance; tilt_motion | `frames/cosmos/` |
| `cracked-ice` | Raichu — Stormfront (dp7-8) | implemented | nay | 2/3/3/2 | color_travel; static_appearance | `frames/cracked-ice/` |
| `diagonal-sheen-left` | Fomantis — Sun & Moon (sm1-14) | implemented | nay | 1/1/1/1 | color_travel; static_appearance; tilt_motion | `frames/diagonal-sheen-left/` |
| `diagonal-sheen-left-v2` | Fomantis — Sun & Moon (sm1-14) | implemented | **yay** | 5/5/5/5 | none | `frames/diagonal-sheen-left-v2/` |
| `diagonal-sheen-right` | Moltres-EX — Plasma Storm (bw8-14) | implemented | **yay** | 4/5/5/3 | color_travel | `frames/diagonal-sheen-right/` |
| `horizontal-sheen` | Kyogre — Mega Evolution (me01-034) | implemented | **yay** | 5/5/5/5 | none | `frames/horizontal-sheen/` |
| `starlight` | Blastoise — Base Set (base1-2) | implemented | nay | 2/2/2/2 | color_travel; layer_character; static_appearance; tilt_motion | `frames/starlight/` |
| `starlight-ii` | Charizard — Evolutions (xy12-11) | implemented | nay | 2/3/5/3 | color_travel; static_appearance; tilt_motion | `frames/starlight-ii/` |
| `striped-vertical-sheen` | Leon — Vivid Voltage (swsh4-154) | implemented | **yay** | 4/5/5/4 | static_appearance | `frames/striped-vertical-sheen/` |
| `vertical-sheen` | Ninetales — HeartGold SoulSilver (hgss1-7) | implemented | nay | 2/4/4/3 | static_appearance | `frames/vertical-sheen/` |
| `ace-spec` | Grand Tree — Stellar Crown (sv07-136) | gap fallback | nay | 0/0/1/1 | layer_character; static_appearance; tilt_motion | `frames/ace-spec/` |
| `confetti` | Bulbasaur — McDonald's Collection 2021 (2021swsh-1) | gap fallback | nay | 1/1/1/2 | layer_character; static_appearance; tilt_motion | `frames/confetti/` |
| `cosmos-ii-pixel` | Pachirisu — Call of Legends (col1-18) | gap fallback | nay | 1/1/1/1 | color_travel; static_appearance; tilt_motion | `frames/cosmos-ii-pixel/` |
| `cosmos-iii-smooth` | Fire Energy — Scarlet & Violet Energy (sve-002) | gap fallback | nay | 1/2/2/2 | color_travel; static_appearance; tilt_motion | `frames/cosmos-iii-smooth/` |
| `crosshatch` | Dusknoir FB — Supreme Victors (pl3-26) | gap fallback | nay | 1/1/2/2 | color_travel; static_appearance; tilt_motion | `frames/crosshatch/` |
| `energy-symbols` | Steven's Advice — Hidden Legends (ex5-92) | gap fallback | nay | 0/1/0/2 | layer_character; static_appearance; tilt_motion | `frames/energy-symbols/` |
| `energy-symbols-ii` | Marowak — FireRed & LeafGreen (ex6-7) | gap fallback | nay | 0/1/0/1 | color_travel; layer_character; static_appearance; tilt_motion | `frames/energy-symbols-ii/` |
| `ex-emerald` | Swalot — Emerald (ex9-40) | gap fallback | nay | 1/2/1/1 | color_travel; static_appearance; tilt_motion | `frames/ex-emerald/` |
| `ex-starfoil` | Alakazam ex — 151 (sv03.5-065) | gap fallback | nay | 2/1/1/1 | color_travel; layer_character; static_appearance; tilt_motion | `frames/ex-starfoil/` |
| `fireworks` | Zapdos — Legendary Collection (lc-19) | gap fallback | nay | 0/0/0/1 | color_travel; layer_character; static_appearance; tilt_motion | `frames/fireworks/` |
| `mirror` | Shining Mewtwo — Neo Destiny (neo4-109) | gap fallback | nay | 2/2/4/5 | static_appearance; tilt_motion | `frames/mirror/` |
| `pinwheel` | Shroomish — Deoxys (ex8-72) | gap fallback | nay | 0/1/1/1 | layer_character; static_appearance; tilt_motion | `frames/pinwheel/` |
| `pokeball-hologram` | Cyclone Energy — Unseen Forces (ex10-99) | gap fallback | nay | 0/0/0/1 | layer_character; static_appearance; tilt_motion | `frames/pokeball-hologram/` |
| `pokeball-masterball` | Sewaddle — White Flare (sv10.5w-001) | gap fallback | nay | 1/3/2/3 | layer_character; static_appearance | `frames/pokeball-masterball/` |
| `prism` | Raticate BREAK — BREAKpoint (xy9-89) | gap fallback | nay | 0/0/0/1 | layer_character; static_appearance; tilt_motion | `frames/prism/` |
| `prismatic-pokeball` | Professor's Research — Prismatic Evolutions (sv08.5-123) | gap fallback | nay | 1/2/1/2 | color_travel; layer_character; static_appearance; tilt_motion | `frames/prismatic-pokeball/` |
| `radiant` | Radiant Venusaur — Pokémon GO (swsh10.5-004) | gap fallback | nay | 1/1/1/1 | color_travel; static_appearance; tilt_motion | `frames/radiant/` |
| `rainbow-glitter` | Phoebe — Battle Styles (swsh5-175) | gap fallback | nay | 1/1/1/2 | layer_character; static_appearance; tilt_motion | `frames/rainbow-glitter/` |
| `rainbow-glitter-sheen` | Mega Venusaur ex — Mega Evolution (me01-003) | gap fallback | nay | 1/1/1/1 | color_travel; layer_character; static_appearance; tilt_motion | `frames/rainbow-glitter-sheen/` |
| `rainbow-mirror` | Crystal Energy — Aquapolis (ecard2-146) | gap fallback | nay | 2/2/4/1 | color_travel; static_appearance; tilt_motion | `frames/rainbow-mirror/` |
| `tinsel` | Meloetta — Boundaries Crossed (bw7-77) | gap fallback | nay | 1/1/1/1 | color_travel; layer_character; static_appearance; tilt_motion | `frames/tinsel/` |
| `tinsel-ii` | Thundurus — Black Bolt (sv10.5b-033) | gap fallback | nay | 1/2/1/2 | layer_character; static_appearance; tilt_motion | `frames/tinsel-ii/` |
| `vertical-sheen-rainbow` | Medicham — Crystal Guardians (ex14-25) | gap fallback | nay | 2/4/4/1 | color_travel; static_appearance | `frames/vertical-sheen-rainbow/` |
| `water-web` | Rhyperior — Burning Shadows (sm3-67) | gap fallback | nay | 0/0/0/1 | color_travel; static_appearance; tilt_motion | `frames/water-web/` |

## Orchestrator review notes (human-eye pass over the frames)

- **`cosmos` set-misID rejected, visual critique accepted.** Gemini's notes claim the
  reference "shows a Starlight pattern (typical of Jungle set)" — wrong: the reference
  keyframes are the genuine Base Set 2 Pidgeot cosmos demo (the video overlay literally
  reads "Cosmos"). This is the documented set-misID failure mode (see DECISIONS
  2026-08-02 video-reference entry). The *scores* stand on their own, though: eyeballing
  the frames confirms our render lights a dense wall of large saturated orbs at every
  tilt, while the real foil shows sparse clusters brightening in place against a dark
  field. The cosmos recipe needs a density/gain/activation-window re-tune regardless.
- **Diagonal-sheen left/right asymmetry explained.** Both diagonals are the same physical
  sheet at 90°; the pre-fix left (1/1/1/1) vs right (4/5/5/3) split is exemplar choice,
  not rotation: the right render is a busy full-art Moltres-EX that hides band structure;
  the left render is a flat green Fomantis reverse where the single broad band was
  glaring. Slope itself was verified correct in both ("/" right, "\" left).
- **Cheap fix applied — `diagonal-sheen-left` uP0 2 → 7** (band count; one uniform
  default in `patterns.ts`). Before: 1/1/1/1 nay ("one broad diffuse wash"). After
  re-capture + re-judge: 5/5/5/5 yay. Honest caveat: straight 5s flatter the fix — to my
  eye the bands, while now plural and correctly angled, are still softer than the raw
  sheet's sharp CD-like lines (band exponent is hard-coded at 1.6, not a uniform), and
  the broad beam term still dominates mid-sweep. Recorded as residual polish, not done.
- **Not applied to `diagonal-sheen-right`** (same sheet, still uP0 2): it currently holds
  a match=true verdict; changing it invalidates that verdict for a cosmetic-consistency
  win. Recommended follow-up: bump it to 7 too and re-judge in the next wave, which
  should also address its one note (center blown out to white).
- **`vertical-sheen` left alone deliberately.** Its only failing dimension
  (static_appearance 2: "barcode of multiple sharp lines of varying widths") needs
  variable band widths / a sharpness uniform — a GLSL change, out of cheap-fix scope.
- **`cracked-ice` left alone deliberately.** Gemini wants the intra-shard grain gone;
  that grain is a hard-coded, deliberately authored GLSL line ("a hot shard glitters, it
  doesn't flood"). Chey should arbitrate looks-vs-reference before anyone deletes it.
- **`starlight` (2/2/2/2) is flagged for Chey, not auto-fixed.** The recipe was hand-tuned
  with him (v3 parallax rework). Gemini wants sharper metallic star glyphs, a tighter
  pop-in window, and more saturated discrete flashes — plausibly right (the reference
  really does pop harder), but his eye owns this one.
- **High-scoring fallbacks worth noting:** `mirror` via its fallback already hits 4–5 on
  layer/color (needs sharper static texture), `rainbow-mirror` 4 on layer,
  `vertical-sheen-rainbow` 4/4 on tilt/layer, `pokeball-masterball` 3/3 on tilt/color.
  Their dedicated recipes start from a decent base.

## Patterns not judged in this run — honest skip list

Verification requires a real catalog scan to render. Six of the 39 corpus patterns have
no verification row:

| Pattern | Why | Catalog status (checked 2026-08-02 against the live catalog) |
|---|---|---|
| `radiant-collection-dots` | **Skipped, but its exemplars ARE in the catalog** (Generations `g1-RC1…RC32`, e.g. Pikachu g1-RC29; Legendary Treasures RC also present). The pre-crash W2 lane skipped it; nothing blocks a capture. | **In catalog — first candidate for the next verification pass.** |
| `big-glitter` | Video exemplar is the e-series *oversized gold box topper* (Scizor); no such product card exists in the catalog. | Not in catalog. |
| `sequin` | General Mills cereal-box promos only; no General Mills promo set in the catalog (McDonald's sets exist, General Mills does not). | Not in catalog. |
| `tcg-classic` | Pokémon TCG Classic (2023 premium decks); no such set in the catalog (only "Celebrations Classic Collection" matches the word, different product). | Not in catalog. |
| `acid-wash` | ~2006 Pokémon League promo *energy cards* only; no matching League-promo energy printing found in the catalog. | Not in catalog. |
| `disco` | Factory prototypes, never released (CGC-authenticated b-roll only; no true tilt demo exists even in the corpus). | Not in catalog — unverifiable by design. |

No silent substitutions were made: every judged row above names the exact catalog card
that was rendered.

## Recipe-wave plan — ~30 gap recipes, prioritized

Ordering rule: **patterns used on eras/cards Chey owns come first** (owned today: WOTC
Base series 176 cards, Mega Evolution 139, Scarlet & Violet 68, Sword & Shield 3 — from
the live collection API), **then by verification-failure severity** (lower score sum =
bigger gap). Era attribution from `research/foil-pattern-usage.json` via the cited usage
index. Implemented-recipe re-tunes are listed separately — they're cheaper than new
recipes and mostly sit on owned cards.

### Wave R0 — re-tunes of implemented recipes (owned cards, highest leverage)

| # | Recipe | Owned era | Score sum | What the verdict asks for |
|---|---|---|---|---|
| R0.1 | `cosmos` | WOTC (Base Set 2), promos everywhere | 5/20 | Sparser, smaller orbs; dark cloudy field; clusters brighten in place within a narrow window instead of a lit wall |
| R0.2 | `starlight` | WOTC (Base/Jungle/Fossil) | 8/20 | Chey-arbitrated: sharper metallic 4/8-point glyphs, tighter pop window, saturated discrete flashes (his hand-tuned parallax must survive) |
| R0.3 | `diagonal-sheen-right` | XY default, SWSH, SV/Mega uses | 17/20 (pass) | uP0 2→7 for sheet consistency with the fixed left; tame center blow-out; re-judge |
| R0.4 | `vertical-sheen` | Platinum→XY default (unowned era, but the sheet underlies many reverses) | 13/20 | Barcode static: variable band widths + sharpness uniform (GLSL change) |
| R0.5 | `cracked-ice` | Theme decks DP→SWSH | 10/20 | Chey-arbitrated: drop/attenuate intra-shard grain, solid saturated shard flashes |
| R0.6 | `starlight-ii` | XY (Evolutions) | 13/20 | Sharper starbursts, saturation up, tighter activation (layer character already 5) |

### Wave R1 — new recipes on owned eras (SV/Mega + WOTC + SWSH)

| # | Recipe | Era (owned signal) | Score sum | Notes |
|---|---|---|---|---|
| R1.1 | `fireworks` | WOTC reverses (Legendary Collection) | 1/20 | Worst score on an owned-adjacent era; radial burst streaks |
| R1.2 | `ace-spec` | SV ACE SPEC cards (owned SV) | 2/20 | Distinctive pink-sheet sparkle |
| R1.3 | `energy-symbols-ii` | EX→SV/Mega energy holos | 2/20 | Symbol-shaped die-cut layer |
| R1.4 | `rainbow-glitter-sheen` | **Mega Evolution ex holos (me01 — 139 owned)** | 4/20 | The current Mega-era chase look |
| R1.5 | `ex-starfoil` | SV ex (151, owned SV) | 5/20 | Star-punched foil |
| R1.6 | `prismatic-pokeball` | Prismatic Evolutions (owned SV) | 6/20 | Pokeball die-cut + prism field |
| R1.7 | `tinsel-ii` | Black Bolt / White Flare (owned SV) | 6/20 | Fine vertical tinsel strands |
| R1.8 | `cosmos-iii-smooth` | SVE energy reverses (owned SV) | 7/20 | HD smooth cosmos orbs |
| R1.9 | `pokeball-masterball` | SV pokeball/masterball reverses | 9/20 | Fallback already lands 3s on tilt/color; stamp grid exists in `reverse-sheet` |
| R1.10 | `radiant` | SWSH Radiant cards (3 SWSH owned) | 4/20 | Criss-cross metallic lattice |
| R1.11 | `rainbow-glitter` | SWSH rainbow rares | 5/20 | Dense pastel glitter over painted art |
| R1.12 | `confetti` | Promo cross-era (McDonald's etc.) | 5/20 | Chunky sparse confetti flakes |

### Wave R2 — new recipes on unowned eras (severity order)

| # | Recipe | Era | Score sum |
|---|---|---|---|
| R2.1 | `pokeball-hologram` | EX era (Unseen Forces etc.) | 1/20 |
| R2.2 | `prism` | Pre-WOTC JP / XY BREAK | 1/20 |
| R2.3 | `water-web` | Sun & Moon standard holo | 1/20 |
| R2.4 | `energy-symbols` | WOTC/EX energy holos | 3/20 |
| R2.5 | `pinwheel` | EX era (Deoxys etc.) | 3/20 |
| R2.6 | `tinsel` | Black & White standard holo | 4/20 |
| R2.7 | `cosmos-ii-pixel` | Call of Legends / BW promos | 4/20 |
| R2.8 | `ex-emerald` | EX Emerald | 5/20 |
| R2.9 | `crosshatch` | League promos, cross-era | 6/20 |
| R2.10 | `rainbow-mirror` | e-Card reverses | 9/20 (fallback layer already 4) |
| R2.11 | `vertical-sheen-rainbow` | EX era | 11/20 (fallback tilt/layer already 4) |
| R2.12 | `mirror` | Neo/e-Card/EX reverses | 13/20 (closest fallback of all — polish job) |

### Wave R3 — no catalog exemplar (build to corpus frames only, verify by eye)

`radiant-collection-dots` (capture + judge FIRST — exemplars are in the catalog, see skip
list), then `big-glitter`, `sequin`, `tcg-classic`, `acid-wash`; `disco` last (prototype,
animation inferred, Medium confidence — prototype flag in the workbench dropdown).

## Reproduction

- Re-run everything: `cd ~/ringer && ./ringer.py run ~/.legacy-dev-hub-legacy/foil-verify/manifest.json`
  (33 tasks; `manifest-resume.json` = the 31-task crash-resume variant; `manifest-dsl-v2.json`
  = the one-task re-judge).
- Re-capture a pattern's sweep: drive the workbench at `:5182/pokedex/foil-lab` with
  Playwright — pick the exemplar card, force the pattern in the dropdown, Manual tilt,
  8 frames x = −0.9…0.9 / y = 0.6·x, screenshot the canvas (crop DOM overlays out).
  The v2 capture script pattern is recorded in DECISIONS (2026-08-02 W2 entry).
- `report.py` in the run dir predates the crash and expects a lost
  `~/.legacy-dev-hub-legacy/verify-manifest.json`; `verdicts-summary.json` (written by the
  finisher) supersedes it.
