# Lists, prices and insights — the 2026-08-29 walkthrough

**Branch:** `fix/lists-prices-insights`
**Source:** screen-recorded walkthrough, 2026-08-29 (14m37s, narrated).
**Scope agreed with the owner:** Waves 1 + 2 below. Waves 3+ are recorded here
so the deferred items have a written home, but are NOT in this branch.

---

## What the recording actually showed

Nine complaints. Four of them are one outage, two are one-line-ish bugs, and
three are product changes. The mapping matters because it is not obvious from
the symptoms.

### The outage — four symptoms, one cause

`GET https://deckpal.app/api/health` on 2026-08-29:

```
prices-tcgcsv        ok   finishedAt 2026-08-08T19:30:25Z
prices-cardmarket    ok   finishedAt 2026-08-09T01:00:08Z
snapshot-collection  ok   finishedAt 2026-08-08T20:00:00Z
reconcile            ok   finishedAt 2026-08-09T00:00:01Z
```

Every scheduled job stopped 20 days ago. They live in `apps/sync/src/index.ts`
as a `node-cron` process that has to be *running somewhere*; on the cloud tier
nothing runs it. `vercel.json` has no `crons`, `.github/workflows/` has only
`catalog-refresh.yml`, and `DEPLOYMENT.md:385` says so in as many words:

> price and snapshot ingests still run from the `deckpal-sync` process (Path B
> below) and are not yet wired to Actions.

That single gap produces all four of:

| Reported | Mechanism |
|---|---|
| "market price as of 22 days ago" | last TCGCSV ingest 2026-08-07 stamp |
| 30d / 3m / 6m / 1y charts identical | ranges are fine — only 10 snapshot days exist (7/30→8/8), so every window returns the same 10 points |
| "Not enough history yet" on Profile | same |
| collection value drifting from reality | prices frozen |

**Upstream ceiling.** TCGCSV publishes once a day (`last-updated.txt` was
`2026-08-28T20:05:45Z` when checked at 14:08Z on the 29th). There is no
10-minute feed to consume, and the app deliberately has no TCGplayer affiliate
relationship. Best achievable is a 15-minute poll of `last-updated.txt` —
one 30-byte request, skip-if-unchanged already implemented in
`ingestTcgcsvPrices` — so prices land within minutes of publication. The label
goes from "22 days ago" to "18 hours ago" and never worse than ~24h.

### The bugs

1. **Every card link from every list page 404s.** `apps/api/src/routes/lists.ts:351`
   sets `setId: r.serie` — the *series* tcgdex id. The row already selects
   `cs.tcgdex_id AS setcode` two lines up. So a list tile links to
   `/series/base/base/60`, `CardDetail` builds `` `${set}-${number}` `` = `base-60`,
   and the real card is `base1-60` (verified against the live API). The image
   URL on the same row is correct (`cardImages(r.serie, r.setcode, r.local_id)`),
   which is why the tiles look fine and only the click is broken.

2. **Back from that card lands on the Series index.** With the card fetch
   errored, `CardDetail`'s `seriesSlug`/`setId` fall back to `backTo`, so the
   BackPill points at `/series/base/base` — not a set. And even when the link
   works, `CardDetail.tsx:395` always targets the *set*, never the list you
   came from.

3. **The value chart is horizontally stretched.** `ValueChart.tsx` renders
   `viewBox="0 0 640 H"` with `width="100%"` and `preserveAspectRatio="none"`.
   At a ~1300px container the x-axis scales 2.05× while y scales 1×, so text
   elongates and `<circle>` renders as an ellipse. The tooltip is an HTML
   `div`, which is exactly why it is the one element that is *not* stretched —
   the owner spotted that and it is the whole diagnosis.

### Corrections to the brief

Recorded because the recording assumed otherwise, and the assumptions are load-bearing:

- **Decks are not variant-aware.** `deck_card`'s PK is `(deck_id, card_id)` and
  `011_formats_decks.sql:100` says so on the line that creates it. The `H`/`J`/`I`
  chip visible in the deck rows is the **regulation mark**, not a variant. So
  `owned` is a roll-up over every printing and "Deck cost" is priced off an
  arbitrary representative. Fixing this is `roadmap/plans/variant-scoped-decks.md`
  — already written up from the owner's 2026-08-12 note, same request.
- **`+3 Variants` means "this card has 3 other printings in the catalog"**, not
  "3 variants are in this list". It is `count(*) FROM card_variant WHERE
  card_id = …`. On a list page it answers a question nobody asked.
- **Dynamic lists are reference-sets by an explicit prior decision**, not saved
  queries (`lists.ts:16-26`). `card_list` has no filter column; `addMissing`
  materialises a query once. Growlithe staying after you own him is
  working-as-designed. The owner has chosen to change the design — see Wave 3.

### Two things already in place

- **`user_settings` exists** (`005_users.sql:10`) with RLS and a row created per
  signup by the `handle_new_user` trigger (`021_rls_policies.sql:35`). Only
  `default_goal` is ever read. Server-side settings is *add columns + one
  endpoint*, not build-a-table.
- **`GET /api/cards/:id` already returns `legal: { standard, expanded }`**
  (`cards.ts:212`) plus `regulationMark`. The web `CardDetailResponse` type
  simply drops the field. "Format legality — coming soon" is a render away for
  Standard/Expanded.

---

## Decisions taken in the planning session

| Question | Decision |
|---|---|
| What "dynamic list" means | A saved query, re-evaluated on read. Wave 3. |
| What runs the price job on cloud | GitHub Actions, 15-minute poll of `last-updated.txt`. Mirrors `catalog-refresh.yml`: same five repo secrets, straight to Postgres, no Vercel config change (so no B9 surface). |
| How value history works | Stored diary **plus** backfill. The nightly job writes today's line; a backfill command reconstructs any missing day from `collection_event` + `price_observation`. Run once now to recover 2026-08-09 → 2026-08-29. |

### Why diary-plus-backfill, and not one or the other

Both ledgers needed to derive value history already exist:
`price_observation` (append-only, per variant per day) and `collection_event`
(`009_collection.sql:15` — append-only, `delta` + `quantity_after` +
`occurred_at`; every `collection_item` write in `collection.ts` and
`mutations.ts` is paired with an event append). So

```
qty(user, variant, D) = quantity_after of the last event <= D
value(user, D)        = SUM over variants of qty x price(variant, D)
```

is reconstructible. Three costs decided the shape:

1. Derivation reaches back only as far as `price_observation` does — also ~7/30.
   It recovers 8/9→today, not 2024.
2. It is a heavy read (365 days x ~600 owned variants, as-of on both sides) and
   `price_observation` grows ~9M rows/year. Today the only index on
   `captured_at` is BRIN, tuned for range scans, not the point lookups an as-of
   join wants.
3. The two answer different questions. The diary says *what it was worth then,
   as we knew it then*. Derived says *what it would have been worth then, given
   what we know now* — so backdated entries silently rewrite the past.

So: diary is the stored series the chart reads (cheap, honest about what was
known, survives anything); backfill is repair. A missed night becomes
self-healing instead of a permanent notch.

---

## Wave 1 — the outage and the confirmed bugs

- [ ] **1.1** `lists.ts:351` `setId: r.serie` → `r.setcode`.
- [ ] **1.2** Card opens as a **sheet** on list pages (`?card=<cardId>`, the
      mechanism the set and species pages already use) instead of navigating
      away. This is also the right fix for "it didn't go back to lists": there
      is nothing to go back *from*. The standalone route stays for deep links.
- [ ] **1.3** `.github/workflows/price-refresh.yml` — `*/15` poll for
      `prices-tcgcsv`; nightly for `prices-cardmarket`, value snapshot and
      reconcile. Same five secrets as `catalog-refresh.yml`.
- [ ] **1.4** All-users value snapshot as SQL in `apps/sync` (the existing
      `POST /insights/value/snapshot` is `currentUserId`-scoped and cannot serve
      a robot with no session). Must mirror `aggregateValue` +
      `ownedCounts` semantics exactly — including that `unique_cards` and
      `total_quantity` are collection-wide, written identically onto every
      currency row.
- [ ] **1.5** Backfill command reconstructing any missing `observed_on` from the
      two ledgers; run for 2026-08-09 → 2026-08-29.
- [ ] **1.6** Test pinning the SQL total against the app's TypeScript total for
      the same collection, so the two copies of the value rule cannot drift.
- [ ] **1.7** `ValueChart` measures its container and sets `W` from real pixels;
      drop `preserveAspectRatio="none"`.
- [ ] **1.8** Remove the PRO chips; add `18m` and `2y` as real ranges
      (API `Range` union, `RANGE_INTERVAL`, the `oneOf` allowlist, web `RANGES`,
      and `insightsCaption`).
- [ ] **1.9** Card modal TCG tab renders the legality already in the payload —
      Standard / Expanded / regulation mark, with the vendored data's
      `as_of` date so it is honest about its own freshness.

## Wave 2 — variants made legible, price history

- [ ] **2.1** List tiles, table rows and binder slots label the variant that was
      actually added (`list_item.card_variant_id` → `variant.displayName`, already
      returned). Two variants of one card are two rows — the schema allows it
      (`list_item_dynamic_uq` is on `(list_id, card_variant_id)`) and `GridView`
      already keys on `itemId`.
- [ ] **2.2** Suppress the catalog `+N Variants` badge wherever a specific
      variant is being shown; it is answering a different question there.
- [ ] **2.3** The grouped-variant table from the set-page modal appears in the
      list context too (falls out of 1.2).
- [ ] **2.4** Price tab: real history from `price_observation`, per variant,
      over the selected range. New read endpoint + chart.

## Deferred — written up, not in this branch

| Item | Where |
|---|---|
| Saved-query smart lists (`card_list.rule` JSONB + read-time evaluator) | needs its own branch; migration against live Supabase |
| Server-side settings (extend `user_settings`, `GET/PATCH /me/settings`, client hydrates with localStorage as offline cache) | covers Deck-E visibility, skin, topbar, showcase, series prefs |
| List cover as a card mosaic | replaces `cover_card_variant_id` single-art crop |
| Variant-scoped decks | `roadmap/plans/variant-scoped-decks.md` — live-DB PK change, wants a backup and a scratch-copy dry run |

---

## Running the backfill — ORDER MATTERS

`price_observation` is EMPTY on Supabase: `scripts/migrate-to-cloud.mjs:74`
never copied it. So:

1. `price-backfill.yml` first (archives → `price_observation`), 2024-08-29 → today.
2. `prices snapshot-backfill --from=… --to=…` second (ledgers → `collection_value_point`).

Reversed, step 2 skips every day with "no price observation within N days" — the
honest answer to the wrong question.

Measured cost, after joining to this catalogue: **28,622 rows per day**, so two
years is ~20.9M rows / ~2.9 GB. (44,385 rows per archived day carry a market
price; the rest are sealed product and groups this catalogue does not carry.)

## Done gate

1. `pnpm --filter @deckpal/db build && pnpm --filter @deckpal/storage build &&
   pnpm --filter @deckpal/agent-tools build`, then the workspace `tsc --noEmit`,
   clean.
2. `pnpm --filter deckpal-api test:deck` green, including the new drift test (1.6).
3. Browser verification at desktop width **and** 390px, signed in as the QA
   account from `.qa-account` (B12): a list card opens, the chart is round, the
   ranges differ, the TCG tab reads.
4. `/api/health` shows `prices-tcgcsv` finishing on the new schedule, and the
   Insights chart shows an unbroken line across 8/9→8/29 after the backfill.
5. `DECISIONS.md` entry; `DEPLOYMENT.md` §6 corrected (it currently states the
   price jobs are *not* wired to Actions); wiki Decision-Log + Contribution-Record.
