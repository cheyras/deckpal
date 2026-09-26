-- Deliberately focused fixture schema for decks.mjs: only the columns the deck
-- version writer, the format pool predicate and the search route read. Loaded
-- only after decks.mjs verifies the runner-owned socket and data directory.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE series (id bigint PRIMARY KEY, tcgdex_id text NOT NULL, slug text NOT NULL, name text NOT NULL);
CREATE TABLE card_set (
  id bigint PRIMARY KEY, tcgdex_id text NOT NULL, name text NOT NULL, series_id bigint NOT NULL REFERENCES series(id)
);
CREATE TABLE card (
  id bigint PRIMARY KEY, tcgdex_id text NOT NULL, local_id text NOT NULL, name text NOT NULL,
  lang text NOT NULL DEFAULT 'en', set_id bigint NOT NULL REFERENCES card_set(id),
  category text NOT NULL, energy_type text, regulation_mark text, playable_fingerprint char(64),
  rarity text, illustrator text, hp integer, released_on date, number_sort text NOT NULL
);
CREATE TABLE variant_kind (code text PRIMARY KEY, display_name text NOT NULL);
CREATE TABLE card_variant (
  id bigint PRIMARY KEY, card_id bigint NOT NULL REFERENCES card(id),
  variant_kind_code text NOT NULL REFERENCES variant_kind(code), display_name text,
  is_primary boolean NOT NULL, sort_order integer NOT NULL
);
CREATE TABLE price_current (
  card_variant_id bigint, source_code text, currency_code text, market_minor bigint
);

-- Deck tables as migrations 011/019/020/051 shape them, minus RLS and soft delete.
CREATE TABLE deck (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, format_code text NOT NULL,
  version integer NOT NULL DEFAULT 1, strategy_md text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE deck_card (
  deck_id uuid NOT NULL REFERENCES deck(id) ON DELETE CASCADE, card_id bigint NOT NULL REFERENCES card(id),
  card_variant_id bigint NOT NULL REFERENCES card_variant(id), user_id uuid NOT NULL,
  quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 60),
  PRIMARY KEY (deck_id, card_variant_id)
);
CREATE TABLE deck_version (
  deck_id uuid NOT NULL REFERENCES deck(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1), format_code text NOT NULL, cards jsonb NOT NULL,
  strategy_md text, note text, source text NOT NULL DEFAULT 'web', user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deck_id, version)
);
CREATE TABLE battle_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, deck_id uuid NOT NULL, deck_version integer NOT NULL,
  FOREIGN KEY (deck_id, deck_version) REFERENCES deck_version (deck_id, version) ON DELETE CASCADE
);

INSERT INTO series VALUES
  (1, 'sv', 'scarlet-violet', 'Scarlet & Violet'), (2, 'swsh', 'sword-shield', 'Sword & Shield'),
  (3, 'base', 'base', 'Base'), (4, 'bw', 'black-white', 'Black & White'), (5, 'sm', 'sun-moon', 'Sun & Moon');
INSERT INTO card_set VALUES
  (1, 'sv05', 'Temporal Forces', 1), (2, 'swsh12', 'Silver Tempest', 2), (3, 'base1', 'Base Set', 3),
  (4, 'bw1', 'Black & White', 4), (5, 'smp', 'SM Black Star Promos', 5), (6, 'sv08', 'Surging Sparks', 1);

-- Each row is a case for the pool rule; `fp` is its playable fingerprint.
--   1  H mark                                   → in every pool
--   2  G mark, English J-mark twin (3)          → Standard by reprint
--   4  G mark, no twin, Sword & Shield set      → not Standard; Expanded by set/mark
--   5  no mark, Base Set                        → in no pool
--   6  no mark, Black & White set               → Expanded by set only
--   7  basic Energy, Base Set print, no mark    → in every pool (§3.3)
--   8  special Energy, Base Set, no mark        → in no pool
--   9  G mark whose only J twin is Japanese (10) → not Standard: the oracle counts English reprints only
--  11  no mark, SM promo                        → Expanded by set only
--  12  J mark                                   → in every pool
INSERT INTO card (id, tcgdex_id, local_id, name, lang, set_id, category, energy_type, regulation_mark, playable_fingerprint, number_sort) VALUES
  (1,  'sv05-051',   '051',   'Pikachu',                 'en', 1, 'Pokemon', NULL,      'H',  lpad('1', 64, '0'), '000000051'),
  (2,  'swsh12-162', '162',   'Lost Vacuum',             'en', 2, 'Trainer', NULL,      'G',  lpad('2', 64, '0'), '000000162'),
  (3,  'sv08-200',   '200',   'Lost Vacuum',             'en', 6, 'Trainer', NULL,      'J',  lpad('2', 64, '0'), '000000200'),
  (4,  'swsh12-100', '100',   'Zamazenta',               'en', 2, 'Pokemon', NULL,      'G',  lpad('4', 64, '0'), '000000100'),
  (5,  'base1-58',   '58',    'Pikachu',                 'en', 3, 'Pokemon', NULL,      NULL, lpad('5', 64, '0'), '000000058'),
  (6,  'bw1-40',     '40',    'Zekrom',                  'en', 4, 'Pokemon', NULL,      NULL, lpad('6', 64, '0'), '000000040'),
  (7,  'base1-100',  '100',   'Lightning Energy',        'en', 3, 'Energy',  'Normal',  NULL, lpad('7', 64, '0'), '000000100'),
  (8,  'base1-96',   '96',    'Double Colorless Energy', 'en', 3, 'Energy',  'Special', NULL, lpad('8', 64, '0'), '000000096'),
  (9,  'swsh12-079', '079',   'Comfey',                  'en', 2, 'Pokemon', NULL,      'G',  lpad('9', 64, '0'), '000000079'),
  (10, 'sv05-ja-79', '79',    'Comfey',                  'ja', 1, 'Pokemon', NULL,      'J',  lpad('9', 64, '0'), '000000079'),
  (11, 'smp-SM108',  'SM108', 'Ash''s Pikachu',          'en', 5, 'Pokemon', NULL,      NULL, lpad('11', 64, '0'), '00000SM108'),
  (12, 'sv08-057',   '057',   'Pikachu',                 'en', 6, 'Pokemon', NULL,      'J',  lpad('12', 64, '0'), '000000057');
INSERT INTO variant_kind VALUES ('normal', 'Normal');
INSERT INTO card_variant SELECT 100 + id, id, 'normal', NULL, true, 0 FROM card;
