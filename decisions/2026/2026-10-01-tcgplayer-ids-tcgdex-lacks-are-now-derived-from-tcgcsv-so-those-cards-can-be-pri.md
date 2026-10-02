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
reads. It runs at the start of every non-skipped `prices-tcgcsv` ingest, before the price walk, and
on its own as `prices link-tcgcsv [--sets a,b] [--dry-run]` (also a `workflow_dispatch` option on
`price-refresh.yml`).

- **A group is assigned to a set** (only where TCGdex gave none) when a TCGCSV group agrees with
  at least 90% of the smaller side on collector number AND name, with at least three agreeing cards
  and at least half of our set covered. Candidates come from the printed set code or the group name;
  two groups tying is a refusal.
- **A variant is linked** only when number AND name agree and the product is priced under the
  printing the variant kind means (`Normal`, `Holofoil`, `Reverse Holofoil`, and the WotC-era
  `Unlimited` / `1st Edition` names). A name that is unique on both sides is the one number-less
  fallback (confidence 70).
- **Refused, left unpriced:** stamped or event products (`(Prerelease)`, `[Staff]`), ambiguous
  matches, stamped / jumbo / cosmos-foil variants, and any (product, printing) already owned.
  A lone finish-descriptor product such as `(Cosmos Holo)` is accepted at 80.
- **Never overwrites:** every write is guarded by `tcgplayer_product_id IS NULL`, and an existing
  `id_source` (for example from a Cardmarket id) is preserved.

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
  import, so nothing is lost in between. Run `link-tcgcsv` by hand after a refresh to close the gap
  sooner.
- **The first run has to be triggered.** The ingest skips when TCGCSV's stamp is unchanged, so after
  deploy dispatch `price-refresh.yml` with job `link-tcgcsv` (use `--dry-run` locally first to read
  every set's outcome), or wait for the next published stamp.
- **A link failure is loud.** It does not stop the prices that can be written, but it marks the run
  `partial` and throws after recording it, so the workflow goes red instead of cards staying unpriced
  behind green dashboards. A TCGCSV rate limit aborts the run, per their policy.
- **Not fixed here: art.** The ~950 cards with no art are a sourcing problem, not a linking one.
  TCGplayer and pkmn.gg are ruled out by the owner (`research/CARD-ART-SOURCES.md` §2.3, §8), and
  `images.scrydex.com` has not been approved. Nothing in this change touches the image tier.
- **Tests:** `apps/sync/src/prices/__tests__/linkMatch.test.ts` (21 pure cases) and a real-Postgres
  suite, `apps/api/src/__integration__/priceLinks.mjs`, run by `scripts/test-db-integration.mjs` with
  every migration applied. It proves the link, the existing price writer producing a `price_current`
  row for the linked card, idempotency, and that an upstream id is never overwritten.
