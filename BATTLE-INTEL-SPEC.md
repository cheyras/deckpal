# Battle Intelligence & Foil Renderer — Feature Spec

**Audience:** the orchestrating Fable agent and its worktree subagents.
**Supersedes:** the 2026-07-31 conversation roadmap ("Rotom Battle Intelligence & Foil Renderer") where they conflict. Where *this* spec and the code disagree, code wins — flag the discrepancy in DECISIONS.md.
**Status:** UX decisions below are locked (interviewed 2026-08-01). Architecture internals are the orchestrator's judgment within the contracts stated here.
**Companion docs:** `roadmap/ORCHESTRATION.md` (how to run the fan-out: worktrees, ports, merge protocol, dev hub) and `roadmap/plans/<branch>.md` (one plan per feature branch — the subagent's brief).

---

## 1. Ground truths (verified against the codebase, 2026-08-01)

Facts the source roadmap got wrong or didn't know. Do not re-litigate these; re-verify only if the code has moved.

1. **The timeout-parse gap is already fixed.** `apps/api/src/deck/battlelog.ts` handles `<anything>. <name> wins.` endings (see the "battle-#8 miss" comment). Not a work item.
2. **holo-card.jsx is gone by choice.** The prototype from the source conversation was procedural art, not real scans; Chey elected not to preserve it. The foil track starts from this spec's description, not from code.
3. **`battle_log` needs a deliberate schema decision for non-owned games** (migration 019): `deck_id` is NOT NULL and the row is anchored by a composite FK `(deck_id, deck_version) → deck_version`; format is only derivable through that snapshot, and `raw_log` is NOT NULL. Recommended resolution (W0's call, rationale required in the migration comments): keep one table; make `deck_id`/`deck_version` nullable together (`CHECK ((deck_id IS NULL) = (deck_version IS NULL))`), add nullable `format_code` FK for deckless rows, add `source`, and relax `raw_log` to nullable so simulated games can be events-only (no fake Live text).
4. **`opponent_deck` is freetext.** `matchup_stats` needs canonical archetype labels before A2 writes structured fields — an archetype registry is W0 scope, not an afterthought.
5. **Embedding infra already exists on this box.** pgvector 0.8.0 is available in the cluster (the `a co-hosted app` DB uses it with HNSW); `nomic-embed-text` is in local ollama (OpenAI-compatible `/v1/embeddings`). "Same approach as a co-hosted app" is literal: `CREATE EXTENSION vector` in the deckscout DB + ollama embeddings. No new infra, no GPU.
6. **Postgres connection budget is 4** (api 2, sync 1, mcp 1) and it is a hard house rule. Any new sustained DB writer (sim runner, synthesis worker) either batches on an existing slot's cadence or needs Chey's explicit OK for +1. Ask at W0 merge, not mid-build.
7. **Raw Live logs are richer than the parser consumes**: per-card draw reveals, mulligan reveals, shuffles — the deck owner's full hidden information is present. Consequences: (a) the B4 replay harness can validate hand contents, not just prizes/KOs; (b) the log format *defines* the hidden-info boundary for agent matches — the opponent-visible subset is exactly what a log shows about the other player.
8. **Corpus reality: ~10 logs, 1 deck.** Phase-1 answers will say "n=4" — that's correct behavior, not a bug. Honesty about sample size is a standing constraint everywhere stats are reported.
9. **CI runs pure tests only** (no live DB). Engine and parser tests must stay pure; DB-touching tests are excluded from CI by convention.

## 2. Locked UX decisions (from the 2026-08-01 interview)

- **Battle intel is chat-first.** Everything ships as rotom MCP tools consumed from claude.ai / Claude Code. Pokédex UI surfaces for intel (deck battle tab, matchup views) are a later, separate feature — do not bundle them into A-track branches.
- **Sim/gauntlet reports are phased: chat answer → persistent report page → markdown artifact history.** Contract now: the runner persists the full aggregate report as JSON in the DB from day one, so the later phases are render-only.
- **Matches are played on an interactive board UI, phone-first** (one-handed portrait, must work at 390px). Desktop is secondary.
- **Board input is phased:** v1 is tap-to-act — the board renders state and the engine's legal-action list drives tappable choices (tap Active → attack options, tap hand card → play targets). Full direct manipulation (drag from hand, drag energy) is a later enhancement on the same component, not a rewrite.
- **One board component, two data sources.** The board is a pure renderer of game state / event streams; a live match (engine-fed) and a replay of a logged game (battle_events-fed) are the same component. Replay scrubbing therefore ships *before* the engine is done, against real logged games.
- **Coaching is chat-first** (`coach_review` cites turn numbers and comparable games); turn-pinned annotations inside the replay UI are a later enhancement once scrubbing exists.
- **The foil renderer is quarantined**: its own long-lived branch, its own prototype route, zero imports from collection views until Chey explicitly merges it. He wants unhurried craft time on it. The prototype page is a **tuning workbench**: one owned card/variant at a time, real scan, plus dev controls — shader-uniform sliders, pattern override, mask overlay toggle — for tuning recipes against reference photos.

## 3. Feature decomposition

Each feature is one branch + one worktree + one reviewable merge. Branch names are canonical. "Done" lines are merge gates. Anything not stated per-feature (file layout, internal module design) is the implementing agent's judgment — consistent with existing repo conventions (`CLAUDE.md`, `DECISIONS.md`, `apps/mcp/SPEC.md` tool conventions).

### Wave 0 — contracts (serialize; everything else builds on this)

**W0 · `feat/battle-contracts`**
Migration 020 + the shared vocabulary. Scope:
- `battle_log` relaxation per Ground Truth #3, plus `source` (`own_game | shared | simulated | agent_match`, default `own_game`) and structured fields (`my_archetype`, `opp_archetype`, `tags[]`, `key_cards[]`, `narrative`).
- `battle_events` table: `(log_id, seq, turn, actor, type, payload jsonb)` — the interchange format for parser → engine validation → sim output → replay. Starter type taxonomy (refined by A1's census, **additive-only** after this merge): setup events (coin toss, go-first, opening hand, mulligan), turn_start, draw, play_to_bench, play_to_active, play_trainer, play_stadium, evolve, attach, use_ability, attack (name, target, damage), knockout, prize_take, promote/retreat, shuffle, reveal/search, end_turn, game_end (win/concede/timeout).
- Archetype registry (canonical labels + aliases) and how `matchup_stats` will group on it.
- `card_impls`, `gauntlet_decks`, `battle_memories` (pgvector) tables per the source roadmap's data-architecture sketch, adjusted to what the code actually needs.
- `CREATE EXTENSION vector` in the deckscout DB.
**Done:** migration applies clean on the live DB; schema documented in `research/SCHEMA.md`; DECISIONS.md entry recording the one-table-vs-corpus-table rationale and the connection-budget answer from Chey.

### Wave 1 — parallel foundations

**A1 · `feat/battle-events-parser`** (depends: W0)
Extend the pure parser to emit the full event stream. First task: an **event census** across all stored `raw_log`s — derive the final type taxonomy from observed lines, not guesses. Write path populates `battle_events` on ingest and backfills the existing logs. Parser stays pure (no DB, no I/O) with the census logs as fixtures; tolerance remains the prime directive (unknown lines → skipped, recorded in a counter, never a throw).
**Done:** all existing logs re-parse into event streams; unknown-line rate reported per log; CI-pure tests cover every event type with real log excerpts.

**A2 · `feat/battle-synthesis`** (depends: W0; parallel with A1)
**Chat-driven synthesis — no server-side LLM calls** (decided 2026-08-01; follows Chey's established a co-hosted app pattern: Claude in chat reads via MCP, synthesizes, writes back via MCP). Rotom grows a read tool `synthesis_queue` (logs missing narrative/structured fields; returns raw log + parsed output, paged) and a write tool `save_synthesis` (dry-run defaulted) accepting the ~150–300-word retrieval-oriented narrative + structured fields. On commit the server normalizes archetypes through the W0 registry and embeds the narrative via local ollama (`nomic-embed-text`) into `battle_memories`; `battle_search` later embeds query text through the same model. A `battle-synthesis` SKILL.md pins the narrative rubric so any session produces consistent output. Narratives carry the existing `ai_generated` metadata discipline. Backfill = Chey (or a scheduled session) runs the queue in chat.
**Done:** every stored log synthesized through the chat path with narrative, embedding, and canonical archetype fields; re-synthesis is idempotent.

**B1 · `feat/engine-fork`** (depends: nothing)
The fork-vs-greenfield gate. Clone RyuuPlay; evaluate `@ptcg/common`'s state model firsthand (how effects/prompts/replacement effects are modeled; whether `@ptcg/sets` card behavior is declarative or imperative; how SimpleBot enumerates and scores). Deliverables: (a) the **written B2 gap analysis** — engine primitives that exist vs. what Standard 2026 requires, derived from actual card text of Chey's decks + the meta pool; (b) the fork/greenfield decision **in writing** in DECISIONS.md; (c) if fork: `@ptcg/common` + bot vendored as `packages/engine`, building and type-checking in CI, DP-era cruft removed. Vendor into the monorepo (decided — separate-repo option rejected 2026-08-01); expect root-file churn (`pnpm-workspace.yaml`, lockfile), which is why B1 merges early.
**Done:** engine package builds in CI with a smoke test (a legal game of vanilla basics plays to completion); gap analysis + decision documented.

**E1 · `feat/foil-workbench` → long-lived branch `foil/main`** (depends: nothing; interleave anytime)
The quarantined track. Sub-branches off `foil/main` per sub-feature so multiple agents can jam: pattern library (the craft time — 15–20 shader recipes tuned against reference photos, starting with the eras Chey owns), era layout spec (data, not code), mask derivation pipeline (layout-driven tier first; art-driven and hand-corrected tiers later), resolver table + `foil_recipe` MCP tool, and the workbench page itself (own route, real scans, uniform sliders, pattern override, mask overlay toggle; gyro tilt on phone, pointer on desktop, reduced-motion respected). `foil-effects` SKILL.md and a mask-pipeline SKILL.md are part of done for their sub-features. **Nothing under `foil/` imports into, or is imported by, collection views until Chey merges to main.**
**Done (workbench v1):** any owned card/variant renders its real scan with a selectable pattern and a layout-driven mask on the workbench page, tunable live.

### Wave 2 — first consumables

**A3 · `feat/battle-search-tools`** (depends: A2)
MCP read surface: `battle_search` (semantic over narratives, filterable by archetype/format/result/source), `matchup_stats` (aggregates from structured fields; sample size always stated, Wilson interval or explicit n; **defaults to real games** — sim results never silently merged), and `battle_logs` detail extended with the narrative. Follow `apps/mcp/SPEC.md` conventions: compact rows, pagination, honest empty states.
**Done:** the source roadmap's Phase-1 line — "how does this deck do into X and what usually decides it" answered from actual games with n stated.

**D2 · `feat/board-replay`** (depends: A1)
The board component, phone-first, rendering `battle_events` streams — **replay mode ships first**, against real logged games, before any engine work lands. Board-state-per-turn with scrubbing. Card faces from the existing image cache. This merge defines the board's renderer contract (state in → pixels out, no game logic in the component); live-match mode (D1b) plugs into the same contract later.
**Done:** any stored log is watchable and scrubbable on a phone at 390px.

**B2 · `feat/engine-modern-rules`** (depends: B1)
Close the gap analysis: current-form ex + multi-prize rules, current first-turn rules, current trainer/status/timing conventions — whatever the B1 document says Standard 2026 needs that the engine lacks.
**Done:** rule-level tests pass for each gap item; no card-specific work yet.

### Wave 3 — the engine earns trust

**B3 · `feat/card-dsl`** (depends: B2)
The behavior DSL + `card-implementation` SKILL.md (primitive catalog, worked examples per effect category, escape-hatch policy, rulings-check step with citation comments — steal the deckgym-core document's shape). Then implement both of Chey's decks card-by-card, each card with at least one scenario test. `card_impls` rows maintained as the ledger.
**Done:** both current decks' full 60s implemented with passing tests; an agent can implement a new card from the SKILL.md alone.

**B4 · `feat/replay-validation`** (depends: A1 + B3)
The harness: feed a real log's decisions into the engine, assert computed state transitions match the log's stated outcomes (damage, KOs, prizes — and hand contents where the log reveals them, per Ground Truth #7). Every parsed log is a free integration test.
**Done:** the source roadmap's engine gate — Chey's logged games replay with zero state divergence.

**C1 · `feat/gauntlet`** (depends: W0; card_impls gap reporting needs B3's table but not B3's cards)
LimitlessTCG-sourced gauntlet refresh job (on-demand, cached, gentle; check their API/robots situation at build time before writing any scraper). Gauntlet decks stored as ordinary decks tagged with source URL + fetched-at. `impl_gaps(deck_id)` MCP tool reports unimplemented cards per deck so B-track card work is demand-driven.
**Done:** refresh pulls current Standard archetypes; gap report per gauntlet deck.

### Wave 4 — the payoff features

**C2 · `feat/sim-runner`** (depends: B3/B4 + C1)
`simulate(deck_a, deck_b, n, seed?)` — deterministic under seed, SimpleBot (or successor) both sides, emits `battle_events` streams tagged `source: simulated` through the same pipeline (embeddings sampled, not exhaustive — sampling rate is the implementer's call). `gauntlet_run(deck_id, games_per_matchup)` persists its full aggregate report as JSON (per Locked UX: chat consumes it now; report page and markdown export render it later). Honesty constraints are **non-negotiable and encoded in the reporting layer**: standing bot-quality caveat, bot-strength sanity benchmarks (mirror ≈50%, dominant-vs-weak spread sane), small n reported as small n. Runner placement respects Ground Truth #6. Pi-5 performance target: useful, not heroic — a gauntlet run over a coffee ships.
**Done:** `gauntlet_run` on the Dhelmise deck produces a report Chey consults before locals, caveats intact.

**D1 · `feat/match-server`** (depends: B3; interim chat-refereed mode may start anytime)
Engine-mediated matches: `match_start / match_state / match_act / match_concede` MCP tools; `matches` table holds engine-serialized state under the mcp process. Agent turns: serialized state + legal actions → model → validated action (illegal picks bounce; a confused agent can stall, never corrupt). The agent-turn model provider is pluggable and decided in the D1 design doc: Vercel AI Gateway, or a wrapped Claude Code CLI (Sonnet) for personal use — the engine referees regardless, so the provider is swappable. **State-serialization format gets a design doc + SKILL.md first** — compact, legible, hidden-info-respecting (the visible subset per Ground Truth #7); it doubles as the sim debug view. Every match emits a standard log → pipeline, `source: agent_match`.
**Done:** a full match playable through MCP tools alone (chat-only), logged and synthesized like any game.

**D1b · `feat/board-live`** (depends: D1 + D2)
Live-match mode on the board component: tap-to-act from the engine's legal-action list, phone-first. This is the "table" Chey plays on.
**Done:** the source roadmap's D gate — a full match against Claude on the phone, on the board.

**D4 · `feat/coach`** (depends: A3 + D1)
`coach_review(match_id)` — walks the log it played, flags decision points, cites comparable games via `battle_search`, grounded and specific, never generic. Chat-only for now.
**Done:** post-match review references at least one comparable game from the knowledge layer.

### Later / unscheduled (do not start without Chey's go)

- Board direct manipulation (drag from hand, drag energy) on top of D1b.
- Persistent gauntlet report page + markdown artifact history (render C2's stored JSON).
- Turn-pinned coaching annotations in the replay UI.
- Battle-intel Pokédex UI surfaces (deck battle tab, matchup views).
- Foil integration into collection views ("inspect" → 3D) — gated on Chey merging `foil/main`.

## 4. Merge order & parallelization

```
W0 ──┬── A1 ──┬── D2 (board replay)
     │        └── B4 ─┐
     ├── A2 ── A3 ────┼── D4 (coach)
     │                │
B1 ── B2 ── B3 ──┬────┴── C2 (sim)      B1 needs no W0; merge it early
     │           ├── D1 ── D1b          (root-file churn, see §5)
     ├── C1 ─────┘
     └── E1 (foil/main — fully parallel, merges to main only on Chey's call)
```

Wave boundaries are also **checkpoint boundaries** (source roadmap rule, kept): at each one, write a short retro to a co-hosted app — what shipped, what the next wave's real cost looks like — and get Chey's explicit go. The five-project shape of this roadmap is exactly the over-engineering pattern he watches for; the checkpoint is the guardrail.

## 5. Cross-cutting rules for the orchestrator

- **Migrations are the serialization point.** Numbered sequentially (019 is current). Only W0-style contract branches create migrations where possible; when a feature branch genuinely needs one, it takes the next free number **at merge time** (renumber on rebase — never merge a colliding number). Two in-flight branches must never both hold an unmerged migration without the orchestrator knowing.
- **Root-file churn is scheduled, not suffered.** Adding `packages/engine` touches `pnpm-workspace.yaml` + lockfile; land B1 before fanning out Wave-2+ worktrees, and rebase long-lived branches (`foil/main`) after root-touching merges.
- **Every merge appends a dated DECISIONS.md entry** (repo convention) and updates `research/SCHEMA.md` if schema moved.
- **MCP conventions are inherited, not optional:** mutating tools default `dry_run: true`; atomic tools; compact rows; pagination; honest empty states; result-size budgets (see `apps/mcp/SPEC.md`).
- **Honesty in stats is a layer, not a habit:** sample sizes always stated; sim vs. real never silently merged; bot-quality caveats standing.
- **CI purity:** engine/parser/DSL tests are pure (fixtures from real logs); live-DB tests stay out of CI.
- **SKILL.md debt is real debt.** card-implementation, state-serialization, foil-effects, mask-pipeline — each ships with its feature, not after.
- **House rules apply in every worktree:** connection budget (Ground Truth #6), never run the TCGdex API server, image cache is a contract, no shared-infra changes without Chey's OK, rtk-prefix every shell command.
- **Deploy reality:** the app serves from this working tree via pm2. Feature branches in worktrees don't touch the live deployment; only merges to main followed by the documented build/restart do.

## 6. Deliberately open (implementing agents' judgment)

- Event-stream normalization depth v1 (census decides; taxonomy additive-only post-W0).
- Embedding density for simulated games (C2).
- State-serialization format (D1 — design doc first, please).
- Board component internals; whether it lives in `apps/web` or a package.
- Mask-derivation image-analysis approach (classical CV vs. small segmentation model — whatever runs sanely on the Pi).
- SimpleBot successor policy, if the greedy baseline embarrasses itself.

## 7. Sources

- RyuuPlay: github.com/keeshii/ryuu-play — MIT, TS monorepo, ~250 DP/HGSS cards, SimpleBot, release 0.2.0 (2025-07).
- deckgym-core: github.com/bcollazo/deckgym-core — the agent-facing card-implementation SKILL.md shape to copy.
- LimitlessTCG: limitlesstcg.com/decks — check API/terms at C1 build time.
- Rulings: official rules docs + community rulings compendium — verify canonical location at B3 build time.
- Foil taxonomy: bulbapedia.bulbagarden.net/wiki/Holofoil (canonical); Collexy "Database Insight: Holofoil" series; simeydotme/pokemon-cards-css; Daniel Ilett's holofoil Shader Graph tutorials.
