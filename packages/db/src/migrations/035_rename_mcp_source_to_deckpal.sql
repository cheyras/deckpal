-- 035 · Brand rename: the MCP server's attribution value becomes 'deckpal-mcp'.
--
-- The product was DeckScout (and, before that, pokedex); the MCP server it ships
-- was called 'rotom-mcp'. Everything is now DeckPal, and the attribution value a
-- reader sees next to an agent-authored row has to match the connector they
-- actually installed — otherwise the provenance trail names a server that no
-- longer exists anywhere in the code.
--
-- Three columns carry it, all with the same shape CHECK (^[a-z0-9][a-z0-9._-]{0,39}$),
-- which 'deckpal-mcp' satisfies, so no constraint work is needed:
--   • collection_event.source  (018)
--   • deck_version.source      (019)
--   • battle_log.source        (019)
--
-- Migrations 018/019 are shipped and checksum-locked, so their COMMENTs are
-- refreshed here rather than edited in place.

UPDATE collection_event SET source = 'deckpal-mcp' WHERE source = 'rotom-mcp';
UPDATE deck_version     SET source = 'deckpal-mcp' WHERE source = 'rotom-mcp';
UPDATE battle_log       SET source = 'deckpal-mcp' WHERE source = 'rotom-mcp';

COMMENT ON COLUMN collection_event.source IS
  'Who wrote this change: web (UI), deckpal-mcp (agent), import/script names. Default web.';
COMMENT ON COLUMN deck_version.source IS
  'Who wrote this version: web (UI), deckpal-mcp (agent), backfill (migration 019). Same shape as collection_event.source.';
COMMENT ON COLUMN battle_log.source IS
  'Who recorded this log: web (UI), deckpal-mcp (agent). Same shape as collection_event.source.';
