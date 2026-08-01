# Engine gap analysis — RyuuPlay (`@ptcg/common`) vs. Standard 2026

**B1 deliverable (2026-08-01). This is B2's requirements document.**
Evaluated firsthand from a clone of `github.com/keeshii/ryuu-play` @ `9cd20b6`
(MIT, release 0.2.0). Requirements are derived from *actual card text*: Chey's
Dhelmise deck (24 unique cards, read from the live catalog via the read API) and a
verified sample of current-meta staples (18 cards fetched from the local catalog,
which carries regulation marks and per-card `legal` flags). Decision itself:
see DECISIONS.md 2026-08-01 entry ("B1: fork RyuuPlay").

## 0. Ground truths about the format (verified 2026-08-01)

- **Standard 2026 = regulation marks H + I.** Verified against the catalog's
  `legal.standard` flags: Iono `sv04.5-080` (G) and Technical Machine: Evolution
  `sv04-178` (G) are `standard: false`; everything H/I sampled is `standard: true`.
- Consequence: **Technical Machines are NOT in Standard 2026** (all TMs are reg G).
  The spec's mention of them is covered below as the general "granted attacks"
  mechanism (§2 G4) — wanted for Expanded/gauntlet breadth, not required for the
  B2 gate.
- **Lost Zone is not required for Standard 2026** (Lost-Zone cards were F/G; none
  in the H/I sample or either deck). Adding a zone later is cheap (§2 G13).
- **Mega Evolution era mechanics** (sets `me01`–`me05`, mark I): Mega Evolution
  Pokémon ex evolve *normally* (no Spirit-Link-style tempo cost, may attack the
  same turn) and give up **3 prizes**; regular ex give 2. Sources: TPCi press
  release for ME—Perfect Order; Bulbapedia "Mega Evolution (TCG)"; catalog card
  rows (Mega Gardevoir ex `me01-060` hp 360, suffix `ex`, mark I).
- **First-turn rules (current)**: the player going first draws normally but may
  neither attack nor play a Supporter on their first turn. No 2026 rulebook change
  to this (PokéGym Feb-2026 rulebook-update roundup: no major rule change since
  SV). B2 must re-verify against the then-current rulebook PDF when implementing.
- Corpus note: the plan says "Chey's two decks"; **only one deck exists in the DB
  today** (`Hide 'n' Sneak (Dhelmise)`, 60 cards, standard-legal). Requirements
  below use that deck + the meta sample. When deck #2 appears, B3 implements it
  card-by-card per its own plan; no new *rule-level* category is expected from it
  that the meta sample doesn't already cover.

## 1. What the engine already has (verified by reading the source)

The core is ~150 files of framework-free TypeScript (`packages/common`), one
runtime dep (`@progress/pako-esm`, used only by the replay encoder). Architecture:

- **Redux-style store with effect propagation.** Actions → reducers → `Effect`
  objects that are offered to *every card in play, hand, deck, discard and prizes*
  (`Store.propagateEffect`) before the default reducer runs. Cards override
  `reduceEffect(store, state, effect)` and may mutate the effect or set
  `effect.preventDefault = true`. **This is a real replacement-effect system** —
  interception is how Abilities, Tools, and Stadiums modify game rules.
- **Prompt/continuation model for choices.** All player decisions (choose cards,
  attach energy, coin flips, deck shuffles, ordering) are `Prompt` objects with
  validate/decode hooks; multi-step card scripts are generator functions that
  yield on prompts. Store snapshots state before each action and rolls back on
  `GameError` → illegal moves can never corrupt state.
- **All randomness flows through prompts** (ShuffleDeckPrompt, CoinFlipPrompt
  resolved by a `BotArbiter`). The store itself contains zero `Math.random`.
  Determinism for the C2 sim runner is therefore *one seeded arbiter away*.
- **Hidden information is modeled**: `CardList.isSecret/isPublic`, serializer
  strips hidden zones per viewer. Matches Ground Truth #7's hidden-info boundary.
- **Multi-prize KOs are parameterized**: `KnockOutEffect.prizeCount` is mutable;
  the DP-era `POKEMON_EX` tag already adds +1. Modern ex/Mega are tag handlers.
- **Rules object per format**: `Rules { firstTurnDrawCard, firstTurnUseSupporter,
  noPrizeForFossil }` attached to `State`, set per format via
  `CardManager.defineFormat(name, sets, rules)`.
- **Deck validation** (`DeckAnalyser`): 60 cards, 4-per-name (basic energy
  exempt), ≥1 Basic, **Ace Spec singleton already enforced** (`CardTag.ACE_SPEC`
  exists — BW-era Ace Specs; same rule as SV/ME-era ones).
- **Per-turn bookkeeping**: `energyPlayedTurn`, `retreatedTurn` (retreat
  once/turn), supporter zone (one/turn, discarded at end of turn),
  `stadiumUsedTurn` (Prism Tower's "once during each player's turn" works today),
  per-slot `pokemonPlayedTurn` (evolution sickness), marker system for
  "once during your turn" abilities and "during your next turn" restrictions.
- **Special conditions**: all five, processed between turns; paralysis clears at
  end of owner's turn; confusion = flip on attack, tails → 30 to self + turn ends.
- **Dynamic bench size**: `CheckTableStateEffect.benchSize` + discard-down
  prompts when it shrinks — exactly the machinery Area Zero Underdepths needs.
- **Status/ability timing hooks**: Check effects (`CheckHpEffect`,
  `CheckProvidedEnergyEffect`, `CheckAttackCostEffect`, `CheckRetreatCostEffect`,
  `CheckTableStateEffect`) let cards modify HP, energy provision, attack/retreat
  costs — the standard modern ability surface.
- **Tools** occupy `PokemonSlot.trainers` with `AttachPokemonToolEffect` and
  `UseTrainerInPlayEffect`; Air Balloon is a `CheckRetreatCostEffect` intercept,
  Jamming Tower is a blanket intercept of tool effects. Both fit today.
- **Bot**: `SimpleBot` = ordered greedy tactics (attack, evolve, energy, trainer,
  retreat, …). Each tactic proposes actions, simulates them on a cloned
  headless `Simulator`, scores the result with a weighted `StateScore`
  (hand/bench/energy/damage/prizes/…, all weights in options), picks the best;
  per-prompt resolvers answer prompts the same way. Enumeration is
  tactic-driven, not exhaustive — fine as the C2 baseline, swappable via `BotAi`.
- **State serializer + replay format** (pako-compressed diff chain) — prior art
  for D1's state-serialization design doc, not used by the engine loop itself.
- **Card behavior is imperative TypeScript**, not declarative data: each card in
  `@ptcg/sets` overrides `reduceEffect` (e.g. Professor Juniper ≈ 15 lines;
  Eelektrik's Dynamotor ≈ 50 with marker + prompt). There is a small library of
  **reusable parameterized templates** (`sets/src/common/`: Poké Ball, Rare
  Candy, Switch, Potion, call-for-family, metronome/copy-attack, protective
  dust…). So ~40% of B3's DSL already exists as *convention*; the DSL itself
  (declarative layer + escape hatch to raw `reduceEffect`) is B3's job.

## 2. Gap list — what Standard 2026 needs that the engine lacks

Ordered by priority for B2. Each item cites the card text that demands it.

**G1 · First-turn attack ban (rule flag).** Nothing prevents attacking on
turn 1. `Rules` has `firstTurnDrawCard`/`firstTurnUseSupporter` but no
`firstTurnCanAttack`. Add the flag, enforce in `useAttack` when
`state.turn === 1`, and define the standard-2026 `Rules` preset
(draw: yes, supporter: no, attack: no). *Cards: whole format.*

**G2 · Modern tag taxonomy + Rule Box predicate.** `CardTag` lacks: lowercase
`ex` (2 prizes, SV/ME form), `MEGA` (3 prizes), `TERA` (bench damage
protection), owner prefixes (`N's`, `Lillie's`, `Hop's`, `Ethan's` — referenced
by card text: "Choose 1 of your Benched **N's Pokémon's** attacks", N's Zoroark ex
`sv09-098`), and a derived `hasRuleBox` predicate ("Discard up to 2 Pokémon that
**don't have a Rule Box**" — Gwynn `me05-078`; Poké Pad `me03-081`; Neutralization
Zone `sv06.5-060`). Tags are `string[]` — additive, no migration pain. The
catalog already carries `flags.ruleBox` per card, so the B3 bridge can populate
tags mechanically.

**G3 · Prize counts for modern ex / Mega ex.** One handler in `gameReducer`'s
`KnockOutEffect` branch per tag: `ex` → +1, `MEGA` (which are also `ex`) → +2
total over baseline. *Cards: Bloodmoon Ursaluna ex (2), Mega Gardevoir ex
`me01-060` (3).* Depends on G2. Also G2's `TERA` tag needs its bench-protection
replacement effect ("Prevent all damage done to your Benched Tera Pokémon by
attacks") as a rule-level intercept, not per-card.

**G4 · Attack enumeration is hardwired to the active card's own attacks.**
`playerTurnReducer` only reads `player.active.getPokemonCard().attacks`. Copying
another Pokémon's attack *through a card's own attack* works today (metronome
pattern — Night Joker, N's Zoroark ex, is implementable). What cannot work is an
attack **granted by an attached card** (Technical Machines, reg G — Expanded
only). B2 should add a `CheckAttacksEffect` (or extend `CheckAttackCostEffect`)
so attached/foreign attacks can join the legal-action list. Medium priority:
not needed for the Standard-2026 gate, needed before gauntlet/Expanded work.

**G5 · Burn semantics are DP-era.** Engine: flip between turns, tails → damage,
condition never self-clears. Modern: **20 damage always, then flip; heads →
condition removed**. Fix in `handleSpecialConditions`; also process conditions in
canonical order (Poison → Burn → Asleep) rather than insertion order.
*Cards: any burner; rule-level correctness for replay validation (B4).*

**G6 · Seeded RNG for the arbiter.** `BotArbiter` RANDOM modes and its shuffle
use `Math.random`. C2's contract is `simulate(deck_a, deck_b, n, seed?)`.
Because *all* randomness is prompt-resolved (§1), it suffices to give
`BotArbiter` (and SimpleBot's tie-breaking, if any) an injectable PRNG
(e.g. mulberry32). Small, but do it in B2 so every later test can be
deterministic.

**G7 · Ability-use limits across copies.** "You can't use more than 1
Flip the Script Ability each turn" (Fezandipiti ex `sv06.5-038`) — a *player*-
scoped once-per-turn marker keyed by ability name, vs. the existing per-card
markers. Convention + helper, not architecture. Same machinery covers
"once during each player's turn" trainer text (Prism Tower `me04-080` — already
supported via `stadiumUsedTurn`).

**G8 · Self-restriction windows.** "During your next turn, this Pokémon can't
attack / can't use <attack>" (Blood Moon `sv06-141`, Mega Brave `me01-077`,
Brave Slash `sv09-111`). Marker set on attack, checked in `UseAttackEffect`
intercept, cleared at end of *next* turn. Prior art exists in DP cards; B2
should promote it to a named primitive because a third of sampled attackers
carry this clause.

**G9 · Item lock and effect-prevention windows.** Budew `sv08.5-004` ("during
your opponent's next turn, they can't play any Item cards"), Dig/Hide 'n' Sneak
("prevent all effects/damage done to this Pokémon") — all are effect intercepts
(`PlayItemEffect`, `PutDamageEffect`, targeted-effect checks) with turn-scoped
markers. Machinery exists (`protective-dust.ts` prior art); B2 adds the
turn-window marker helpers; B3 makes them DSL primitives.

**G10 · Bench-size stadium (Area Zero Underdepths `sv07-131`).** Conditional
bench size 8 *only while that player has a Tera in play*, with ordered
discard-down when the condition lapses. `CheckTableStateEffect.benchSize` is
per-*table* today, needs to be per-*player* and re-evaluated when the stadium or
the Tera leaves. Small state-model change — flagged because it touches
`handleBenchSizeChange`'s player loop.

**G11 · Damage-counter placement/movement at modern scale.** Phantom Dive
(6 counters split over bench), Munkidori's Adrena-Brain (move up to 3 counters),
Cruel Arrow (fixed 100 to a benched target), Sinistcha's 4-counters-on-each.
`PutDamageEffect` / `PutCountersEffect` / `MoveDamagePrompt` /
`DamageMap`-style prompts all exist. **No gap** — listed to record that B3's DSL
needs these as first-class primitives with tests, not new engine work.

**G12 · On-attach triggered energy.** Telepathic Psychic Energy `me03-088`
(attach from hand → search 2 basics onto bench) — `AttachEnergyEffect` intercept
on a special energy card; `provides` override exists. DSL category, no engine gap.

**G13 · Zones.** No Lost Zone. Not required for Standard 2026 (§0). When it
returns (or for Expanded), it is one more `CardList` on `Player` + serializer
entry. Defer.

**G14 · Catalog bridge (for B3, recorded here).** `CardManager` keys cards by
`fullName` strings and formats by explicit set arrays. Our source of truth is
the pokedex catalog (`cardId` like `me05-039`, regulation marks, `legal` flags).
B3 must define the mapping (`fullName ↔ cardId`) when wiring `card_impls`, and
the standard-2026 format should be *derived from regulation marks*, not
hand-listed sets.

**G15 · Mid-prompt state is not serializable.** Pending prompts hold `then`
closures inside `Store` (`promptItems`), so a match can only be persisted at
quiescent points (no unresolved prompts) or by replaying the action log. This is
fine for B4 (replay = action feed) and for C2 (in-memory games), but **D1's
`matches` table must persist either at stable points or as an event-sourced
action log**. Recording it now so D1's design doc starts from reality.

**G16 · Perf note for the Pi (C2).** `Store.reduce` deep-clones the entire
state before every action (rollback safety), and SimpleBot clones a Simulator
per candidate action. Fine for turn-based play and coffee-scale gauntlets;
if C2 needs more, the knobs are cheaper clone (structuredClone / immutable
zones) — *measure first*, don't redesign.

## 3. What we deliberately discard from upstream

- `packages/play` (Angular 15 web client), `packages/cordova` (mobile shell),
  `packages/server` (Express + WebSocket lobby + **TypeORM/SQLite** — the only
  persistence in the repo; the game core has none, so there is nothing to strip
  *inside* the core), `avatars/`, `scans/`, `docker/`, `fastlane/`.
- `@ptcg/common`'s lobby-flavored interfaces (login/profile/ranking/avatar/
  message) ride along for now — they are type-only, tiny, and removing them
  touches the public index; B2 may prune once it owns the API surface.
- Upstream's ~119 jasmine specs for DP/HGSS *card implementations* (the card
  sources themselves are kept as DSL prior art). Core specs (~36 across
  store/serializer/game/bot) are ported to `node:test` and kept green.

## 4. deckgym-core SKILL shape (for B3's card-implementation SKILL.md)

Read `bcollazo/deckgym-core` → `.claude/skills/implement-cards/SKILL.md`
(AGPL repo — **shape only, no code**). Structure worth copying:

1. Intro = the TDD workflow + how to find unimplemented cards (our analog:
   `card_impls` gap query / `impl_gaps` tool).
2. One section per effect category — Abilities / Attacks / Tools / Trainers /
   Stadiums — each with: how to look up card data, how to map effect text onto
   the primitive catalog (their `*MechanicMap`s ≈ our DSL primitives), where the
   implementation lives, worked example.
3. Helper-function discipline to keep dispatch sites small.
4. Appendix: exact test/lint commands an agent runs before claiming done.

B3 additions per spec §3: escape-hatch policy (raw `reduceEffect` when the DSL
can't express it, with a comment citing this doc), and a rulings-check step with
citation comments.

## 5. B2 done-gate restated against this list

Rule-level tests for **G1, G2+G3 (tags/prizes/Tera), G5, G6, G7, G8, G9, G10**;
G4 optional (Expanded); G11/G12 explicitly deferred to B3 as DSL categories;
G13 deferred; G14/G15/G16 are requirements on B3/D1/C2 respectively, not B2.
