-- The match query's index for the fine-tuned identity checkpoint
-- (`deckpal-card-b32-v1`, tools/scan-embed; DECISIONS 2026-10-09).
--
-- 051's HNSW index is partial on the shipped stamp, `e1:clip-vit-b32-openai`,
-- and the planner can use a partial index only when the query's predicate
-- implies the index's (see embedMatch.ts `pgNeighbours`). Vectors written under
-- the new stamp would therefore be searched by a sequential scan over every
-- row. This adds the same index for the new stamp; the old one stays, so the
-- old rows remain searchable and switching back is a revert of #288 with no
-- data to restore.
--
-- Additive and idempotent. Runs before the gallery is embedded under the new
-- stamp (an index over zero rows is free) and before the code that queries it
-- is deployed.
CREATE INDEX IF NOT EXISTS card_embedding_hnsw_e1_deckpal_card_b32_v1
  ON card_embedding USING hnsw (embedding vector_cosine_ops)
  WHERE stamp = 'e1:deckpal-card-b32-v1' AND quality = 'low';
