---
date: "2026-07-29"
title: "deckpal-mcp: MCP server over the deckpal DB (`apps/mcp`)"
decided_by: "Not recorded"
areas: ["agents","decks","operations"]
supersedes: []
---
## 2026-07-29 — deckpal-mcp: MCP server over the deckpal DB (`apps/mcp`)

New workspace app **`deckpal-mcp`** ("deckpal-mcp", after the games' AI-assistant Pokémon):
an MCP streamable-HTTP server on **127.0.0.1:3704** giving Claude (Code / claude.ai / iOS)
14 tools + a `collection://summary` resource over the collection, catalog, prices, decks,
and lists. Design contract: `apps/mcp/SPEC.md`. Key decisions:

- **Hybrid data path.** Reads hit Postgres directly (compact MCP-shaped aggregation,
  precomputed views — `variant_tier_resolved`, `master_required_variant`,
  `user_set_progress` — never re-derived). All writes and every deck/list operation go
  through deckpal-api on :3700 so the transactional write logic (event append + progress
  recompute) and deck logic stay single-sourced.
- **Connection budget is now 4 TOTAL** (API 2 + sync 1 + **mcp 1**). Headroom re-checked
  against the 2026-07-24 measurement (7 spare); `makePool(1)`, `PGAPPNAME=deckpal-mcp`.
- **Migration 018** adds `source` (default `'web'`) + `note` to `collection_event`;
  the three collection write endpoints and `GET /collection/events` carry them. MCP
  writes are stamped `source='deckpal-mcp'` — the "agentic logging" attribution. The
  append-only event log is unchanged otherwise.
- **SDK v2** (`@modelcontextprotocol/server@2.0.0`, released 2026-07-27 — the stable
  line): stateless `createMcpHandler`, fresh `McpServer` per request. Auth = house
  `x-brain-key` (fallback `?key=`), bare 401 (no `WWW-Authenticate` — claude.ai treats
  that header as an OAuth trigger). Host allowlist via `createMcpExpressApp`.
- **Ports**: 3704 (3702 stays the TCGdex escape-hatch slot, 3703 the dev server).
- **Write-tool policy** (`log_cards`): `dry_run` defaults true; ambiguity (card name or
  multi-owned-variant absolute set) is returned as candidates, never guessed; per-item
  partial failure; sequential API calls only.
- **Deploy fragments**: LAN and public nginx location blocks (public path restricted
  to the Anthropic CIDR `160.79.104.0/21` + an nginx-injected key from a snippet
  outside the repo). Process-manager entry added to the ecosystem config (300M
  ceiling).
- **Bug found & fixed en route**: PTCGL name-only deck import 500'd — pg returns `DATE`
  as `Date` but `deck/db.ts` sorted `releasedOn` with `.localeCompare` (`CardFacts` claims
  ISO string). Normalized at the row boundary (`toFacts`).

