-- =============================================================================
-- dump-affected.sql — the ONE read-only query behind the card-art re-sourcing.
--
-- Project Holo, subtask 2c: "every image_asset row has an approved source_url,
-- or the card is on a published no-art list."
--
-- UNTRACKED (Holo 2c PREP). SELECT-only: no INSERT, UPDATE, DELETE, no DDL, no
-- temp tables, no SET. Safe to run against production. It opens ONE connection
-- and returns ONE row containing ONE json column, which is the complete input to
-- `tools/card-art/resource-assets.mts` — deliberately one round trip, so the
-- pipeline never needs the database again.
--
-- ── How to run it (from a box that has DATABASE_URL) ─────────────────────────
--
--   set -a && . ./.env && set +a
--   psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 \
--        -f tools/card-art/dump-affected.sql > tools/card-art/affected.json
--
--   # sanity: it must be one line of valid JSON
--   node -e "const j=require('./tools/card-art/affected.json'); \
--            console.log(j.summary)"
--
-- `-A -t` (unaligned, tuples-only) is what keeps the output parseable; without
-- them psql wraps the JSON in column headers and a row count. Add
-- `-P pager=off` if your psqlrc sets one.
--
-- ── What "affected" means, and why the retired host is not named here ────────
--
-- The predicate is an ALLOW-LIST, exactly like `packages/storage/src/upstream.ts`
-- `IMAGE_SOURCE_HOSTS`: a row is affected when its `source_url` is not an
-- approved origin. NULL is affected (it is the honest-blank value the 2026-08-07
-- backfill established for bytes warmed from a source we can no longer name),
-- and so is any host that is not on the list — including hosts nobody has ever
-- considered. Naming the retired source would make this file need editing every
-- time a source is retired, and 2c's own guardrail rule says an allow-list does
-- not need to name what it blocks.
--
-- Keep `approved_host` below in step with `IMAGE_SOURCE_HOSTS`
-- (packages/storage/src/upstream.ts) and with the approved ladder in
-- `research/CARD-ART-SOURCES.md`. `images.pokemontcg.io` is listed because it is
-- the approved card-art FALLBACK; `archives.bulbagarden.net` because the
-- owner-approved set-image crosswalk (`packages/storage/src/setImageFallback.ts`,
-- 2026-08-29) sources some set logos/symbols from it. Neither is in
-- IMAGE_SOURCE_HOSTS yet — adopting them is a separate, deliberate act.
--
-- ── Why cache_key is the join key and relative_path is not ──────────────────
--
-- `cache_key` is `card:{setTcgdexId}-{localId}:{quality}`. Colons appear in
-- exactly two places, so `split_part(cache_key, ':', 2)` is EXACTLY
-- `card.tcgdex_id` and `split_part(cache_key, ':', 3)` is the quality — no
-- ambiguity, even though both set ids (`tk-bw-e`) and local ids (`SWSH133`) can
-- contain hyphens, which is what makes splitting `relative_path` or the card id
-- on '-' wrong. `relative_path` is still carried verbatim, because it IS the
-- Supabase Storage object key and the path under IMAGE_CACHE_ROOT
-- (packages/db migration 025, packages/storage/src/paths.ts).
-- =============================================================================

WITH approved_host(host) AS (
  VALUES
    ('assets.tcgdex.net'),        -- primary card art + set imagery (upstream.ts)
    ('raw.githubusercontent.com'),-- PokeAPI sprites, pinned SHA (paths.ts SPRITES_SHA)
    ('images.pokemontcg.io'),     -- APPROVED FALLBACK (CARD-ART-SOURCES.md §2.2, §7)
    ('archives.bulbagarden.net')  -- set-image crosswalk only (setImageFallback.ts)
),

affected AS (
  SELECT
    ia.cache_key,
    ia.kind,
    ia.relative_path,
    ia.content_type,
    ia.byte_size,
    ia.source_url,
    ia.etag,
    ia.fetched_at,
    ia.is_pinned,
    CASE
      WHEN ia.source_url IS NULL THEN 'null-source'
      ELSE 'unapproved-host'
    END                                                AS affected_reason,
    -- Host, for the report. NULL when there is no source_url at all.
    substring(ia.source_url from '^[a-z]+://([^/:?#]+)') AS source_host,
    split_part(ia.cache_key, ':', 1)                   AS key_kind,
    split_part(ia.cache_key, ':', 2)                   AS key_body,
    split_part(ia.cache_key, ':', 3)                   AS quality
  FROM image_asset ia
  WHERE ia.source_url IS NULL
     OR substring(ia.source_url from '^[a-z]+://([^/:?#]+)') IS NULL
     OR lower(substring(ia.source_url from '^[a-z]+://([^/:?#]+)'))
          NOT IN (SELECT host FROM approved_host)
),

-- Physical copies, folded to one json object per cache_key so the pipeline can
-- see at a glance which tiers hold bytes for this asset.
objects AS (
  SELECT
    io.cache_key,
    jsonb_object_agg(
      io.tier,
      jsonb_build_object(
        'byteSize',    io.byte_size,
        'contentType', io.content_type,
        'etag',        io.etag,
        'storedAt',    io.stored_at
      )
    ) AS tiers
  FROM image_object io
  WHERE io.cache_key IN (SELECT cache_key FROM affected)
  GROUP BY io.cache_key
),

-- Catalog identity. LEFT JOIN throughout: an image_asset row whose card no
-- longer exists in the catalog is a real and interesting state (a set re-key
-- that moved the card, a card retired upstream), and dropping it here would
-- hide it from the count that has to reach zero.
enriched AS (
  SELECT
    a.*,
    c.tcgdex_id      AS card_tcgdex_id,
    c.local_id       AS card_local_id,
    c.name           AS card_name,
    c.rarity         AS card_rarity,
    cs.tcgdex_id     AS set_tcgdex_id,
    cs.name          AS set_name,
    cs.released_on   AS set_released_on,
    se.tcgdex_id     AS series_tcgdex_id,
    se.name          AS series_name,
    o.tiers          AS object_tiers
  FROM affected a
  LEFT JOIN card c
         ON a.key_kind = 'card'
        AND c.tcgdex_id = a.key_body
        AND c.lang = 'en'
  LEFT JOIN card_set cs ON cs.id = c.set_id
  LEFT JOIN series   se ON se.id = cs.series_id
  LEFT JOIN objects  o  ON o.cache_key = a.cache_key
)

SELECT jsonb_pretty(jsonb_build_object(

  'generatedAt', now(),
  'query',       'tools/card-art/dump-affected.sql',
  'note',        'Read-only dump of every image_asset row whose source_url is not an approved origin. '
              || 'Input to tools/card-art/resource-assets.mts. Contains no secrets.',

  -- ── Headline counts, so a reviewer can check the dump against the numbers
  --    recorded on 2026-08-31 (1,854 NULL-source rows; ~58 on the retired host)
  --    before anything is fetched.
  'summary', (
    SELECT jsonb_build_object(
      'affectedRows',        count(*),
      'nullSource',          count(*) FILTER (WHERE affected_reason = 'null-source'),
      'unapprovedHost',      count(*) FILTER (WHERE affected_reason = 'unapproved-host'),
      'distinctCards',       count(DISTINCT key_body) FILTER (WHERE key_kind = 'card'),
      'cardRows',            count(*) FILTER (WHERE kind = 'card'),
      'nonCardRows',         count(*) FILTER (WHERE kind <> 'card'),
      'orphanRows',          count(*) FILTER (WHERE key_kind = 'card' AND card_tcgdex_id IS NULL),
      'pinnedRows',          count(*) FILTER (WHERE is_pinned),
      'totalBytes',          COALESCE(sum(byte_size), 0)
    ) FROM enriched
  ),

  -- Whole-table context: what the affected rows are a slice OF.
  'manifestTotals', (
    SELECT jsonb_build_object(
      'imageAssetRows',   (SELECT count(*) FROM image_asset),
      'cardRows',         (SELECT count(*) FROM image_asset WHERE kind = 'card'),
      'imageObjectRows',  (SELECT count(*) FROM image_object),
      'objectTierRows',   (SELECT count(*) FROM image_object WHERE tier = 'object'),
      'diskTierRows',     (SELECT count(*) FROM image_object WHERE tier = 'disk'),
      'catalogCards',     (SELECT count(*) FROM card WHERE lang = 'en'),
      'catalogSets',      (SELECT count(*) FROM card_set)
    )
  ),

  'bySeries', (
    SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
    FROM (
      SELECT COALESCE(series_tcgdex_id, '(unknown)') AS k, count(*) AS v
      FROM enriched GROUP BY 1
    ) t
  ),

  'bySet', (
    SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
    FROM (
      SELECT COALESCE(set_tcgdex_id, '(unknown)') AS k, count(*) AS v
      FROM enriched GROUP BY 1
    ) t
  ),

  'byHost', (
    SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
    FROM (
      SELECT COALESCE(source_host, '(null source_url)') AS k, count(*) AS v
      FROM enriched GROUP BY 1
    ) t
  ),

  -- ── The rows themselves. `relativePath` is BOTH the Supabase Storage object
  --    key and the path under IMAGE_CACHE_ROOT — one string locates the bytes in
  --    either tier (migration 025 / paths.ts). Nothing here is derived twice:
  --    the pipeline reads these fields and never re-parses a cache key.
  'rows', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'cacheKey',        cache_key,
      'kind',            kind,
      'relativePath',    relative_path,
      'contentType',     content_type,
      'byteSize',        byte_size,
      'sourceUrl',       source_url,
      'sourceHost',      source_host,
      'etag',            etag,
      'fetchedAt',       fetched_at,
      'isPinned',        is_pinned,
      'affectedReason',  affected_reason,
      'quality',         quality,
      'cardTcgdexId',    card_tcgdex_id,
      'localId',         card_local_id,
      'cardName',        card_name,
      'rarity',          card_rarity,
      'setTcgdexId',     set_tcgdex_id,
      'setName',         set_name,
      'setReleasedOn',   set_released_on,
      'seriesTcgdexId',  series_tcgdex_id,
      'seriesName',      series_name,
      'objectTiers',     object_tiers
    ) ORDER BY series_tcgdex_id, set_tcgdex_id, card_local_id, quality), '[]'::jsonb)
    FROM enriched
  ),

  -- ── The cards in the catalog that have NO image_asset row at all.
  --    `research/card-art-residue.json` counted 592 of these on 2026-08-26; they
  --    are a different population from the affected rows above (no bytes vs.
  --    unattributed bytes) and the no-art list has to account for both. Kept to
  --    identity only — the whole set is ~600 rows, not a second dump.
  'cardsWithNoAssetRow', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'cardTcgdexId',   c.tcgdex_id,
      'localId',        c.local_id,
      'cardName',       c.name,
      'setTcgdexId',    cs.tcgdex_id,
      'seriesTcgdexId', se.tcgdex_id
    ) ORDER BY se.tcgdex_id, cs.tcgdex_id, c.local_id), '[]'::jsonb)
    FROM card c
    JOIN card_set cs ON cs.id = c.set_id
    JOIN series   se ON se.id = cs.series_id
    WHERE c.lang = 'en'
      AND NOT EXISTS (
        SELECT 1 FROM image_asset ia
        WHERE ia.kind = 'card'
          AND split_part(ia.cache_key, ':', 2) = c.tcgdex_id
      )
  )

)) AS dump;
