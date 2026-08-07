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

### Storage — sidecar v3 (committed, reviewable artifacts on the branch)

NOT the image cache (that path is a contract for card art only). `data/*` is gitignored
EXCEPT `data/foil-masks/` — re-included explicitly in `.gitignore`; don't "fix" that.

```
data/foil-masks/<cardId>/<variantId>.png              # ALPHA = foil coverage (RGB = display tint)
data/foil-masks/<cardId>/<variantId>.prior.png        # the era-RULE output, rendered
data/foil-masks/<cardId>/<variantId>.diff.png         # mask vs rule: GREEN added, RED removed
data/foil-masks/<cardId>/<variantId>.parent.png       # (corrections only) the mask BEFORE the human
data/foil-masks/<cardId>/<variantId>.parent.diff.png  # (corrections only) what the human changed
data/foil-masks/<cardId>/<variantId>.json             # sidecar v3
```

#### The provenance taxonomy (`derivation_method`)

Five values. The four cases that must never blur into each other — pure machine
geometry, pure human, human-corrected-machine, machine-unreviewed — each have their own:

| method | who painted | `authorship` | `reviewStatus` | exemplar weight |
|---|---|---|---|---|
| `layout-flatten` | machine (a window/era rect baked, no strokes) | machine | human-adjusted | **0** |
| `hand` | human, from scratch or from a layout/window prior | human | human-authored | 1 |
| `hand-refined` | human, on top of an existing NON-AI mask | human | human-authored | 1 |
| `ai` | a generator; **no human has looked at it** | machine | unreviewed | **0** |
| `ai-corrected` | a generator proposed, a human then edited | mixed | human-authored | 0.6 |

**The label is never taken from the client.** `writeMaskRecord` (`apps/api/src/foil/
provenance.ts`) diffs the saved pixels against the pixels the claimed starting point
actually rasterizes to, and derives the method from that. A caller can only get the `ai`
label by supplying a full `GeneratorIdentity`, which HTTP callers cannot do (only
`generate-masks.ts` can). The PUT route requires `derivation { startedFrom, parent? }`
and 400s without it — a client that forgets would otherwise silently stamp a corrected
AI mask as `hand`.

One subtlety worth knowing before you touch it: the editor bakes windows with canvas
`roundRect`, the server rasterizes from an SDF. Both are correct and they disagree in
the 1-px antialiasing seam (measured: 389 of 330,260 px on the WOTC window, **all** of
them in the seam). So for geometry seeds a pixel only counts as "painted" where the
seed's 3×3 neighbourhood is uniform. Without that, every unpainted Flatten would stamp
`hand` — the exact lie v3 exists to stop. Locked by
`apps/api/src/foil/__tests__/provenance.test.ts` (CI: `pnpm --filter pokedex-api test:foil`).

#### Sidecar v3 fields

`version: 3`, ids, `artworkKey` (= cardId), dims, `channel: "alpha"`,
`derivation_method` + `authorship` + `reviewStatus` (the last two are **recomputed on
every read**, so a hand-edited file can't claim a status its method denies), `savedAt`,
`artworkUrl` (the scan the mask was drawn on — what a generator must consume),
`card { setId, seriesSlug, name, number }`, plus:

- **`prior`** — what the mask was derived FROM. `source: "layout" | "window" | "mask" |
  "ai"`. `rect`/`radius`/`invert` ALWAYS carry the deterministic era-rule numbers so
  `diff.agreement` never stops scoring the rule (v2 semantics, preserved). Optional
  `window { rect, radius }` = the hand-adjusted geometry in effect at save/flatten time.
  Optional **`generator`** = `{ name, version, modelId, runId, params, exemplars[],
  confidence, generatedAt }` — present on an `ai` mask AND **carried forward onto every
  human correction of it**, so any mask can answer "what made me, from what". Optional
  `parentMask { cardId, variantId, savedAt, method }`.
- **`diff`** — `{ addedPx, removedPx, unchangedPx, agreement }`, mask vs the **era rule**
  (Jaccard over foil pixels, alpha ≥ 128). Unchanged from v2; the codify ritual reads it.
- **`correction`** — present iff a human edited a prior mask. `{ parent { cardId,
  variantId, savedAt, method, sha256, generator }, parentPng, parentDiffPng, addedPx,
  removedPx, unchangedPx, agreement, changedPx, changedFraction, bbox (UV y-up),
  grid { size, cells[] } }`. **This is the product**, not a footnote: the parent's pixels
  are kept, the change map is rendered, and `grid` says where the corrections concentrate.
- **`lineage`** — oldest→newest `{ method, savedAt, source, generator }`, capped at 8.
  The parent's chain plus this save, so ancestry survives the parent being overwritten.

**v1/v2 compatibility is permanent.** `normalizeSidecar` migrates any generation in
memory on read; nothing needs rewriting. Pre-v3 sidecars carried a hardcoded
`derivation_method: "hand"` placeholder — true for every mask that predates v3 (all
Pencil-drawn), so it is carried forward as fact, not re-derived. One-shot on-disk
upgrade: `pnpm --filter pokedex-api exec tsx src/foil/corpus.ts migrate [--dry-run]`
(purely additive — never touches the PNG, the prior, or the recorded diff).

The PUT route (`apps/api/src/routes/foil-lab.ts`, mounted only under
`POKEDEX_FOIL_LAB=1`) renders the prior and computes every diff **server-side**
(`apps/api/src/foil/mask-artifacts.ts` + `provenance.ts`, pure-JS PNG codec in
`foil/png.ts` — no native addons), so artifacts can't drift from the recorded numbers. A
save without a parsable prior is a 400: a corpus entry that can't be diffed teaches
nothing. Legacy v1 sidecars can also be given a prior with
`tsx src/foil/backfill.ts --card <id> --variant <n> --era <eraId> --scope <scope>` —
the prior must be deterministic and known; never guess it.

### Reading the corpus

```bash
pnpm --filter pokedex-api exec tsx src/foil/corpus.ts report      # counts, agreement, review queue
pnpm --filter pokedex-api exec tsx src/foil/corpus.ts exemplars --era wotc --scope window
pnpm --filter pokedex-api exec tsx src/foil/corpus.ts tuples --out /tmp/tuples.json
pnpm --filter pokedex-api exec tsx src/foil/corpus.ts migrate --dry-run
```

Same data over HTTP: `GET /pokedex/api/foil-lab/masks/corpus` (`?tuples=1`,
`?exemplars=1&era=&scope=`), and the workbench's **Mask corpus** panel renders it
phone-first. Provenance artifacts stream from
`GET /foil-lab/masks/:cardId/:variantId/artifact/{prior|diff|parent|parent-diff}`.

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

## Tier 1.5 — adjusted window geometry (SHIPPED, foil/mask-refine)

The pre-flatten stage of Chey's "handles → flatten → refine" workflow: on the
Card-adjust surface, a layout-tier window/sheet card gets draggable corner/edge
handles (`foil/WindowEditor.tsx`) that reshape the era rect per card. Persisted as
`data/foil-windows/<cardId>/<variantId>.json` (v1: rect UV y-up + radius + invert +
scope/eraId + `base` = the era rule it adjusted, with resolverVersion; committed,
`.gitignore` re-include like overrides). While no hand mask exists, the layout tier
renders the adjusted rect instead of the era rect. **Artwork-keyed but
scope-agnostic**: the window box is a property of the scan (a sheet is the same box
inverted), so GET `/foil-lab/windows/:cardId/:variantId` aliases to any sibling
variant's geometry, newest savedAt first. Saving geometry that equals the era rule
deletes the file. **Flatten** rasterizes the adjusted rounded rect
(`rasterizeWindowRect`, shared with `loadLayoutRect` — pixel-identical bakes), saves
through the standard hand-mask PUT (prior = era rule, `prior.window` = the
adjustment), and opens the paint editor — from then on the card is an ordinary
hand-masked card. Corpus value: geometry corrections appear in the diff as rule
error, and `prior.window` says exactly which rect the human chose — direct input for
codifying missing era rects (SM era has none; baby shinies/det1 borrow modern-sv).

## Codify — the ritual that turns corpus into rules

Run this whenever an era has new/changed hand masks or resolved mask comments. The
system improves itself: human corrections in, better rules out.

1. **Gather** the era's corpus **through `selectExemplars({ eraId, scope })`** — never by
   globbing the directory. That is what keeps unreviewed `ai` masks out of the evidence;
   a codification that cites machine output is the model grading its own homework.
   `corpus.ts exemplars --era <id> --scope <scope>` prints exactly what is admissible and
   why each rejection was rejected. Then read those entries (mask + prior + diff +
   sidecar stats, and `correction` where a human fixed a proposal) plus every
   `issues/foil/*` comment about that era's masks (follow `maskFile` links). Read the
   diffs VISUALLY — the colors say what the rule got wrong (green = rule missed foil,
   red = rule over-covered); `correction.grid` says where the human's attention went.
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

## The learning loop — generators, corrections, and the collapse safeguard

Chey (2026-08-07): *"once i've made a few hand-done masks, i want an AI to be able to
learn from mine to be able to do its best at replicating it across other cards in
similar sets/series - and then i want to be able to correct the agents' mask such that
it can then observe the diff and continue to improve without me having to hand-paint all
the masks."*

```
 hand masks ──selectExemplars()──▶ generator ──▶ `ai` masks (unreviewed)
      ▲                                              │
      │                                       Chey corrects one
      │                                              │
      └──── correction records (parent PNG + change map + metrics) ◀──┘
              = the supervised (input, target) pairs for the next generation
```

### Anti-feedback-collapse (non-negotiable)

A generator that learns from its own unreviewed output converges on its own mistakes.
So **exemplar eligibility is a property of who painted the pixels**, encoded as
`EXEMPLAR_WEIGHT` in `provenance.ts` and enforced in `selectExemplars()`
(`apps/api/src/foil/mask-corpus.ts`) — the only sanctioned way to choose training masks:

- `ai` → weight **0**. Unreviewed machine output can never be an exemplar, at any corpus
  size, under any flag. `selectExemplars` returns it in `rejected` with that reason.
- `layout-flatten` → weight **0**. It only teaches the rect the generator already has.
- `hand` / `hand-refined` → weight 1 (ground truth).
- `ai-corrected` → weight 0.6. A human painted it, but anchored by what the AI proposed,
  so it must not outrank an unanchored human mask.

`ai` masks are visibly **unreviewed** in the workbench (amber badge, "correct it to turn
it into training signal") and listed in the corpus report's `awaitingReview` queue until
a human touches them. Any future codify/learning step routes through `selectExemplars` —
if you add a selection path, it goes through there too, or the safeguard is a lie.

### Generator contract (`apps/api/src/foil/generator.ts`)

A generator is `MaskGenerator`: `{ name, version, modelId, params, minExemplars,
generate(input) }`. It **never writes files** — `generate-masks.ts` persists through
`writeMaskRecord` with the identity, which is the only way a mask can be stamped `ai`.

**Consumes** (`MaskGeneratorInput`): `target { cardId, variantId, eraId, scope, rect,
radius, invert, window, artwork (decoded RGBA of the cache scan at mask resolution),
artworkUrl, width, height, setId, seriesSlug }` and `exemplars[] { ref (cardId/variantId/
savedAt/method/weight), alpha (the human mask, resampled to the target size), artwork,
rect, scope, eraId }`. Everything is supplied — a generator fetches nothing.

**Emits** (`MaskGeneratorOutput`): `{ alpha (width*height, alpha IS the mask), confidence
(0..1 or null if it honestly has none), notes (shown to the reviewer) }`.

```bash
# 1. ALWAYS evaluate before generating — leave-one-out against the human corpus
pnpm --filter pokedex-api exec tsx src/foil/generate-masks.ts eval \
  --generator window-artgate --era wotc --scope window --serie base
# 2. only if that justifies it: a small, labeled, reversible batch (cap 10)
… run --era wotc --scope window --serie base --series-slug base \
      --run-id <id> --cards <cardId:variantId,…> [--dry-run]
# 3. undo an entire run — deletes ONLY its still-unreviewed `ai` masks
… revert --run-id <id>
```

`run` refuses to overwrite any non-`ai` mask (human work is never clobbered) and refuses
to run below the generator's `minExemplars`. Card art is decoded from the image cache
with ImageMagick (`magick`) — a **CLI-only** dependency; the server never shells out.

### The training-tuple manifest

`corpus.ts tuples --out <file>` (or `GET /foil-lab/masks/corpus?tuples=1`) emits every
mask as a self-describing tuple: resolved file paths (mask / rule prior / rule diff /
**parent** / **parent diff**), `artworkUrl`, `ruleRect`, `exemplarWeight`, the generator
identity, the full `correction` record, and `lineage` — plus a `contract[]` array that
spells out how to read it. A future generator lane consumes that file; it should never
have to reverse-engineer the directory.

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
