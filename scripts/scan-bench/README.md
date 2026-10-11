# scripts/scan-bench — the scan-ID benchmark

One question, measured the same way every time: **of real photos of real
cards, how many does the scanner name by itself, and how often is it wrong
when it does?**

It replays saved scanner crops through the shipping identification path —
the server's dHash (`apps/api/src/scan/phash.ts`), the device's OCR
(`apps/web/src/scan/ocr/pipeline.ts`), the image vector, the server's resolve
ladder (`apps/api/src/scan/resolve.ts`) and the client's identity reducer
(`apps/web/src/scan/ui/identity.ts`) — and scores what the thumbnail would have
done against ground truth. No database, no deployment, no scanner endpoint: the
catalogue, the art, the dHash index and the vector gallery are rebuilt locally.

## Headline numbers

| | meaning | direction |
|---|---|---|
| AUTO-ID | confident AND right, over real cards | up |
| WRONG | confident AND wrong, over confident answers | must stay ~1-2% |
| NEG-FALSE | confident on a non-card or a card back | 0 |
| picker top-5 | truth among a needs-you row's first 5 candidates | up |

## Data (outside git)

Everything lives under `~/deckpal-data/scan-bench/` (override:
`SCAN_BENCH_DIR`), because the datasets are the owner's photos.

| path | what | made by |
|---|---|---|
| `catalog.json` | 201 sets, 21,291 cards, from the deployed set pages | `catalog.mjs` |
| `art/images/en/<serie>/<set>/<localId>.low.webp` | catalogue art (TCGdex first, the card-art bucket for gaps) | `catalog.mjs` |
| `phash-index.json` | dHash of every card with art | `phash.ts --build` |
| `embed/<model>/` | gallery + query vectors, top-k per crop | `embed.py` |
| `datasets/<name>/manifest.jsonl` + `crops/` | real crops with ground truth; `datasets/INDEX.md` describes each | assembled from the owner's sessions |
| `runs/<label>.{md,json}` | one benchmark run | `bench.ts` |

A manifest row: `{ id, dataset, crop, cropFull, truth: [cardId…], kind:
card|negative|card-back|exclude, physicalId, issues, notes }`. `truth` lists
every printing that counts as right (more than one only for identical-art
printings the crop cannot separate).

## Running

```bash
node scripts/scan-bench/catalog.mjs                 # catalogue + art (resumable)
node --import tsx scripts/scan-bench/phash.ts --build
PY=~/deckpal-data/venvs/scanid/Scripts/python.exe   # torch + timm
$PY scripts/scan-bench/embed.py gallery             # zero-shot CLIP, as shipped
$PY scripts/scan-bench/embed.py queries
$PY scripts/scan-bench/embed.py score               # vector-only retrieval numbers
node --import tsx scripts/scan-bench/bench.ts --label <name>   # the whole path
node --import tsx scripts/scan-bench/bench.ts --ocr off        # as deckpal.app runs today
```

`bench.ts` caches OCR reads per crop (keyed by the crop bytes and the OCR
source), so ladder experiments rerun in seconds. `parity-phash.ts` checks the
local dHash index against what production returned for the same field crops.

## Owner quad photos → labelled crops

The labeler queue holds the owner's uploads waiting for a quad, mostly
whole-binder and wall photos. Three scripts turn them into candidate
benchmark rows. Everything they write goes under `~/deckpal-data/quad-queue/`
(override: `SCAN_QUEUE_DIR`), never into git: each script refuses to start when
that directory resolves inside the repo (real paths, case-folded on Windows).
`$PY scripts/scan-bench/test_queue_tools.py` checks that guard, the page and
duplicate-contour rules in `extract_cards.py`, and the gate inference, offline.

```bash
node scripts/scan-bench/queue-pull.mjs        # raw/<id>.jpg as the queue stores it (long edge <= 2048), as the QA account
$PY scripts/scan-bench/extract_cards.py --sheet   # cards/<photo>-<n>.jpg (480x670 + 5%) + cards.jsonl
$PY scripts/scan-bench/label_cards.py --model <fp32.onnx> --query-onnx <int8.onnx>   # cards-labelled.jsonl
```

1. **`queue-pull.mjs`** reads `GET /api/dev/scan-queue` and each photo, signed
   in from the gitignored `.qa-account` through `live.mjs`. Read-only,
   resumable, paced.
2. **`extract_cards.py`** proposes card-shaped quads (edges → contours → a
   4-point polygon near 63:88) and rectifies each from the original photo at the
   scanner's capture geometry. It only proposes; many candidates are frames,
   backs or sleeves.
3. **`label_cards.py`** embeds each crop with the production pairing (int8
   query × fp32 gallery from `embed/<model>/`) and tiers top-1 against the
   gate's MAIN tier: `decisive`, `plausible` or `junk` (a wide tier, where a
   model has one, is not applied). The gate is inferred from `--model`;
   `--model-id` is only needed when it cannot be, and a mismatch is refused.
   The fine-tuned model's gallery needs PR #288's `embed.py` (`.onnx` model
   support). On main, use the shipped CLIP: `--model timm:vit_base_patch32_clip_224.openai
   --query-onnx <clip int8.onnx>` (the int8 query model: `tools/embed-catalog/README.md`).
4. **Hand verification.** Look at a sample of the crops (decisive, plausible
   and junk alike) and write what each card really is, read from its set
   symbol and number strip, into `verify-truth.jsonl`: `{ crop, photo, tier,
   kind, truth: [cardId…], matcherCorrect, note }`.
5. **A separate bench root.** Turn the verified rows into a dataset
   (`datasets/<name>/manifest.jsonl` + `crops/`, the manifest shape above) under
   its own root, for example `~/deckpal-data/scan-bench-quad/`, holding
   `catalog.json` and `phash-index.json` (copies), `art/` and `cache/` (linked
   to the main root's), and `embed/<gallery tag>/gallery.npz` for each model
   (queries and top-k are written there by `embed.py queries`/`score` run with
   the same `SCAN_BENCH_DIR`), and run the full ladder against it with
   `SCAN_BENCH_DIR` pointing there. Keeping it apart leaves the main datasets
   and their run history untouched.

**`label_cards.py`'s tiers are pseudo-labels, not ground truth.** On the
300-crop verified sample (2026-10-10), about 11% of `decisive` rows (17 of 149
cards) named the wrong printing, nearly all vintage reprints with the same art
(Base Set vs Base Set 2, Legendary Collection, Celebrations Classic
Collection). Only rows that went through step 4 become benchmark labels.

## Caveats, read before trusting a number

- **Most crops are 229×320**, the size scan telemetry keeps, not the 480×670
  the device reads. OCR cannot read them, so OCR-dependent numbers are reported
  separately for the full-resolution rows (`FULL-RES crops`).
- **The vector gallery is fp32 on both sides** here; production embeds the
  query with the int8 model. Rankings agree closely; absolute similarities
  differ by a few thousandths.
- **Rung 9 (body text) never runs**: the local catalogue port has no
  `card_text` tokens. It only matters when OCR read neither a name nor a number.
- **Labels can be wrong.** Two were (2026-10-09, quad-check-a); rows carrying
  `relabelled: true` say why. When the scanner disagrees with a label with
  confidence, look at the crop before believing the label.
