# C1 · feat/gauntlet

**Wave 3.** Worktree: `~/pokedex-worktrees/gauntlet` (create when W0 merges; `impl_gaps`
reporting needs B3's `card_impls` table to exist, which W0 creates) · Depends: W0.
Dev server: none. Spec: §3 Wave 3, §7 (LimitlessTCG).

## Mission
The meta gauntlet as data: current Standard archetypes + representative decklists from
LimitlessTCG, stored as ordinary decks, with per-deck implementation-gap reporting so B-track
card work is demand-driven.

## Scope
- [ ] **Check LimitlessTCG's API/robots/terms first** — they've historically had a real API
      (organizer keys). Use an API/export over scraping if one exists; either way cache hard,
      be gentle, on-demand refresh only (never scheduled). Record what you found in
      DECISIONS.md.
- [ ] Gauntlet refresh job (MCP write tool, dry-run defaulted): pull current Standard
      archetypes + a representative list each → decks tagged in `gauntlet_decks` (source URL,
      archetype label, fetched_at). Refresh updates rather than duplicates.
- [ ] `impl_gaps(deck_id?)` MCP read tool: unimplemented cards per gauntlet deck ("Dragapult
      box: 12 cards unimplemented"), sorted to make the next card-implementation session obvious.
- [ ] Card matching: Limitless lists → catalog card IDs (set codes + collector numbers;
      TCGdex remains source of truth — never invent catalog rows).

## Done gate
Refresh pulls the current Standard meta into gauntlet decks; gap report per deck accurate
against `card_impls`; a second refresh is idempotent. CI green.
