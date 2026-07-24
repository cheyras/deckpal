-- 013 · Seed: the default user + the vocabulary tables the schema requires.
-- NOT catalog data (sets/cards/variants/prices) — that is the next task. Empty catalog is the goal.
-- Every INSERT is ON CONFLICT DO NOTHING so a re-run is a no-op.

-- ── catalogues (ROUTE-MAP §1.3-1.5) ─────────────────────────────────────────
INSERT INTO catalogue (code, label, route_prefix, is_enabled) VALUES
  ('en',       'English TCG',      '',                TRUE),
  ('jp',       'Japanese TCG',     '/jp',             FALSE),
  ('pocket-en','TCG Pocket (EN)',  '/tcg-pocket-en',  FALSE)
ON CONFLICT (code) DO NOTHING;

-- ── currencies (SCHEMA §7.2) — minor units ──────────────────────────────────
INSERT INTO currency (code, symbol, minor_unit) VALUES
  ('USD', '$', 2),
  ('EUR', '€', 2),
  ('JPY', '¥', 0)
ON CONFLICT (code) DO NOTHING;

-- ── price sources (SCHEMA §7.2) ─────────────────────────────────────────────
-- ⚠ RECONCILIATION (flagged): SCHEMA §7.2's inline comment labels id 3 "tcgdex-api", but the
--   field-map INSERTs (§7.3) and worked examples use codes 'tcgdex-tcgplayer' and
--   'tcgdex-cardmarket'. Reconciled to a coherent triple so the field-map FK and the id refs both
--   resolve: 1=tcgcsv(tcgplayer/USD/bulk), 2=tcgdex-cardmarket(EUR), 3=tcgdex-tcgplayer(USD).
INSERT INTO price_source (id, code, label, marketplace, default_currency, is_bulk, priority) VALUES
  (1, 'tcgcsv',            'TCGplayer (via TCGCSV bulk)', 'tcgplayer',  'USD', TRUE,  1),
  (2, 'tcgdex-cardmarket', 'Cardmarket (via TCGdex)',     'cardmarket', 'EUR', FALSE, 2),
  (3, 'tcgdex-tcgplayer',  'TCGplayer (via TCGdex)',      'tcgplayer',  'USD', FALSE, 3)
ON CONFLICT (id) DO NOTHING;

-- ── variant facet vocabularies — the MEASURED census (SCHEMA §4.5.2) ─────────
INSERT INTO variant_finish (code, label) VALUES
  ('normal','Normal'), ('reverse','Reverse Holofoil'), ('holo','Holofoil'),
  ('lenticular','Lenticular'), ('metal','Metal')
ON CONFLICT (code) DO NOTHING;

INSERT INTO variant_size (code, label) VALUES
  ('standard','Standard'), ('jumbo','Jumbo')
ON CONFLICT (code) DO NOTHING;

-- 19 non-null foils. is_organised_play (NOT pack-pulled): league, player-reward, professor-program.
INSERT INTO variant_foil (code, label, is_organised_play) VALUES
  ('energy','Energy',FALSE), ('cosmos','Cosmos',FALSE), ('pokeball','Poke Ball Pattern',FALSE),
  ('masterball','Master Ball Pattern',FALSE), ('rainbow','Rainbow',FALSE), ('gold','Gold',FALSE),
  ('galaxy','Galaxy',FALSE), ('cracked-ice','Cracked Ice',FALSE), ('duskball','Dusk Ball Pattern',FALSE),
  ('loveball','Love Ball Pattern',FALSE), ('friendball','Friend Ball Pattern',FALSE),
  ('quickball','Quick Ball Pattern',FALSE), ('tinsel','Tinsel',FALSE), ('team-rocket','Team Rocket',FALSE),
  ('mirror','Mirror',FALSE), ('starlight','Starlight',FALSE),
  ('league','League',TRUE), ('player-reward','Player Reward',TRUE), ('professor-program','Professor Program',TRUE)
ON CONFLICT (code) DO NOTHING;

-- print subtypes. is_error=TRUE for printing errors (§4.5.2). Sync may INSERT any not seeded here.
INSERT INTO variant_print_subtype (code, label, is_error) VALUES
  ('shadowless','Shadowless',FALSE), ('1999-2000-copyright','1999-2000 Copyright',FALSE),
  ('unlimited','Unlimited',FALSE), ('no-e-reader','No E-Reader',FALSE), ('blue-border','Blue Border',FALSE),
  ('shadowless-red-cheek','Shadowless Red Cheek',FALSE), ('japanese-back','Japanese Back',FALSE),
  ('gold-border','Gold Border',FALSE), ('glossy','Glossy',FALSE), ('1999-copyright','1999 Copyright',FALSE),
  ('missing-expansion-symbol','Missing Expansion Symbol',TRUE), ('aoki-error','Aoki Error',TRUE),
  ('no-holo-error','No Holo Error',TRUE), ('rarity-error','Rarity Error',TRUE), ('missing-hp','Missing HP',TRUE),
  ('evolution-box-error','Evolution Box Error',TRUE), ('d-ink-dot-error','D Ink Dot Error',TRUE),
  ('energy-symbol-error','Energy Symbol Error',TRUE), ('text-error','Text Error',TRUE),
  ('shifted-energy-cost','Shifted Energy Cost',TRUE)
ON CONFLICT (code) DO NOTHING;

-- print runs (SCHEMA §5.4.1). Non-booster provenance is unobserved -> NULL.
INSERT INTO variant_print_run (code, label, is_base, provenance) VALUES
  ('base',        NULL,                  TRUE,  'Found in Booster Packs'),
  ('first',       'First Print Run',     FALSE, 'Found in First Print Run Booster Packs'),
  ('shadowless',  'Shadowless Print Run',FALSE, 'Found in Shadowless Print Run Booster Packs'),
  ('no-e-reader', 'No E-Reader Print Run',FALSE, NULL)
ON CONFLICT (code) DO NOTHING;

-- ── price source field map (SCHEMA §7.3) — the reverse-holo trap, as data ────
INSERT INTO price_source_field_map (source_code, upstream_field, target_finish, target_metric, note) VALUES
  ('tcgdex-cardmarket','avg','holo','avg',
   'Cardmarket base listing. Applies to the card''s DEFAULT printing, not necessarily a holo finish.'),
  ('tcgdex-cardmarket','avg-holo','reverse','avg',
   'TRAP: Cardmarket "-holo" fields are the REVERSE-HOLO listing, NOT a holo finish. Verified on swsh3-136 (holo:false/reverse:true yet carries avg-holo). DECISIONS.md correction 5. Reading literally ships wrong prices.'),
  ('tcgdex-cardmarket','trend-holo','reverse','trend','Same trap as avg-holo.'),
  ('tcgdex-tcgplayer','holofoil.marketPrice','holo','market','Keyed by printing name.'),
  ('tcgdex-tcgplayer','reverse-holofoil.marketPrice','reverse','market','Keyed by printing name.'),
  ('tcgdex-tcgplayer','normal.marketPrice','normal','market','Keyed by printing name.')
ON CONFLICT (source_code, upstream_field) DO NOTHING;

-- ── formats (SCHEMA §8.6). data_checked_at from DECK-FORMATS (2026-07-24). ────
INSERT INTO format (code, name, short_name, deck_size, max_copies_per_name, basic_energy_exempt,
                    max_ace_spec, max_radiant, max_prism_star_per_name, require_basic_pokemon,
                    require_single_type, forbid_rule_box, prize_count, pool_strategy, sort_order,
                    source_url, data_checked_at) VALUES
  ('standard','Standard','STD',60,4,TRUE, 1,1,1, TRUE, FALSE,FALSE,6,'regulation_mark',1,
   'https://www.pokemon.com/us/pokemon-tcg/deck-building/', '2026-07-24T00:00:00Z'),
  ('expanded','Expanded','EXP',60,4,TRUE, 1,1,1, TRUE, FALSE,FALSE,6,'set_allowance',2,
   'https://www.pokemon.com/us/pokemon-tcg/deck-building/', '2026-07-24T00:00:00Z'),
  ('glc','Gym Leader Challenge','GLC',60,1,TRUE, 0,0,0, TRUE, TRUE, TRUE, 6,'set_allowance',3,
   'https://gymleaderschallenge.com/', '2026-07-24T00:00:00Z'),
  ('unlimited','Unlimited','UNL',60,4,TRUE, 1,1,1, TRUE, FALSE,FALSE,6,'all',4,
   NULL, '2026-07-24T00:00:00Z')
ON CONFLICT (code) DO NOTHING;

-- Standard marks {H,I,J}; Expanded {D..J}. legal_from dates are curation placeholders — the marks
-- themselves are the required vocabulary (SCHEMA §8.2). legal_until NULL = still legal.
INSERT INTO format_regulation_mark (format_code, mark, legal_from, legal_until) VALUES
  ('standard','H','2023-01-01',NULL), ('standard','I','2024-01-01',NULL), ('standard','J','2025-01-01',NULL),
  ('expanded','D','2016-09-01',NULL), ('expanded','E','2017-09-01',NULL), ('expanded','F','2018-09-01',NULL),
  ('expanded','G','2019-09-01',NULL), ('expanded','H','2023-01-01',NULL), ('expanded','I','2024-01-01',NULL),
  ('expanded','J','2025-01-01',NULL)
ON CONFLICT (format_code, mark) DO NOTHING;

-- GLC functional-reprint exclusive groups (SCHEMA §8.1c). Name-scoped, so no card_set dependency.
INSERT INTO format_exclusive_group (format_code, label, max_total, source_url) VALUES
  ('glc','Boss''s Orders / Lysandre',1,'https://gymleaderschallenge.com/'),
  ('glc','Professor''s Research / Sycamore / Juniper',1,'https://gymleaderschallenge.com/')
ON CONFLICT DO NOTHING;
INSERT INTO format_exclusive_group_member (group_id, name_normalized)
SELECT id, m FROM format_exclusive_group g
CROSS JOIN LATERAL (VALUES ('boss''s orders'),('lysandre')) AS v(m)
WHERE g.label = 'Boss''s Orders / Lysandre'
ON CONFLICT DO NOTHING;
INSERT INTO format_exclusive_group_member (group_id, name_normalized)
SELECT id, m FROM format_exclusive_group g
CROSS JOIN LATERAL (VALUES ('professor''s research'),('professor sycamore'),('professor juniper')) AS v(m)
WHERE g.label = 'Professor''s Research / Sycamore / Juniper'
ON CONFLICT DO NOTHING;

-- ── the single default user + 1:1 settings/profile (SCHEMA §9.1, DECISIONS.md) ──
INSERT INTO app_user (username) VALUES ('cheyras') ON CONFLICT (username) DO NOTHING;
INSERT INTO user_settings (user_id)
SELECT id FROM app_user WHERE username = 'cheyras'
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO user_profile (user_id, display_name)
SELECT id, 'cheyras' FROM app_user WHERE username = 'cheyras'
ON CONFLICT (user_id) DO NOTHING;
