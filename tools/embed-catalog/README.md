# tools/embed-catalog

Fills `card_embedding` (migration 048) from the cached card art, so the scanner
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
   extension, which is what makes the pipeline provable before migration 048 is
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
