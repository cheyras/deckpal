# tools/scan-embed — the scanner's identity embedding, fine-tuned

The scanner names a card by finding the catalogue art whose embedding is
closest to the photo's. The shipped embedding was CLIP ViT-B/32 used zero-shot:
a general photo model that had never been asked to tell one Pokémon card from
another. This directory trains it for that job, on the catalogue itself, and
exports what production loads.

## What the training does

- **Every catalogue card is its own class.** That is 20,467 cards with art.
- **Each step pairs a synthetic scanner capture with the card's clean render** (`augment.synth_capture`). The pair is pulled together against every other card in the batch with symmetric InfoNCE.
- **The synthetic capture models the field's failures, at the field's strength:**
  - detector misregistration (about 3% of the diagonal per corner, check A);
  - the 5% capture margin;
  - glare and washout;
  - holo sheen;
  - fingers;
  - shadows;
  - blur and resolution loss;
  - JPEG.
- **Batches are filled a NAME FAMILY at a time,** so the hard negatives (other printings of the same Pokémon) are always in the batch.
- **Identical-art reprints are masked out of each other's negatives.** "Identical art" means the same name and a dHash within 6 bits. Their only difference is a badge and number a few pixels tall at 224 px. That is the printed key's job (OCR), and training the model to separate them would teach it noise.
- **Validation is the real-crop benchmark** (`scripts/scan-bench`), and it is never trained on.

## Result (run r1, 2026-10-09; `last.pt`, not the benchmark's best epoch)

| on 256 real crops, fp32 gallery × int8 query | zero-shot (shipped) | fine-tuned |
|---|---|---|
| top-1, exact printing | 80.9% | **93.0%** |
| top-1, right art | 86.3% | **96.1%** |
| top-5 | 89.1% | **96.5%** |
| median top-1 − top-2 margin | 0.053 | **0.320** |

Through the whole identification path (`scripts/scan-bench/bench.ts`, 244 distinct cards):
- **With OCR on:** auto-identified rose from 68.9% to **83.2%**, and confident-but-wrong fell from 0.6% to **0%**.
- **With OCR off:** auto-identified rose from 63.1% to **81.1%**, again with **0** wrong.

## Running it

```bash
PY=~/deckpal-data/venvs/scanid/Scripts/python.exe   # torch (CUDA) + timm + onnx + onnxruntime
# (on this machine: OPENBLAS_NUM_THREADS=1 — the Windows commit charge is tight)
$PY -u tools/scan-embed/train.py --run r1 --epochs 20 --batch 256 --workers 3
$PY tools/scan-embed/export.py --run r1 --ckpt last.pt --name deckpal-card-b32-v1
```

- **Training:** about 2.5 min per epoch on an RTX 5080. The CPU augmentation is the bottleneck, so it synthesises at half the capture size.
- **Export:** writes `<name>.fp32.onnx` (the catalogue side) and `<name>.int8.onnx` (the query side; dynamic int8, the shipped quantisation) to `~/deckpal-data/scan-embed/export/<name>/`, with a manifest of sha256s and fp32/int8 agreement.
- **Scoring before shipping:** `scripts/scan-bench/embed.py` (gallery / queries / score with `--model <fp32> --query-onnx <int8>`), then `calibrate.py` for the gate and `bench.ts --vectors <tag> --model-id <id>` for the whole path.

## Shipping a checkpoint

A model id is a vector space. A new one needs:
- its own `EMBED_MODEL_ID` in both `packages/matching` halves;
- its own `THRESHOLDS` entry;
- its own catalogue rows (a new stamp);
- its own HNSW index (a migration).

The old rows and index stay, so switching back is a revert with no data to restore. The production steps are the OWNER's (AGENTS.md B9):

1. **Stage the int8 query model:** `node scripts/stage-embed-model.mjs <int8.onnx>`. It uploads the parts the build fetches and reads them back against the pinned sha256.
2. **Apply the index migration** (`packages/db/src/migrations/082_…`).
3. **Embed the catalogue** under the new stamp, FROM THIS BRANCH (after building `packages/matching`) and with the fp32 export passed explicitly: `node --import tsx tools/embed-catalog/embed.mts --model <export>/<name>.fp32.onnx`. The job checks the file's sha256 against `GALLERY_MODEL_SHA256` before writing a row, and its log must say `stamp=e1:<name>`. Never run it with `--force` from a checkout whose `EMBED_MODEL_ID` is the live one.
4. **Deploy the code.** The build fetches the staged model, and the API queries the new stamp.
