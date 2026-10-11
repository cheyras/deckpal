# scan-assets — provenance

Every binary in this directory is fetched, not built, and none of it is
reproducible from this repo. So each one is recorded here with the exact URL it
came from and the sha256 of the bytes that are checked in, because "the model
file" is otherwise an unfalsifiable claim: two `ch_PP-OCRv4_det_infer.onnx`
files with different weights look identical from the filename.

The whole directory is excluded from the service-worker precache
(`vite.config.ts` `globIgnores: [… 'scan-assets/**']`) and is fetched lazily by
`src/scan/engine/model.ts` (detector) and `src/scan/ocr/session.ts` (OCR) on
first use, never at page load.

## OCR — PaddleOCR PP-OCRv4 mobile, Chinese det + rec

Adopted by `roadmap/plans/card-scanner-redesign/p2-work/ocr/bakeoff/REPORT.md`
§9.1: 100 % on the collector number pair and 76 % on the card name over 21 real
480×670 crops, with zero wrong reads of any field.

| file | bytes | sha256 |
|---|--:|---|
| `ppocr-v4-det.onnx` | 4 745 517 | `30a86f5731181461d08021402766601e4302a9b9b9666be8aff402696339cdff` |
| `ppocr-v4-rec.onnx` | 10 822 323 | `06b3e6af6c59a1ba5d53790ed8c2e4b2de389870b6cf5a97f349f3412cb269c0` |
| `ppocr-keys-v1.txt` | 26 249 | `28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7` |

**Fetched from** the npm registry, 2026-09-05:

```
https://registry.npmjs.org/@gutenye/ocr-models/-/ocr-models-1.4.2.tgz
  tarball sha256 9b6666eae0b51936f186bcf4d581c403b63232c8d2d256308d2259dee3afd14e
  npm dist.integrity sha512-y7cLEpGFOeroavopfCd/ejyZB/UeF6xdn0mBFqVHNOI5wQTv2My+/nKxvxKTtG4DVMBzt9TpOfaX7aZGbuciUw==
```

Renamed on the way in (`ch_PP-OCRv4_det_infer.onnx` → `ppocr-v4-det.onnx`,
`ch_PP-OCRv4_rec_infer.onnx` → `ppocr-v4-rec.onnx`, `ppocr_keys_v1.txt` →
`ppocr-keys-v1.txt`); the bytes are byte-identical to the tarball's, which is
what the sha256 column above is for.

`@gutenye/ocr-models` is MIT (`https://github.com/gutenye/ocr`, directory
`packages/models`). **These are the exact files the bakeoff measured** — it ran
`@gutenye/ocr-node`, whose default model paths are these three (`node.js` in
that package), so the accuracy numbers in REPORT.md are numbers for *these*
weights and not for a same-named export from somewhere else.

**What is NOT verified.** The package describes itself as "based on PaddleOCR …
supports PP-OCRv4 model", and the filenames are PaddleOCR's own. We have not
byte-compared these against a PaddlePaddle-published ONNX export, because
PaddleOCR publishes `.pdmodel`/`.pdiparams` inference archives rather than ONNX
— an ONNX file for these weights necessarily comes from someone's Paddle2ONNX
run. The claim this table supports is therefore "these are the exact bytes the
bakeoff measured, from a named, hashed, MIT-licensed tarball", not "these are
bit-for-bit an upstream PaddlePaddle artefact".

**The `cls` angle classifier (`ch_ppocr_mobile_v2.0_cls_infer.onnx`, 578 966 B)
is deliberately NOT shipped.** REPORT.md §5.2: rectified crops are never upside
down — `rectify.ts` produces a portrait card from an oriented quad — so the
0.58 MB is 0.58 MB of nothing.

## Detector — DocAligner LC050

| file | bytes | sha256 |
|---|--:|---|
| `lc050.onnx` | 4 911 217 | `fd0a320c756ca7f445fb58de108b71f6f6e8bf652bb2a5f4f5d852224edcd081` |

The DocAligner LC050 checkpoint predates this file. Its provenance lives in
`roadmap/plans/card-scanner-redesign/` phase-0a and in the header of
`src/scan/engine/model.ts`. The checkpoint as first committed had sha256
`32d186080ce16442674d4c0eaaaaac878eea289b56a8d1284f05fff1ff42e220`.

**The presence head was refit (2026-10-11).** Only the presence head
changed, through two initializers: `head.has_obj.1.weight` (256 floats) and
`head.has_obj.1.bias`. The backbone, the corner head and the graph are
byte-identical, so the quad (corner) outputs are unchanged and only `hasObj`
differs.
`scripts/scan-bench/video/presence_head.py` refits it and reproduces this file
byte for byte from its cached features (`collect`, then `export`). The decision
file "Scanner detector: the presence head is refit on labelled video frames"
says why, and how it was measured.

**Training data, attributed under CC BY.** The refit weights are fitted to
LC050's pooled features of frames from these Creative Commons Attribution
YouTube videos (`youtube.com/watch?v=<id>`). The labels are our own
ground-truth files, which say which frames show a card.

| video | channel |
|---|---|
| `-1hPV6p3Y8E` | PokéDaddy |
| `46OLXH5-aLQ`, `QOWR1q_Vaek` | Schmitty's Poke Search |
| `4vq6zgMd_9U` | 513's collectible cards |
| `8nqqNrDo3CE` | PokePullShorts |
| `9qpeku0otao` | GamingEELeete |
| `ARAWSwYFz2I` | Blues Corner TCG |
| `BO1Wa-evt6k` | Card Game Nomad |
| `ETkbLABj598` | Steph And Mannie |
| `Ep7NokxQ0q4`, `RLULfTjTFSs`, `gUw1BTjycBU` | Welshpokedon |
| `Gc9d5_87odU`, `WuheDPVq_Bo` | Bkemon |
| `H4FjFjvLhbg` | Ruxin34 |
| `JP-MdK4Kr00` | MacCardz |
| `SKQJEu7DDzo` | SFCollects |
| `XrKBGUrZV44`, `aWmpwRUfN5E` | OneSPlays |
| `_dK-gA71H7E` | Team Rocket Joey |

The videos and frames themselves are not in this repo. They stay on the
developer's machine (`~/deckpal-data`).

## ONNX Runtime Web — wasm-only bundle

| file | bytes |
|---|--:|
| `ort.wasm.min.mjs` | 50 126 |
| `ort-wasm-simd-threaded.mjs` | 24 218 |
| `ort-wasm-simd-threaded.wasm` | 13 961 845 |

From the `onnxruntime-web` npm package's `dist/`. `model.ts`'s header explains
at length why it is the **wasm-only** bundle and why all three files must sit in
one directory (the bundle resolves its own `.wasm` sibling with
`new URL(…, import.meta.url)`). The OCR sessions load this same bundle from this
same directory — one runtime, two more sessions, no second copy.
