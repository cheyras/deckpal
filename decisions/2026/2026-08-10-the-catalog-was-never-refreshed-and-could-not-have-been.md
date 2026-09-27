---
date: "2026-08-10"
title: "The catalog was never refreshed, and could not have been"
decided_by: "Claude Opus 5 on behalf of @cheyras, investigating issue #21."
areas: ["catalog"]
supersedes: []
---
## 2026-08-10 — The catalog was never refreshed, and could not have been
**Decided by:** Claude Opus 5 on behalf of @cheyras, investigating issue #21.

Issue #21 reported a missing 087 Binacle in MEP Black Star Promos and guessed it
was not the only gap. It was not. The reporter's instinct was the finding.

### What was actually wrong

`data/catalog/en/*.json` is a point-in-time extract of `tcgdex/server:edge`. Ours
was pulled 2026-07-24 from an image built 2026-07-22 and had never been replaced.
Local `pokedex` and cloud Supabase agreed exactly — 23,444 cards, MEP stuck at 60
with a top localId of 080 — so this was never a migration-staleness problem
between the two databases. Both were faithfully importing the same stale file.
Sets do not stop growing at release: MEP has since gone 60 → 89 cards, filling in
046–063, 072–073 and 081–088. 087 Binacle is in that fill.

Against the current upstream (image built 2026-08-09) the snapshot was short 222
card ids. 120 of those are the same Trainer Gallery cards under new ids (below),
so **102 cards genuinely did not exist in the app**, across six sets:

| Missing | Set | |
|---:|---|---|
| 29 | `tk-hs-r` | HS Trainer Kit (Raichu) |
| 29 | `tk-hs-g` | HS Trainer Kit (Gyarados) |
| 29 | `mep` | MEP Black Star Promos ← the reported one |
| 11 | `tk-sm-r` | SM Trainer Kit (Alolan Raichu) |
| 3 | `swshp` | SWSH Black Star Promos |
| 1 | `ecard2` | Aquapolis |

### Why nobody had simply re-run the import

Because it would have failed. Two latent importer defects, each of which aborts
the **entire** run rather than skipping a row — so the catalog was not merely
un-refreshed, it was un-refreshable:

1. **Upstream re-keyed four sets without renaming them.** The SWSH Trainer
   Gallery subsets went `swsh9.5tg` → `swsh9tg` (and 10/11/12 likewise), taking
   every card id with them. `card_set` upserts on `(series_id, tcgdex_id)`, so
   the re-keyed set looks brand new and gets INSERTed — into the
   `(series_id, slug)` UNIQUE that its own old row still holds. A single upstream
   rename freezes the whole catalog, every set, indefinitely.

2. **Retired variants keep their `sort_order` forever.** `card_variant` upserts on
   `(card_id, variant_kind_code)`, so a printing upstream has since dropped is
   never touched again. The first time upstream reshuffles a card's
   `variants_detailed`, a live variant is handed a slot a dead row still occupies.
   `(card_id, sort_order)` is DEFERRABLE INITIALLY DEFERRED, so this does not fail
   on the offending statement — it detonates at COMMIT and takes the set's whole
   transaction with it. Measured: **5,081 retired rows across 77 sets, 847 of them
   colliding.**

**Decision:** fix both in `apps/sync/src/catalog/import.ts` rather than hand-patch
the data. Renames are re-keyed in place (`card_set.tcgdex_id` plus every
`card.tcgdex_id` under it) before the per-set loop, detected narrowly — same slug,
different id, and the id we hold no longer published upstream — so two live sets
that merely share a name are left for a human. Retired variants are *parked* above
the live range, never pruned: `collection_item`, `deck_card`, `list_item`,
`graded_card` and `user_showcase` all point at `card_variant`, and B8 says an
import never destroys user-owned data. A user who owns a printing upstream has
retired keeps it; it simply sorts last.

Identity is the bigint PK throughout, so nothing user-owned moves. Verified: the
four set rows kept ids 177/178/183/184, and `collection_item` was **byte-identical**
before and after (454 rows / 976 quantity / 408 distinct cards, 7 decks), with zero
orphaned collection or deck rows and zero duplicate `(card_id, sort_order)` pairs.

### Result

Cloud went 23,444 → **23,546 cards**, and every set now matches upstream exactly
(23,546/23,546 — no set is short by even one card). MEP 60 → 89. Verified in a real
browser on deckpal.app as a throwaway confirmed user: `/series/mega-evolution/mep`
shows 89 cards, Binacle #087 opens, and **it added to the collection** — the
reporter's actual complaint — with zero console errors and zero HTTP ≥ 400. The
throwaway user was then deleted and the cascade removed its row.

### Runbook — this is the part that must not be forgotten

`scripts/refresh-catalog.sh` now encodes the whole refresh: pull the image, extract
via `docker create` + `docker cp` (B3 — the TCGdex server is never started; it
statically imports all 18 languages per worker and will OOM this box), report the
card delta, then import. `ENV_FILE=.env.cloud` targets Supabase.

**There is still no automation.** The `catalog` entry in `apps/sync/src/index.ts`
is a logging stub, and no GitHub Actions workflow runs it — which is precisely why
this rotted for 2.5 weeks and surfaced as a bug report rather than a sync log. The
importer is now robust enough to schedule; wiring the weekly job (Actions, where
Docker is available per ARCHITECTURE §8) is the actual fix for the recurrence and
is deliberately left as an explicit follow-up rather than a unilateral scheduled
job that writes to production.

**Known follow-up (images lane):** card art is keyed on the set's `tcgdex_id` (B6),
so the four re-keyed sets left 240 `image_asset` rows stranded under the old path —
120 Trainer Gallery cards now serve placeholders. The bytes still exist; re-keying
those rows and moving the objects would restore them without refetching. Separately,
new promos routinely have data before art: MEP 087 renders "no image" because
`assets.tcgdex.net/en/me/mep/087` is a genuine 404 upstream. 894 cards in total
currently lack cloud art. The importer now warns loudly when a rename orphans art.

