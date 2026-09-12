-- Deliberately focused fixture schema, not the production migration/RLS suite.
-- Loaded only after routes.mjs verifies the runner-owned socket and data directory.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

CREATE TABLE catalogue (code text PRIMARY KEY, is_enabled boolean NOT NULL);
CREATE TABLE series (
  id bigint PRIMARY KEY, tcgdex_id text, slug text, name text,
  first_release_on date, sort_order integer, catalogue_code text REFERENCES catalogue(code)
);
CREATE TABLE card_set (
  id bigint PRIMARY KEY, tcgdex_id text, slug text, name text, released_on date,
  card_count_official integer, card_count_total integer, is_promo boolean,
  logo_url text, symbol_url text, series_id bigint REFERENCES series(id)
);
CREATE TABLE card (id bigint PRIMARY KEY, tcgdex_id text, lang text, set_id bigint REFERENCES card_set(id));
CREATE TABLE user_set_progress (
  set_id bigint, user_id text, goal text, owned_required integer, total_required integer, set_level integer
);
CREATE TABLE variant_kind (code text PRIMARY KEY, display_name text);
CREATE TABLE card_variant (
  id bigint PRIMARY KEY, card_id bigint REFERENCES card(id), variant_kind_code text REFERENCES variant_kind(code),
  display_name text, sort_order integer
);
CREATE VIEW variant_tier_resolved AS SELECT id AS card_variant_id, 'standard'::text AS tier FROM card_variant;
CREATE TABLE price_bucket (
  card_variant_id bigint, grain text, bucket_start date, currency_code text,
  open_minor bigint, high_minor bigint, low_minor bigint, close_minor bigint,
  high_on date, low_on date, mean_minor numeric, median_minor numeric, n_obs integer
);
CREATE TABLE price_observation (
  card_variant_id bigint, currency_code text, captured_at timestamptz, market_minor bigint
);

INSERT INTO catalogue VALUES ('en', true);
INSERT INTO series VALUES
  (1, 'me', 'mega-evolution', 'Mega Evolution', '2025-09-26', 2, 'en'),
  (2, 'unknown', 'unknown', 'Unknown date series', NULL, 1, 'en');
INSERT INTO card_set (id, tcgdex_id, slug, name, released_on, card_count_official, card_count_total, is_promo, series_id)
VALUES
  (1, 'newer', 'newer', 'Newer real set', '2026-10-01', 1, 1, false, 1),
  (2, 'older', 'older', 'Older real set', '2026-08-01', 1, 1, false, 1),
  (3, 'same-z', 'same-z', 'Z same-day set', '2026-01-01', 1, 1, false, 1),
  (4, 'same-a', 'same-a', 'A same-day set', '2026-01-01', 1, 1, false, 1),
  (5, 'null-z', 'null-z', 'Z unknown', NULL, 1, 1, false, 1),
  (6, 'null-a', 'null-a', 'A unknown', NULL, 1, 1, false, 1),
  (7, 'zero-card', 'zero-card', 'Zero-card catalog artifact', '2027-01-01', 0, 0, false, 1),
  (8, 'september', 'september', 'September real set', '2026-09-16', 1, 1, false, 1);
INSERT INTO card
  SELECT id, CASE WHEN id = 1 THEN 'base1-1' ELSE 'fixture-' || id END, 'en', id
  FROM card_set WHERE id <> 7;
INSERT INTO variant_kind VALUES ('normal', 'Normal');
INSERT INTO card_variant
  SELECT i, 1, 'normal', 'Printing ' || i, i FROM generate_series(1, 3) AS i;
-- UTC capture times and a fixed DB timezone make the rolling 30-day fixture
-- independent of the Node process timezone and the future wall-clock date.
INSERT INTO price_observation
  SELECT v.id, currency, ((CURRENT_DATE - 30 + day_index)::timestamp + interval '12 hours') AT TIME ZONE 'UTC',
         CASE WHEN day_index = 0 THEN 0 ELSE v.id * 1000 + day_index END
  FROM card_variant v
  CROSS JOIN generate_series(0, 30) AS day_index
  CROSS JOIN (VALUES ('JPY'), ('USD')) AS currencies(currency);
-- A second lower quote and null quote prove the real daily aggregate/filter.
INSERT INTO price_observation
  SELECT 3, 'JPY', CURRENT_DATE::timestamp AT TIME ZONE 'UTC', value
  FROM (VALUES (1::bigint), (NULL::bigint)) AS quotes(value);
-- Currency/range decoys must not appear in the 30-day JPY response.
INSERT INTO price_observation VALUES
  (1, 'EUR', CURRENT_DATE::timestamp AT TIME ZONE 'UTC', 999999),
  (1, 'JPY', (CURRENT_DATE - 65)::timestamp AT TIME ZONE 'UTC', 888888);
