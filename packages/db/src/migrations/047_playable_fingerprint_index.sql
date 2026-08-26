-- 047 · Index the reprint-equivalence hash, now that something fills it.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE COLUMN HAS BEEN EMPTY SINCE 003 AND ITS OWN COMMENT SAID WHY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 003 declared `playable_fingerprint CHAR(64)` with the note "NULL until full
-- data present", which reads as a remark about missing upstream data. It was a
-- remark about missing code: `fingerprint.ts` computed the hash from the day it
-- was written, but only in memory, per deck validation, for the reprint-
-- legality oracle. Nothing ever wrote the column, and it was NULL on all 23,546
-- rows.
--
-- That was not cosmetic. `save_deck` and `search_cards` both instruct the model
-- to "use the cheapest available printing of the named card", which is sound
-- for a REPRINT and wrong for a NAME — Pokémon reuses names across sets for
-- different cards. Measured on this catalogue: of 1,409 Standard-legal names,
-- 897 have several printings and 218 of those are SEVERAL DIFFERENT CARDS.
-- Cheapest-first on `Shaymin` offers three 70 HP cards above the 80 HP one a
-- decklist actually named, at $0.20 against $0.83.
--
-- `apps/api/src/deck/fingerprintIndex.ts` fills it now, from
-- `refresh-catalog.sh` after every import and as a one-off backfill.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHY AN INDEX, AND WHY THIS SHAPE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The read this exists for is "every OTHER row that is this same card" —
-- `WHERE playable_fingerprint = $1` — run per search result and per deck slot.
-- Without an index that is a sequential scan over the whole catalogue each time.
--
-- PARTIAL, excluding NULL. A null fingerprint means "too thin to trust", never
-- "equal to the other nulls", and every query that uses this column is an
-- equality on a known hash. Indexing the nulls would add thousands of entries
-- no query can ever match.
--
-- NOT UNIQUE, emphatically. Collision is the entire point: two rows sharing a
-- hash are two printings of one card, which is the fact being looked up.
--
-- Platform-agnostic, like 003 and 043 — this is a column on a table every
-- deployment has, not an RLS policy.

CREATE INDEX IF NOT EXISTS card_playable_fingerprint_idx
  ON card (playable_fingerprint)
  WHERE playable_fingerprint IS NOT NULL;

COMMENT ON COLUMN card.playable_fingerprint IS
  'SHA-256 over name + gameplay attributes (attacks, abilities, weaknesses, '
  'resistances, retreat, types) and never over print fields. Rows sharing one '
  'are the SAME CARD in different printings and may be swapped for each other; '
  'rows sharing only a NAME may not — 218 Standard-legal names in this '
  'catalogue are more than one card. NULL = too little gameplay data to hash, '
  'which is not a claim of equality with the other NULLs. Filled by '
  'apps/api/src/deck/fingerprintIndex.ts, not by the importer, because the hash '
  'covers child tables written after the card row exists.';
