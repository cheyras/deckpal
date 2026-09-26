---
date: "2026-08-29"
title: "price_observation was empty on cloud, and it was never a bug"
decided_by: "agent, verifying against the live database"
areas: ["commerce"]
supersedes: []
---
## 2026-08-29 — price_observation was empty on cloud, and it was never a bug

**Decided by:** agent, verifying against the live database
**Decision:** Record that `price_observation` holds ZERO rows on Supabase, that
this is the documented behaviour of the cloud migration rather than a defect,
and that the archive backfill is therefore the ONLY source of price history for
this deployment — not merely repair for the August outage.

**Why:** Verification found 0 rows in `price_observation` while `sync_run`
reported sixteen successful `prices-tcgcsv` runs writing ~27,000 rows each and
`price_current` held 53,959 rows. That looks exactly like a silent write failure
in `appendObservations`, which would also have meant the new backfill wrote
nothing and reported success. It is not. `scripts/migrate-to-cloud.mjs:74`:

> `// NOTE: price_observation is partitioned and huge — migrated separately if at all`

The table was deliberately left behind when the product moved to Supabase.
`sync_run` came across, which is why the history claims work that was done on
the old box.

**Implications:**

- The Price tab ships correct and EMPTY until the backfill runs. That is worth
  knowing before someone reports it as broken.
- `backfillValuePoints` reads `price_observation`, so ORDER MATTERS: replay the
  price archives first, then reconstruct value points. Run the other way round
  and every day is skipped with "no price observation within N days", which is
  the honest answer to the wrong question.
- **Measured, replacing the earlier estimate:** one archived day yields 44,385
  Pokémon rows with a market price, of which **28,622 join to a `card_variant`**
  in this catalogue (178 sets carry a TCGplayer group id; 33,064 variants carry
  a product id). So two years is **~20.9M rows, ~2.9 GB** — not the ~32M/4-6 GB
  quoted from the unjoined row count. The unmatched remainder is sealed product
  and groups this catalogue does not carry.
- One day (2026-08-15, 28,412 rows) was written during verification to prove the
  write path. Re-running it inserted 0, and `price_current` stayed at its
  2026-08-09 stamp — so B8 idempotency and the `updateCurrent: false` decision
  are both confirmed against production rather than asserted.

**Verified against the live database, not inferred:**

| Check | Result |
|---|---|
| Value-snapshot SQL vs the app's own totals | USD 84824 / EUR 90659, 604 unique, 1298 cards — matches the recording's `$848.24`, `€906.59`, `604`, `1298` exactly |
| `collection_event` vs `collection_item` | agree for every account, so ledger reconstruction is sound |
| List card links | `/series/base/base1/60` → `base1-60` (was `base-60`) |
| Two printings in one list | two rows, chips read "Normal" and "1st Edition Normal Shadowless" |
| `GET /cards/:id/legality` | Ponyta `base1-60` illegal in Standard/Expanded/GLC, legal Unlimited; Rellor `sv08-013` (mark H) legal in all four |
| `GET /cards/:id/prices` | two series for `sv08-013` — Normal $0.08, Reverse Holofoil $0.16 |

**Still unverified:** pixel rendering. The browser extension is not connected in
this environment and the repo has no Playwright, so the chart's aspect ratio,
the variant chips and the sheet-over-list were verified through the API and the
data, not by looking at them. The AGENTS.md gate for browser verification at
desktop and 390px is NOT met.

