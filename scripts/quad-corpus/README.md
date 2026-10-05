# Quad corpus: harvest, split, evaluate

The baseline every corner-model training run has to beat. A fine-tune counts only
if it beats **zero-training LC050, as the engine ships it**, on the **same frozen
held-out split**, under the **same gates**.

| file | what it does |
|---|---|
| `harvest.mjs` | Downloads the labeler corpus as the QA account and audits it into `manifest.jsonl` + `raw/<id>.png`. |
| `split.ts` | Builds a deterministic, frozen train/val/test split (`split.json`), pinned to the manifest's sha256. |
| `eval.ts` | Runs a model over a split through the shipping engine path and writes `eval-<model>-<split>.json` + `.md`. |
| `metrics.ts` | The research's metric definitions, implemented in code (pure functions). |
| `corpus.ts` | Manifest and split reading, plus the composition summary. |

## Running it

Prerequisites: `pnpm --config.verify-deps-before-run=false install` in the
checkout (it provides sharp + tsx), and the phase-0a python venv with
onnxruntime at `offline-harness.ts` `PY`.

```bash
# 1. the owner harvests (needs .qa-account); output defaults to ~/deckpal-data/quad-corpus
node scripts/quad-corpus/harvest.mjs

# 2. freeze a split (once). --dry-run prints the composition and writes nothing
node --import tsx scripts/quad-corpus/split.ts

# 3. the baseline: LC050 on the test split
node --import tsx scripts/quad-corpus/eval.ts                     # --split test is the default

# 4. a candidate: the same split, a different model
node --import tsx scripts/quad-corpus/eval.ts --model path/to/finetune.onnx

# session 2 of phase 0b (the 19 hand-labelled frames), with no corpus needed
node --import tsx scripts/quad-corpus/eval.ts --session2               # shipping v3 path
node --import tsx scripts/quad-corpus/eval.ts --session2 --pipeline v2 # harness cross-check
```

`eval.ts` options: `--corpus <dir>` (default `QUAD_CORPUS_DIR`, else
`~/deckpal-data/quad-corpus`), `--split test|val|train|all`, `--model <onnx>`
(default `apps/web/public/scan-assets/lc050.onnx`), `--acquire <p>`,
`--out <dir>`, `--limit <n>`. Output goes next to the corpus. For session 2 it
goes to `<SESSION2>/quad-eval/`.

**A comparison is valid only between two eval JSONs whose `meta.split.sha256` (a
hash of the id-to-split assignments) and `meta.manifestSha256` match.** `eval.ts`
refuses to score at all if the manifest has changed since `split.json` was made.

**What a model must look like to be scored:** input `img` 1x3x256x256, BGR, /255,
no mean/std. Outputs named `points` (8 normalized floats) and `has_obj`, exactly as
LC050's are, because `ort_sidecar.py` reads those names. A model that needs
different preprocessing, such as a letterbox, is not on the shipping path, and
scoring it here would not measure what would ship.

## What "the shipping engine path" is

This is `engine/index.ts` `tick()` reduced to a single frame, the same reduction
`labeler/detectSeed.ts` makes. Every stage is the shipping module, imported
unmodified:

1. Canonical square. The labeler's 416 PNG already is one. For session 2,
   `frame.squareCrop` takes the centre square of the 480x640 frame.
2. A plain resize to `MODEL_SIZE` (index.ts `drawModelInput`), then
   `preprocess.rgbaToBGRPlanar`.
3. The model, run through `ort_sidecar.py`.
4. `gate.createPresenceGate()`, cold. It opens at `hasObj >= DEFAULT_ACQUIRE`
   (0.80), which is exactly what the shipping gate does on its first frame.
5. `frame.modelPointsToCanonicalQuad`, then
   `refine.refineQuadChecked(gradientField(canonical 416))`, falling back to the
   raw quad when the refiner refuses.

Three things are left out, for detectSeed.ts's reasons: the rAF cadence, the
gate's hysteresis (a still frame has no previous tick), and the tracker and lock
policy. These measure **raw single-frame** on-card, not the Phase 2
"displayed-on-card" over sequences.

Two things are substituted, both of them `offline-harness.ts`'s own documented
substitutions:

- sharp lanczos3 stands in for the browser's smoothed `drawImage`.
- Python onnxruntime stands in for ORT-web.

Wherever the label recorded the browser's own `pipeline.hasObj` (rows from
2026-09-07 on), the summary prints a **presence-parity** table that measures
the size of that substitution.

`--pipeline v2` (session 2 only) runs the old letterboxed full-frame path that
`integration-frames.test.ts` scores. It exists to check this evaluator against
that test's published numbers, and it reproduces them: mean 18.0 px, linear
scale 0.986 (vs 0.985), and 11 of 19 frames within 12 px.

## Metric definitions, and where each comes from

All errors are in **canonical px** (the 416 square). A quad has no canonical
start corner, so errors are computed under the best of the 8
orderings/reversals (`offline-harness.cornerDeltas`, which is the same as
`field-check.mjs`).

| metric | definition | source |
|---|---|---|
| **on-card** | best-of-8 **mean** corner error <= **16.18 px** | `field-check.mjs` (used by R5 §3, phase 0a §3, phase 0b §2.3), with the threshold scaled; see below |
| all four corners within | best-of-8 **max** corner error <= 16.18 px | asked for in the task. Stricter than on-card, and not a research metric |
| **interior lock** (gate) | not on-card, AND >= 90% of the quad inside the label, AND area <= 90% of the label's (art-interior <= 55% + partial-inset <= 90%) | R5 §5, `flags-raw-r2/_analyse.py` `classify` |
| interior lock (phase 0) | not on-card, AND area < 70% of the label, AND >= 85% of the quad's area inside it | `phase0a/run_docaligner.py` `classify`, also used by phase 0b §2.2 |
| R5 classes | perimeter / art-interior / partial-inset / partial-overhang (>= 55% inside) / off-object / miss | R5 §5 |
| **miss** | card present, no quad emitted (cold gate shut, or no four finite corners) | R5 §3.2, PHASE0-CLOSEOUT §2.2 |
| **false quad** | a quad emitted on a negative | notes-fused.md, PHASE0-CLOSEOUT §2.2 |
| IoU | `geometry.polyIoU`, the shipping Sutherland-Hodgman routine | - |
| presence | raw `has_obj`. Emitted = `has_obj >= acquire` AND a decodable quad | `gate.ts` |
| on-card ungated | on-card scored on the corner head's quad whatever `has_obj` said | diagnostic. It separates corner-head failures from presence-head failures |

### Where a definition was ambiguous, and what this code does

1. **The 14 px resolution.** R5 §4.1 says the 14 px is a *display* tolerance
   on its 360x480 frames. It warns that applying a fixed 14 px in some other
   resolution's native pixels changes the test. The canonical square's side is
   the stream's short side, so this code scales by 416/360: **14 px becomes
   16.18 canonical px.** Phase 0b applied 14 px natively at 480x640, which is
   12.13 canonical px, and the integration test uses 12 px at 480x640. Both are
   reported as secondaries, alongside R5's 20 px cut (23.11).
2. **"Within 14 px".** The research's on-card is the *mean* of the four corner
   errors, not all four. The gate uses the mean, and the all-four version is
   reported beside it.
3. **Two interior-lock definitions exist.** The Phase 1 gate's own comparison
   number (fused 32.1%, RECOMMENDATION §3) is R5's taxonomy, so R5 is the gate.
   Phase 0's narrower definition is reported beside it. R5's *partial-inset*
   also catches "three sides right, one on the inner rim", which includes some
   sleeve-rim cases phase 0b called on-perimeter (session 2's F061). That
   happens on any frame whose quad is more than 16.18 px off and 10–45% too
   small.
4. **Containment.** For R5 this code reproduces `_analyse.py`'s 24x24 sample
   grid exactly. For phase 0 it uses the exact polygon intersection, as
   `run_docaligner.py` (shapely) did, and falls back to a 48x48 grid on a
   non-convex label.
5. **Denominators.** On-card and interior lock are rates over **labelled
   positives, misses included** (R5's 9/28 counted every card frame). Miss is
   over **all positives**.
6. **Which negatives the false-quad gate counts.** The gate is stated on
   *distractor-only* frames, so it counts only `no_card`, `not_a_card` and v1's
   mixed `no_card`. The other negative reasons are frames where a card is
   present and a human declined to quad it. Training should still teach
   "emit nothing" for those (HARVEST.md §6), so they are reported per reason
   and in an all-negatives rate, but they are not gated.
7. **Tight framing** means label fill >= 75% of the canonical square, the
   HARVEST.md §5 failure. It gets its own block in every summary.

## The gates

From RECOMMENDATION §3 Phase 1 and DECISIONS 2026-09-02. They are evaluated on
the overall test split and printed with Wilson 95% intervals, because on a
small n a bare rate misleads.

| gate | target |
|---|---|
| on-card @ 14 px (16.18 canonical) | >= 80% |
| interior-lock rate (R5) | <= 5% |
| miss rate | <= 15% |
| false-quad rate, distractor-only | <= 20% |

The device latency gate (median <= 30 ms) is out of scope for an offline
evaluator.

## The split

- **The unit is a session, never a frame.** Rows are grouped with union-find
  over two relations: consecutive labels with no gap longer than `--gap-min`
  (not cut at the UTC day boundary, because evening sessions in UTC-6 cross
  it), and harvest's `dupGroup` (dHash within 4 bits). A unit never straddles
  splits.
- **Gap selection.** If `--gap-min` is omitted, the script uses the coarsest of
  30/10/5/2/1 min that covers every stratum, so it gets as much leakage
  protection as the corpus can afford. The choice is recorded in
  `split.json` `params`.
- **Stratified.** Strata are processed rarest first. For each one, test takes
  whole units until it holds its share. The strata are: tight framings
  (fill >= 75%), card backs, every negative reason, every source, and every
  fill bucket. A unit is taken only if train keeps a unit of *every* stratum it
  carries. Test may grow past its target to buy coverage: normally to at most
  2x, but **past 2x when it holds no row yet of the stratum being filled**,
  because coverage wins over size. Val does the same where three units exist.
  Leftover units fill toward 70/10/20 in a fixed pseudo-random order:
  sha256(seed + unit key).
- **Lumpy on small corpora.** A labelling session is one long run of frames,
  so units are big. The 2026-10-04 corpus (163 rows) has 9 units, the largest
  47 rows, and splits 54/47/62 against a 114/16/33 target; a finer `--gap-min`
  does not help. Re-freeze with `--force` once the labeler queue is labelled,
  before any candidate model depends on the split.
- `train.py` (`tools/quad-train`) reads this same `split.json`, drops the
  `excluded` rows, and refuses to train on a corpus that has none.
- **Frozen.** `split.json` stores the manifest's sha256, and both scripts
  refuse a changed manifest.
  - `--extend` keeps every existing assignment. New rows inherit the split of
    any unit they join, and brand-new units are dealt by the same rules. A new
    row that bridges two splits is `excluded`.
  - `--force` re-deals from scratch, which invalidates every model trained on
    the old train split.
- **Composition is printed.** split.ts prints the composition of every split
  and records it in `split.json`, and every eval summary of a split repeats it.

## Baseline: phase 0b session 2 (2026-10-04)

These are 87 owner-flagged frames: 19 hand-labelled, 42 unlabelled card frames
(used only for the miss rate), and 26 no-card frames (BLIND-VERIFICATION's
`card? = no`). The flags were chosen because something looked wrong, and the
labels include every failure case, so **these rates are biased toward
failure**. The set has no tight framings: the largest label is 49% of the
square.

| LC050 | on-card | interior lock (R5 / phase 0) | miss | false quad (distractor) |
|---|---|---|---|---|
| **v3 shipping path** | 9/19 = 47.4% | 4/19 = 21.1% / 2/19 = 10.5% | 11/61 = 18.0% | 8/26 = 30.8% |
| v2 letterboxed full frame | 11/19 = 57.9% | 4/19 = 21.1% / 1/19 = 5.3% | 3/61 = 4.9% | 9/26 = 34.6% |

Under v3, 7 of the 19 labelled cards have a corner outside the centre square.
That clipping comes from replaying a 3:4 capture through the square crop. A v3
corpus is framed inside the square, so this is not a fault in the engine. Full
summaries: `<SESSION2>/quad-eval/eval-lc050-session2{,-v2}.md`.
