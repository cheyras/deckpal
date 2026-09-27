---
date: "2026-08-19"
title: "Idempotency keys, bucketed by time"
decided_by: "Claude (on behalf of @cheyras)."
areas: ["images"]
supersedes: []
---
## 2026-08-19 — Idempotency keys, bucketed by time
**Decided by:** Claude (on behalf of @cheyras).
**Decision:** `mutation_batch` carries `UNIQUE (user_id, idempotency_key)`. The
key row is the FIRST statement of the writing transaction, so a duplicate
collides before anything changes and the caller gets the ORIGINAL response back
instead of a second application. A caller-supplied key is honoured indefinitely.
Otherwise the server derives `<fingerprint>#<15-minute bucket>`, where the
fingerprint is `sha256(userId | canonical(folded, RESOLVED ops))`.

**Why the note is excluded and the ops are resolved.** An agent that rewrites
its note on retry ("batch 1" → "batch 1 retry") must not thereby double-apply;
an agent that expresses the same card as `card_id` on one attempt and
`name`+`number` on the next must still collide. Both fall out of hashing the
resolved operations and nothing else.

**Why bucketed rather than forever.** A content-forever key would silently
swallow a genuine second acquisition of the same cards next month — the same
dishonesty this whole workstream exists to remove, inverted. Lookup checks the
current and previous bucket, so the practical replay window is 15–30 minutes and
a boundary crossing mid-retry still matches. `request_fingerprint` is stored
WITHOUT the bucket, so a batch that is correctly allowed to apply can still be
flagged: "an identical batch was applied 2 days ago — if that was a retry,
revert(batch_id: …)".

**Implications.** `dry_run` never consumes a key. Chunk keys are
`sha256(wholeBatchFingerprint)#<chunkIndex>`, not per-chunk content, so a retry
of the same request reuses identical chunk keys while an edited request gets
entirely fresh ones.

