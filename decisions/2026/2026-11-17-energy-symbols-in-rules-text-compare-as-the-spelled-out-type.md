---
date: "2026-11-17"
title: "Energy symbols in rules text compare as the spelled-out type"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["catalog", "agents", "decks"]
supersedes: []
---
## 2026-11-17 — Energy symbols in rules text compare as the spelled-out type
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** When rules text is HASHED (`playable_fingerprint`) or SEARCHED (`search_cards`' `text`
filter, the REST `/search` `attack`/`ability` filters), Energy symbols are folded to the spelled-out
type word: `{G}` Grass, `{R}` Fire, `{W}` Water, `{L}` Lightning, `{P}` Psychic, `{F}` Fighting,
`{D}` Darkness, `{M}` Metal, `{N}` Dragon, `{Y}` Fairy, `{C}` Colorless, and the 30th Celebration
`<span class="energy-symbol …">Word</span>` markup becomes its word. One pure function
(`canonicalEnergyText`) and its SQL twin (`canonicalEnergyTextSql`), built from the same table in
`packages/db/src/energyText.ts` (`@deckpal/db/energyText`). The stored catalogue text is NOT
rewritten, by the importer or by a migration.

**Why:** TCGdex writes the same ink three ways depending on the printing — Delphox me04-013 "discard
a Basic {R} Energy card" vs its reprint mep-074 "a Basic Fire Energy card"; Moltres 30th-011 "Fire"
vs mep-096 "{R}". The fingerprint hashed those differently, so `search_cards` called functional
reprints "2 DIFFERENT CARDS" and cheapest-printing advice broke for them; and a text search for
"Basic Fire Energy" never saw a "{R}" card (Oricorio ex, Emboar, Hearthflame Mask Ogerpon…).

- **Word, not symbol, is the canonical form** because only symbol -> word is unambiguous. `{R}`
  always means Fire; the word "Fire" is also in attack names ("Fire Spin"), card names and flavour,
  so word -> symbol would have to guess. It is also what people type.
- **Comparison-side, not ingest-side.** Rewriting stored text would change what `get_card` and the
  web show (the printed card has a symbol, and the sim keys card scripts by printed text), would need
  a migration or a full re-import to reach existing rows, and would still leave the next upstream
  spelling to drift. Folding where text is compared fixes every existing row with a recompute and
  no data rewrite.
- **Scope is rules text only.** Card NAMES ("Basic {R} Energy" vs "Fire Energy") and attack COSTS
  (already words upstream) are not folded, so nothing can merge on a name, and `{X}` (a variable
  count) and any unknown letter are left alone. Text with no symbol returns the same string, so its
  hash does not move (a test pins a pre-change hash).

**Implications:**
- **Post-merge, once:** `pnpm --filter deckpal-api fingerprint:index --all`, then
  `pnpm --filter deckpal-api identical-prints:index`. Until then stored fingerprints of symbol-bearing
  cards are on the old definition (the grouping bug persists; nothing breaks). `IS DISTINCT FROM`
  means only rows whose hash actually moved are written.
- The fold is upper-case-only in SQL (the catalogue's spelling) and case-insensitive in TS (search
  terms). A bare `{R}` search term now also matches attack names containing "Fire".
- `@deckpal/db/cardText` (the scanner's body-text bag) is unaffected: it already drops brace tokens.
- Any new rules-text comparison should go through `@deckpal/db/energyText`, not its own regex.
