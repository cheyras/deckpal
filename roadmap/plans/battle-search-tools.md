# A3 · feat/battle-search-tools

**Wave 2.** Worktree: `~/pokedex-worktrees/battle-search-tools` (create when A2 merges) ·
Depends: A2. Dev server: none. Spec: §3 Wave 2, §2 (chat-first intel).

## Mission
The MCP read surface that makes the knowledge layer consumable: "how does this deck do into X
and what usually decides it," answered from actual games with n stated.

## Scope
- [ ] `battle_search(query, filters?)`: semantic over narrative embeddings (query embedded
      server-side via ollama), filterable by archetype/format/result/source. Compact rows,
      pagination, honest empty states (`apps/mcp/SPEC.md`).
- [ ] `matchup_stats(archetype_a, archetype_b?, format?)`: aggregates from structured fields.
      **Sample size always stated** (Wilson interval or explicit n — never a bare percentage on
      n=3). **Defaults to `source: own_game`**; sim results never silently merged.
- [ ] `battle_logs` detail view extended with the narrative.
- [ ] No Pokédex UI — chat-first is locked; UI surfaces are a separate unscheduled feature.

## Done gate
The Phase-1 line from the spec: the Dhelmise-into-Mega-Lucario question answered in chat,
grounded in logged games, sample sizes stated. CI green.
