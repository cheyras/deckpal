-- 086 — the reader's PTCG Live screen name.
--
-- A pasted PTCG Live log names both players and not which one is the reader; the parser guessed the reader's side from
-- card overlap and, on short games, guessed wrong (2026-10-13). The reader can set the name in their profile; while it is
-- empty it fills itself in once three logged games attribute the same name to them (apps/api/src/deck/ptcglName.ts), and
-- it is never changed automatically after that. `ptcgl_name_source` says which: 'manual' (typed) or 'auto' (learned).
--
-- user_settings has no column grants (RLS on the table, own row only), so nothing else is needed for the API to write it.

ALTER TABLE public.user_settings
  ADD COLUMN ptcgl_name text
    CHECK (ptcgl_name IS NULL OR (char_length(ptcgl_name) BETWEEN 1 AND 100 AND ptcgl_name = btrim(ptcgl_name))),
  ADD COLUMN ptcgl_name_source text CHECK (ptcgl_name_source IN ('manual', 'auto')),
  ADD CONSTRAINT user_settings_ptcgl_name_pair CHECK ((ptcgl_name IS NULL) = (ptcgl_name_source IS NULL));

-- One-time backfill, by the same rule the API applies after each logged game: at least three PTCG Live games attribute
-- the name to the reader, strictly more than any other name. Readers who already qualify should not have to log a
-- fourth game to get it.
WITH counts AS (
  SELECT user_id, parsed->'players'->>'me' AS name, count(*) AS n
    FROM public.battle_log
   WHERE origin = 'ptcgl' AND parsed->'players'->>'me' IS NOT NULL
     AND char_length(parsed->'players'->>'me') BETWEEN 1 AND 100
     AND parsed->'players'->>'me' = btrim(parsed->'players'->>'me')
   GROUP BY 1, 2
), ranked AS (
  SELECT user_id, name, n,
         row_number() OVER (PARTITION BY user_id ORDER BY n DESC, name) AS rk,
         lead(n) OVER (PARTITION BY user_id ORDER BY n DESC, name) AS next_n
    FROM counts
)
UPDATE public.user_settings s
   SET ptcgl_name = r.name, ptcgl_name_source = 'auto'
  FROM ranked r
 WHERE r.user_id = s.user_id AND r.rk = 1 AND r.n >= 3 AND (r.next_n IS NULL OR r.next_n < r.n)
   AND s.ptcgl_name IS NULL;
