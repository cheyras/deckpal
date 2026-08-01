# W0 · feat/battle-contracts

**Wave 0 — serialize; every other battle feature builds on this merge.**
Worktree: `~/pokedex-worktrees/battle-contracts` · Depends: nothing · Dev server: none
Spec: `BATTLE-INTEL-SPEC.md` §3 Wave 0, Ground Truths #3–#6.

## Mission
Migration 020 + the shared vocabulary: the schema contracts that let A/B/C/D branches work in
parallel without colliding.

## Scope
- [ ] `battle_log` relaxation per Ground Truth #3: `deck_id`/`deck_version` nullable **together**
      (`CHECK ((deck_id IS NULL) = (deck_version IS NULL))`), nullable `format_code` FK for
      deckless rows, `source` (`own_game|shared|simulated|agent_match`, default `own_game`),
      `raw_log` nullable (sim games are events-only), structured fields (`my_archetype`,
      `opp_archetype`, `tags[]`, `key_cards[]`, `narrative`).
- [ ] `battle_events` table `(log_id, seq, turn, actor, type, payload jsonb)` + starter type
      taxonomy from spec (additive-only after this merge; A1's census refines payloads).
- [ ] Archetype registry (canonical labels + aliases) + the grouping rule `matchup_stats` will use.
- [ ] `card_impls`, `gauntlet_decks`, `battle_memories` (pgvector) tables.
- [ ] `CREATE EXTENSION vector` in the pokedex DB (available in cluster at 0.8.0 — verified).
- [ ] Update `research/SCHEMA.md`; migration comments carry the one-table-vs-corpus-table
      rationale (spec Ground Truth #3 states the recommendation — justify or deviate in writing).

## Must-ask (blocks merge, not start)
Connection budget (Ground Truth #6): does a future sim/synthesis worker get +1, or batch on
existing slots? Ask Chey at merge prep, record answer in DECISIONS.md.

## Done gate
Migration applies clean to the live DB (test against a scratch DB first — budget: ONE
connection); schema documented; DECISIONS.md entry written; CI green.
