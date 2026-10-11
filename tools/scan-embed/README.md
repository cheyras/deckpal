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
- **Identical-art reprints are masked out of each other's negatives.** "Identical art" means the same name and either a dHash within 6 bits or, with `--same-art`, a `same_art.py` pair: ORB features on contrast-equalised luma that agree under one near-identity homography, with enough of the agreement inside the art band. Their only difference is a badge and number a few pixels tall at 224 px. That is the printed key's job (OCR), and training the model to separate them would teach it noise.
  - dHash alone is at the mercy of the scan. The catalogue's Base Set images are 1st Edition scans with a colour cast and a different crop, so Base Set and its Base Set 2 reprint landed 13 bits apart. The loss then treated them as negatives, and the model learned to tell them apart by scan colour, which a real card under a warm lamp does not have. `same_art.py` is colour-blind.
- **A colour-cast augmentation** (`augment.py` `CAST_P`, `CAST_GAIN`: a per-channel gain on 40% of captures), for the same reason.
- **Real photos as extra queries** (`--real-pairs`, a JSONL of `{crop, cardId}`; `--p-real` is the chance a card that has some uses one instead of a synthetic capture). v2 used 185 of the owner's quad-scan crops, none of them from the photos the gate is checked on.
- **Validation is the real-crop benchmark** (`scripts/scan-bench`), and it is never trained on.

## Result

`deckpal-card-b32-v2` is run r4's `last.pt` (2026-10-10), not the benchmark's best epoch. It replaced run r1's `deckpal-card-b32-v1` before either was deployed. The decision file (`decisions/2026/2026-10-09-scanner-identity-embedding-*.md`) has the full comparison.

| on 256 real crops, fp32 gallery × int8 query, one capture at a time | zero-shot (shipped) | v1 (r1) | v2 (r4) |
|---|---|---|---|
| top-1, exact printing | 80.9% | 93.8% | 90.6% |
| top-1, right name | — | 96.1% | 95.7% |
| top-5 | 89.1% | 96.5% | 96.5% |
| median top-1 − top-2 margin | 0.053 | 0.317 | **0.334** |
| decisive at the gate, all of them right | | 207 | **210** |

v2's top-1 falls because it is trained not to split identical-art printings, so its first answer among them is a coin toss. That is the printed key's question either way, and the gate refuses those pairs on their margin. What the gate does name rises, on the benchmark and more on the owner's own photos: 148 against 134 named exactly, with no wrong card.

(The zero-shot column was measured with batched queries, before `embed.py` embedded one capture at a time; batching moves int8 similarities by a few thousandths.)

## Running it

```bash
PY=~/deckpal-data/venvs/scanid/Scripts/python.exe   # torch (CUDA) + timm + onnx + onnxruntime
# (on this machine: OPENBLAS_NUM_THREADS=1 — the Windows commit charge is tight)
$PY tools/scan-embed/same_art.py                    # -> ~/deckpal-data/scan-bench/same-art.json (once per catalogue)
$PY -u tools/scan-embed/train.py --run r4 --epochs 20 --batch 256 --workers 3     --same-art ~/deckpal-data/scan-bench/same-art.json --same-art-min 80     --real-pairs ~/deckpal-data/quad-queue/real-pairs-v2.jsonl --p-real 0.5
$PY tools/scan-embed/export.py --run r4 --ckpt last.pt --name deckpal-card-b32-v2
```

- **Training:** about 2.5 min per epoch on an RTX 5080. The CPU augmentation is the bottleneck, so it synthesises at half the capture size.
- **Export:** writes `<name>.fp32.onnx` (the catalogue side) and `<name>.int8.onnx` (the query side; dynamic int8, the shipped quantisation) to `~/deckpal-data/scan-embed/export/<name>/`, with a manifest of sha256s and fp32/int8 agreement.
- **Scoring before shipping:** `scripts/scan-bench/embed.py` (gallery / queries / score with `--model <fp32> --query-onnx <int8>`; queries are embedded one at a time, as production embeds them), then `gate_sweep.py` and `calibrate.py` for the gate and `bench.ts --vectors <tag> --model-id <id>` for the whole path.

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
