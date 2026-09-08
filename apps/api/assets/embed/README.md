# apps/api/assets/embed

The identity model the API embeds uploaded crops with. **Nothing here is
committed** — `.gitignore` excludes `*.onnx` in this directory, because an int8
CLIP ViT-B/32 export is ~88 MB and this repo carries no binaries.

This directory exists in git so that `vercel.json`'s `includeFiles` glob has
something to point at and so that whoever has to place the file finds an
explanation rather than an absence.

## On a cloud build nothing places it by hand — a build step fetches it

`includeFiles` can only carry a file that is on disk when Vercel traces the
function. A cloud builder clones the repo and nothing else, and this file is
gitignored — so "placed by hand" described the owner's laptop and no deployment
that had ever happened.

`scripts/fetch-embed-model.mjs` runs **first** in `vercel.json`'s
`buildCommand`. It downloads the checkpoint from the `card-art` bucket, where it
is staged as `models/clip-vit-b32-openai.onnx.part0`, `.part1`, … — one 88 MB
object was refused with a 413 `EntityTooLarge`, so it is split — concatenates
the parts in order, verifies a **pinned sha256 over the whole file**, and writes
it here.

* **No `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`** → it logs loudly and exits
  0. A fork, CI, or a self-host build must not break over an asset it was never
  going to use: with `SCAN_EMBED_MATCH` off — the default — the vector rung is
  absent anyway and the ladder degrades exactly as designed.
* **A digest mismatch** → it fails the build. A model that is present and wrong
  is worse than one that is missing: its query vectors are not comparable with
  the catalogue's, so the scanner would rank confidently and rank nonsense.
* **Already here at the expected size** → it leaves the file alone. That is the
  local-dev case, and re-downloading 88 MB to arrive at identical bytes is a
  minute of somebody's life for nothing.

**Replacing the checkpoint is a three-part change**: re-stage the parts, update
`MODEL_SHA256` in the script, *and* re-run `tools/embed-catalog` for the current
stamp. The first two without the third give a query space that does not match
the index — which looks like a working scanner returning wrong answers.
`apps/api/src/scan/__tests__/fetchEmbedModel.test.ts` pins the parts of this
that a test can hold; DEPLOYMENT.md carries the same warning beside the bundle
arithmetic.

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
