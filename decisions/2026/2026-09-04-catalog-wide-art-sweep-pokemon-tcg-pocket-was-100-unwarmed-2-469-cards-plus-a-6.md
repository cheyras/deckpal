---
date: "2026-09-04"
title: "Catalog-wide art sweep: Pokémon TCG Pocket was 100% unwarmed (2,469 cards), plus a 6-card Double Crisis gap"
decided_by: "Not recorded"
areas: ["catalog"]
supersedes: []
---
## 2026-09-04 — Catalog-wide art sweep: Pokémon TCG Pocket was 100% unwarmed (2,469 cards), plus a 6-card Double Crisis gap

The owner's "I know there are more that we are missing" (previous entry) was
executed as its own task, against approved sources only: TCGdex (primary) and
pokemontcg.io (fallback) — no further Bulbagarden use. Full trace, method,
and the remaining-gap table: `roadmap/plans/card-scanner-redesign/p2-work/
art-sweep/SWEEP.md`.

**Method.** Read-only SQL against production Postgres (`.env.prod`): every
English card vs. every `image_object(tier='object')` row. Cheaper and more
authoritative than a CDN sweep, because `apps/api/src/images/handler.ts` only
ever writes that row after a successful upstream fetch — no row means no real
art, full stop. Found 3,252 gap cards across 59 sets, two classes of which
were on no prior residue list.

**Finding 1 — Pokémon TCG Pocket (`tcgp` series), 2,469 cards, 15 sets: not a
sourcing gap, a discovery gap.** TCGdex already has real art for these cards
(verified directly against the CDN) — they were simply never warmed, because
`GET /api/series` deliberately excludes `tcgp` (`apps/api/src/routes/
series.ts:96`, "a separate game, not an English TCG era" — a real product
decision: the dedicated `pocket-en` catalogue exists in schema but is seeded
disabled, and `tcgp` currently sits under the enabled `en` catalogue as a
staging step, reachable directly via `/api/sets/:id` but hidden from the main
series list). `apps/images/src/cloudWarm.ts` (`warm:cloud`) builds its
work-list by walking that same series list, so it silently produces zero jobs
for any `tcgp` set — confirmed by running it. Same root-cause shape as the
mee/sve finding (a whole set with no `image_asset` row from day one, invisible
to any sweep built from existing rows) but on a structural axis instead of a
per-card one, at ~150x the scale.

**Finding 2 — Double Crisis (`dc1`), 6 cards:** a small, previously
undocumented, ordinary sourcing gap (TCGdex 404s for exactly these six).
pokemontcg.io has all six at an exact 1:1 number+name match.

**Filled:** `dc1` 6/6 (`fill-dc1.mjs`, same shape as `fill-sve.mjs`) and
`tcgp` 2,257/2,469 (`fill-tcgp.mjs`, which reuses `cloudWarm.ts`'s exact
work-list shape and fetch mechanics but builds the set list from the 15 known
`tcgp` ids directly, working around the `/api/series` exclusion rather than
fixing it — that exclusion is a deliberate product decision, not this task's
to reverse). Both went through the same choke point as every prior fill
(`packages/storage/src/put-asset.ts`, `provenance: fromUrl(...)`). 0 upload
failures across both. Verified live (no `X-Placeholder`, correct `X-Cache`)
and viewed 4 cards across 4 different sets (`dc1-1` Team Magma's Numel,
`A1-001` Bulbasaur, `A3b-001` Tropius, `B2-001` Ledyba) — all correct art,
correct card.

**Remaining, 967 cards:** 206 (`B2a` Paldean Wonders in full, plus tails of
`P-A`, `B1`, `B1a`) still 404 at TCGdex and have no pokemontcg.io fallback
(confirmed: pokemontcg.io does not carry TCG Pocket at all) — read as an
upstream publishing lag on the newest Pocket sets rather than a closed door;
`fill-tcgp.mjs` is idempotent and worth re-running later. The other 761 are
the pre-existing `research/CARD-ART-SOURCES.md` / `card-art-unavailable.json`
residue (trainer kits in full, `mep`, `mfb`, `cel25cc`, McDonald's
Collections, e-card era, `exu`, promos), re-confirmed live today by
spot-checking five different classes against TCGdex — unchanged: TCGplayer
verifiably has much of it but is ruled out on ToS grounds, Bulbagarden's
general named-card crosswalk stays unresolved and uncommissioned beyond the
narrow energy-card exception already granted, and the rest has no source at
all.

**Not done, and flagged rather than assumed:** did not touch the `tcgp`
series exclusion, the `pocket-en` catalogue's `is_enabled` flag, any schema,
or any feature code — only image bytes through the existing choke point for
cards that already exist live in the `card` table (this task's stated
approved purpose). Whether TCG Pocket's current hidden-but-reachable state is
an intentional pre-launch stage is the owner's call, not inferred here; it is
named in `SWEEP.md` §2a so a future catalog import doesn't reproduce the same
invisible-to-`warm:cloud` gap from scratch.
