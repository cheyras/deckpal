---
date: "2026-08-19"
title: "The mutation log: before AND after, append-only"
decided_by: "Claude (on behalf of @cheyras). Migrations 036/037."
areas: ["general"]
supersedes: []
---
## 2026-08-19 — The mutation log: before AND after, append-only
**Decided by:** Claude (on behalf of @cheyras). Migrations 036/037.
**Decision:** Every mutating route opens a `mutation_batch` and appends one
`mutation_event` per changed thing, each carrying a `before` and an `after`
snapshot plus `requested_delta` and `effective_delta`.
`collection_event.batch_id` joins the collection's own feed to it.

**Why before/after and not just deltas.** Reconstructing truth from a stream of
signed deltas is exactly what made the incident's recovery expensive. A snapshot
per event answers "what did that call do?" in one query.

**Why both deltas.** The collection clamps to [0, 100000], so a requested −3
against a quantity of 1 has an effective delta of −1. Reverting the requested
value would be wrong; reverting the effective one is only right while nothing
clamped. Storing both is what lets `revert` detect the difference and refuse.

**Why append-only, with no `reverted_by` column.** RLS policies are not
column-scoped, and on Supabase every policied table is reachable through the
Data API with a user JWT. An UPDATE policy on `mutation_event` would let a user
rewrite `before`/`after` on their own history through PostgREST, bypassing this
app entirely — an audit trail the audited party can edit is not an audit trail.
So the table has SELECT + INSERT policies only, and "was this reverted?" is the
presence of a later event whose `reverts_event_id` points at it.
`mutation_batch` does get an UPDATE policy: it moves pending → committed in the
same transaction that wrote it, and it holds bookkeeping rather than before/after
state, so rewriting it cannot falsify what happened to a card.

**Verified** on a scratch Postgres with Supabase auth stubs (roles, `auth.users`,
`auth.uid()`), running migrations 001→038 with `SUPABASE_MODE=1` so 021/027/033/037
actually execute — which a plain local run skips. Under the real `authenticated`
role: Alice writes and reads her own rows; Bob sees 0 of them; Bob cannot forge a
row as Alice; and **Alice cannot rewrite her own history** (0 rows updated — no
UPDATE policy).

**Implications.** Revert coverage begins at deploy. History written before
migration 036 exists only in `collection_event`, which covers collection
quantities and nothing else.

