> **Predates the cloud pivot -- re-scope before executing.**

# B4 · feat/replay-validation

**Wave 3 — the engine's trust gate.**
Worktree: `~/pokedex-worktrees/replay-validation` (create when A1 + B3 have merged) ·
Depends: A1 (event streams), B3 (cards). Dev server: none. Spec: §3 Wave 3, Ground Truth #7.

## Mission
Every parsed real log is a free integration test: feed the log's decisions into the engine,
assert the engine's computed state transitions match the log's stated outcomes. This is the
single best defense against a subtly-wrong engine.

## Scope
- [ ] Harness: event stream → engine actions; assert damage numbers, KOs, prize counts — and
      hand contents where the log reveals them (the deck owner's full hidden info is in the
      log; use it).
- [ ] Divergence reporting that names the first diverging event + engine-vs-log state diff —
      this is a debugging tool, make the output worth reading.
- [ ] Handle the honest gaps: logs contain hidden information the engine can't know
      (opponent's exact deck), randomness (coin flips are stated in logs — replay them as
      given), and cards not yet implemented (skip-with-reason, feed `card_impls` demand).
- [ ] Wire into CI for the fixture logs (pure — fixtures, not live DB).

## Done gate
The spec's engine gate: Chey's logged games replay with **zero state divergence** (or each
divergence is a filed, understood card/rule bug — none waved off). CI green.
