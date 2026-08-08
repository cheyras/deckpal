# Codified mask rules — era `modern-sv` (Scarlet & Violet 2023–, incl. Mega Evolution)

Codification log per the ritual in `.claude/skills/mask-pipeline/SKILL.md` ("Codify").
Nothing here is fabricated — every claim traces to a hand-drawn mask, measured.

## Pass 1 — 2026-08-08 · scope `sheet` · n=3 human exemplars

**Corpus** (selected through `selectExemplars({ eraId:'modern-sv', scope:'sheet' })`; the
five unreviewed `ai` masks from `edgetrace-me05-batch-1` do not exist any more, and no `ai`
mask is admissible regardless — `EXEMPLAR_WEIGHT.ai = 0`).

| entry | method | weight | rule agreement | evidence |
|---|---|---|---|---|
| `me05-001/37184` Tropius | `ai-corrected` | 0.6 | 0.7090 | `37184.diff.png`, `37184.parent.diff.png` |
| `me05-007/37195` Heatran | `hand` | 1.0 | 0.7596 | `37195.diff.png` |
| `me05-012/77558` Armarouge (Stage 1) | `hand-refined` | 1.0 | 0.7496 | `77558.diff.png`, `77558.parent.diff.png` |

Two Basics and one Stage 1, three different frame colours, one with an evolution medallion
that overlaps the illustration box. Small, but it spans the layout variation that matters.

## The rule this corpus teaches

> **modern-sv `sheet` scope = the COLOURED FRAME BODY, and nothing else.**
> Foil covers the card's printed colour field — name bar, HP, type icon, attack area,
> weakness/resistance/retreat row, flavour text, illustrator and set-number line.
> Foil stops at every piece of **silver furniture** and at the illustration.

Excluded, unanimously, on all three masks:

| excluded region | his foil share | note |
|---|---|---|
| **the silver border ring** | 0.2% · 0.2% · 0.4% | **THE ANSWER to the open question.** Not foil. |
| the illustration box (incl. its bevel) | 0.0% · 0.0% · 1.6% | the `sheet` hole, by definition |
| the species strip (`NO. 0485 …`) + its flared tails | — | part of `furniture` below |
| the stage tag (`BASIC` / `STAGE 1`) | — | ditto |
| the evolution medallion + the "Evolves from X" bar | — | ditto; Stage 1 only |
| the copyright footer under the frame | — | ditto |
| all silver furniture together | 16.1% · 15.5% · 11.8% | the residue is boundary antialiasing, not a claim |

**The silver border was flagged in DECISIONS 2026-08-08 as "Chey's call, not a
measurement". It is now a measurement.** On his three masks the ring carries essentially
no foil: he stops at the inner edge of the coloured frame, all the way round including the
rounded corners, and the copyright line below the frame stays bare.

## Expressibility

- **Not a rect, and never will be.** The excluded set is the frame's printed furniture:
  a strip whose ends flare wider than the illustration, a pill in one corner, a disc that
  straddles the illustration's edge on evolved cards only. `era-layouts.json` cannot say
  this and should not try.
- It IS expressible as a **region policy over structures detected on the card's own
  printing** — which is what `region-learn@1` (`apps/api/src/foil/region-learn.ts`) does:
  partition the face into `border / furniture / frameBody / windowBackground /
  windowSubject`, then apply the classes his masks voted for. Here that vote is
  `frameBody` at 98.3% · 97.8% · 98.8%, everything else under 17%.
- Restated physically, and this is why it generalises: **the reverse-holo foil is under
  the coloured ink and not under the silver.** Chroma is therefore the signal, not
  luminance — the same reason `edge-trace` uses a colour structure tensor.

## Validation (step 4)

Leave-one-out: each card's own mask withheld, the policy learned from the other two, the
result scored against the withheld truth (`generate-masks.ts eval --generator region-learn
--era modern-sv --scope sheet --serie me`).

| card | era rect | region-learn@1 | Δ | boundary mean / p95 |
|---|---|---|---|---|
| me05-001 | 0.7607 | **0.9803** | +0.2196 | 3.64px / 23px |
| me05-007 | 0.7596 | **0.9752** | +0.2156 | 4.82px / 55px |
| me05-012 | 0.7496 | **0.9519** | +0.2023 | 3.86px / 15px |
| **mean** | **0.7566** | **0.9691** | **+0.2125** | |

Bar stated before the numbers existed: mean ≥ 0.90 and no card below 0.85. **PASS.**

The residual is registration, not regions: me05-012's 7,244px shortfall is a 1–2px
hairline running the whole way round the frame perimeter (his stroke sits a touch outside
the printed chroma edge), plus the same hairline round the illustration. No excluded
region is claimed and no included region is dropped on any of the three.

Rect-only ceiling for this scope, for the record: **0.7566**. Anything at or below that
is not using the artwork.

## What is still unproven

- **All three exemplars are from one set (me05, Pitch Black).** Frame colour varies but
  print run and scan pipeline do not. A hand mask on a Scarlet & Violet main-series
  reverse would test that.
- **A coloured island marooned inside silver furniture is dropped** (it is not part of the
  largest coloured component). That is right for the sprite inside an evolution medallion
  — his me05-012 mask agrees. It also drops a narrow coloured sliver trapped between a
  medallion and the border ring on cards where the medallion does not quite reach the
  edge (visible on `me05-014` Seaking in the generated batch). **Chey has never ruled on
  that sliver**; it is an extrapolation, and the first thing to look at in the batch.
  → **RULED ON in pass 2 below. The sliver IS foil.**
- `full` scope (ex / illustration rare / hyper rare) has **no** modern-sv corpus at all.

---

## Pass 2 — 2026-08-08 · scope `sheet` · n=11 human exemplars

Chey corrected **every one** of the 8 masks `regionlearn-me05-1` produced. Those 8
correction records, plus the 3 originals, are this pass. Corpus selected through
`selectExemplars({ eraId:'modern-sv', scope:'sheet' })`; the 5 unreviewed `ai` WOTC masks
and the 4 human WOTC masks are rejected (weight 0 / wrong era) and appear in `rejected[]`.

| entry | method | weight | corrected | changed | vs machine parent |
|---|---|---|---|---|---|
| `me05-001/37184` Tropius | `ai-corrected` | 0.6 | ✓ | 118 px (0.04%) | edge-trace@1 |
| `me05-002/37186` Grubbin | `ai-corrected` | 0.6 | ✓ | 393 px (0.12%) | region-learn@1 |
| `me05-003/37188` Fomantis | `ai-corrected` | 0.6 | ✓ | 1 023 px (0.31%) | region-learn@1 |
| `me05-005/37191` Poltchageist | `ai-corrected` | 0.6 | ✓ | 2 560 px (0.78%) | region-learn@1 |
| `me05-006/37193` Sinistcha (S1) | `ai-corrected` | 0.6 | ✓ | 2 615 px (0.79%) | region-learn@1 |
| `me05-007/37195` Heatran | `hand` | 1.0 | — | — | — |
| `me05-010/37200` Centiskorch (S1) | `ai-corrected` | 0.6 | ✓ | 7 357 px (2.23%) | region-learn@1 |
| `me05-012/77558` Armarouge (S1) | `hand-refined` | 1.0 | — | — | — |
| `me05-014/37207` Seaking (S1) | `ai-corrected` | 0.6 | ✓ | 3 507 px (1.06%) | region-learn@1 |
| `me05-024/37225` Manectric (S1) | `ai-corrected` | 0.6 | ✓ | 6 007 px (1.82%) | region-learn@1 |
| `me05-029/37234` Slowpoke | `ai-corrected` | 0.6 | ✓ | 3 891 px (1.18%) | region-learn@1 |

6 non-evolving, 5 evolving. **The corrections are small** — 0.04% to 2.23% — which is the
first finding: pass 1's REGION policy was substantially right. What he changed was
specific, repeated across cards, and structural.

### Three rulings his corrections make

**1. THE SLIVER IS FOIL.** *(the open question from pass 1, now closed)*

The narrow coloured wedge pinched between the evolution medallion, the stage tag and the
border ring. `region-learn@1` dropped it — it is not part of the largest coloured component
— and scored **0.0%** foil there on all four Stage-1 cards it generated. Chey added it back
on **all four** (`me05-006`, `-010`, `-014`, `-024`, ~220–240 px each). Measured over a box
covering the sliver and part of the medallion (x 20–44, y 43–58 at 490×674):

| | his mask | region-learn@1 |
|---|---|---|
| me05-006 | 36.3% | 0.0% |
| me05-010 | 35.3% | 0.0% |
| me05-014 | 37.5% | 0.0% |
| me05-024 | 37.8% | 0.0% |

**So "largest coloured component" was the wrong rule.** The right one: *every* coloured
region outside the illustration that reaches the border ring is frame body. The medallion's
own interior sprite stays excluded because it is fully enclosed by the medallion disc — a
topological distinction, not a size one. Locked by
`apps/api/src/foil/__tests__/vector-template.test.ts`.

**2. INK ON THE COLOURED FIELD IS FOIL — furniture is not ink.**

`region-learn@1` carved a hole around every achromatic mark sitting on the frame, because
its only test was chroma. Chey filled every one of them:

- the **colourless energy symbols** in the attack-cost row (the coloured Fire/Water symbols
  were already included — only the achromatic ones were being cut);
- the **retreat-cost symbols** in the weakness/resistance/retreat row;
- the **regulation-mark box** and the illustrator / set-number line at the bottom left;
- the **name text**, where bold lettering severed the top strip of frame from the rest and
  `largestComponent` then dropped the orphan (me05-010 and me05-024: a 369×17 band, the
  single biggest correction in the batch at 4 533 px and 4 271 px).

Physically this is the same law pass 1 already stated: **the reverse foil is under the
coloured ink.** It is under the colourless energy symbol too, because that symbol is printed
on the same field. What the foil stops at is *structural silver furniture*, and furniture is
distinguished topologically — it touches the border ring or the illustration window
(species strip with its flared tails, stage tag, medallion, "evolves from" bar which spans
to the right border, copyright footer). An achromatic island fully enclosed by frame body is
ink, and carries foil.

**3. THE WINDOW EDGE SITS ON THE BEVEL'S OUTER LINE — and he draws it STRAIGHT.**

On 7 of 8 cards he removed a 3–5 px vertical hairline at x≈35–38 and x≈451–454, i.e. the
detected window was one bevel line too far in. Pass 1's `detectWindow` already takes the
bevel side explicitly; the corrections say the refusals were falling back to an era rect
that is itself ~2 px wide. More importantly — see `zoom-window-edge-straightness.png` —
**his line there is dead straight and the machine's traced line wobbles ±2 px.** That
observation is what moved this era off livewire tracing entirely; see the DECISIONS entry
for 2026-08-08 and `roadmap/plans/foil-mask-vector.md`.

### The geometry: ONE layout, not two

Chey: *"We don't need 3,454 vector masks. All of these share the same 2 layouts really."*
Measured across all 11 masks:

- **165 302 px (50.05%) are foil on every mask**; **155 821 px (47.18%) are bare on every
  mask**; only **9 137 px (2.77%) are contested at all**, and nearly all of that is the
  ±1–2 px registration band along the boundary.
- The Basic-vs-evolving difference is **one blob**: 2 646 px at x 18–87, y 41–125 — the
  evolution medallion. Nothing else differs.

So it is better than two layouts: **one layout plus one optional element.** The fitter
discovers that element from the corpus itself rather than being told a medallion exists —
open the contested set to destroy the boundary band, take the largest survivor, and split
the exemplars on their foil share inside it. The split is unambiguous: 1.1 / 1.1 / 1.2 /
1.5 / 3.3 % against 83.7 / 84.0 / 84.6 / 84.9 / 86.3 / 98.4 %, an **80.5 pp** gap.

### Validation (step 4)

Leave-one-out through `generate-masks.ts eval --generator vector-template`, against the bar
committed in `38e12cc` **before the generator existed** (mean ≥ 0.94, none below 0.90):

| | mean IoU | worst | boundary p95 |
|---|---|---|---|
| era rect only | 0.7518 | 0.7427 | — |
| `region-learn@1` (11 exemplars) | 0.9757 | 0.9519 me05-012 | 2–72 px |
| **`vector-template@1`** | **0.9907** | **0.9843** me05-007 | **1 px on 10 of 11** |

**PASS.** And on the 10 cards with a machine parent, the template is closer to *his
corrected mask* than to *the machine version he rejected* on **every** card (worst margin
+0.0002, best +0.1080) — it learned the correction, not the proposal.

### Rect-only ceiling, for the record

**0.7518.** Anything at or below that is not using the artwork.

### What is still unproven after pass 2

- **Trainer (431 variants) and Energy (104 variants) have ZERO exemplars** and are a
  different layout — no illustration window, no species strip. The template is visibly
  wrong on them (`exception-sets-and-energy-failure.png`) and the optional-element probe
  agrees with the catalog on 0/49 of them, against 293/328 on Pokémon. **Out of scope until
  he draws one of each.**
- **Every exemplar is still from me05.** The template holds across 25 sets on the evidence
  below, but no hand mask exists outside Pitch Black.
- **Pale frames cannot self-verify.** Template-vs-artwork adherence is systematically lower
  on Lightning (45.5% flagged), Colorless (41.0%), Grass (23.6%) and Metal (16.7%) than on
  Fire, Psychic and Darkness (0.0% flagged) — a low-contrast frame/border step, not a
  geometry error. The next hand mask should be a **Lightning or Colorless** card.
- `full` scope still has **no** modern-sv corpus at all.

## Batch generated from this pass

`regionlearn-me05-1` — 8 cards, all `ai` / unreviewed:
`me05-002, -003, -005, -006, -010, -014, -024, -029` (5 frame colours, 4 with a Stage-1
medallion). Undo in one line:

```
pnpm --filter pokedex-api exec tsx src/foil/generate-masks.ts revert --run-id regionlearn-me05-1
```
