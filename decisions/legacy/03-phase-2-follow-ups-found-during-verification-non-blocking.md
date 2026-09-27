## Phase 2 follow-ups (found during verification, non-blocking)

- ✅ **Task 4 — dex importer** and ✅ **Task 5 — price ingest + cross-fill**, both
  lead-verified against the DB. Cross-fill: 4,285 tcgcsv reverse rows,
  **0 false positives** on control sets (sm3 all-tcgdex, sv03.5 zero tcgcsv);
  reverse-holo trap proven (`swsh3-136` `-holo` prices land on `reverse`);
  `captured_at` = source stamp not `now()`; re-runs add 0. Full catalog now priced:
  **32,948 distinct priced variants across 187 sets**.
- 🐛 **`prices --sets <x>` does not scope the TCGCSV group walk.** A targeted
  `tcgcsv --sets base1 --force` ran the full 178-group sync. Harmless for the daily
  cron (all groups run together, idempotent), but the flag is misleading for
  targeted/incremental runs. Fix before relying on partial price runs.
- 🐛 **Skip-if-unchanged gate is global, not per-set.** Because the gate keys on the
  source `last-updated.txt` stamp, a set absent from the first run of the day never
  gets priced until the stamp advances — unless `--force`. Fine for the full daily
  job; wrong for incremental. Consider per-(job,set) stamping.
- ⚠️ **base1 priced 102 of 300 product-matched variants.** The printing-aware join
  `(tcgplayer_product_id, tcgplayer_printing) ↔ (productId, subTypeName)` may be
  dropping variants whose `tcgplayer_printing` is null/mismatched. Price *coverage*
  (not correctness) needs a look — vintage sets are the likely weak spot.
- 📝 **Schema asymmetries flagged by the price agent** (not blockers): the
  field-map's base `avg → target_finish='holo'` row is not literally usable (routed
  in code for the base bucket, field-map used as authority for reverse only);
  `price_observation.source_code` is SMALLINT→id while `price_current.source_code`
  is TEXT→code. Reconcile in a later migration.
- 📝 **`card_species_conflict`**: the dex importer seeded `resolved_to` for the 13
  known-wrong cards (treating the curated seed as the human decision). The
  *recurring* sync must still never clobber a human `resolved_to`.
- ⏳ **`dex_species.total_card_count`** left 0 (level denominator) — catalog sync
  follow-up.

