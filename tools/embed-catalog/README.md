# tools/embed-catalog

Fills `card_embedding` (migration 051) from the cached card art, so the scanner
has something to match against. The sibling of the dHash indexer
(`apps/api/src/scan/index.ts`, `pnpm --filter deckpal-api scan:index`) — same
resumability, same connection budget, same cache.

## Why it is two processes

`embed.mts` owns the database contract; `embed_worker.py` owns the tensor. The
input spec has a bit-exact golden on both sides
(`packages/matching/fixtures/parity-golden.json`), and the Python
implementation is the one an ONNX runtime can be driven from without
reimplementing the resampler a third time. They speak JSON lines over a pipe;
the worker announces the stamp it produces and `embed.mts` refuses to write if
that is not the stamp it was going to label the rows with.

## Prerequisites

1. **The model.** Not committed — the repo carries no binaries. Export the
   checkpoint named by `EMBED_MODEL_ID` (`packages/matching/src/input-spec.ts`)
   to ONNX and put it where the job looks:

   ```bash
   pip install timm torch onnx onnxruntime numpy pillow
   python - <<'PY'
   import timm, torch, os
   name = 'vit_base_patch32_clip_224.openai'   # EMBED_MODEL_ID's checkpoint
   m = timm.create_model(name, pretrained=True, num_classes=0).eval()
   x = torch.zeros(1, 3, 224, 224)
   os.makedirs('.cache/models', exist_ok=True)
   torch.onnx.export(m, (x,), '.cache/models/clip-vit-b32-openai.onnx',
                     input_names=['pixel_values'], output_names=['features'],
                     dynamic_axes={'pixel_values': {0: 'batch'}, 'features': {0: 'batch'}},
                     opset_version=17, do_constant_folding=True)
   PY
   ```

   `.cache/` is gitignored in its entirety. Override the location with
   `--model` or `EMBED_MODEL_PATH`.

2. **The image cache.** `IMAGE_CACHE_ROOT`, exactly as the phash indexer reads
   it. A path that differs between the two jobs means two indexes built from two
   sets of bytes.

3. **Postgres** — only for the default mode. `--dry-run` and `--local-out` need
   the catalogue tables but never write, and `--local-out` needs no `vector`
   extension, which is what makes the pipeline provable before migration 051 is
   applied.

## Running

```bash
set -a && . ./.env && set +a

# What would happen, and how long it will take.
node --import tsx tools/embed-catalog/embed.mts --dry-run --limit 200

# Vectors to a file, no database write at all.
node --import tsx tools/embed-catalog/embed.mts --local-out .cache/embeddings

# The real thing. Resumable: re-running embeds only what is missing.
node --import tsx tools/embed-catalog/embed.mts

# One set, or everything again under a new model.
node --import tsx tools/embed-catalog/embed.mts --set me04 me05
node --import tsx tools/embed-catalog/embed.mts --force
```

| Flag | Effect |
|---|---|
| `--dry-run` | Embed, report, write nothing. |
| `--local-out <dir>` | Write `<stamp>.jsonl` there instead of Postgres. |
| `--quality low\|high` | Which art tier to embed. Default `low` — what the matcher queries. |
| `--set <id>…` | Restrict to sets. |
| `--limit N` | Cap the run. |
| `--force` | Re-embed rows that already have a vector for this stamp. |
| `--model <path>` | Override the ONNX path. |
| `--python <exe>` | Override the interpreter (`PYTHON` env var also works). |

## After a run

`missing-art` in the summary is expected and should not be zero: 967 catalogue
cards have no art in any approved source (`p2-work/art-sweep/SWEEP.md`), and a
run reporting none of them has probably not found the cache.

The API only queries this table when `SCAN_EMBED_MATCH=true` (DEPLOYMENT.md).
Embedding the catalogue changes nothing on its own, which is deliberate: the
data lands first, the switch is a separate decision.

---

# RUNBOOK — the production run

The exact sequence, in order, with what each step should print. Steps 1-3 are
the owner's: they touch the database and the deployment, which no agent may do
(AGENTS.md B9). Everything below was rehearsed on 2026-09-06 against a PGlite
instance holding this schema, with a fixture catalogue of three cards and a
stub checkpoint of the right signature — so the SQL, the resumability, the
worker handshake and the flag semantics are known-good; the model weights and
the row counts are what the real run adds.

### 0. Prerequisites, on the machine that will run it

```bash
python -m venv .venv && . .venv/bin/activate
pip install onnxruntime numpy pillow           # the worker
pip install timm torch onnx                    # the export, once
```

Export the checkpoint (the snippet in "Prerequisites" above) to
`.cache/models/clip-vit-b32-openai.onnx`. **Keep it.** The API needs the same
file at `SCAN_EMBED_MODEL_PATH`, quantised to int8 — a query vector and a
catalogue vector are comparable only when one model made both.

Confirm `IMAGE_CACHE_ROOT` points at the cache the phash indexer used. A path
that differs between the two jobs means two indexes built from two sets of
bytes, and nothing will complain.

### 1. Migrate — OWNER ONLY

```bash
set -a && . ./.env && set +a
pnpm migrate:status                 # expect 050 applied, 051-053 pending
pnpm migrate                        # applies 051, 052, 053
```

051 refuses with a message naming the package if `pgvector` is missing
(verified: on a server without it the message reads *"pgvector is not available
on this server. Install it before migrating: … See DEPLOYMENT.md"*). Install
it, then re-run — nothing partial is left behind, since every migration runs in
one transaction.

### 2. Embed — the long step

```bash
set -a && . ./.env && set +a
export EMBED_MODEL_PATH="$PWD/.cache/models/clip-vit-b32-openai.onnx"
export PYTHON="$PWD/.venv/bin/python"

# Rehearse first. Costs a minute and catches a wrong cache path.
node --import tsx tools/embed-catalog/embed.mts --dry-run --limit 200

# Then the real thing.
node --import tsx tools/embed-catalog/embed.mts
```

| what | expected |
|---|---|
| runtime | **~8 minutes.** Measured: 6,464 images in 128 s single-threaded under ORT's CPU EP, which extrapolates to ~7.8 min for the full catalogue (embed-spike/NOTES.md §4b). |
| `embedded` | ~22,600 — the catalogue minus the cards with no art |
| `missing-art` | **~967, and NOT zero.** Zero means the job did not find the cache. |
| `failed` | 0. Anything else names the file; a single bad image does not stop the run. |
| `coverage` | the same number as `embedded`, counted back out of `card_embedding` |

It is **resumable and idempotent**: interrupt it and re-run, and it embeds only
what is missing for this stamp. Re-running after a completed run reports
`0 card(s) to embed` and exits — verified.

### 3. Place the API's model, then turn the flag on — OWNER ONLY

Quantise the export to int8 and put it where the function will find it:

```bash
cp clip-vit-b32-openai.int8.onnx apps/api/assets/embed/clip-vit-b32-openai.onnx
```

It is gitignored and carried into the bundle by `vercel.json`'s `includeFiles`.
Deploy, then set `SCAN_EMBED_MATCH=true` in **Preview first**:

```bash
vercel env add SCAN_EMBED_MATCH preview     # value: true
```

Check `GET /health` reports `scanEmbed: "on"`, run one real scan through
`POST /api/scan/embed`, confirm the answer, and only then add it to Production.

### If something is wrong, what it looks like

| symptom | cause |
|---|---|
| `/api/scan/embed` 404s | the flag is not set on this environment. `/health` says which. |
| `/api/scan/embed` 500s naming a path | the checkpoint is not in the bundle. Step 3. |
| scans behave exactly as before, one log line about `card_embedding` | the migration has not run, or pgvector is missing. **This is the designed degradation, not an outage** — the ladder falls back to what it did before the vector existed. |
| `indexSize: 0` with a `note` | migrated but not embedded. Step 2. |
| `stamp mismatch` from the job | the TypeScript and Python halves of `packages/matching` have drifted. Run both parity suites; do not override it. |
