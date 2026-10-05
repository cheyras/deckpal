# quad-train: fine-tuning LC050 on the owner's labels

This is the groundwork for fine-tuning DeckPal's card-corner detector, DocAligner LC050
(`apps/web/public/scan-assets/lc050.onnx`), on the labeller corpus. The goal is to fix
the failure in `apps/web/src/scan/labeler/HARVEST.md` section 5: when the card fills
most of the frame, the model outlines the inner text panel instead of the card's edge.

**Status (2026-10-04): the foundation is built and every step has a passing check.
No real training run has been done.** The only training so far is a 40-step smoke test
on the 45 phase-0b session-2 fixtures, which shows the loop runs on the GPU and the
loss goes down. It says nothing about how well the model generalises.

Run everything with `.venv/Scripts/python.exe run_checks.py`. It takes about 1 min 45 s and should end
with `ALL PASS`.

---

## Setup

```bash
cd tools/quad-train
py -3.11 -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # torch 2.11.0+cu128: has sm_120 kernels for the 5080
.venv/Scripts/python.exe check_env.py                         # confirms CUDA, sm_120 in the arch list, a real matmul+conv+backward
# The TypeScript parity scripts use the worktree's tsx and sharp:
(cd ../.. && pnpm --config.verify-deps-before-run=false install)
```

Inputs the tools read. Each one can be overridden through an environment variable in
`common.py`:

| what | default | env |
|---|---|---|
| the shipping checkpoint | `apps/web/public/scan-assets/lc050.onnx` | `LC050_ONNX` |
| session-2 fixtures (untracked) | `E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work/phase0b/session2` | `SESSION2_DIR` |
| the owner's corpus | `C:/Users/cheyr/deckpal-data/quad-corpus` (written by `scripts/quad-corpus/harvest.mjs`) | `QUAD_CORPUS_DIR` |
| scratch (gitignored) | `tools/quad-train/cache/`, `tools/quad-train/runs/` | `QUAD_TRAIN_CACHE`, `QUAD_TRAIN_RUNS` |

The TS parity scripts also use the offline harness's Python ORT sidecar. That means the
phase-0a venv and `deckpal-wt/scan-harness/.../lc050.onnx` have to exist, as
`apps/web/src/scan/engine/__tests__/offline-harness.ts` hard-codes them. The
scan-harness copy is byte-identical to the shipped file: same md5.

`.venv/`, `cache/`, `runs/`, `*.pt` and `*.onnx` are all gitignored (`.gitignore`).

---

## The I/O contract: what LC050 actually is

Checked by `inspect_model.py`, which reads it straight from the graph and then
cross-checks it against the engine.

| | name | shape | dtype | meaning |
|---|---|---|---|---|
| input | `img` | [1,3,256,256] | float32 | **BGR** planar, `/255`, **no mean/std** (`preprocess.ts rgbaToBGRPlanar`; ImageNet normalisation was the phase-0b session-1 failure) |
| output | `points` | [1,8] | float32 | `[x0,y0,..,x3,y3]` as fractions of the 256 input. Comes from a **linear** Gemm, so values are not clamped to [0,1] |
| output | `has_obj` | [1,1] | float32 | presence probability. **Post-sigmoid** (Gemm then Sigmoid). Its logit is graph tensor `/head/has_obj/has_obj.1/Gemm_output_0` |

- **Opset and size:** opset ai.onnx 16, IR 8, exported by pytorch 1.14.0 on 2023-12-30.
  It has 400 initializers totalling 1,101,177 floats, and costs 0.111 GMACs.
- **Architecture,** read off the node names:
  - **Backbone:** LCNet050 with BatchNorm folded into the convs, and SE blocks that use
    Clip as their hard-sigmoid.
  - **`has_obj`:** GlobalAveragePool over the last backbone stage (256 channels), then
    Gemm(256->1), then Sigmoid. It never sees the decoder.
  - **`points`:** a single learned query `head.query [1,1,64]`, refined coarse-to-fine by
    5 decoder blocks (4, 3, 2, 1, 0). Each block has a conv tokenizer, a learned
    `pos_emb`, and a 3-layer `nn.TransformerDecoder` (d=64, 4 heads, FFN 128). The
    result goes through Gemm(64->8) with no activation.
- **It is not a heatmap model.** Corners come out directly as regression values, and
  `has_obj` is a separate image-level classifier.
- **Corner order:** LC050 emits `[TL, TR, BR, BL]`, clockwise in image coordinates, using
  DocAligner's rule (sort by x, then by y within each pair). This held on 19 of the 19
  labelled frames, and `gt.json` was labelled in the same order.
  `dataset.order_corners` reproduces it.
- **How the engine consumes it:**
  - `model.ts` picks the input as `inputNames[0]`, and the outputs by `/point/i` and
    `/obj/i`.
  - `frame.ts modelPointsToCanonicalQuad` multiplies the points by 416.
  - `gate.ts` latches `has_obj` on the cold side at 0.80 (acquire) and holds it at 0.30.
  - On session 2, `has_obj` was >= 0.80 on 17 of 19 cards and on 9 of 26 no-card frames.
    That 9 of 26 is the known clutter problem, fp-rect in `triage.json`.

### Which preprocessing matters: v3, not the letterbox

The brief describes the training input as a letterbox with `INFERENCE_RECT`. That is
**pipeline v2**, and it has been superseded. `index.ts` now keeps it only so the
offline harness can replay the 480x640 phase-0b corpus. Pipeline v3 is the live
engine and the labeller (`frame.ts`, since 2026-09-04):

- The stream's centre square is resampled to the 416 canonical frame, and the model
  input is a **plain resize of that square to 256**.
- There is no padding, so a model fraction **is** a canonical fraction.
- Manifest corners are canonical fractions, which makes them the training targets with
  no transform at all. "The inverse mapping" is `p * 416`.

`preprocess.py` ports both pipelines and tests both. On a square frame, the v2
transform reduces exactly to the v3 resize: they differ by 5.7e-14 px.

---

## The scripts and their measured results

All the numbers below come from the run on 2026-10-04.

### `check_env.py`

- torch 2.11.0+cu128 with cudnn 9.19. `torch.cuda.is_available()` returns True on the
  RTX 5080, which reports sm_120, and sm_120 is in the build's arch list.
- A matmul, a conv and a backward pass all run on `cuda:0`.

### `inspect_model.py`

This prints everything in the contract section above. All six cross-checks pass.

### `preprocess.py` + `parity_preprocess.py` + `ts/dump_ts.mts`: the check that matters most

`dump_ts.mts` runs the engine's **own exports** under tsx: `preprocess.ts`, `index.ts`
`inferenceTransform`, `frame.ts`, plus the offline harness's sharp and ORT sidecar.
Python then compares its port against them on 25 session-2 frames (19 labelled), 14
letterbox transforms, 33 point vectors and 7 stream sizes. Some sizes are chosen
deliberately to hit JS `Math.round`'s .5 cases, where Python's `round()` would be
wrong.

| exact check | max abs diff |
|---|---|
| computeLetterbox / inferenceTransform, modelPointsToQuad, modelNormToFrame, frameToModelNorm | **0.0** |
| modelPointsToCanonicalQuad, squareCrop, streamQuadToCanonical, canonicalToStream | **0.0** |
| PNG decode, cv2 vs sharp (uint8) | **0.0** |
| letterboxRGBA, the nearest-neighbour reference (uint8) | **0.0** |
| rgbaToBGRPlanar (float32 **bit patterns**), on TS RGBA and on Python RGBA | **0.0** |
| modelPointsToQuad on the harness's own model outputs | **0.0** |

The same tensor also gives the same answer in both runtimes: Python ORT 1.30 against the
harness sidecar's ORT 1.29 differs by 3.6e-7 in points and 0 in has_obj.

**What cannot be ported is the resampler.** The browser uses canvas `drawImage`, the
harness uses sharp lanczos3, and Python uses OpenCV. This gap is measured, not assumed
away:

- OpenCV `area` sits closest to sharp lanczos3: a mean of 0.77 to 0.98 and a max of
  36 to 38 uint8 levels.
- Through LC050, the worst corner per labelled frame moves by a median of 1.5 to 1.7 px,
  and by up to 18.5 to 20.8 px on frames where the model is bistable.
- OpenCV `lanczos` (Lanczos-4) is worse.

Treat the resampler as noise to train through. `--aug full` jitters it on purpose.

The training path has one more exactness guard. Batches travel to the trainer as uint8
and are scaled on the GPU by **table lookup**. PyTorch's CUDA `x / 255` multiplies by a
rounded reciprocal, which was measured **not** to be bit-identical to JS `d / 255`.
`train.py` asserts that the lookup is bit-identical every time it starts
(`dataset.ModelInput.check`).

### `convert.py`: ONNX to trainable PyTorch, via onnx2torch plus four fixes

1. **Frozen weights.** onnx2torch makes only Conv and Gemm weights trainable (445,561
   floats). Every other learned tensor arrives as a frozen buffer: the transformer
   MatMul weights, every LayerNorm (decomposed in this export), the query and the
   pos_embs. That is 60% of the model. `promote_initializers()` turns every float
   initializer into a parameter. The model now has 1,110,009 trainable floats and 0
   float buffers left. Every float Constant node is a scalar and stays a constant.
2. **Shared initializers.** The export de-duplicated 6 initializers that happened to have
   equal values. onnx2torch already gives each consumer its own copy, so they are
   independent again, as they were upstream. That accounts for the extra 8,832 floats.
3. **The presence logit.** The `has_obj` logit is tapped out of the fx graph, so training
   uses BCE-with-logits and never takes the log of a saturated sigmoid.
4. **Batch 1 baked in.** The export froze N=1 into 150 attention Reshapes and 6 Expands.
   `make_batchable()` rewrites exactly those, and refuses to run if any of them doesn't
   match the expected pattern. A first attempt used `torch.func.vmap` instead. It was
   numerically exact, but autocast fails under vmap with a conv bias dtype error, so it
   was dropped.

Parity against onnxruntime on 96 inputs: 90 real session-2 tensors through both v3 and
v2, plus random and constant tensors.

| | points, real frames | has_obj, real frames | points, all inputs | has_obj, all inputs |
|---|---|---|---|---|
| CPU fp32 | 5.3e-6 | 2.4e-5 | 6.1e-5 | 2.4e-5 |
| CUDA fp32, TF32 off | 7.5e-6 | 9.0e-6 | 7.0e-5 | 9.0e-6 |
| CUDA with TF32 (info only) | **1.3e-2** | 3.4e-2 | 6.0e-2 | 3.4e-2 |

- **TF32 stays off.** TF32 alone moves corners by up to 5 canonical px, so validation is
  always run in fp32 with TF32 disabled.
- **Batches match.** A batch of 32 matches the same frames run one at a time to 2.4e-7.
- **Gradients reach everything.** All 412 tensors receive gradient. 12 of them get
  exactly zero: decoder_block.4's cross-attention value/out path and norm2. Perturbing
  them with 5-sigma noise changes no output at all, so they are structurally dead in the
  exported function. That is also why the exporter found them still equal and
  de-duplicated them. It is harmless and faithful to upstream.

### `fixtures.py`

This turns session 2 into a manifest in the labeller's format: 416 canonical PNGs, with
corners as canonical fractions. That way every test runs the same code path the
owner's corpus will.

- **Rows:** 19 positives (the frames in `gt.json`) and 26 negatives (triage scene
  `none`).
- **Skipped:** the 39 card frames with no hand label, and the 3 two-card frames.
- **Off-frame corners:** 7 of the cards reach a little past the centre square (worst:
  F059 at 1.104). That is still inside the labeller's [-0.15, 1.15] clamp, so they are
  kept.
- **No tight framings:** session 2 has **0 of 19** cards filling 50% or more of the
  frame (median fill 0.30). It cannot test the actual fix. Only the corpus can.

### `dataset.py`

- **Loading:** reads `manifest.jsonl` and re-validates every row: the verdict, four
  finite corners inside the clamp, and the PNG exists. Corners are put in LC050's order,
  with `topLeftIndex` remapped to match.
- **Targets** are in the model's native space:
  - `points` are the canonical fractions, positives only.
  - `has_obj` is 1 for front, back and face-unknown. A card back counts as a card, with
    real corners.
  - `has_obj` is 0 for every negative. That includes a frame showing a card the labeller
    could not quad, which is HARVEST.md section 6's stated intent.
  - `--exclude-reasons` (for example `too_far multiple_no_clear_foreground`) drops
    negatives by reason. `--exclude-mirror-padded` drops uploads whose square was
    padded by mirroring.
- **Splits** are never made frame by frame (details below).
- **Augmentation** hooks are all off by default. Presets: `light`, `full`, and
  `tight-only` for ablations. The hooks:
  - photometric: brightness, contrast, saturation, hue, gamma, a warm-biased white
    balance, noise and JPEG;
  - one homography for rotation, shear, perspective, zoom and translate;
  - **tight framing:** with `p_tight`, the frame is zoomed so the card's bbox fills 80%
    to 97% of it. This is the regime where LC050 locks onto the text panel. Draws that
    push a corner past the clamp are rejected;
  - Gaussian and motion blur;
  - a soft specular glare blob, biased onto the card;
  - a random 416->256 resampler.

  `--aug-json '{"p_tight":0.6}'` overrides any field. To check the augmentation
  visually, run `python dataset.py --manifest ... --preview 8 --aug full`, which writes
  images to `cache/preview/` with corner 0 marked.
- **Throughput:** about 10 ms per augmented sample on one thread, 4 ms without
  augmentation. With 8 workers that is about 440 img/s. Workers persist between epochs,
  and the epoch number reaches them through shared memory.

#### How splits work

**For the real corpus, the split is `scripts/quad-corpus/split.ts`'s `split.json`, in
the corpus directory, and nothing else.** `dataset.py` and `train.py` read it as an
authoritative prior, and refuse it if it was frozen from a different manifest (the
sha256 is checked). Rows that split.ts marked `excluded` (they bridge into a test unit)
are dropped from training entirely. `train.py` refuses to run on a corpus with no
`split.json`, because `eval.ts` would then score a split the run never saw. Pass
`--allow-own-split` only for throwaway runs such as the session-2 smoke test.

Everything below describes the fallback split this tool makes for itself in that
throwaway case.

1. **Grouping.** Rows are grouped by **day**, which stands in for a labelling session:
   the same cards, the same table, the same light. The day groups are unioned with
   harvest's dHash near-duplicate `dupGroup`, so a re-upload on another day can't land
   on both sides of the split. With fewer than 5 distinct days, the split falls back to
   `dupGroup` alone and prints a NOTE. Session 2 is one day, so it splits by dupGroup.
2. **Assignment.** A group's split comes from `sha1(seed|key)`. The defaults are 15% val
   and 15% test.
3. **The split file.** It is written to `cache/splits/<corpus dir name>.json`, never
   into the corpus. **Once it exists, it is authoritative.** Re-running only assigns rows
   it hasn't seen, and a new row joins its group's existing split. Adding data never
   moves an existing row.
4. **Checks.** Counts are reported per verdict, and so is any dupGroup that crosses
   splits. Each run copies the split file into `runs/<name>/split.json`.

### `train.py`

- **Losses:** L1 on the 8 coordinates (`--points-loss smoothl1` is an option), positives
  only, in LC050's corner order. `--order-loss min-cyclic` is the fallback if ordering
  ever gets in the way. Presence uses BCE on the logit, with weights `--w-points 10
  --w-obj 1`. The upstream docs say DocAligner used Smooth-L1 with points weighted 1000
  plus BCE, a similar balance at their loss scale.
- **Options:**
  - `--freeze none|backbone|backbone+presence`, plus `--backbone-lr-mult 0.1`.
  - Optimisation: AdamW with warmup and cosine decay, and an optional per-group
    `--clip-norm`. BN is folded into the backbone convs, so their raw gradients run
    about 100x the decoder's. That is why gradient norms are logged per group.
  - `--amp off|bf16|fp16`. Both AMP modes work.
  - `--resume`, `--init` and `--eval-only`.
- **Outputs:** `last.pt`, plus `best.pt` chosen by the lowest val corner median.
- **Why fp32 is the default:** the model is limited by op count, not FLOPs. A training
  step costs about 150 ms of fixed overhead at any batch size, so AMP doesn't help:

  | precision | throughput at B=256 |
  |---|---|
  | fp32 | 1,311 img/s |
  | bf16 | 1,031 img/s |
  | fp16 | 1,197 img/s |

  fp32 also avoids the precision sensitivity measured above.
- **Validation** runs every epoch in fp32 with TF32 off. It reports:
  - corner error in **canonical px**: median, mean, p90, best-cyclic, and the share of
    frames within 8 px and 14 px;
  - linear scale, `sqrt(area_pred/area_gt)`, which is what shows an interior lock;
  - the same numbers on the **tight** slice (fill >= 0.5);
  - presence: accuracy at 0.5, the acquire rate at 0.80 on cards, the false-acquire rate
    at 0.80 on negatives, and BCE.
- **Baseline:** epoch 0 is always the untouched pretrained LC050.

**Smoke test on GPU.** Run on the RTX 5080 with a peak of 107 MiB, 40 steps, batch 8,
training **and** evaluating on all 45 rows, so it measures fit, not generalisation:

| | pretrained (epoch 0) | after 40 steps |
|---|---|---|
| loss | 1.022 (step 1) | 0.171 (last-epoch mean) |
| corner median | 16.31 px | 6.48 px |
| <=14 px | 42% | 89% |
| false-acquire on negatives | 27% | 0% |

bf16 with a frozen backbone, `--aug full` and 4 persistent workers also runs. `--resume`
continues from step 40, and `--eval-only` works.

### `export.py`

- **How it exports:** TorchScript exporter, opset 16, batch 1. onnxscript's optimizer
  then folds the shape arithmetic back into constants, and the I/O shapes are re-pinned
  to the shipped file's.
- **The contract,** checked against `lc050.onnx`: the same names, shapes and dtypes, the
  same opset 16 and IR 8, and op types that are a **subset** of the shipped file's. So
  nothing new reaches the wasm-only ORT bundle. Both exports pass.
- **Parity, torch against the exported ONNX:** 6.1e-5 / 2.4e-5 for `--pristine`, and
  1.4e-5 / 3.8e-6 for the smoke checkpoint. The pristine export differs from the shipped
  file by 2.4e-7.
- **Shipping contract** (`ts/contract_ts.mts`). The exported file is run through the
  engine's **own TypeScript**: harness `engineInput`, rgbaToBGRPlanar,
  modelPointsToQuad and modelPointsToCanonicalQuad, the cold presence gate, isConvexQuad
  and isCardShaped/isSingleCardShaped. The shipped file runs beside it for comparison:
  - The pristine export matches the shipped model frame for frame. The v2 corner median
    is 11.63 px, the harness's published "FULL FRAME 11.6".
  - The smoke checkpoint draws 45/45 finite quads, none of them non-convex. On v3 the
    corner median goes from 15.46 to 6.47 px and negatives that pass the gate go from
    8/26 to 0/26. That is overfit to the same frames, so it only proves the plumbing.
    The v2 letterbox, which is not the training distribution, gets slightly worse (11.63
    to 12.53): the fine-tune is specialising to v3 inputs, as intended.

---

## A real training run

```bash
# 0. the owner harvests (QA account; writes C:/Users/cheyr/deckpal-data/quad-corpus)
node scripts/quad-corpus/harvest.mjs

# 1. FREEZE the split once, shared with eval.ts (use --extend after a later harvest,
#    so frozen rows never move; re-freeze with --force only before any candidate depends on it)
node --import tsx scripts/quad-corpus/split.ts
# 2. the shipping model's baseline on the locked test split
node --import tsx scripts/quad-corpus/eval.ts

cd tools/quad-train
# 3. look at the augmentation (reads the same split.json)
.venv/Scripts/python.exe dataset.py --manifest C:/Users/cheyr/deckpal-data/quad-corpus --preview 16 --aug full
# 4. train; epoch 0 in the log is the shipping model's score on the same val split
.venv/Scripts/python.exe train.py --manifest C:/Users/cheyr/deckpal-data/quad-corpus \
    --epochs 60 --batch-size 64 --lr 1e-4 --aug full --num-workers 8 --run r1
#    cheaper first try: add --freeze backbone (decoder + presence only, 842k params)
# 5. export + contract + shipping check
.venv/Scripts/python.exe export.py --checkpoint runs/r1/best.pt     # -> cache/export/r1.onnx
cd ../..
# 6. score the candidate ONCE on the locked test split, through the shipping engine path,
#    with the same metric definitions as the baseline (train.py's own val metrics are a
#    training signal: raw 14 px, fixed corner order, "tight" at fill >= 0.5)
node --import tsx scripts/quad-corpus/eval.ts --model tools/quad-train/cache/export/r1.onnx
# 7. and on real tight framings, plus the synthetic tight crops of held-out cards
node scripts/quad-corpus/make-tight.mjs --split test
node --import tsx scripts/quad-corpus/eval.ts --corpus C:/Users/cheyr/deckpal-data/quad-corpus-tight-test --split all \
    --model tools/quad-train/cache/export/r1.onnx
```

**Expected time on the 5080:** minutes, not hours. With `--aug full` the data loader is
the bottleneck at about 440 img/s with 8 workers. The GPU can take about 1,300 img/s at
B=256, or about 400 at B=64.

| corpus | epochs | samples | time |
|---|---|---|---|
| 2,000 labels | 60 | 120k | about 5 min |
| 10,000 labels | 60 | 600k | about 23 min |

Add about 20 s for worker spawn on Windows and a few seconds of evaluation per epoch.

**What success looks like on the val split, compared with epoch 0:**

- a lower corner median overall;
- above all, a lower **tight-slice corner median**, with **tight scale moving toward 1.0**.
  The text-panel lock shows up as a scale of roughly 0.6 to 0.9;
- `interior_like` falling;
- a lower false-acquire rate, without the acquire rate on cards going down.

Shipping the `.onnx` is a separate decision for the owner. It would replace
`scan-assets/lc050.onnx`, change `SOURCES.md`, and needs on-device verification.

---

## Risks and open questions

- **No upstream training code.** As of 2026-10-04,
  [DocsaidLab/DocAligner](https://github.com/DocsaidLab/DocAligner) ships inference only
  (Apache-2.0). The [model-design notes](https://docsaid.org/en/docs/docaligner/model_arch/)
  describe the point model: a PP-LCNet backbone, coarse-to-fine cross-attention,
  Smooth-L1 points at weight 1000, and BCE presence. I found no public training script
  or model definition for it. So the realistic choices are:
  - **(a) this onnx2torch graph.** It is the exact function, proven to 1e-5, and
    trainable now.
  - **(b) a hand-written module that loads these weights.** Cleaner code, but it adds
    parity risk, and with BN folded it trains with no BN either way.
  - **(c) reimplementing upstream from the description.** It could restore BN, but the
    weights would no longer map one-to-one.

  My read is that (a) is the right first step. It is the shipped function, nothing was
  re-derived, and every quirk of the export is fixed and tested. Its costs:
  - an awkward graph: about 2,000 small ops, 150 ms per step, mitigated by large batches;
  - no BN to adapt;
  - the batch fix depends on the 2023 export's exact patterns. `make_batchable` refuses
    anything else.

  If the first real run is limited by the model rather than the data, moving to (b) is
  the next step.
- **The corpus is unknown.** Its size, its day spread, and how many tight framings it
  holds will decide whether fine-tuning works. With fewer than about 500 positives,
  freeze the backbone. With fewer than 5 labelling days, the split falls back to
  dupGroup, and same-session frames will make val look better than it is.
- **The training input is resampled twice.** Training uses 416 PNG -> 256. The live
  engine goes stream -> 256 in one `drawImage`. LC050 moved 1.5 px (median) and up to
  20 px between two resamplers. The resampler jitter in `--aug full` is the mitigation.
  A better one would be harvesting `reference`-resolution crops (HARVEST.md:
  `stream`/`crop` fields).
- **Labels aren't perfectly precise.** Labels are good to about 3 to 8 px, and the sleeve
  rim is ambiguous by 8 to 30 px live. The model inherits that, so don't chase sub-5 px
  medians (RECOMMENDATION.md section 4.7).
- **Clutter.** About 35% of session-2 no-card frames cross the 0.80 acquire threshold
  (9/26). Presence fine-tuning needs real negatives, `not_a_card` most of all. Those only
  exist from schema 2 onward, and v1 `no_card` is a mixture.
- **Synthetic data** is still Phase 1b of RECOMMENDATION.md, and nothing here builds it.
  The augmentation's tight-framing hook is the cheap version of its "margin" lesson. A
  compositor using the catalogue's card art would fill the tight, oblique, glare and
  sleeve regimes the owner's labels may cover thinly. The cost is days of engineering
  plus a real synthetic-to-real gap, so measure the real corpus first.
- **Order convention.** DocAligner's sort rule is ambiguous near 45 degrees.
  `order_corners` falls back to an angular rule for degenerate cases, and
  `--order-loss min-cyclic` is there if this ever shows up in training.
- **Overfitting.** A 1.1M-parameter model on a few thousand frames will overfit without
  augmentation. Watch train loss against val corners, and keep the test split locked
  until the end.
- **Not verified:** ORT-web on the phone running an exported file. The opset, IR and op
  set are identical to the shipped model and its input/output contract is enforced, so
  the risk is low, but a fine-tuned file still needs one on-device run before it ships.
