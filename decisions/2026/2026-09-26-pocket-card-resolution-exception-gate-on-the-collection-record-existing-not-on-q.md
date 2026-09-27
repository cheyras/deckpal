---
date: "2026-09-26"
title: "Pocket-card resolution exception: gate on the collection record existing, not on quantity"
decided_by: "Chey (via Claude)"
areas: ["catalog"]
supersedes: []
---
## 2026-09-26 — Pocket-card resolution exception: gate on the collection record existing, not on quantity

**Decided by:** Chey (via Claude)

**Decision:** `packages/agent-tools/src/resolve.ts`'s `ownedPocketCardById()`
(added the same day, see the "Exclude Pokémon TCG Pocket" entry above) resolves
a Pocket card by its exact id when the caller has a `collection_item` row for
it **at all**, regardless of current quantity — not only while
`quantity > 0`, which was the first version.

**Why:** An independent review pass (Astra, `codex review`) found that
gating on `quantity > 0` broke `log_cards`' retry safety. `log_cards`
derives its idempotency key from the *resolved* item set
(`packages/agent-tools/src/tools/logging.ts`). A batch that reduces a
Pocket card's last owned unit to zero resolves that item on the first call
(quantity was still 1) and silently drops it on an identical retry
(quantity is now 0) — two different resolved sets, two different
idempotency keys, so the retry is not recognized as a replay and any other
item in the same batch (e.g. a physical card's increment) is re-applied a
second time. Reproduced by Astra against the real tool handler, diffing the
two outgoing keys. A `collection_item` row, once created, is never deleted
by an ordinary write ("qty-0 rows are KEPT", `research/SCHEMA.md` §9.1), so
gating on the row's existence instead makes resolution stable across any
number of retries.

**Implications:** A user who has ever recorded owning a specific Pocket
variant can use its exact id to set the quantity back up again later, not
only down to zero — a narrower gap than "Pocket cards are acquirable,"
since it only ever applies to a variant this exact user already has a row
for, never a new Pocket card, and never anything reachable by name or by
browsing. Closing that narrower gap would mean refusing a quantity
*increase* on a non-browsable card at write time, inside `logging.ts`/
`lists.ts`'s own idempotency-sensitive planning logic, which this PR does
not change. Left as a flagged follow-up rather than same-PR surgery on code
neither this fix nor its review fully exercised. `pocketExclusion.mjs`
(`pnpm --filter deckpal-api test:pocket-exclusion`) gained two checks
proving the fix directly: resolution is identical before and after the
quantity-zeroing write, and a mixed batch (Pocket decrement + physical
increment) resolves the same two items on a simulated retry as on the
original call.
