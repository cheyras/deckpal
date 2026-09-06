-- 049 · The card's printed body text, in the form the scanner can compare:
--       card.flavor_text (the one upstream field nobody was keeping) and
--       card_text (the derived, indexed comparison bag).
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHAT THIS IS FOR
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The OCR ladder (apps/api/src/scan/resolve.ts) reads the bottom strip and the
-- title. When BOTH of those fail — a glare on the strip, a full-art title over
-- artwork — the device has one thing left to send: the text in the middle of the
-- card. Attacks, ability, rules text, the flavour line.
--
-- That text answers a strictly weaker question than the printed key does. It
-- identifies the card FAMILY — every printing of one playable card carries the
-- same attacks and the same rules text, which is exactly why it can be reprinted
-- — and it can never identify WHICH printing you are holding. So this is an
-- escalation rung that returns a confident answer only when the family it lands
-- on has exactly one printing, and otherwise hands the family's printings back
-- as candidates for a human to choose between.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- MOST OF THE TEXT WAS ALREADY HERE. ONE FIELD WAS NOT.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 003 already stores everything gameplay-bearing: `card_attack` (name, damage,
-- effect, cost), `card_ability` (kind, name, effect) and `card.effect` for
-- trainer/energy rules text, all of it written by the catalog importer on every
-- sync. Nothing needed adding for those.
--
-- `description` — the flavour/Pokédex line printed under the attacks — was the
-- exception, and for the same reason `abbreviation` was missing until 048:
-- `RawCard` in apps/sync/src/catalog/import.ts simply had no member for it, so
-- the importer parsed past it every week. Upstream publishes it (verified
-- against the live TCGdex resource for sv01-014, sv01-039 and sv03.5-025 on
-- 2026-09-06); roughly the whole Pokémon half of the catalogue carries one and
-- Trainers carry none.
--
-- It is stored RAW, in its own column, and not merely folded into the bag below,
-- because the bag is lossy by design (case, accents, punctuation and word order
-- all gone). A column you cannot rebuild the bag from is a column that pins the
-- normaliser forever.

ALTER TABLE card ADD COLUMN flavor_text TEXT;

COMMENT ON COLUMN card.flavor_text IS
  'TCGdex Card.description, verbatim: the flavour/Pokedex line printed below '
  'the attacks. Pure upstream mirror, overwritten by every catalog sync. NULL '
  'on Trainers and Energy, which print none, and on Pokemon upstream has no '
  'line for — NULL is "not printed / not published", never "not yet fetched". '
  'Read by the scanner''s family-text rung via card_text; nothing else consumes '
  'it yet.';

-- ══════════════════════════════════════════════════════════════════════════════
-- WHY A DERIVED TABLE AND NOT A QUERY OVER THE THREE THAT ALREADY EXIST
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Because the read is "which cards share rare words with these 24 OCR lines",
-- and answering that from card_attack + card_ability + card.effect means
-- normalising every row of three tables on every request. The normalisation is
-- not free and it is not expressible in SQL without duplicating it there:
-- accents fold, `{C}` energy placeholders vanish, digits go, apostrophes go
-- (packages/db/src/cardText.ts is the single definition, imported by the writer
-- in apps/sync and by the reader in apps/api so the two cannot drift).
--
-- So the bag is materialised once per card per sync, and the prefilter is one
-- GIN `&&` against an array. One row per card, ~23.5k rows.
--
-- 🔴 This table holds a COMPARISON FORM, not content. Never render it, never
-- diff it against upstream, never treat a change in it as a catalogue change.
-- The authority for what a card says is card_attack / card_ability /
-- card.effect / card.flavor_text; this is those four, folded.

CREATE TABLE card_text (
  card_id            BIGINT PRIMARY KEY REFERENCES card(id) ON DELETE CASCADE,
  normalizer_version SMALLINT NOT NULL,
  body               TEXT   NOT NULL,
  tokens             TEXT[] NOT NULL
);

COMMENT ON TABLE card_text IS
  'One row per card: its printed body text (attacks, ability, rules text, '
  'flavour line) folded to the comparison form the OCR family-text rung comes '
  'in on. DERIVED — rebuilt wholesale by the catalog importer, safe to TRUNCATE '
  'and re-sync, and holding no user data and no upstream claim of its own. '
  'Absent or empty is a supported state: apps/api/src/scan/resolve.ts skips the '
  'rung entirely and the ladder behaves exactly as it did before 049.';

COMMENT ON COLUMN card_text.normalizer_version IS
  'CARD_TEXT_NORMALIZER_VERSION from packages/db/src/cardText.ts as of the sync '
  'that wrote this row. The reader compares it against the version IT speaks '
  'and skips rows that disagree, because a half-migrated table — some rows '
  'folded one way, some another — is the single state in which this rung could '
  'quietly match the wrong family. Bump the constant on any change to the '
  'folding and let the next sync rewrite every row.';

COMMENT ON COLUMN card_text.body IS
  'The normalised text, joined, in reading order. Not currently read by the '
  'matcher, which is a token-set scorer — it is kept because the token array is '
  'a SET and has thrown word order and repetition away, and any future phrase '
  'or trigram pass would otherwise have to re-derive this from four tables.';

COMMENT ON COLUMN card_text.tokens IS
  'Deduped, sorted content tokens: accents folded, {C} energy placeholders '
  'removed, apostrophes removed, digit-only tokens removed (damage, HP and '
  '"draw 7" are the most OCR-fragile and least discriminative glyphs on a '
  'card), English function words removed. Deliberately EXCLUDES the card name — '
  'the device only sends body text when the name could not be read, so a name '
  'token here could only ever be matched by accident — and excludes attack '
  'energy costs, which the card prints as coloured circles and never as the '
  'word "psychic".';

-- The prefilter, and the only query shape this table has: `tokens && $1`, where
-- $1 is a handful of the read's rarer tokens. GIN is the array-containment index
-- and `&&` is one of its indexable operators.
--
-- No index on `body`. It has no query, and a trigram index over 23.5k rows of
-- rules text would cost more than the whole rest of this migration to maintain
-- for a scorer that does not exist yet.
CREATE INDEX card_text_tokens_idx ON card_text USING GIN (tokens);
