-- 048 · pgvector, and the catalog's identity embeddings.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHY A SECOND INDEX WHEN 016 ALREADY HAS ONE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Owner ruling, 2026-09-04 (PLAN.md, "MATCHING ARCHITECTURE RULING"): identity
-- becomes an on-device embedding compared against catalog vectors in pgvector,
-- and the perceptual hash is demoted to a prefilter. This table is the catalog
-- half of that.
--
-- The measurement behind the ruling, and behind this file: on 19 photographs of
-- real cards, each rectified from a HAND-LABELLED quad — the best crop geometry
-- this pipeline can produce — the shipped dHash matcher's top-1 was the right
-- card twice, and its own `matched: true` gate fired four times and was wrong
-- every time. 0-for-4 on precision (p2-work/phash-on-crops/RESULTS.md,
-- 2026-09-03). The 2026-09-04 embedding spike put the right card first on
-- 10 of the 10 frames whose card exists in the catalogue at all, with a cosine
-- threshold that also rejected all 9 frames whose card has no catalogue art and
-- therefore CANNOT be matched by anything (p2-work/embed-spike/NOTES.md).
--
-- 016 stays. A hash is 8 bytes and a `bit_count` is one instruction; it is a
-- cheap way to shrink a candidate set before the expensive comparison, and it
-- is the fallback while the embedding path is behind its flag.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE EXTENSION, AND WHY THIS FILE REFUSES RATHER THAN GUESSES
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `vector` ships with Supabase and is one package on a self-hosted box
-- (`postgresql-<major>-pgvector`). Where it is missing, `CREATE EXTENSION`
-- fails with "could not open extension control file" — accurate, and useless to
-- anyone who has not met it before. The guard below turns that into a sentence
-- naming the package and the doc, because a migration is the worst possible
-- place to make somebody guess (contract B11: a configuration failure must be
-- loud and actionable). DEPLOYMENT.md carries the same note as a prerequisite.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE STAMP IS IN THE PRIMARY KEY, ON PURPOSE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `stamp` is `e<input-spec-version>:<model-id>` — `packages/matching`'s
-- `embedStamp()`, and the ONLY thing that makes two vectors comparable. Change
-- the resampler, the crop rule, the normalisation or the checkpoint and the
-- numbers in this column stop meaning what they meant, silently and with no
-- error anywhere.
--
-- This is contract B5's corollary applied to a second index: `card_image_phash`
-- carries `algo` for exactly the same reason, and the matcher FILTERS on it so
-- a stale row is invisible rather than wrong. Putting the stamp in the key goes
-- one step further and lets two generations coexist: a new model can be embedded
-- across all 23.5k cards while the old one keeps serving, and the cutover is a
-- change of one string in the query rather than a re-index with a blind window.
--
-- `quality` is in the key too, because 'low' (245x337) and 'high' (600x825) are
-- different pictures of the same card and a model does not produce the same
-- vector for both. 'low' is what the embed job uses and what the phone will be
-- compared against; 'high' is left representable rather than assumed away.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- vector(384), AND WHY THE INDEX IS PARTIAL
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 384 is the winning checkpoint's feature width (`EMBED_DIM` in
-- packages/matching/src/input-spec.ts, which this number is pinned against by
-- that package's tests). A checkpoint with a different width is a different
-- column type and therefore a new migration — which is honest, since it is also
-- a different vector space and every row would have to be recomputed anyway.
--
-- Vectors are stored L2-NORMALISED (`l2Normalize` runs before the write), so
-- cosine distance and inner product agree. `vector_cosine_ops` is still the
-- declared operator class: it is correct whether or not a future producer
-- forgets, and the cost of the extra norm is nothing next to being subtly wrong.
--
-- The HNSW index is PARTIAL, restricted to the current stamp. An unfiltered
-- index over a table holding two generations would happily return the nearest
-- neighbour from the wrong generation — the query's `WHERE stamp = $1` would
-- then filter it out AFTER the index chose it, so a scan would return fewer
-- than k rows, or none, with nothing in the plan to suggest why. A cutover adds
-- a migration that creates the next partial index and drops this one, which is
-- also the moment somebody has to think about the cutover.
--
-- 23,546 catalogue rows is small for HNSW; the index is here for the serverless
-- shape rather than the row count. A sequential scan means reading ~36 MB of
-- vectors on a cold function instance, per scan, which is the same mistake the
-- original in-process hash cache made (contract B5) in a different costume.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    RAISE EXCEPTION
      'pgvector is not available on this server. Install it before migrating: '
      'Debian/Ubuntu `apt install postgresql-%-pgvector`, or enable the "vector" '
      'extension in the Supabase dashboard. See DEPLOYMENT.md, "pgvector".',
      current_setting('server_version_num')::int / 10000;
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE card_embedding (
  card_id     BIGINT      NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  -- Which art tier was embedded. Same vocabulary as card_image_phash.quality.
  quality     TEXT        NOT NULL,
  -- `e<spec>:<model>` — packages/matching `embedStamp()`. See the header.
  stamp       TEXT        NOT NULL,
  embedding   vector(384) NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, quality, stamp),
  CONSTRAINT card_embedding_quality_check CHECK (quality IN ('low', 'high')),
  -- A stamp is compared as an exact string and must therefore never arrive
  -- padded, empty, or with a stray newline from a shell variable.
  CONSTRAINT card_embedding_stamp_check CHECK (stamp = btrim(stamp) AND length(stamp) > 0)
);

-- THE MATCH QUERY'S INDEX. Partial by stamp — see the header for why an
-- unfiltered one would be a silent correctness bug rather than a slow one.
CREATE INDEX card_embedding_hnsw_e1_vitamin
  ON card_embedding USING hnsw (embedding vector_cosine_ops)
  WHERE stamp = 'e1:vitamin-small-datacomp1b' AND quality = 'low';

-- The embed job's resumability read: "which cards do NOT yet have a vector for
-- this stamp and quality". Without it that is a scan of the whole table per run,
-- and the job is designed to be re-run often and cheaply (contract B8).
CREATE INDEX card_embedding_stamp_idx ON card_embedding (stamp, quality, card_id);

COMMENT ON TABLE card_embedding IS
  'Identity embeddings of cached card art, for the scanner''s nearest-neighbour '
  'matcher. One row per (card, quality, stamp); the stamp names the input-spec '
  'version and the checkpoint, and the matcher filters on it, so a vector from '
  'another pipeline is invisible rather than silently wrong. Vectors are stored '
  'L2-normalised. Written by tools/embed-catalog.';

COMMENT ON COLUMN card_embedding.stamp IS
  'e<EMBED_SPEC_VERSION>:<EMBED_MODEL_ID> from packages/matching. Two vectors '
  'are comparable if and only if their stamps are equal.';
