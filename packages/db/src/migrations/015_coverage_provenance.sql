-- 015 · Coverage provenance split for the reverse-holo cross-fill (TCGCSV-VARIANTS §C.4).
--
-- The reverse-holo cross-fill (Phase 2 task 5) INSERTs source='tcgcsv' reverse rows for the
-- Call of Legends / Black & White / XY / Sun & Moon eras that TCGdex lacks. set_variant_coverage
-- (migration 009) already reflects them in `variants` / `variants_per_card` because it is a plain
-- view over card_variant — but it can't tell a supplemented set from a natively-complete one.
--
-- Add `filled_variants` (source='tcgcsv') and `native_variants` (source='tcgdex') so the UI can
-- footnote honestly ("reverse-holo data supplemented from TCGplayer") on sets with filled_variants>0,
-- rather than mislabelling them provisional. Also expose `provisional_variants` — the cleanName
-- fallback fills (fill_confidence < 100), which DO warrant a genuine provisional flag.
--
-- CREATE OR REPLACE keeps the existing view's column order stable for the first four columns; the
-- new columns are appended, so existing readers are unaffected.

CREATE OR REPLACE VIEW set_variant_coverage AS
SELECT s.id AS set_id, s.name, se.name AS serie,
       COUNT(DISTINCT c.id)                                             AS cards,
       COUNT(cv.id)                                                     AS variants,
       ROUND(COUNT(cv.id)::numeric / NULLIF(COUNT(DISTINCT c.id),0), 2) AS variants_per_card,
       COUNT(cv.id) FILTER (WHERE cv.source = 'tcgcsv')                 AS filled_variants,
       COUNT(cv.id) FILTER (WHERE cv.source = 'tcgdex')                 AS native_variants,
       COUNT(cv.id) FILTER (WHERE cv.source = 'tcgcsv'
                              AND COALESCE(cv.fill_confidence,100) < 100) AS provisional_variants
FROM card_set s
JOIN series se ON se.id = s.series_id
JOIN card c    ON c.set_id = s.id
LEFT JOIN card_variant cv ON cv.card_id = c.id
GROUP BY s.id, s.name, se.name;
