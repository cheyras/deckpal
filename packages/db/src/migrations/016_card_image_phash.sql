-- 016 · Perceptual-hash index for the offline card scanner (Phase 8).
--
-- The scanner matches a query photo to a catalog card by nearest-neighbour over
-- 64-bit perceptual hashes (dHash) of the locally cached card art. One hash per
-- (card, quality); the indexer (apps/api/src/scan/index.ts) computes them from
-- the cached WebP files and upserts here. The scan route loads them and ranks by
-- Hamming distance. Fully local — no external model or API.
--
-- Storage: the 64-bit hash lives as a fixed 8-byte BYTEA (big-endian). BYTEA
-- avoids Postgres BIGINT's signedness fuss for an unsigned 64-bit value and is
-- trivially reconstructed to a JS bigint (Buffer.readBigUInt64BE). `algo` records
-- which hash produced it so a future algorithm change is a new value, not a silent
-- reinterpretation of old bytes.

CREATE TABLE card_image_phash (
  card_id     BIGINT      NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  quality     TEXT        NOT NULL,
  algo        TEXT        NOT NULL DEFAULT 'dhash8',
  hash        BYTEA       NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, quality),
  CONSTRAINT card_image_phash_quality_check CHECK (quality IN ('low', 'high')),
  CONSTRAINT card_image_phash_len_check     CHECK (octet_length(hash) = 8)
);

COMMENT ON TABLE card_image_phash IS
  'Perceptual hash (dHash, 64-bit big-endian BYTEA) of cached card art, for the offline scanner. One row per (card, quality).';
