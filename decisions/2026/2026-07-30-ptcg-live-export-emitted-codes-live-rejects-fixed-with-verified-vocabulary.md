---
date: "2026-07-30"
title: "PTCG Live export emitted codes Live rejects; fixed with verified vocabulary"
decided_by: "Not recorded"
areas: ["catalog"]
supersedes: []
---
## 2026-07-30 — PTCG Live export emitted codes Live rejects; fixed with verified vocabulary
- **What was broken:** `GET /decks/:id/export?format=ptcgl` fell back to
  `tcgdex_id.toUpperCase()` for any set missing from `ptcgl-set-alias.json` — the
  whole ME era except me01 plus every vintage set. The user's real deck emitted
  `ME05`/`ME03`/`ME04`/`ME02.5`/`BASE1` codes (18 of 21 lines unimportable) and
  basic energy as `5 Psychic Energy BASE1 101`. PTCG Live rejects unknown codes
  **and leading-zero numbers** (community.pokemon.com "can't read numbers
  beginning with 0" — our serializer already stripped zeros, codes were the bug).
- **Set-code authority stays the vendored JSON, not `card_set.ptcgl_code`:** that
  column is TCGdex `tcgOnline` (dead since 2023-01, collides, and the catalog
  sync's `ON CONFLICT … SET ptcgl_code = EXCLUDED.ptcgl_code` would clobber any
  backfill on next run). Added ME-era codes to the JSON — PFL/ASC/POR/CRI/PBL —
  each verified two ways (limitlesstcg.com/cards index + per-card number matches
  in NAIC/JP-Championships 2026 decklists; chasedex.com as third source). Notes
  per entry in the JSON; `_provenance.json` updated.
- **Live pool floor is Sun & Moon** (Bulbapedia: Live's Expanded (Beta) "only
  allows cards printed from Sun & Moon onwards"). New `live:false` flag on XY/BW
  alias entries; sets older than BW deliberately have no entry. New
  `deck/export.ts` builds export lines: in-pool print → real code; out-of-pool →
  substitute a **playable_fingerprint-identical** Live reprint (conservative:
  exact rules-text match, newest wins — e.g. Primal Clash Switch → PFL 123), else
  bare-name line + structured warning (`NOT_ON_PTCGL`/`SUBSTITUTED_PRINT`), never
  an invented code. Warnings ride the export response and render in the export
  modal (amber panel).
- **Basic energy canonicalises to `Basic {X} Energy SVE <1-8>`** — PTCGL's own
  export spelling (7,713 corpus lines, DECK-FORMATS §1.5 case 2); Live grants
  unlimited basic energy so SVE always resolves regardless of the paper print.
  Consequence: basic energy round-trips by TYPE, not print (base1-101 → SVE 5 →
  newest basic Psychic on re-import) — by design. Energy names containing a type
  word render as PTCGL writes them: `Telepathic Psychic Energy` (me03-088) →
  `Telepathic {P} Energy POR 88` (§1.5 case 2b; NB TCGdex marks this card
  energy_type='Normal', so basic-detection keys on the *name* being exactly
  "<Type> Energy", never on energy_type alone). Curly apostrophes fold to
  straight; TCGdex parenthetical disambiguators are stripped.
- Verified: 36/36 deck tests (9 new in `__tests__/export.test.ts`); user's deck
  now exports 21/21 clean verified lines, round-trips through POST /decks/import
  with zero unresolved (20/21 identical print, energy by type); temp test decks
  deleted.

