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

## The auto-capture re-arm on the owner's sessions (`owner-rearm.ts`)

A separate question from identification: on the owner's three recorded phone
sessions, what does the look re-arm (`apps/web/src/scan/ui/rearm.ts`) do with
the locks the duplicate policy refuses? It computes the shipping `cardLook` /
`captureLook` off the recorded frames and capture crops, takes the refusals
from the builds' own flags narrowed to the shipping region policy, and lets the
shipping judge decide. Ground truth is the session-1 NCC measure plus
`owner-rearm-labels.json`, labelled by eye from the sheets `--sheets` writes.

```bash
node --import tsx scripts/scan-bench/owner-rearm.ts --sheets --out <dir>
```

The frames live in the main checkout's untracked
`roadmap/plans/card-scanner-redesign/p2-work` (override: `OWNER_SESSIONS`).
The script's header has the method, its limits and the 2026-10-10 result.
