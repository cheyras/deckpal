---
date: "2026-10-01"
title: "TCGplayer ids TCGdex lacks are now derived from TCGCSV, so those cards can be priced"
decided_by: "Claude Sonnet 5.5 on behalf of @cheyras"
areas: ["prices"]
supersedes: []
---
## 2026-10-01 — TCGplayer ids TCGdex lacks are now derived from TCGCSV, so those cards can be priced
**Decided by:** Claude Sonnet 5.5 on behalf of @cheyras

**Decision:** A card is priced from TCGplayer only when its `card_variant` carries
`(tcgplayer_product_id, tcgplayer_printing)`, and until now that pair came from exactly one place:
TCGdex's `thirdParty.tcgplayer`. Where TCGdex has no id the card was permanently `unpriced`, however
well TCGplayer prices it. A new **link pass** (`apps/sync/src/prices/linkTcgcsv.ts`, matching rules in
`linkMatch.ts`) derives the missing ids from TCGCSV, the same free mirror the price ingest already
reads. It runs inside the `prices-tcgcsv` job, before the price walk, once per TCGCSV stamp (see
Implications), and on its own as `prices link-tcgcsv [--sets a,b] [--dry-run]` (also a `workflow_dispatch` option on
`price-refresh.yml`).

- **A group is assigned to a set** (only where TCGdex gave none) when a TCGCSV group agrees with
  at least 90% of the smaller side on collector number AND name, with at least three agreeing cards
  and at least half of our set covered. Candidates come from the printed set code or the group name;
  two groups tying is a refusal.
- **A variant is linked** only when number AND name agree and the product is priced under the
  printing the variant kind means (`Normal`, `Holofoil`, `Reverse Holofoil`, and the WotC-era
  `Unlimited` / `1st Edition` names). A sibling variant's id is NOT evidence: a stamped or
  patterned sibling never lends its product to a plain variant, and a plain sibling that already
  holds a different product blocks the link. A name unique on both sides is the one number-less
  fallback (confidence 70). It never takes a qualified product, a product whose number belongs to
  another of our cards, or one whose number is also plain digits and differs from ours (in practice
  it fires for CC-prefixed vs original-set numbering).
- **Refused, left unpriced:** stamped or event products (`(Prerelease)`, `[Staff]`), ambiguous
  matches, stamped / jumbo / cosmos-foil variants, and any (product, printing) already owned.
  A lone finish-descriptor product such as `(Cosmos Holo)` is accepted at 80. The "only variant,
  one printing" relabel is limited to Normal <-> Holofoil and never crosses an edition.
- **Never overwrites:** every write is guarded by `tcgplayer_product_id IS NULL`, an existing
  `id_source` (for example from a Cardmarket id) is preserved, and `tcgplayer_url` is NOT written
  (the API builds it from product id + printing, so a later id reset cannot leave a stale link).

**Why:** `svp-085` Pikachu with Grey Felt Hat showed no price while TCGplayer lists it at
$1,031.27 (product 518861). The whole SVP set was in that state, and so was Jungle (`base2`).
Against live TCGdex and TCGCSV data the group picker accepts 140 of 220 sets (no duplicate group
assignments), and 13,902 of 23,736 cards would link even under a deliberately crude all-`normal`
variant model. It was made conservative on purpose: SCHEMA §4.5 already says "a wrong price is not
acceptable", so every ambiguity resolves to unpriced. The first draft of the matcher failed to strip
the number from names like `Pawmot - 006 (Prerelease)` and refused 62 SVP cards as a name mismatch;
a second flaw let a tiny subset group be accepted for a large set. Both are pinned by tests.

**Implications:**
- **The catalog importer still resets these columns.** `import.ts` writes
  `tcgplayer_product_id = EXCLUDED…` with no COALESCE on purpose (a stale id must not outlive its
  upstream; see `releasePriceLinks.ts`), so every catalog refresh puts affected cards back to NULL and
  the next price run re-derives them. `price_current` is keyed by variant id and is not touched by an
  import, so nothing is lost in between.
- **No manual first run.** The link pass is its own `sync_run` job, `products-tcgcsv`, keyed on
  TCGCSV's stamp. The first 15-minute tick after deploy sees no successful run for the current stamp
  and does it; after that it costs one query per tick. `prices link-tcgcsv [--dry-run]` and the
  `link-tcgcsv` dispatch option run it on demand. Linking only writes ids: a newly linked card's price
  lands at the next price ingest (dispatch `prices-tcgcsv` with force to do it now).
- **An interrupted run cannot wedge prices.** `sync_run_one_active` allows one `running` row per
  job and nothing clears a stale one, so a link run killed mid-flight would have made every later
  tick fail before the price walk. Both jobs' stale rows are now swept to `orphaned` under the
  `prices-tcgcsv` lock, and a failure to even record the link run is held like any other link failure.
- **A link failure is loud and retried.** One bad set costs that set, not all of them
  (`failedSets`). The run is recorded `failed` (not `partial`, which `lastOkStamp` counts as done), so
  the next tick retries the link pass even though today's prices are already in; prices that can be
  written still are; the job goes red. A TCGCSV rate limit aborts the whole run, per their policy.
  The cost of a set that fails every run is the whole link pass (~150-250 requests) every 15 minutes
  until fixed, bounded by the 100 ms request floor; noisy by design.
- **Review found and fixed two wrong-price paths before merge.** A sibling's id had been copied onto a
  plain variant without identity checks (Umbreon `sv08.5-059`: a Poké Ball pattern's $3.69 instead of
  $0.47), and the name-only fallback accepted qualified or contradicting products (np-23 Metang).
  Both are pinned by tests, and the reviewer's real-data reproduction no longer fires.
- **Not fixed here: art.** The ~950 cards with no art are a sourcing problem, not a linking one.
  TCGplayer and pkmn.gg are ruled out by the owner (`research/CARD-ART-SOURCES.md` §2.3, §8), and
  `images.scrydex.com` has not been approved. Nothing in this change touches the image tier.
- **Tests:** `apps/sync/src/prices/__tests__/linkMatch.test.ts` (matching, 25 cases),
  `tcgcsvLink.test.ts` (sequencing and retry, 7 cases), and a real-Postgres suite,
  `apps/api/src/__integration__/priceLinks.mjs`, run by `scripts/test-db-integration.mjs` with every
  migration applied. It proves the link, the existing price writer producing a `price_current` row for
  the linked card, idempotency, per-set failure isolation, and that an upstream id is never overwritten.
