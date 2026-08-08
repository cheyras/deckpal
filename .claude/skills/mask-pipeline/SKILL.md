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
data/foil-masks/<cardId>/<variantId>.parent.png       # the mask BEFORE this save (correction OR supersede)
data/foil-masks/<cardId>/<variantId>.parent.diff.png  # what this save changed
data/foil-masks/<cardId>/<variantId>.json             # sidecar v3
data/foil-masks/<cardId>/superseded/<variantId>.<runId>/  # verbatim undo archive + archive.json
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
- **`supersedes`** — the MIRROR of `correction`, and never to be read as one: a **generator
  replaced a mask that was already there** (`run --refine`), and no human has agreed. Same
  metrics/grid shape plus `runId`, `archiveDir`, and `archive { basename → sha256 }`. The
  replaced mask's pixels go to `.parent.png` for review AND every artifact it had is copied
  **verbatim** into `superseded/<variantId>.<runId>/` beside an `archive.json` manifest — so
  `revert --run-id` restores the original **byte-for-byte**, sha256-verified, and the whole
  archive is verified *before* a single live file is deleted. `writeMaskRecord` **throws** if
  a machine write lands on an existing mask without `supersede: { runId }`; silence used to
  mean overwrite, which is how human work disappears. The archive is self-describing on disk,
  so an undo still works after Chey has corrected the proposal (`archives` lists what is
  undoable). Reading `supersedes` as `correction` would feed a generator's own reshaping back
  as if a human had endorsed it — exactly what `EXEMPLAR_WEIGHT` exists to prevent.
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
# 1. ALWAYS evaluate before generating — leave-one-out against the human corpus.
#    It prints a per-card IoU + boundary-distance table and a PASS/FAIL against the bar.
pnpm --filter pokedex-api exec tsx src/foil/generate-masks.ts eval \
  --generator region-learn --era modern-sv --scope sheet --serie me \
  [--bar-mean 0.90 --bar-min 0.85] [--dump <dir>]
# 2. only if that PASSES: a small, labeled, reversible batch (cap 10)
… run --generator region-learn --era modern-sv --scope sheet --serie me \
      --series-slug mega-evolution --run-id <id> --cards <cardId:variantId,…> \
      [--dry-run --dump <dir>]
# 2b. REFINERS (`requiresSource`, e.g. edge-trace / line-snap) rework the mask already there
…  run --generator edge-trace --refine --era modern-sv --scope sheet \
      --serie me --series-slug mega-evolution --run-id <id> --cards <cardId:variantId>
# 3. undo an entire run — RESTORES what it superseded (byte-for-byte),
#    deletes only masks the run created from nothing (and the empty card dir with them)
… revert --run-id <id>
… archives [--run-id <id>]     # what is currently undoable, and from when
# 4. MEASURE the result instead of asserting it — edge adherence, any set of masks
… adherence --serie me --card me05-001 [--probe luminance|tensor] \
      --masks "his=data/foil-masks/me05-001/37184.png,new=/abs/path.png"
```

> **STATE THE BAR BEFORE YOU SEE THE NUMBERS.** `eval` takes `--bar-mean` / `--bar-min`
> and prints a verdict, so the threshold is an input, not a story told afterwards. The
> shipped default — mean IoU ≥ 0.90 with no held-out card below 0.85 — is the one
> `foil/mask-learn` used, written down before `region-learn@1` produced a single number.
> **Boundary distance and edge adherence never promote a class.** They measure precision;
> a mask can sit perfectly on an edge that is 40px from where anyone meant (DECISIONS
> 2026-08-08, `edgetrace-me05-batch-1`).

> **Which refiner: `edge-trace@1` is the default. `line-snap@1` is the fallback.**
> line-snap stays because it is cited in the corpus lineage and its refusal rules are still
> the right instincts — but its premise (his strokes ARE the geometry; nudge the straight
> bits) is narrower, it cannot represent a curve at all, and it loses measurably on edge
> adherence. Reach for it only if a card's foil boundary is genuinely all-straight.

**Refiners** (`MaskGenerator.requiresSource`) get `input.source` = the mask at the target
path (alpha + RGBA + method + sha256). `--refine` **refuses a source whose exemplar weight
is 0** — the anti-collapse rule applied to the source rather than the corpus, because a
refiner that could eat its own output would drift a boundary a pixel per pass forever. The
recorded `exemplars[]` for a refine run is the source itself: it learned from that mask and
nothing else, and must not imply otherwise.

### `line-snap@1` — reading a hand mask's INTENT (`apps/api/src/foil/line-snap.ts`)

Chey, 2026-08-08: *"it's impossible to get the lines really straight so I'm hoping you can
get computer vision on the mask and card art in tandem to really see my intent there."*
Premise: a hand-drawn foil boundary is an **attempt to trace a printed edge** (frame, art
box, species strip, stage tag), and those are dead straight in the scan. Pipeline: contour
the mask (crack-following, holes wind oppositely) → cut each loop into near-axis **runs**
(PCA orientation over a window, short wobble gaps bridged) → robust TLS fit per run → local
Hough over (angle, offset) on the scan's directional gradient, with a Gaussian **proximity
prior** → replace → intersect adjacent lines into real corners → rasterize (analytic-x,
supersampled-y) matching his AA character.

The refusals are the point, and each is a param: weak evidence (`edgeSnrMin`,
`edgeCoverageMin`, `edgeMinStrength`) ⇒ no move; an **ambiguous band** of comparable ridges
(`ambiguityRatio`) may nudge but never relocate (`ambiguousMaxMovePx`); no artwork edge ⇒
straighten only to HIS own fit, and only if his stroke was aiming straight
(`selfStraightenResidPx`); short or curved runs (`minSegmentPx`, `axisToleranceDeg`) pass
through untouched; corners close only when the two lines actually meet nearby
(`cornerJoinPx`). Every run's decision + numbers land in the sidecar params (`report`) and
in the notes. Locked by `__tests__/line-snap.test.ts` — including that a deliberate curve
survives and an ambiguous band is refused.

`run` refuses to overwrite any non-`ai` mask (human work is never clobbered) and refuses
to run below the generator's `minExemplars`. Card art is decoded from the image cache
with ImageMagick (`magick`) — a **CLI-only** dependency; the server never shells out.

### `edge-trace@1` — the artwork holds the geometry (`apps/api/src/foil/edge-trace.ts`)

Chey, 2026-08-08, after reviewing the line-snap result: *"Really just 'straighten' isn't
quite enough, really just detecting edges and actually tracing accurately around them is
the real move."* **The premise moves**: his mask is a STATEMENT OF INTENT (which regions
carry foil); the ARTWORK holds the true geometry. The output boundary is therefore derived
from the card's own edges, with his mask deciding only WHICH edge to follow.

Pipeline: **Di Zenzo colour structure tensor** (a green-field/silver-border boundary is a
big chroma step and a small luminance one — a luminance Sobel under-reads it) → Scharr
gradients → non-maximum suppression → hysteresis linking → a **corridor** (distance+index
field around his boundary; nothing beyond `corridorPx` is even reachable) → **anchors** at
`anchorSpacingPx` PLUS every hard turn in his own line (`cornerAnchorDeg`), each snapped
to the strongest ridge within `anchorSnapPx` → **livewire**: Dijkstra between consecutive
anchors on `wRidge`·(1−ridge) + `wLinked`·(unlinked) + `wProximity`·(dist/corridor)^`proximityPower`
+ `wDirection`·(across-the-edge) → **sub-pixel refinement** onto the parabolic peak of
|∂I/∂n| along the path normal → **only then** a straight fit where the traced path really
is straight (`minStraightPx`, `straightResidPx`, `straightMaxDevPx`) → rasterize with
line-snap's analytic-x / supersampled-y / nonzero-winding rasterizer.

It **refuses**, each refusal a param and a report line: no scan ⇒ returns his mask
untouched; an anchor with no ridge ≥ `anchorMinStrength` ⇒ that stretch stays exactly as
drawn; a traced path under `segmentMinRidge` or detouring past `segmentMaxDetourRatio` ⇒
kept; no path inside the corridor ⇒ kept; and **every move is capped by `corridorPx`.**

Two traps it exists to avoid, both locked by `__tests__/edge-trace.test.ts`:
- **The MAD-trim trap.** A robust fit discards a small feature as an outlier, reports
  "straight to 0.2px RMS", and crisping then flattens the feature it ignored. That is how
  line-snap squared off the Tropius species-strip tail. `straightMaxDevPx` requires EVERY
  point in a run to be close, outliers included.
- **The half-pixel frame.** Mask space (`traceLoops`/`rasterizePolygons`) puts pixel
  centres at `x+0.5`; a gradient array indexes centres at integer `x`. All artwork lookups
  convert in one place (`edgeAlong`, `luminanceProbe`, `tensorProbe`). Get it wrong and the
  boundary sits half a pixel off the edge it claims to be on, invisibly.

### `region-learn@1` — the REGIONS are learned, the geometry is traced (`apps/api/src/foil/region-learn.ts`)

The other half of the loop, and the first **proposer** rather than refiner. It exists
because the previous lane measured the thing everyone assumed: seeding `edge-trace` from
the era rectangle failed on all five me05 reverses, and **99.7% of the gap between the
layout rule and Chey's intent is REGION decisions, not boundary crispness** (DECISIONS
2026-08-08, run `edgetrace-me05-batch-1`). A tracer crisps a boundary; it can never add or
remove a region. So:

1. **PARTITION** the card face into five structural classes, from the card's **own
   printing** (the era rect only bootstraps the search):

   | class | what it is |
   |---|---|
   | `border` | achromatic ring connected to the outside of the card — the silver frame edge |
   | `furniture` | achromatic printed elements INSIDE the frame: species strip, stage tag, evolution medallion, "evolves from" bar, copyright footer, the WOTC stage box |
   | `frameBody` | the coloured frame body — the card's chromatic field outside the illustration |
   | `windowBackground` | inside the illustration box, the field colour-connected to the box's own inner edge (on a WOTC holo: the starlight) |
   | `windowSubject` | inside the illustration box, everything else (the Pokémon) |

2. **READ THE POLICY** off his masks: per class, what share of its pixels did he make
   foil? >50% ⇒ that class carries foil. Where his exemplars agree, the agreement IS the
   policy; where they split it lands in `RegionPolicy.disagreements` with both numbers and
   is **never averaged into a decision** (`PolicyVote.disputed`, threshold `disagreeSpread`).
3. **APPLY** to a new card: partition it the same way, union the classes the policy voted
   for, clean up, then hand the boundary to `edge-trace` for the sub-pixel geometry.

Nothing about Pokémon is hard-coded. The proof is that the vote comes out **opposite** for
the two classes in the corpus, from the same code — locked by `__tests__/region-learn.test.ts`.

#### HOW CHEY MASKS — the policy, in plain words (this is the reusable part)

> **`modern-sv` / `sheet` (reverse holo)** — *foil = the coloured frame body, and nothing
> else.* Foil covers the printed colour field: name bar, HP, type icon, attack area,
> weakness/resistance/retreat row, flavour text, illustrator and set-number line. It stops
> at **every piece of silver furniture** and at the illustration.
> **The silver border ring is NOT foil** — 0.2% / 0.2% / 0.4% of its pixels across his
> three masks; he stops at the inner edge of the coloured frame all the way round,
> including the rounded corners, and the copyright line below the frame stays bare. (This
> was flagged as "his call, not a measurement". It is now a measurement.) Also excluded:
> the species strip *including its flared tails*, the BASIC/STAGE tag, the evolution
> medallion *and the little sprite inside it*, and the "Evolves from X" bar.
> Physically: **the reverse foil is under the coloured ink, not under the silver** — which
> is why CHROMA is the signal here and luminance is not.
>
> **`wotc` / `window` (classic holo)** — *foil = the illustration's own background, minus
> the subject silhouette, minus the stage/evolution box where it overlaps the window.* The
> card stock and yellow border carry none. Confirmed 4/4 (`base1-5/6/7/8`); the stage-box
> clause is visible on both evolved cards and inapplicable on both Basics.

Both eras' full numbers, evidence and caveats: `data/foil-masks/codified/<eraId>.md`.

#### The bevel side — a finding worth carrying to every era

An illustration box is framed by a bevel, so its edge is **two parallel printed lines** a
few px apart, both real, both strong. Which one the foil boundary sits on is not a
detection question — it is **which side the foil is on**: `window` scope (foil inside)
stops at the bevel's INNER line, `sheet` scope (foil outside) at its OUTER line. Taking
"the strongest peak" picks between them at random card by card; that is what put
`base1-6`'s detected window top 8px wrong and collapsed its segmentation to nothing.
`detectWindow(..., foilInsideWindow)` takes the side explicitly.

#### Where it stands, measured

`modern-sv/sheet` **PASSES** the bar at leave-one-out mean IoU **0.9691** (worst 0.9519,
rect-only 0.7566) — batch `regionlearn-me05-1` shipped, 8 cards, `ai`/unreviewed.
`wotc/window` **FAILS** at **0.8971** (worst `base1-8` Machamp 0.8599) — no batch. Every
frame-level decision on WOTC is right; the whole error is the **subject silhouette**, and
it is worst where the subject's colour is close to its own background. That is the one
region this approach cannot yet segment, and it is where the next hand mask should go.

**Two caveats a future lane must not lose.** (a) The scalar params (chroma threshold,
morph radius, background sigma) were chosen while looking at the corpus; only the region
POLICY is properly held out, so a reported LOO number is a ceiling, not a floor. (b) A
coloured island marooned inside silver furniture is dropped as not-frame — right for a
medallion sprite, an untested extrapolation for a narrow sliver trapped between a
medallion and the border ring.

### Measuring a mask instead of asserting it — edge adherence

`measureAdherence(alpha, w, h, probe)`: marching-squares the alpha at the half level
(sub-pixel, so an antialiased edge is not scored as if it lay on the lattice), sample every
0.5px, and along each sample's own normal find the **NEAREST** local maximum ≥ `strengthFloor`
within ±`searchPx` (nearest, not strongest — a card border has two edges; plateaux are
centred). Reports `supportedFrac`, `within1px`, `within1pxOfSupported`, mean/p95/max
distance. **Run it with a probe the generator did NOT optimise** — the shipped default is
line-snap's own luminance Sobel, which gives the incumbent the home field.

### The training-tuple manifest

`corpus.ts tuples --out <file>` (or `GET /foil-lab/masks/corpus?tuples=1`) emits every
mask as a self-describing tuple: resolved file paths (mask / rule prior / rule diff /
**parent** / **parent diff**), `artworkUrl`, `ruleRect`, `exemplarWeight`, the generator
identity, the full `correction` record, and `lineage` — plus a `contract[]` array that
spells out how to read it. A future generator lane consumes that file; it should never
have to reverse-engineer the directory.

### `vector-template@1` — the LAYOUT is the artifact (`apps/api/src/foil/vector-template.ts`)

Chey, 2026-08-08: *"I want to make sure that what the system is really learning is not 'give
these a hand drawn quality' but what I draw is intent. Generated masks should feel like
they're derived from clean vectors, with straight lines and crisp curves/rounded corners
following the artwork."* And, on scale: *"We don't need 3,454 vector masks. All of these
share the same 2 layouts really."*

**THE MEASUREMENT THAT MOVED THE PREMISE.** At 0.35px tolerance on sub-pixel contours,
primitives per 1000px of boundary: `region-learn@1` **33.7**, **Chey's hand 21.3**,
`vector-template@1` **10.3**. *His masks are already more vector-like than the generator
that was learning from them* — where the print is straight he draws it straight, and the
livewire tracer wobbled ±2px. Smoothing was never the fix; emitting a traced path at all
was the mistake. **A hand mask encodes WHICH REGIONS carry foil. It does not encode how a
boundary should look.**

So: fit **lines + circular arcs + exact corners** to the CONSENSUS of his masks (a weighted
per-pixel majority = the median boundary, so one card's 2px registration error cannot become
the template's edge), store that as normalised geometry, rasterise on demand.

- **The artifact** is `apps/web/src/foil/vector-templates.json` — 13.3 KB, 58 primitives,
  beside `era-layouts.json`. Committed, diffable, hand-correctable. It carries full
  provenance (generator name/version/runId, the exemplars it was fitted from, params,
  a plain-language `statement`). **Reverting is `git revert`** — it is one small file.
- **Per-card masks are now EXCEPTIONS**, not the norm: a human mask, or a card that
  genuinely deviates. `generate-masks.ts revert --run-id` still covers those.
- **ONE layout + ONE optional element**, discovered not asserted. `discoverOptionalElement`
  opens the contested set to destroy the ±1-2px boundary band, takes the largest survivor,
  and splits the corpus on foil-share inside it. On modern-sv/sheet that finds the evolution
  medallion with an 80.5pp gap. Era-agnostic: on another class it finds that class's
  optional element, or nothing, which is also an answer.
- **Storage.** The rasterisation depends only on `(era, scope, hasOptionalElement, w, h)` —
  NOT on the card. Every Basic reverse gets byte-identical pixels. The cache is **2 PNGs**
  under `IMAGE_CACHE_ROOT/foil-templates/`, mirroring the image-cache contract (disk-only,
  outside git, safe to delete). Per-card masks would have been ~100–350 MB.
- **The API fallback** (`GET /foil-lab/masks/:cardId/:variantId?era=&scope=&evolves=1`)
  answers with the template ONLY when no hand mask resolves — human work is never shadowed
  — and labels it `X-Foil-Mask-Review-Status: unreviewed` with the generator identity.
  `evolves` is an INPUT because these routes have no DB and the server never shells out.

```bash
pnpm --filter pokedex-api exec tsx src/foil/fit-template.ts fit --era modern-sv --scope sheet --run-id <id>
…  vectorness  --era modern-sv --scope sheet    # his masks vs region-learn@1 vs the template
…  corrections --era modern-sv --scope sheet    # did it learn his CORRECTION or the machine parent?
…  sample --era modern-sv --scope sheet --per-set 16 --pop <tsv>   # population check, generating nothing
pnpm --filter pokedex-api exec tsx src/foil/generate-masks.ts eval --generator vector-template \
  --era modern-sv --scope sheet --serie me --bar-mean 0.94 --bar-min 0.90
```

> **VECTOR-NESS NEVER PROMOTES A CLASS.** Same rule as boundary distance and edge adherence:
> it describes, IoU gates. A flawless vector boundary in the wrong place is still wrong.

> **MEASURE ON SUB-PIXEL CONTOURS, NEVER ON `traceLoops`.** Crack following returns a
> rectilinear staircase, so every run is exactly axis-aligned and every residual is exactly
> zero — the measure reports the tracer and rates a hand-drawn blob as perfect geometry.
> `vectorness()` uses `subpixelLoops()` (marching squares at the alpha half-level). Locked.

> **A join is the INTERSECTION of the two primitives that meet there.** Taking each run's
> endpoint off the raw contour emits a polyline wearing a vector's clothes — the fitted
> "vertical" edge of a rounded rect ran x=25.00→25.66 and the straightness the lane claims
> was measured but never emitted. Line/line, line/arc and arc/arc are all solved, capped by
> `joinMaxMovePx`. And with y DOWN a positive cross product is a CLOCKWISE turn, so
> `sweep = cross > 0 ? 1 : 0`; inverting it makes every arc bulge the wrong way (round-trip
> IoU 0.9482 vs 0.9994). Both locked by `__tests__/vector-template.test.ts`.

#### The modern-sv/sheet policy, as his corrections left it

Supersedes the pass-1 wording above where they differ; numbers in `codified/modern-sv.md` pass 2.

> **The sliver IS foil.** The coloured wedge pinched between the evolution medallion, the
> stage tag and the border ring — pass 1's open question, which it explicitly recorded as
> "Chey has never ruled on that sliver". He has: `region-learn@1` scored 0.0% there on all
> four Stage-1 cards and he added it back on all four (~35-40% of the probe box).
> **"Largest coloured component" was the wrong rule**; the right one is *every coloured
> region outside the illustration that reaches the border ring*. The medallion's own sprite
> stays excluded because it is fully enclosed by the disc — topology, not size.
>
> **Achromatic ink printed ON the coloured field carries foil.** Colourless energy symbols
> (attack cost AND retreat), the regulation-mark box, the illustrator/set-number line, the
> name text. `region-learn@1` carved a hole around every one because its only test was
> chroma; he filled every one. Furniture is distinguished **topologically** — it touches the
> border ring or the illustration window (species strip with its flared tails, stage tag,
> medallion, "evolves from" bar, copyright footer). Same law as before: the foil is under
> the coloured ink, and it is under the symbol printed on that ink too.
>
> **The window edge sits on the bevel's OUTER line** (`sheet` = foil outside). He removed a
> 3-5px hairline at both x≈36 and x≈452 on 7 of 8 cards.

#### Scope limits — say these out loud, do not paper over them

- **Trainer (431 variants) and Energy (104) are a DIFFERENT layout with ZERO exemplars.** No
  illustration window, no species strip. The template is visibly wrong on them and the
  optional-element probe agrees with the catalog on **0/49** of them against **293/328** on
  Pokémon. Out of scope until he draws one of each.
- **Pale frames cannot self-verify.** Adherence flags 45.5% of Lightning and 41.0% of
  Colorless against **0.0%** of Fire/Psychic/Darkness — a low-contrast frame/border step, not
  a geometry error. Calibrate before believing an adherence number: on the 11 cards where the
  boundary is known correct the same probe reads **0.720 for his own hand masks** and 0.758
  for the template.

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
