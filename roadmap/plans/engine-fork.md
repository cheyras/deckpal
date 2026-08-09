> **Predates the cloud pivot -- re-scope before executing.**

# B1 · feat/engine-fork

**Wave 1 — merge early: this branch churns root files (`pnpm-workspace.yaml`, lockfile).**
Worktree: `~/pokedex-worktrees/engine-fork` · Depends: nothing · Dev server: none.
Spec: §3 Wave 1, §7 sources.

## Mission
The fork-vs-greenfield gate for the rules engine. Evaluate RyuuPlay firsthand, decide in
writing, and (if fork) land a gutted, building `packages/engine`.

## Scope
- [ ] Clone `github.com/keeshii/ryuu-play` (MIT, TS, ~250 DP/HGSS cards). Read `@ptcg/common`
      for real: how effects/prompts/replacement effects are modeled; whether `@ptcg/sets` card
      behavior is declarative data or imperative code (this decides how much of the B3 DSL
      already exists); how `SimpleBot` enumerates legal actions and scores states.
- [ ] **Written gap analysis** (the B2 requirements doc): engine primitives that exist vs. what
      Standard 2026 needs — current-form ex + multi-prize, current first-turn rules, Ace Specs /
      Technical Machines / current trainer conventions, status+ability timing, current Stadium
      wording. Derive requirements from actual card text: Chey's two decks + a sample of current
      meta lists. Also read `bcollazo/deckgym-core`'s agent-facing card SKILL for document shape.
- [ ] **Decision in writing** (DECISIONS.md): fork vs. greenfield. Greenfield needs explicit
      justification — it is the over-engineering risk here; a state model that "fights modern
      mechanics badly" is the bar, not aesthetic preference.
- [ ] If fork: vendor `@ptcg/common` + the bot into `packages/engine` (monorepo — decided
      2026-08-01; no separate repo). Discard Angular client, Cordova, websocket server. Strip
      TypeORM/SQLite if the engine core doesn't need persistence. Keep only the card
      implementations useful as DSL prior art. Builds + typechecks in CI.
- [ ] Smoke test: a legal game of vanilla basics plays to completion under the bot.

## Done gate
Gap analysis + decision documented; `packages/engine` builds in CI with the smoke test green
(or, if greenfield: the justification + a skeleton package with the same smoke test).
