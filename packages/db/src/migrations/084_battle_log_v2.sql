-- 084 · Battle logs v2: in-person games, countable archetypes, durable reviews.
--
-- Forward-only (B4). The existing battle_log_own and admin_active_account RLS
-- policies predicate on user_id/the caller, not a column allow-list, so they
-- already cover every column added here. No replacement policy is needed.

ALTER TABLE public.battle_log
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'ptcgl'
    CONSTRAINT battle_log_origin_check CHECK (origin IN ('ptcgl','in_person','other')),
  ADD COLUMN opponent_archetype TEXT,
  ADD COLUMN review_md TEXT
    CONSTRAINT battle_log_review_md_len CHECK (char_length(review_md) <= 12000);

-- DEFAULT fills old rows when the column is added; spell the backfill out so a
-- restored pre-084 database records the intended provenance rather than relying
-- on that PostgreSQL implementation detail.
UPDATE public.battle_log SET origin = 'ptcgl';

ALTER TABLE public.battle_log
  ALTER COLUMN raw_log DROP NOT NULL,
  ADD CONSTRAINT battle_log_ptcgl_requires_raw
    CHECK (origin <> 'ptcgl' OR raw_log IS NOT NULL),
  ADD CONSTRAINT battle_log_opponent_archetype_shape
    CHECK (
      opponent_archetype IS NULL OR (
        char_length(opponent_archetype) <= 64
        AND opponent_archetype ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      )
    );

-- Same key rule as normalizeOpponentArchetype in apps/api/src/deck/battlelog.ts:
-- lowercase ASCII words joined by one hyphen, with apostrophes removed (`N's`
-- -> `ns`). The migration is intentionally more conservative than the runtime:
-- only simple ASCII labels and familiar separators are confident old data.
-- Anything else remains NULL for a reader or Deck-E to classify honestly.
WITH candidates AS (
  SELECT id,
         lower(trim(both '-' from regexp_replace(
           replace(replace(replace(opponent_deck, '''', ''), '’', ''), '‘', ''),
           '[^A-Za-z0-9]+', '-', 'g'
         ))) AS archetype
    FROM public.battle_log
   WHERE opponent_deck IS NOT NULL
     AND opponent_deck ~ '^[A-Za-z0-9][A-Za-z0-9 /&+._''’‘-]*$'
)
UPDATE public.battle_log bl
   SET opponent_archetype = c.archetype
  FROM candidates c
 WHERE bl.id = c.id
   AND c.archetype ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
   AND char_length(c.archetype) <= 64;

CREATE INDEX battle_log_user_deck_archetype
  ON public.battle_log (user_id, deck_id, opponent_archetype);

COMMENT ON COLUMN public.battle_log.origin IS
  'Where the game was played/reported: ptcgl requires raw_log; in_person and other require an explicit result at the API boundary.';
COMMENT ON COLUMN public.battle_log.opponent_archetype IS
  'Normalized countable matchup key: lowercase ASCII words joined by hyphens, at most 64 characters.';
COMMENT ON COLUMN public.battle_log.review_md IS
  'Deck-E analysis in markdown (at most 12000 characters), separate from the reader-authored notes.';

-- Supabase installs these roles; self-host plain PostgreSQL does not. Guarding
-- the grants preserves both deployments. RLS remains the row-ownership gate.
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.battle_log TO authenticated;
    GRANT USAGE, SELECT ON SEQUENCE public.battle_log_id_seq TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.battle_log TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE public.battle_log_id_seq TO service_role;
  END IF;
END
$grants$;
