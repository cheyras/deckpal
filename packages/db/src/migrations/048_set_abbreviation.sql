-- 048 · The printed set code, catalogue half: card_set.abbreviation + prints_set_code.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHAT THIS IS FOR
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The scanner's OCR pass reads the badge in a card's bottom strip — `SVI`, `PBL`
-- — and has to turn it into a set id. `(printed code, collector number)` is
-- unique across 20,444 of the 21,068 physical cards in this catalogue: 100.0%,
-- ZERO collisions (roadmap/plans/card-scanner-redesign/p2-work/ocr/CROSSWALK.md
-- §4). That is a stronger key than anything the phash index can produce, and it
-- is the only evidence that separates the wrong top-1s `apps/api/src/scan/
-- router.ts` already documents in its own comment: "the rare wrong top-1s are
-- near-identical same-art reprints at distance 1-6". A Floragato reprint at
-- Hamming distance 3 loses to a `SVI 014` exact key every time.
--
-- We were already fetching the code every week and throwing it away. TCGdex
-- publishes it as `Set.abbreviation.official` on 188 of 218 sets, collision-free
-- across every era; `apps/sync/src/catalog/import.ts`'s `RawSet` interface
-- simply had no member for it (CROSSWALK §2.3). This migration gives the
-- importer somewhere to put it.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHY TWO COLUMNS AND NOT ONE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- "TCGdex has an abbreviation for this set" and "the physical card prints it"
-- are different claims, and only the first has an upstream field. English
-- Pokémon cards began printing a text set code with Scarlet & Violet on
-- 2023-03-31 — not 2002, not 2016. Before that the bottom strip carries a set
-- SYMBOL graphic and no text at all (verified against real scans of swsh9-018,
-- xy1-001, base1-004, base2-001; CROSSWALK §1.3). That is 16,264 of 21,068
-- physical cards, 77%, for which `abbreviation` is a catalogue label and an OCR
-- target that does not exist.
--
-- So `abbreviation` mirrors upstream and `prints_set_code` records a fact about
-- a physical object that no upstream field asserts. Conflating them would give
-- the scanner 188 badges to look for where only 29 are printed.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- NEITHER COLUMN IS THE AUTHORITY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 003 line 34 already made this ruling once, for `ptcgl_code`: "seed from
-- Set.tcgOnline, never trust it; authority is ptcgl_set_alias". Same ruling,
-- same reasons, and the second reason is the load-bearing one:
--
--   1. A human-verified fact belongs in a reviewable diff, not in a column.
--   2. The importer's ON CONFLICT ... DO UPDATE would clobber any backfill on
--      the next weekly catalog sync. `apps/api/src/deck/data/_provenance.json`
--      records that hazard verbatim for `ptcgl_code`; it applies here unchanged.
--
-- The authority for the OCR path is the vendored
-- `apps/api/src/scan/data/printed-set-code.json` (29 rows — the whole printed
-- universe fits on one screen and grows by ~4 rows a year). These columns exist
-- so a SQL-side query can narrow without a round trip through that file, and so
-- a startup/CI check can diff the two and shout when upstream ships a set the
-- file has not been taught about yet.

ALTER TABLE card_set ADD COLUMN abbreviation TEXT;

COMMENT ON COLUMN card_set.abbreviation IS
  'TCGdex Set.abbreviation.official, verbatim: ''SVI'', ''PBL'', ''BRS:TG''. '
  'A CATALOGUE abbreviation — present on 188/218 sets across every era, '
  'collision-free upstream, and NOT a claim that the physical card prints it '
  '(see prints_set_code). Three namespaces exist and none of them is this one: '
  'ptcgl_code is the deck-list namespace (PR-SV where the card says SVP), '
  'ptcgl_set_alias is its hand-verified authority, and TCGplayer Mass Entry '
  'uses a third (DECK-FORMATS §1.9). NEVER trust this column as an OCR target '
  'and never join the three — CROSSWALK §2.2 measures where they disagree. '
  'Overwritten wholesale by every catalog sync; do not backfill it by hand.';

ALTER TABLE card_set ADD COLUMN prints_set_code BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN card_set.prints_set_code IS
  'Whether the PHYSICAL English card prints `abbreviation` in its bottom strip. '
  'FALSE for every set before Scarlet & Violet (2023-03-31): those print a set '
  'SYMBOL graphic and no text, so there is nothing for OCR to read. No upstream '
  'field asserts this — it is hand-verified against real card scans, which is '
  'exactly why the authority is the vendored '
  'apps/api/src/scan/data/printed-set-code.json and never this column. Seeded '
  'below for the 29 sets known printed as of 2026-09-05; it does NOT '
  'self-maintain, so a new printed-era set needs a row in that file (the '
  'startup cross-check in apps/api/src/scan/printedSetCode.ts logs the '
  'divergence) and, if a SQL-side filter ever depends on it, a new migration.';

-- Seed the 29 printed-era sets (CROSSWALK §2.5). Scoped to the EN catalogue
-- because the claim is about English cards: Japanese SV-era cards print a badge
-- too, but a mixed-case one with no `EN` subscript and a different id space
-- (`SV1a`, `M-P`), and `catalogue.jp` is is_enabled = FALSE anyway (§3.5).
--
-- Two of these 29 are asserted on TCGdex's say-so rather than on a scan:
-- `2023sv`/`2024sv` (MCD23/MCD24) and `mfb` (MFB) have no art upstream and
-- serve placeholders from our own CDN, so nobody has seen what they print
-- (CROSSWALK §3.6, §9 item 1). They are seeded TRUE because they sit inside the
-- printed era and TCGdex assigns them abbreviations; the vendored file carries
-- the same three rows flagged `"verified": false`, which is where that doubt is
-- allowed to affect a lookup. Note MCD23/MCD24 are five characters, breaking a
-- naive ^[A-Z]{3}$ badge regex, and are the era's ONLY 1-edit code pair the
-- denominator does not separate (both /15).
UPDATE card_set cs
   SET prints_set_code = TRUE
  FROM series s
 WHERE s.id = cs.series_id
   AND s.catalogue_code = 'en'
   AND cs.tcgdex_id IN (
     -- Scarlet & Violet (2023-03-31 →)
     'sve', 'svp', 'sv01', 'sv02', 'sv03', 'sv03.5', 'sv04', 'sv04.5',
     'sv05', 'sv06', 'sv06.5', 'sv07', 'sv08', 'sv08.5', 'sv09', 'sv10',
     'sv10.5w', 'sv10.5b',
     -- Mega Evolution
     'mee', 'mep', 'me01', 'me02', 'me02.5', 'me03', 'me04', 'me05',
     -- inside the era, printing unverified (see above)
     '2023sv', '2024sv', 'mfb'
   );

-- ══════════════════════════════════════════════════════════════════════════════
-- NO INDEX ON abbreviation, DELIBERATELY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- CROSSWALK §8.1 sketches `CREATE INDEX ... ON card_set (upper(abbreviation))`.
-- Not taken: `card_set` holds 218 rows — one page — so Postgres will choose a
-- sequential scan over any index here and should. More to the point the badge →
-- set lookup the scanner actually runs never reaches this column at all: it is
-- answered from the 29-row vendored JSON in process memory, because the lookup
-- needs the printed DENOMINATOR alongside the code (CROSSWALK §4.1) and that is
-- a fact this table cannot express — `card_count_official` is 24 for SVE and 225
-- for SVP, neither of which is printed on any card.
