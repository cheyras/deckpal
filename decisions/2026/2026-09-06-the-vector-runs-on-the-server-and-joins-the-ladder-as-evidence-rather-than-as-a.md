---
date: "2026-09-06"
title: "The vector runs on the server, and joins the ladder as evidence rather than as a second opinion"
decided_by: "Claude Opus 5 on behalf of @cheyras, merging"
areas: ["operations"]
supersedes: []
---
## 2026-09-06 — The vector runs on the server, and joins the ladder as evidence rather than as a second opinion

**Decided by:** Claude Opus 5 on behalf of @cheyras, merging
`feat/matching-embeddings` into `dev/scan-harness` under the owner's 2026-09-05
and 2026-09-06 rulings.

**What the rulings changed about the branch as written.** It shipped the CLIP
model to the PHONE — an 88 MB int8 download before the scan route could identify
anything — and it exposed the matcher as `POST /api/scan/embed`, a second
endpoint with its own verdict beside `/resolve`'s. Both are now wrong: *"it's ok
if we run that server-side"* (09-05) and *"ensure that the image vector match is
still a point of data in the match"* (09-06). So `apps/web/src/scan/engine/
embed.ts` is DELETED, the endpoint takes the crop instead of a vector, and the
vector became a rung of the one resolver.

**The runtime, decided by measurement and not by the obvious import.**
`onnxruntime-node@1.29.0` is disqualified twice over. It unpacks to **296 MB** —
one tarball carrying `bin/napi-v6/{linux,darwin,win32}/{x64,arm64}`, no optional
per-platform packages to prune — against Vercel's **250 MB** uncompressed
function ceiling, so it does not fit before a model is added. And it would not
run if it did: the binding is loaded as
``require(`../bin/napi-v6/${process.platform}/${process.arch}/…node`)``, which
@vercel/nft either wildcards (all 296 MB) or resolves to the 0.39 MB `.node`
while missing `libonnxruntime.so.1` — 44.7 MB that the `.node` `dlopen`s and no
static tracer can see. The second outcome deploys green and 500s on the first
scan.

The runtime shipped instead is the **ORT-web WASM build this repo already
vendors** for the detector (`apps/web/public/scan-assets/`), read off disk by
the API. No native component, nothing to trace. Verified under plain Node
against `lc050.onnx` in this repo: session created in 370 ms, inference in
23 ms, correct output shapes. Two things make it work headless and both are in
`queryEmbed.ts`: the `.wasm` is handed over as BYTES (`env.wasm.wasmBinary`,
because the browser build would `fetch()` a URL Node cannot fetch), and threads
are off (ORT's threaded path wants a `Worker`, and a function is one CPU).

**The bundle, measured 2026-09-06 on this repo:**

| | size |
|---|---|
| `api/index.mjs` today (127 packages; sharp's Linux libvips is 17.4 MB) | 62.8 MB |
| ORT-web WASM runtime + loader | 13.3 MB |
| CLIP ViT-B/32, int8 | 88.2 MB |
| **total** | **~164 MB**, ~86 MB under the ceiling |

**So the full checkpoint ships and TinyCLIP is not needed.** It stays the
pre-measured fallback — 61.7 MB, thresholds already in `confidence.ts`, 6% less
similarity headroom (0.0685 against 0.0731) plus a 640-wide column and a full
re-embed. Cold start is a load and not a download: session creation measures
~7.5 ms/MB after a one-off ~360 ms runtime init, so ~1.0-1.5 s on an instance's
first request, then nothing.

**The fusion rules, in `apps/api/src/scan/fuse.ts`, consulted from
`resolve.ts`.** Not a weighted score, for the reason the ladder is a ladder: a
printed set code is unique across 20,444 physical cards with ZERO collisions and
a cosine is a number whose meaning depends on what else was in the gallery.
Three rules about AGREEMENT:

1. **A key that resolved is never reviewed.** OCR wins a disagreement; the
   vector cannot demote a confident rung to uncertain either, so the feature
   cannot make the product worse than it was.
2. **Corroboration.** Where a key narrowed the world to candidates it cannot
   choose between — `014/198` is Steenee or Floragato, different pictures, and
   the printed key genuinely cannot say — and the vector's OWN top-1 is one of
   them at `>= simFloor`, the agreement is the answer:
   `resolvedBy: 'corroborated'`, confident, the runner-up kept. Rung 9 routes
   through the same rule, which is the best case in the design: body text
   identifies the words every reprint shares, the vector identifies the picture
   no two printings share.
3. **Alone, the calibrated gate.** `similarity >= 0.74 AND margin >= 0.02` for
   `clip-vit-b32-openai` — the spike's applied gate, unchanged, accepting 9 of
   10 true matches and 0 of 9 impossible ones. Below decisive but showable, the
   candidates go back with `matched: true, confident: false`. The vector is the
   LAST rung that can name a card, above rungs 6/7/8 only because those hand the
   hash's list back filtered and the hash was right 2 times out of 10 where the
   vector was right 10.

**The hash is demoted, not deleted, and the demotion has a sharp edge.** Inside
the near-exact band (distance <= 2) it may CONFIRM the vector; it may never
speak alone, and `corroborate()` requires the vector to be one of the two
signals. This was a real finding rather than a preference: allowing the hash to
corroborate by itself made the flag's arrival change answers BEFORE the
catalogue was embedded, which is a switch nobody can roll back cleanly — and it
would hand back the power the ruling took off it, when the measured wrong top-1s
are same-art reprints at distance 1-6, INSIDE that band. `scan_exemplar` gains
`resolved_by` and `phash_distance` so *"does the hash ever change an outcome"*
is a `GROUP BY` rather than an afternoon; that query is what retires it.

**Migrations renumbered, and one of them was wrong.** The branch's 048/049/050
collided with this line's `set_abbreviation`/`card_text`/`card_text_rls` and
became **051_card_embedding, 052_scan_exemplar, 053_scan_exemplar_rls**, order
preserved, every cross-reference updated. The semantic collision was worse than
the numeric one: `scan_exemplar_frame.embedding` was declared `vector(384)` —
ViTamin-S's width, the checkpoint that won the spike's FIRST gallery and stopped
separating when it doubled — while the catalogue's vectors are 768. A flywheel
storing query vectors in a space the catalogue does not live in cannot be
compared to anything; it would have accumulated for months and been worth
nothing, silently. Now 768, pinned to `EMBED_DIM` like 051.

**Verified without a database, because there is not one here.** All 53
migrations apply in order on PGlite; 051 refuses with exactly the actionable
sentence it was written to produce (*"pgvector is not available on this server.
Install it before migrating: … apt install postgresql-18-pgvector"*), and with
the vector type shimmed the remaining SQL — constraints, both consent triggers,
indexes, comments, and 053's RLS policies — applies clean, 16 behavioural checks
passing over it: the consent trigger refuses a retained crop with no recorded
consent, withdrawal refuses while keys are still referenced and succeeds after
the two-step, a delete cascades its frames, and two stamps coexist for one card.
`tools/embed-catalog` was then run END TO END against that schema over a PGlite
socket with a three-card fixture catalogue and a stub checkpoint of the right
signature: dry-run, `--local-out`, the real batched upsert, resumability
(`0 card(s) to embed` on a second run), `--force`, and the `--set` filter. The
runbook for the production run is in `tools/embed-catalog/README.md`.

**And the flag means what it says.** With `SCAN_EMBED_MATCH` unset, `/resolve`
ignores `vectorMatches` entirely, reports no `similarity` key, and is asserted
byte-identical to the pre-vector ladder across every fixture case — and with the
flag ON and the index still empty it is identical again, so migrate → embed →
flag has no step that changes answers early.

**Tests:** 206 api pure (79 new across `fuse.test.ts` and the reworked
`embedMatch.test.ts`), 555 web scan, 27 matching, 91 drive-export. Full
workspace typecheck and the production build chain pass.

**NOT DONE, and each needs the owner:** apply 051/052/053, run
`tools/embed-catalog` against the real database, place the int8 checkpoint at
`SCAN_EMBED_MODEL_PATH`, and set the flag — in Preview first. The exemplar
WRITER is still unwired: the tables and their columns are here because the
2026-09-04 addendum says the schema commitments cannot be retrofitted, but
nothing yet writes a row at verify time.

