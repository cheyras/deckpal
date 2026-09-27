---
date: "2026-08-10"
title: "The deck lane also had the swsh*.5tg rename stranded (#21 sibling)"
decided_by: "agent, on behalf of @cheyras"
areas: ["decks"]
supersedes: []
---
## 2026-08-10 — The deck lane also had the swsh*.5tg rename stranded (#21 sibling)

**Decided by:** agent, on behalf of @cheyras
**Decision:** Re-keyed the four PTCGL Trainer Gallery aliases in
`apps/api/src/deck/data/ptcgl-set-alias.json` (`BRS-TG`, `ASR-TG`, `LOR-TG`,
`SIT-TG`) from the retired `swsh9.5tg`/`swsh10.5tg`/`swsh11.5tg`/`swsh12.5tg` to
the current `swsh9tg`/`swsh10tg`/`swsh11tg`/`swsh12tg`, and fixed the one
matching `set` value (Flapple TG02) in `banlist-expanded.json`.

**Why:** f5fb3e7 re-keyed the *image* tier for these four upstream TCGdex
renames (#21); the *deck-import* data files were a separate, un-migrated
reference to the same old ids and got missed by that pass. Verified against
both DBs (`.env` local `pokedex`, `.env.cloud` Supabase) that `card_set` only
has the new ids — no row anywhere still has `swsh9.5tg`/`10.5tg`/`11.5tg`/`12.5tg`.
Reproduced through the real code path, not just the JSON: parsing
`"1 Flareon BRS-TG 1"` and running it through `resolveDeck()` resolved to
`sv08.5-013` (a Scarlet & Violet promo Flareon) via the step-3 name-only
fallback — silently the *wrong card*, no warning — because step 1 (exact
set+number) and step 2 (name-in-set) both no-opped against a `card_set.tcgdex_id`
that no longer exists. After the fix the same line resolves `name_in_set` to
`swsh9tg-TG01`, the correct print. Cross-checked every `set` value in both
`ptcgl-set-alias.json` and `banlist-expanded.json` (and, for completeness, the
other three banlists) against `card_set.tcgdex_id`; these five references were
the only stale ones — `CRZ-GG`→`swsh12.5gg` and `CEL-CC`→`cel25cc` were not
part of the rename and are untouched.

**Implications:** These JSON files are copied verbatim into `dist/deck/data` at
build time (`apps/api`'s `build` script `cpSync`s `src/deck/data` →
`dist/deck/data`) — confirmed the currently-running build's copy still has the
stale ids. **A rebuild + redeploy of `deckpal-api` is required** for this fix
to reach production; not done here since another lane has `apps/api` mid-edit
(auth/identity refactor + the anonymous-catalog routes work) — left for the
orchestrator to sequence. Added a pure (no-DB) regression test,
`apps/api/src/deck/__tests__/data.test.ts`, wired into `test:deck` (CI): it pins
the four TG aliases to their current ids and sweeps every `set` value in the
alias table and all banlists for a reappearance of any of the four specific
retired ids, so the next upstream re-key of this kind fails CI instead of
silently mis-resolving a user's decklist. It cannot assert "every id is known to
the catalog" the way a DB-backed test could — the catalog only exists in
Postgres — so a genuinely new (not-yet-seen) stale id class would still need a
DB-backed check or another `prove.ts`-style manual pass to catch.

_Filed by agent on behalf of @cheyras — 2026-08-10._

