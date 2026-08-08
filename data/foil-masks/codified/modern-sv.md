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
- `full` scope (ex / illustration rare / hyper rare) has **no** modern-sv corpus at all.

## Batch generated from this pass

`regionlearn-me05-1` — 8 cards, all `ai` / unreviewed:
`me05-002, -003, -005, -006, -010, -014, -024, -029` (5 frame colours, 4 with a Stage-1
medallion). Undo in one line:

```
pnpm --filter pokedex-api exec tsx src/foil/generate-masks.ts revert --run-id regionlearn-me05-1
```
