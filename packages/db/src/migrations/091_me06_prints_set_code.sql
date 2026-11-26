-- 091 · Delta Reign (me06) prints a set code: DLR.
--
-- 048 seeded card_set.prints_set_code for the 29 sets of the printed era it
-- knew. me06 came later, and the owner's own cards read `DLR044/103` and
-- `DLREN 045/103` (2026-11-25), so apps/api/src/scan/data/printed-set-code.json
-- gains a DLR row and this column follows it (the startup check in
-- printedSetCode.ts compares the two; the JSON is the authority).
UPDATE card_set cs
   SET prints_set_code = TRUE
  FROM series s
 WHERE s.id = cs.series_id
   AND s.catalogue_code = 'en'
   AND cs.tcgdex_id IN ('me06');
