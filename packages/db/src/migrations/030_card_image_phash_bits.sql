-- 030 · Make the scanner's nearest-neighbour search a SQL query (issue #20).
--
-- The scanner used to load every hash into a process-lifetime typed array at API
-- boot and rank them in JS. That works for a long-lived self-host process and is
-- meaningless on serverless, where every cold start would re-read 22k rows and no
-- two requests are guaranteed to share memory. The cloud path instead ranks in
-- Postgres: `bit_count(a # b)` is native from PG 14 and needs no extension.
--
-- `hash` is BYTEA (8 bytes, big-endian) because that is what round-trips cleanly
-- to a JS bigint, but Postgres has no bitwise XOR for BYTEA — only for BIT. The
-- conversion `('x' || encode(hash,'hex'))::bit(64)` is exact and immutable, but
-- doing it per row per probe is the whole cost of the query: measured against the
-- live 22,771-row cloud index (26 query probes, wall time from this Pi, ~29 ms of
-- which is network round trip):
--
--     conversion inline in the query   180–190 ms
--     stored bit(64) column             64– 84 ms
--
-- So the conversion is materialised once, as a GENERATED column. It stays in
-- lockstep with `hash` by definition — there is no writer that can set one and
-- forget the other, and the indexer keeps inserting `hash` exactly as before.
--
-- The (quality, algo) index serves the `indexSize` count the scan response
-- reports; the ranking itself is a full scan of a 22k-row table by design
-- (a Hamming ball has no B-tree ordering to exploit).

ALTER TABLE card_image_phash
  ADD COLUMN hash_bits bit(64)
  GENERATED ALWAYS AS (('x' || encode(hash, 'hex'))::bit(64)) STORED;

COMMENT ON COLUMN card_image_phash.hash_bits IS
  'Generated bit(64) mirror of `hash`, so nearest-neighbour search can use bit_count(hash_bits # query) without a per-row BYTEA→BIT conversion.';

CREATE INDEX card_image_phash_quality_algo_idx
  ON card_image_phash (quality, algo);
