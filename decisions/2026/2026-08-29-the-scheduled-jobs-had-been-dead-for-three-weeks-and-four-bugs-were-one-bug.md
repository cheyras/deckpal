---
date: "2026-08-29"
title: "The scheduled jobs had been dead for three weeks, and four bugs were one bug"
decided_by: "Chey (walkthrough recording, 2026-08-29) + agent"
areas: ["general"]
supersedes: []
---
## 2026-08-29 — The scheduled jobs had been dead for three weeks, and four bugs were one bug

**Decided by:** Chey (walkthrough recording, 2026-08-29) + agent
**Decision:** Wire the price and snapshot ingests to GitHub Actions, replay two
years of TCGCSV archives into `price_observation`, and fix the list card links,
the stretched value chart, the decorative PRO chips and the empty TCG tab.

**Why:** A 14-minute screen recording reported nine problems. `GET /api/health`
answered four of them at once:

```
prices-tcgcsv        ok  finishedAt 2026-08-08T19:30Z
prices-cardmarket    ok  finishedAt 2026-08-09T01:00Z
snapshot-collection  ok  finishedAt 2026-08-08T20:00Z
reconcile            ok  finishedAt 2026-08-09T00:00Z
```

`apps/sync/src/index.ts` is a long-running node-cron process. It has to be
RUNNING somewhere, and on the cloud tier nothing ran it — `vercel.json` has no
`crons` and `catalog-refresh.yml` was the only scheduled data workflow.
DEPLOYMENT.md §6 even said so ("price and snapshot ingests still run from the
deckpal-sync process and are not yet wired to Actions"), which turned out to be
a description of an outage rather than a plan. So: "market price as of 22 days
ago", an Insights chart that stopped on 8/8, and all four range chips drawing
the same ten days because there was nothing else to draw. One missing cron, four
symptoms.

**Implications:**

- **`price-refresh.yml`**, mirroring `catalog-refresh.yml`'s shape and secrets.
  The tick is */15 and the work is conditional: TCGCSV publishes ONCE a day
  (~20:05 UTC), `ingestTcgcsvPrices` already checks `last-updated.txt` and
  returns `{skipped:true}` on an unchanged stamp, so ~95 of ~96 daily ticks are
  one 30-byte request. The owner asked for "as close to real time as possible";
  the honest ceiling without a TCGplayer partner agreement — which this app
  deliberately does not have — is "within minutes of publication", not
  continuous.
- **The value snapshot needed an all-users path.** All three API-backed jobs are
  `currentUserId(req)`-scoped, which was right for one account and snapshots
  nothing for a runner holding a database password and no session. Rejected:
  giving the runner a credential that can impersonate any account — a real
  security surface, for a diary entry. Chosen: one set-based statement
  (`jobs/valueSnapshot.ts`), with the collection-wide `unique_cards` /
  `total_quantity` written onto every currency row exactly as the endpoint does.
- **Two years of price history, replayed from archives.** The live endpoint
  serves only today, so the 8/9→8/29 gap first looked permanently unrecoverable:
  the ownership ledger (`collection_event`) survived, but there were no prices to
  value it with, and carrying the last known price forward for three weeks draws
  a flat line and calls it market data. TCGCSV does publish per-day archives
  (`prices-YYYY-MM-DD.ppmd.7z`, from 2024-02-08), whose files are byte-identical
  in shape to the live envelope — so the gap is recoverable with REAL observed
  prices, and the chart can have a past longer than the snapshot job's own
  uptime. Owner's call: 2024-08-29 → today, all variants. Measured cost: 44,385
  priced rows per archived day, so ~32M rows and ~3-4 GB.
- **`price_current` is never written by the backfill.** It holds the LATEST
  price per variant; replaying 2024 through `writeSetPrices`'s default would
  leave the whole app quoting two-year-old prices as today's. Hence the
  `updateCurrent` option.
- **The chart was stretched because of `preserveAspectRatio="none"`.** A fixed
  640-wide viewBox scaled to a ~1300px container is a 2.03x horizontal stretch:
  elongated text, circles rendered as ellipses. The tell was the owner's own —
  the hover tooltip looked fine, because it is an HTML div outside the SVG.
  `ValueChart` now measures its container and uses real pixels as the viewBox.
- **Every card link from every list page 404'd.** `lists.ts` mapped
  `setId: r.serie` — the SERIES tcgdex id — so a tile linked to
  `/series/base/base/60` and `CardDetail` asked for `base-60` when the card is
  `base1-60`. Invisible in review because the images line two rows below takes
  serie AND setcode and was always right; only the click was wrong.
- **List pages open the card as a SHEET now.** That is also the fix for "it
  didn't go back to lists": the standalone card route's BackPill can only point
  at the card's set, because that is the only ancestor the URL carries. A sheet
  has no back problem. The routing rule moved into `components/CardLink.tsx` —
  it had drifted across three copies (tile, table row, binder slot), and the
  binder slot silently rendered no link at all on list pages.
- **The PRO chips are gone.** 1.5y/2y were disabled chips stamped PRO in front
  of a tier that does not exist, over ranges the API had no window for either.
  Both are ordinary ranges (`18m`, `2y`) now.
- **The TCG tab computes legality, it does not echo `card.legal_standard`.**
  That column is documented in `003_catalog.sql:68` as "upstream-mirror ONLY;
  NOT the legality predicate". `deck/cardLegality.ts` runs the real validator on
  a one-card deck and keeps only card-scoped violations, so the card tab and the
  deck builder's legality panel cannot disagree. `formats.test.ts`'s "every
  production validateDeck call supplies the reprint oracle" fired on the first
  draft, which had made the oracle optional — for GLC's `cel25cc` cards it is the
  only pool route that fires, so omitting it reports a legal card illegal. The
  oracle is a required argument as a result.

**Corrections to the brief, recorded because the assumptions were load-bearing:**

- **Decks are not variant-scoped.** `deck_card`'s PK is `(deck_id, card_id)` and
  `011_formats_decks.sql:100` says so on the line that creates it. The H/J/I chip
  visible in the deck rows is the REGULATION MARK, not a variant. Fixing this is
  `roadmap/plans/variant-scoped-decks.md`, already written from the 2026-08-12
  note; it is a live-DB PK change and stays on its own branch.
- **`+3 Variants` means "this card has 3 other printings in the catalog"**, not
  "3 variants are in this list".
- **Dynamic lists are reference-sets by prior decision** (`lists.ts:16-26`), not
  saved queries, so owning Growlithe correctly did not remove him. The owner has
  chosen to change that design to a re-evaluated saved query; deferred to its own
  branch.

