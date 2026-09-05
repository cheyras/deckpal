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

| file | bytes |
|---|--:|
| `lc050.onnx` | 4 911 217 |

Predates this file; provenance lives in
`roadmap/plans/card-scanner-redesign/` phase-0a and in `src/scan/engine/model.ts`'s
header. Recorded here so the directory listing is not half-documented.

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
