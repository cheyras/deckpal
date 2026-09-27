---
date: "2026-09-04"
title: "The matching schema: one stamped index, and a flywheel that stores vectors rather than photographs"
decided_by: "Claude Opus 5 on behalf of @cheyras, implementing the owner's"
areas: ["data","catalog"]
supersedes: []
---
## 2026-09-04 — The matching schema: one stamped index, and a flywheel that stores vectors rather than photographs

**Decided by:** Claude Opus 5 on behalf of @cheyras, implementing the owner's
2026-09-04 MATCHING ARCHITECTURE RULING and its sleeve-invariance addendum
(roadmap/plans/card-scanner-redesign/PLAN.md).

**Decision:** migrations 048/049/050, `packages/matching`, and a matcher route
that is off by default.

**048 — `card_embedding`.** `vector(768)`, keyed on `(card_id, quality, stamp)`.
The stamp is `e<input-spec-version>:<model-id>` and it is in the PRIMARY KEY,
not beside it. That is contract B5's corollary — `card_image_phash` carries
`algo` so a stale row is invisible rather than silently wrong — taken one step
further: two generations can coexist, so a new model can be embedded across the
whole catalogue while the old one keeps serving and the cutover is a change of
one string. The HNSW index is PARTIAL on the current stamp, because an
unfiltered index over two generations would choose a neighbour from the wrong
one and let the query's `WHERE` filter it out afterwards — fewer than k rows,
or none, with nothing in the plan to say why.

**049 — `scan_exemplar` + `scan_exemplar_frame`.** The addendum's three
commitments, which it says explicitly cannot be retrofitted, are the shape of
these tables rather than a note on them:

1. MULTI-FRAME. Frames are their own table, 2-3 per verified scan, each with
   its own vector. One vector per scan would be cheaper today and would make
   the sleeve problem permanently unsolvable with the data it collected —
   sleeve gloss and card foil are separable across tilts and indistinguishable
   within one frame.
2. SLEEVE, nullable, `none|penny|matte|gloss|toploader` as TEXT + CHECK rather
   than a Postgres ENUM: `ALTER TYPE ... ADD VALUE` cannot run inside a
   transaction block, and this project's runner wraps every migration in one.
   NULL means "nobody has said" and is deliberately NOT `none`; collapsing them
   would poison the stratification the addendum asks for.
3. STRATIFICATION, as an index on `(variant_id, sleeve)` — the finish x sleeve
   grid is a query, not a spreadsheet somebody maintains.

The table also stores what the MATCHER claimed before the reader confirmed or
corrected it. That pair is the calibration dataset for the confidence gate: the
question p2-work/phash-on-crops answered by hand for dHash (0 correct out of 4
confident) becomes a continuous measurement that costs nobody a photo shoot.

**The opt-in crop tier is enforced, not intended.** The ruling says the
flywheel stores embeddings by default with crop retention opt-in. So a retained
crop with no recorded consent is made UNREPRESENTABLE — the same move contract
B1 makes with `image_object`'s foreign key to `image_asset`. A trigger, not a
CHECK, because the consent lives on the exemplar and the reference lives on the
frame and a CHECK cannot see another table. Withdrawing consent while crops are
still referenced RAISES: the caller must delete the objects first. A row that
says "no consent" while the bytes are still in the bucket is the one state this
tier must not be able to reach.

**050 — RLS.** SELECT and DELETE for the reader's own rows; INSERT and UPDATE
denied. 044's reasoning ("you may withdraw it, you may not revise it") with a
sharper edge, because this is training data: a client that could insert could
manufacture labelled examples indistinguishable afterwards from real ones, and
a subject who could update could rewrite the matcher's own claim, which is
exactly the half being measured.

**`packages/matching` — ONE versioned input spec, with cross-runtime bit
parity.** The ruling asks for one spec, PIPELINE_VERSION stamped on every
vector, and coordination with the detector's canonical frame rather than a copy
of it. Delivered as:

- a pure TypeScript module and a pure Python mirror that produce BIT-IDENTICAL
  tensors, checked by both test suites against one committed golden digest.
  Achieved rather than approximated: the resampler is an exact area-average
  with a fixed loop order, because IEEE-754 float64 add and multiply are
  correctly rounded and the same operations in the same order give the same
  bits in both languages. (The first version of the pgvector text codec used 7
  significant digits and the round-trip test caught it — float32 needs 9.)
- NO copy of the detector's `PIPELINE_VERSION`. `apps/web/src/scan/engine/frame.ts`
  owns that number; this package formats whatever it is handed, and a test
  asserts the constant appears nowhere in the module. A catalogue vector
  carries no frame version at all, because a catalogue render never went
  through a camera and stamping it would be a false claim about provenance.

**The matcher route returns two confidences and no third.** `POST /api/scan/embed`
answers with an `identity` block and a `variant` block and deliberately nothing
that could be mistaken for their average — no `matched`, no `confidence`. A
test asserts those fields are ABSENT. `variantConfidence()` has exactly one
inhabitant today, `unknown`, because nothing in this build measures a printing;
what it does compute is whether that unknown BLOCKS the commit, which is the
ruling's "no silent default-to-primary" as a field the UI cannot ignore by
accident.

**Why:** every one of these is a shape that is cheap now and impossible later.

**Implications:**
- `SCAN_EMBED_MATCH` is unset by default and the route 404s; the dHash path is
  untouched. Merging changes nothing about the running product.
- `pgvector` becomes a prerequisite of migration 048. 048 checks for it and
  raises a message naming the package rather than letting Postgres answer
  "could not open extension control file". DEPLOYMENT.md carries the note.
- NOT DONE, and each needs the owner: apply the migrations, run
  `tools/embed-catalog` against the real database, set the flag, and provide
  the Google Drive service-account credential the export tool refuses to run
  without.
- The verify UI still has to USE `variant.requiresUserChoice`. Until it does,
  the ruling's immediate consequence — multi-variant cards must require an
  explicit printing at verify — is available and unexercised.

