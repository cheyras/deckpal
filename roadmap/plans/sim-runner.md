> **Predates the cloud pivot -- re-scope before executing.**

# C2 · feat/sim-runner

**Wave 4.** Worktree: `~/pokedex-worktrees/sim-runner` (create when B3/B4 + C1 have merged) ·
Depends: B3, B4, C1, and W0's connection-budget answer. Dev server: none.
Spec: §3 Wave 4, §2 (phased reports), C3 honesty constraints — **non-negotiable**.

## Mission
Judge a deck by experience: `simulate` and `gauntlet_run`, with honesty encoded in the
reporting layer, not left to prompt discipline.

## Scope
- [ ] `simulate(deck_a, deck_b, n, seed?)`: engine games, bot piloting both sides,
      deterministic under seed. Each game emits a standard `battle_events` stream through the
      ingest pipeline, `source: simulated`, `raw_log` NULL. Embeddings sampled, not exhaustive
      (thousands of near-identical narratives are noise — your sampling call, documented).
- [ ] `gauntlet_run(deck_id, games_per_matchup)`: deck vs. every gauntlet deck. **Persists the
      full aggregate report as JSON in the DB from day one** (locked UX: chat consumes it now;
      a later report page + markdown export are render-only). Report: overall WR, per-matchup
      WR with intervals, common loss patterns from event streams (bricked openings, out-priced
      trades), unimplemented-card exclusions named.
- [ ] **Honesty layer**: standing bot-quality caveat in every report; bot-strength benchmarks
      shipped as tests (mirror ≈50%; known-dominant vs. known-weak shows a sane spread); small
      n reported as small n; sim never merges into real-game stats.
- [ ] Runner placement per W0's budget answer (worker app with its own slot, or batch cadence
      on an existing one). Writes batched — never hold connections across a whole run.
- [ ] Pi-5 target: useful, not heroic. A gauntlet run finishing over a coffee ships; profile
      before optimizing.

## Done gate
`gauntlet_run` on the Dhelmise deck produces a report Chey actually consults before locals,
caveats intact; benchmarks green; determinism under seed verified. CI green (pure parts).
