# A1 · feat/battle-events-parser

**Wave 1.** Worktree: `~/pokedex-worktrees/battle-events-parser` · Depends: W0 (schema only —
census + parser work can start immediately; rebase onto main once W0 merges before touching DB).
Dev server: none. Spec: §3 Wave 1, Ground Truth #7.

## Mission
The pure parser (`apps/api/src/deck/battlelog.ts`) grows a full event-stream emitter; every raw
log becomes `battle_events` rows. This event stream is the interchange format for engine
validation (B4), sim output (C2), and the board/replay renderer (D2) — treat its shape as a
public contract.

## Scope
- [ ] **Event census first**: sweep every stored `raw_log` (10 today) and catalog observed line
      shapes the parser doesn't consume (damage lines, abilities, retreats, special conditions,
      stadium effects, draw/reveal sub-bullets). The final taxonomy comes from observation, not
      the spec's starter list. Save the census as a doc in the branch.
- [ ] Extend the parser to emit ordered events; keep it **pure** (no DB/IO), keep the tolerance
      contract (unknown lines skipped + counted, never a throw), keep existing outputs
      backward-compatible (existing `parsed` jsonb consumers must not break).
- [ ] Ingest write path populates `battle_events` on `add_battle_log`; backfill script re-parses
      existing logs (one DB connection).
- [ ] CI-pure tests: fixtures from real log excerpts covering every event type; unknown-line
      rate asserted per fixture.

## Done gate
All stored logs re-parse into event streams; unknown-line rate reported per log; taxonomy
documented (additive-only from here); tests green in CI.
