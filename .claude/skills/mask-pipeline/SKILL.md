---
name: mask-pipeline
description: "The foil-mask derivation pipeline for the foil/main track: how holo-zone masks are derived, stored, and codified — layout rects (shipped), Apple-Pencil hand-drawn masks with prior+diff sidecars (shipped, the ground-truth corpus), artwork-keyed mask aliasing, the codify ritual that turns corpus into per-era rules, and the future art-driven tier. Read before touching mask storage, the mask editor, the foil-lab api routes, or building art-driven masks."
---

# mask-pipeline

Masks decide **where** foil appears on a card face. Tiers, cheapest first
(spec: `roadmap/plans/foil-main.md`):

## Tier 1 — layout-driven (SHIPPED)

`apps/web/src/foil/era-layouts.json` holds art-window rects per frame generation (data,
not code; top-left-origin fractions of the card face, measured on 600×825 cache scans).
`resolver.ts` maps a resolved scope to mask uniforms: `window` = inside the art window
(classic holo), `sheet` = outside it (reverse holo), `full` = whole face. Zero image
analysis. Supplements: the `uArtGate` luminance gate in the shader (foil only where the
scan is dark) approximates ink-vs-foil *within* the zone; the workbench mask-overlay
toggle is the review tool for rect accuracy. `RESOLVER_VERSION` in `resolver.ts` names
the current rule version — bump it whenever resolver heuristics or layout data change
meaning (it is recorded in every hand-mask sidecar).

## Tier 3 — hand-drawn (SHIPPED; deliberately before tier 2)

Chey draws masks directly on the scan with Apple Pencil on the workbench
(`foil/MaskEditor.tsx`): brush/eraser with size + pen pressure, undo (12 steps),
pen+mouse by default with an allow-finger toggle, `touch-action: none` while editing,
editing starts from the layout prior (or the saved mask). **The explicit purpose is a
ground-truth corpus**: hand masks + their priors + diffs + linked comments are the
instruction set from which agents codify how masks are really made per era (see
"Codify" below) — masks are more complicated than a square.

### Storage — sidecar v2 (committed, reviewable artifacts on the branch)

NOT the image cache (that path is a contract for card art only). `data/*` is gitignored
EXCEPT `data/foil-masks/` — re-included explicitly in `.gitignore`; don't "fix" that.

```
data/foil-masks/<cardId>/<variantId>.png        # ALPHA = foil coverage (RGB = display tint)
data/foil-masks/<cardId>/<variantId>.prior.png  # the layout-rule output the edit started from
data/foil-masks/<cardId>/<variantId>.diff.png   # hand vs prior: GREEN = human added,
                                                #   RED = human removed, faint white = agreed
data/foil-masks/<cardId>/<variantId>.json       # sidecar v2
```

Sidecar v2 fields: `version: 2`, ids, `artworkKey` (= cardId, see below), dims,
`channel: "alpha"`, `derivation_method: "hand"`, `savedAt`, `prior { source: "layout",
eraId, scope, rect (UV y-up, maskForScope output), radius, invert, feather,
resolverVersion }`, `priorPng`, `diffPng`, and `diff { addedPx, removedPx, unchangedPx,
agreement }` (agreement = Jaccard of hand vs prior foil pixels; foil = alpha ≥ 128).

The PUT route (`apps/api/src/routes/foil-lab.ts`, mounted only under
`POKEDEX_FOIL_LAB=1`, port 3712) renders the prior and computes the diff **server-side**
(`apps/api/src/foil/mask-artifacts.ts`, pure-JS PNG codec in `foil/png.ts` — no native
addons) from the client-reported resolver output, so artifacts can't drift from the
recorded numbers. A save without a parsable prior is a 400: a corpus entry that can't be
diffed teaches nothing. Legacy v1 sidecars are upgraded with
`pnpm --filter pokedex-api exec tsx src/foil/backfill.ts --card <id> --variant <n>
--era <eraId> --scope <scope>` — the prior must be deterministic and known; never guess it.

When a hand mask exists for the selected `(card, variant)` the workbench auto-loads it
and it beats the layout tier (`uMaskTex`/`uMaskTexOn`; canvas is y-down, the shader
flips V once; `CanvasTexture.flipY` is explicitly false — don't reintroduce the
double-flip).

**Never fabricate corpus entries**: only Chey's actual drawings belong in
`data/foil-masks/`. Synthetic test masks from verification runs must be deleted before
commit (use a `zztest-*` card id so they can't be mistaken for corpus).

### Artwork-keyed lookup (the identity rule and its limits)

Chey (2026-08-01): the Machamp mask "should be the same one for all the ones of this
Machamp because they have the same picture." A mask is a property of the
**illustration-as-scanned**, not of `(card, variant)`.

What the catalog **proves**: all variants of one `cardId` render the same scan — card
imagery is keyed per card (cache path `<lang>/<serie>/<set>/<localId>.<quality>.webp`;
the `card_variant` table has no imagery of its own; the workbench textures
`card.images.high` for every variant). So `artworkKey = cardId` and a mask drawn on that
scan serves every variant of the card **whose foil treatment covers the same zone**:
GET `/foil-lab/masks/:cardId/:variantId?scope=<resolved scope>` falls back to a sibling
variant's mask with matching `prior.scope` (newest `savedAt` wins;
`X-Foil-Mask-Alias-Of` header + `aliasOf` in `/meta` report the source; the workbench
shows "same-artwork alias of variant N"). Scope matters: a holo (window) and a reverse
(sheet) of the same card must NOT share a mask.

**Limits — where it falls back to per-card:** (a) different `cardId`s that reprint the
same illustration (Base Set 2, promo reprints) canNOT be proven identical from the
catalog — there is no illustration key; `illustrator`+name is heuristic,
`playable_fingerprint` is gameplay, pHash is similarity not identity — so cross-card
reuse is never automatic. Draw (or explicitly copy, as a human decision) a new mask.
(b) v1 sidecars (no `prior`) are never aliased — no guessing. (c) Saving while viewing
an aliased mask writes a NEW file under the current variantId (provenance stays with
the variant it was drawn/adjusted on).

### Comment↔mask linkage (automatic)

Workbench comments (`issues/foil/<id>/`) automatically capture the saved hand mask they
describe: `maskFile`, `maskSavedAt`, `maskAliasOf`, `maskHasPriorDiff` in the report
front-matter + context.json (plus the existing `maskSource`/`maskDirty` state). One
button + free text stays the whole UI; the linkage means "here's why I changed this" is
mechanically joined to the exact mask state it describes. Comments are corpus: resolved
comments stay in place with `status: resolved` + a short resolution note appended —
never edit Chey's words.

## Codify — the ritual that turns corpus into rules

Run this whenever an era has new/changed hand masks or resolved mask comments. The
system improves itself: human corrections in, better rules out.

1. **Gather** the era's corpus: every `data/foil-masks/**` entry whose `prior.eraId`
   matches (mask + prior + diff + sidecar stats) and every `issues/foil/*` comment
   about that era's masks (follow `maskFile` links). Read the diffs VISUALLY — the
   colors say what the rule got wrong (green = rule missed foil, red = rule
   over-covered).
2. **State the rule** the corpus teaches, in the strongest expressible form:
   - data, when the layout schema can express it (rect/radius changes in
     `era-layouts.json`);
   - prose, when it can't yet (e.g. "minus subject silhouette" needs the art-driven
     tier) — record it in the era's `notes` field AND the codification log.
3. **Record** the pass in `data/foil-masks/codified/<eraId>.md`: date, corpus size
   **n**, the rule, per-entry evidence (agreement numbers, diff paths), and what the
   rule implies for tier-2 derivation. **Always state n.** n=1 is a "codified
   observation", not a law — say so explicitly and keep the rule conservative.
4. **Validate**: regenerate each corpus entry's mask from the (new) rule and measure
   agreement against the hand mask — today that is `backfill.ts --force` re-diffing
   prior vs hand (agreement in the sidecar IS the rule-vs-human score for the current
   resolver). A rule change should move agreement up across the corpus; report the
   before/after numbers in the log. If a new rule needs capabilities the resolver
   lacks, the validation states the ceiling (e.g. "rect-only tops out at 0.64 here").
5. **Version**: if resolver heuristics or layout data changed meaning, bump
   `RESOLVER_VERSION` — future saves record which rule they were diffed against.
6. Same ritual for **pattern** comments: a resolved comment's insight is distilled into
   the relevant pattern's section/field-note in `.claude/skills/foil-effects/SKILL.md`.

First worked example: `data/foil-masks/codified/wotc.md` (n=1, Machamp — "WOTC window
scope = art-window rect minus subject silhouette").

## Tier 2 — art-driven (NEXT, sub-branch `foil/masks`)

Segmentation/luminance analysis on the actual scan to find the true foil region (holo
behind the subject only, cosmos voids, textured IR relief zones), **trained/validated
against the hand-drawn corpus above** — the codified era rules say what to segment
(WOTC: subject silhouette inside the art window), the sidecar `diff.agreement` gives
the score to beat, and `codified/<eraId>.md` carries the target numbers. Constraint:
must run sanely on the Pi 5 — prefer classical CV (luminance/chroma thresholds, flood
fill from layout priors) over models; decide at build time with measurements. Derived
masks use the same storage shape with `derivation_method: "layout" | "luminance" | …`;
hand masks always win.

Contract to preserve: the shader takes whatever mask it is given (layout rect uniforms
or `uMaskTex`). Storage-shape or contract changes must update
`.claude/skills/foil-effects/SKILL.md` in the same commit.
