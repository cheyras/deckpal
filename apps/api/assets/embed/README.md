# apps/api/assets/embed

The identity model the API embeds uploaded crops with. **Nothing here is
committed** — `.gitignore` excludes `*.onnx` in this directory, because an int8
CLIP ViT-B/32 export is ~88 MB and this repo carries no binaries.

This directory exists in git so that `vercel.json`'s `includeFiles` glob has
something to point at and so that whoever has to place the file finds an
explanation rather than an absence.

## What goes here

`clip-vit-b32-openai.onnx` — the export named by `EMBED_MODEL_ID`
(`packages/matching/src/input-spec.ts`). **The same file
`tools/embed-catalog` uses**, and it must be: a query vector and a catalogue
vector are comparable only when one model produced both. The export snippet is
in `tools/embed-catalog/README.md`; quantise it to int8 for the API, which is
what the 88.2 MB / 57 ms figures in DECISIONS.md were measured on.

Override the location with `SCAN_EMBED_MODEL_PATH` (DEPLOYMENT.md).

## Why the runtime is not here too

`apps/api/src/scan/queryEmbed.ts` loads ONNX Runtime from
`apps/web/public/scan-assets/` — the WASM build the detector already ships to
browsers, read off disk by the server rather than vendored twice. A second copy
of a 13 MB binary is a second copy that can drift from the one phones run.

Not `onnxruntime-node`: it unpacks to 296 MB against Vercel's 250 MB function
ceiling, and the 44.7 MB shared object its binding `dlopen`s cannot be seen by
static file tracing. Measured 2026-09-06; the numbers are in DECISIONS.md.
