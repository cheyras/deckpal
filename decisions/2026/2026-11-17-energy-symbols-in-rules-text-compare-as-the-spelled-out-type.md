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
`<span class="energy-symbol Word" …>…</span>` markup becomes the type named in its class (so an
empty span is still its type, never ""). Every other HTML tag (`<\/?[a-zA-Z]…>`) is dropped, its
inner text kept; a bare angle bracket in prose ("HP < 50") is not a tag and stays. One pure function
(`canonicalEnergyText`) and its SQL twin (`canonicalEnergyTextSql`), built from the same table and
the same two regex sources in
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
  count) and any unknown letter are left alone. Only text with no `{X}` symbol AND no HTML tag
  returns the same string, so only its hash does not move (a test pins a pre-change hash). Text
  with a tag moves too: 30th Celebration `<em>` reminder text now hashes the same as the untagged
  printing, which is intended (same ink) and pinned by a test.

**Implications:**
- **The definition is self-healing; a mixed index is the real risk.** Rows hashed on the old
  definition next to rows on the new one are NOT harmless: `buildReprintOracle`
  (`apps/api/src/deck/db.ts`) answers reprint legality by fingerprint equality, so an old printing
  whose legal reprint was hashed on the other definition loses that reprint and validates
  `NOT_IN_FORMAT`. `fingerprint:index` without `--all` only fills NULL rows, so the weekly
  `scripts/refresh-catalog.sh` used to produce exactly that mix after any `fingerprint.ts` change.
  From this change the refresh runs `fingerprint:index --all` every time (idempotent; `IS DISTINCT
  FROM` writes only rows whose hash moved; ~23.5k rows, the same scan `identical-prints:index`
  already makes), so a definition change heals on the next refresh. A FINGERPRINT_VERSION column
  was considered and not taken: it would need a migration and still a full recompute to act on.
- **Post-merge:** to apply it before the next weekly refresh, run
  `pnpm --filter deckpal-api fingerprint:index --all`, then
  `pnpm --filter deckpal-api identical-prints:index`, back to back. Never the NULL-only form.
- **What changes after the reindex.** Symbol/word (and tagged/untagged) reprints become ONE card
  everywhere the fingerprint is read: deck validation (reprint legality and the `legal` format-pool
  filter, `formatPoolSql`), owned-print counting (`identical_print_group`, `deck/ownedPrints.ts`),
  and scanner family grouping (`apps/api/src/scan/catalogPort.ts`, whose family key is the
  fingerprint). That is the intended fix, and it widens what each of those accepts as "the same card".
- **Recommended pre-reindex check:** `fingerprint:index --all --dry-run` (writes nothing) reports
  how many rows, and which cards, would change; expect only symbol- or tag-bearing cards. Spot-check
  that newly merged groups that span regulation marks are genuine reprints (e.g. Delphox me04-013 /
  mep-074, Moltres 30th-011 / mep-096). After the real run,
  `collisionReport().namesWithSeveralCards` (the "card names are MORE THAN ONE CARD" line) should
  drop slightly, never to 0 (the CLI exits 1 at 0).
- The fold is upper-case-only in SQL (the catalogue's spelling) and case-insensitive in TS (search
  terms); a parity test pins `{r}` as the known difference. A bare `{R}` search term now also
  matches attack names containing "Fire". REST `/search` folds the term and the effect column but
  not the attack/ability NAME column (names never carry symbols).
- The SQL fold is gated (`CASE WHEN strpos(x,'{')>0 OR strpos(x,'<')>0 …`), so rows with neither
  character skip the regex and eleven `replace()`s; results are identical. The database integration
  suite (`apps/api/src/__integration__/energyText.mjs`) runs the SQL on real PostgreSQL against the
  TS function.
- **Duplicated table:** `@deckpal/sim` keeps its own symbol tables (`cards/clean-text.ts` SYMBOL,
  word -> symbol, and `cards/render.ts` TYPE_SYMBOL). The sim has no workspace dependencies and is
  not given one on `@deckpal/db` for eleven fixed pairs; change all three together.
- `@deckpal/db/cardText` (the scanner's body-text bag) is unaffected: it already drops brace tokens.
- Any new rules-text comparison should go through `@deckpal/db/energyText`, not its own regex.
