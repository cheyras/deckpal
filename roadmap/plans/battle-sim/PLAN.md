# Battle simulation — plan

**Status:** in build (2026-10-10). Supersedes the build ORDER of `BATTLE-INTEL-SPEC.md`
(whose Wave 0–4 put simulation last); its locked principles that still apply are carried
over below. Sources: the owner's direction of 2026-10-10 and the commissioned research
plan "Pokémon TCG AI build plan" (2026-10-10), folded in here with its user-facing parts
(difficulty, personality, feel, playing against Deck-E) deferred.

## What we are building, and what we are not

Fast, rules-accurate simulation that an assistant (Deck-E in the app, Claude through the
DeckPal MCP) can call to answer deck questions with real data: "how does this list do into
these archetypes", "is v4 better than v3", "how often does this open well". Games are
played by a heuristic CPU player on both sides — **not** an LLM. The assistant reasons
over the numbers; it does not choose moves.

Out of scope for now (wanted later, in this order): playing against the AI on a board UI;
Deck-E as an opponent choosing among the pilot's ranked lines; difficulty and personality
dials; Expanded/GLC; best-of-three; AI deck building.

## Architecture

Two separate things, and the boundary is the point:

- **The engine** (`packages/sim`, `@deckpal/sim`) is the only judge of what is legal. It
  is one function in spirit: (state, choice) → new state + events.
- **The pilot** can only pick from the options the engine lists. It never sees hidden
  information: search runs on *determinised* copies in which everything the player can't
  know is resampled.

Five engine properties everything else relies on:

1. **State is plain data, including unfinished effects.** Card effects are compiled clause
   programs; a program partway through is a frame `(code, pc, vars)` inside the state. A
   game can be saved between requests, cloned for search, and replayed.
2. **Every decision has one shape:** pick between `min` and `max` of a numbered list. The
   list is the legal-move list; nothing else can be submitted.
3. **Randomness comes from seeded streams** in the state (one per deck, one for coins);
   one seed reproduces a game, and coin results can be forced (log replay, tests).
4. **Each player gets a view, not the state** — enforced for the pilot by `determinize`.
5. **Every change is an event**, in the battle_events vocabulary from the battle-intel
   roadmap, so a simulated game, a parsed Live log and (later) a live match are one kind
   of stream.

Changing values (HP, attack cost, Retreat Cost, Weakness, prevention, locks) are computed
when asked from the live static effects, never written onto cards.

## Rules accuracy

Target: Standard (regulation marks H, I, J) under tabletop rules, per the Pokémon TCG
Rulebook last updated September 2026 (setup, turn, attack steps, Checkup), the Tournament
Handbook (public/private information), errata and card text (newest printing wins over a
general rule it contradicts), then the Rulings Compendium; Live's behaviour is evidence
only where documents are silent. Recorded calls the rulebook doesn't settle:

- Both Active Pokémon Knocked Out together: the player whose turn is next takes Prize cards
  first, then promotes first (Compendium, 2018).
- Mutual mulligans cancel; the extra draws are the difference.
- Prize cards are taken from the top of the (random) Prize pile — distributionally identical
  to choosing face-down.
- A tiebreaker game (both players win the same number of ways) is recorded as a draw.

Six checks, each catching what the others miss:

| Check | Where | Gate |
|---|---|---|
| Rule tests, one per rulebook row | `src/__tests__/rules.test.ts` | pass before card work |
| A scenario test per scripted card | `src/__tests__/cards*.test.ts` | no test, not implemented |
| Text round-trip (script rendered to English vs printed text) | `src/cards/render.ts` | no unexplained mismatch |
| Data diff (frames vs a second source) | later | each disagreement resolved |
| Random-play invariants (zones, prizes, damage, limits, determinism, clone/JSON) | `src/__tests__/invariants.test.ts` | every change |
| Live log replay / damage audit | `src/replay/` | no unexplained divergence |

## Cards

A card = its printed frame (catalog, snapshotted in `src/cards/frames.ts` by
`scripts/fetch-frames.mjs` so tests stay pure) + a script composing clauses
(`src/dsl.ts`). Scripts are keyed by **printed text**, so every reprint with identical
text resolves to one script and a reworded printing never silently matches. Cards with no
effect text need no script. Unscripted cards are reported, never hidden: Pokémon run as
approximations (printed damage only), unscripted Trainers/Special Energy can't be played.

The loop (`packages/sim/CARDS.md`): gap analysis (`scripts/coverage.ts`) → extend the
vocabulary only with review → write the script from printed text only → one scenario test →
round-trip → rulings lookup with a citation or `status: 'needs_ruling'`. Licensing: card
text only; no twinleafgg code (no licence file); nothing from the Kaggle/cabt competition
engine; ryuu-play (MIT) informs design.

Coverage order: the owner's decks (Hide 'n' Sneak, Toolbox Slowking — done), then the
gauntlet (the 11 other decks in the account: five scouting reports plus five lists —
91 distinct cards, in four parallel lanes), then demand from users' decks.

## The pilot

A search over its own turn scored by a hand-tuned evaluation (the Hearthstone-competition
pattern), with exact "can I take my last Prizes this turn" checks and an opponent model by
sampling hidden states. Layers, each a working opponent: random → one-step greedy →
own-turn search (transpositions merged, chance sampled) → evaluation weights as data →
exact lethal checks → determinised reply sampling → per-deck profiles. Strength is measured
with paired games (same seed, seats swapped); a 55%-vs-50% difference needs ~800 games, so
reports state n and intervals.

## Product surface

- `deck_odds` (draw math: opening hands, Prizes, cards seen by turn N) — both assistants.
- `simulate_battles` (deck vs opponents, paired games, Wilson intervals, setup speed, card
  impact, Prize liabilities, loss patterns, coverage block, standing caveat) — both
  assistants, read-only, runs inside the 60 s `/api` function with a ~45 s budget.
- Honesty is encoded in the report layer: sample sizes stated, simulation never merged with
  real-game stats, bot-quality caveat, draws/time-outs separate, uncovered cards named.

## Open decisions

- **Compute.** `/api` and MCP functions get 60 s on one CPU. If search-strength pilots need
  more, options are raising `maxDuration` (infrastructure change — owner's approval), a
  chunked fan-out over several invocations, or a browser Web Worker for Deck-E.
- **Rights.** Simulation of card text inside a paid product needs a deliberate decision
  before any match-play feature ships (research plan, "Risks").
- **Opponent model.** v1 assumes the opponent's 60 is known (gauntlet lists); inference from
  revealed cards against archetype lists comes with a meta source (LimitlessTCG).

## Build order (gates, not dates)

1. Engine core + both owner decks — **done** (58 tests).
2. Pilot (search + eval), runner/stats/report, `simulate_battles` tool, gauntlet card lanes,
   round-trip check + CARDS.md, Live-log damage audit — **in progress (parallel lanes)**.
3. Full decision-replay of logged games; opponent inference; deck profiles drafted by a
   model and kept only if they win a paired test.
4. Later, on the owner's go: match play (board UI, Deck-E opponent), difficulty, coach.
