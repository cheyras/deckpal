# Battle events — census & taxonomy (A1 · feat/battle-events-parser)

**Status:** census complete (2026-08-01) over every stored `battle_log.raw_log` (ids 3–12,
10 rows). The taxonomy below is the **registry of record** for `battle_events.type`
(migration 020 keeps `type` regex-checked so this list extends without a migration).
**Additive-only after W0 merges:** never rename or repurpose a type or payload field —
engine validation (B4), sim output (C2) and the board replay renderer (D2) all consume
this stream as a public contract.

- Emitter: `apps/api/src/deck/battleevents.ts` (**pure** — no DB/IO; tolerance contract:
  unknown lines are skipped + counted with samples, never a throw).
- Write path / perspective mapping: `apps/api/src/deck/battleevents-db.ts` (gated on 020).
- Backfill + live census: `pnpm --filter pokedex-api backfill:events` (dry-run by default).
- Fixture census: `pnpm --filter pokedex-api census:events`.
- Fixtures: `apps/api/src/deck/__tests__/fixtures/battle-logs/battle-{03..12}.txt` — the real
  stored logs, exported verbatim (Chey's own games; battle-06 is a freetext note kept as
  a tolerance fixture).

## 1. Census method & corpus

Every line of every stored log was clustered by masked shape (player names → `P`,
`(set_local)` refs → `(ID)`, numbers → `N`), yielding ~635 distinct shapes; the grammar
below was then iterated until the only unmatched lines were human freetext. Final rates:

| log | events | turns | unknown / considered | note |
|---|---|---|---|---|
| battle-03 | 236 | 14 | 0 / 274 | bare-name format |
| battle-04 | 198 | 10 | 1 / 233 | trailing "Chey's notes: …" |
| battle-05 | 173 | 14 | 1 / 206 | trailing "Chey's notes: …" |
| battle-06 | 0 | 0 | 1 / 1 (rate 1) | freetext only — correct degradation |
| battle-07 | 170 | 10 | 0 / 186 | |
| battle-08 | 114 | 11 | 0 / 130 | timeout ending |
| battle-09 | 183 | 12 | 0 / 216 | Dudunsparce ability-as-play |
| battle-10 | 81 | 7 | 0 / 104 | 6 mulligans, no-bench ending |
| battle-11 | 140 | 10 | 0 / 179 | ID-prefixed format |
| battle-12 | 154 | 11 | 0 / 196 | poison / Pokémon Checkup |

Corpus: **3 / 1725 unknown (0.17%)** — all three are deliberate (freetext notes).
CI asserts these counts exactly plus rate < 1% per real log (`battleevents.test.ts`).

Two raw-log dialects exist: pre-≈July-2026 logs use bare card names; newer logs prefix
every card mention with a printing id — `(me5_39) Dhelmise`, optionally with a variant
suffix (`(me3_48_ph) Gastly`). The ref is `<tcgdexSetId>_<localId>[_variant]`, i.e.
directly joinable to the catalog/image cache — D2 should use it when present.

## 2. Envelope

Parser output (`BattleEvent`, neutral): `{ seq, turn, actor, type, payload }`

- `seq` — 1-based, dense, total order within the log.
- `turn` — 0 during setup, then increments at each `<name>'s Turn` header. `Pokémon
  Checkup` and game-end events keep the current turn.
- `actor` — player **screen name**, or `null` for system lines (the pure parser cannot
  know deck ownership).

DB rows (migration 020) are written by `battleevents-db.ts` with two mappings:

- `actor`: owner screen name → `'me'`, other → `'opp'`, `null` → `'system'`. The owner is
  identified exactly as ingest does (deck-name overlap / explicit `playerName`); a log
  whose owner cannot be identified is **skipped, never mis-anchored** (backfill reports
  it). Payloads keep display names (blessed by the 020 column comment).
- `turn`: parser `0` → SQL `NULL` (020: `CHECK (turn >= 1)`, NULL = pre-game).

Note one deliberate delta from 020's `actor` column comment (which lists coin_toss /
game_end as examples of `'system'`): when the Live line names an acting player
("cheyras chose heads…", "… PlayerA wins.") we keep that attribution (`me`/`opp`) —
more information, same CHECK. `'system'` is used only where the line names no player
(checkup, tool activations, effect negations, condition damage).

`CardRef` (used everywhere a card appears): `{ name: string; ref?: string }`.
`BoardRef` (a Pokémon in play): `{ player: string|null; card: CardRef }`.

## 3. Type taxonomy (registry of record)

32 types observed + 1 synthesized (`concede` — no stored concession yet; shape pinned by
test). Payload fields marked `?` are present only when the log states them. `via?: string`
on an event means it was a nested resolution line (dash-prefixed) and names the card or
move whose effect produced it (e.g. evolve `via: 'Rare Candy'`, switch `via: "Boss's
Orders"`).

| type | actor | payload | example line |
|---|---|---|---|
| `coin_toss` | caller/winner | `{call?: 'heads'\|'tails'; won?: true}` — one event per line (call line, won line) | `cheyras chose heads for the opening coin flip.` |
| `go_first` | decider | `{order: 'first'\|'second'}` | `OppCharlie decided to go first.` |
| `opening_hand` | drawer | `{count; cards?: CardRef[]}` — cards only for the log owner (§5) | `cheyras drew 7 cards for the opening hand.` |
| `mulligan` | mulliganer | `{count; cards?: CardRef[]}` — reveal groups fold in | `xTheWizardx took 5 mulligans.` |
| `turn_start` | turn player | `{turn}` | `cheyras's Turn` |
| `draw` | drawer | `{card?; count?; cards?; to?: 'bench'; reason?: 'mulligan_bonus'; via?}` — `to:'bench'` = drawn straight into play (Poffin) | `cheyras drew Boss's Orders.` |
| `end_turn` | turn player | `{timeout?: true}` — timeout = "didn't take an action in time" | `cheyras ended their turn.` |
| `checkup` | system | `{}` — between-turns Pokémon Checkup marker | `Pokémon Checkup` |
| `play_to_bench` | player | `{card; via?}` | `cheyras played Shuppet to the Bench.` |
| `play_to_active` | player | `{card; via?}` | `cheyras played Poltchageist to the Active Spot.` |
| `play_card` | player | `{card; via?}` — see §4 polysemy | `cheyras played Ultra Ball.` |
| `play_stadium` | player | `{card; via?}` — placement only; later uses are `play_card` | `cheyras played Prism Tower to the Stadium spot.` |
| `evolve` | owner | `{from; to; where?: 'active'\|'bench'; via?}` | `cheyras evolved Shuppet to Banette in the Active Spot.` |
| `attach` | owner | `{card; to; where?; via?}` — energy AND tools | `cheyras attached Air Balloon to Dhelmise in the Active Spot.` |
| `retreat` | owner | `{card; via?}` | `cheyras retreated Dhelmise to the Bench.` |
| `promote` | owner | `{card; via?}` — new Active after KO/retreat/switch | `cheyras's Poltchageist is now in the Active Spot.` |
| `switch` | board owner | `{in; out; via?}` — `in` becomes Active; via = the gust/switch effect | `- cheyras's Dhelmise was switched with cheyras's Poltchageist to become the Active Pokémon.` |
| `attack` | attacker's owner | `{attacker; move; target: BoardRef; damage; modifiers?: {amount, reason}[]; breakdown?: {label, amount}[]; extra?: string}` — amounts signed as printed; `extra` = unrecognized trailing rider text, preserved verbatim | `OppFoxtrot's Mega Darkrai ex used Dusk Raid on cheyras's Dhelmise for 440 damage. …took 220 more damage because of Darkness Weakness.` |
| `use_move` | user's owner | `{user; move; target?; breakdown?}` — see §4 | `cheyras's Fezandipiti ex used Flip the Script.` |
| `knockout` | **owner of the downed mon** | `{card}` | `cheyras's Dhelmise was Knocked Out!` |
| `prize_take` | taker | `{count}` | `OppFoxtrot took 2 Prize cards.` |
| `hand_add` | hand owner | `{card: CardRef\|null}` — null = hidden ("A card was added…") | `Buddy-Buddy Poffin was added to cheyras's hand.` |
| `discard` | owner | `{card?; count?; cards?; from?: BoardRef; via?}` — `from` = discarded off a mon (KO cleanup, energy costs) | `- 2 cards were discarded from cheyras's Banette.` |
| `shuffle` | shuffler | `{zone: 'deck'\|'hand'; card?; count?; cards?; via?}` | `- cheyras shuffled their deck.` |
| `move_cards` | mover | `{to: 'hand'\|'deck'\|'deck_bottom'\|'discard'; card?; count?; cards?; owner?; via?}` — `owner` = whose cards, when the mover is someone else (Prism Tower) | `- cheyras moved OppAlpha's 2 cards to the discard pile.` |
| `damage_counters` | placer / system | `{count; target: BoardRef; condition?; via?}` — `condition` set for checkup poison ticks | `1 damage counter was placed on OppFoxtrot's Mega Darkrai ex for the Special Condition Poisoned.` |
| `damage` | target owner | `{target; amount; via?}` — non-attack damage (bench snipes) | `- cheyras's Shuppet took 30 damage.` |
| `heal` | target owner | `{target; amount; via?}` | `- OppGolf's Lurantis ex healed 30 damage.` |
| `condition` | target owner | `{target; condition; via?}` — Poisoned/Burned/Asleep/Paralyzed/Confused | `- OppFoxtrot's Mega Darkrai ex is now Poisoned.` |
| `effect_negated` | system | `{effect; card}` | `- Effects of Poison Jab did not affect Shuppet.` |
| `activate` | system | `{card}` — tool/energy trigger; the line names no owner | `Telepathic Psychic Energy was activated.` |
| `concede` | conceder | `{}` — terminal when no `game_end` follows | `Misty conceded.` |
| `game_end` | winner | `{winner; reason: 'prizes'\|'timeout'\|'no_bench'\|'unknown'; note?}` — `note` = the non-standard prefix sentence verbatim | `Opponent was inactive for too long. PlayerA wins.` |

Structural non-events: the `Setup` header and blank lines are recognized but emit
nothing (the stream starts at the first coin-toss line; turn 0 marks setup).

## 4. Reconciliation with the W0 starter list

Migration 020's table comment carries the spec's starter taxonomy; per spec §3 the census
refines it. Deltas, with rationale:

| starter | census | why |
|---|---|---|
| `play_trainer` | **`play_card`** | The bare `P played X.` shape is polysemous: trainer plays, a stadium's per-turn use (`played Prism Tower.` after placement), and an in-play Pokémon's self-activated ability (`played Dudunsparce.` = Run Away Draw). A pure parser cannot distinguish without card data; a neutral name beats a wrong one. Consumers with card data (B4) resolve which. |
| `use_ability` | **`use_move`** | Same polysemy the other way: `P's X used Y.` (no damage clause) is an Ability (Flip the Script) **or** a damage-less attack (Hide 'n' Sneak — the corpus deck's core attack). Deliberately not guessed. `attack` (targeted, `for N damage`) matches the starter's intent unchanged. |
| `reveal` / `search` | folded `cards?: CardRef[]` + `hand_add` / `move_cards` / `draw{to:'bench'}` | Live never emits standalone reveal/search lines — reveals are sub-bullets of the causing action (`- 7 drawn cards.` → `• …`), so they fold into the parent event's `cards`; searches surface as their outcome (drew / added to hand / moved). |
| `game_end (outcome win\|concede\|timeout, winner)` | `game_end {winner, reason, note?}` + separate `concede` | Live's endings are richer than win/concede/timeout: observed `reason` values are `prizes` (incl. "Opponent took all of their Prize cards.", KO-sweep phrasing), `timeout`, `no_bench`; `unknown` is the tolerance fallback. A concession is its own line and event. |
| `prize_take` | `prize_take {count}` | Merged "took a Prize card" / "took N Prize cards" into one type with count. |
| — | `checkup`, `hand_add`, `discard`, `move_cards`, `damage_counters`, `damage`, `heal`, `condition`, `effect_negated`, `activate`, `switch` | Observed line families the starter list didn't anticipate (census additions; all regex-conformant, no migration needed). |

Everything else (`coin_toss`, `go_first`, `opening_hand`, `mulligan`, `turn_start`,
`draw`, `play_to_bench`, `play_to_active`, `play_stadium`, `evolve`, `attach`,
`knockout`, `promote`, `retreat`, `shuffle`, `end_turn`) matches the starter list.

## 5. Hidden-information boundary (Ground Truth #7)

The stream carries exactly what the log states, so the owner/opponent asymmetry is
preserved verbatim:

- Owner: opening hand fully listed, every draw named, mulligan hands revealed.
- Opponent: `drew a card.` (`draw {count:1}`), `A card was added to …'s hand.`
  (`hand_add {card:null}`), opening hand as bare count. **Mulligan hands are the
  exception — Live reveals both players' mulligans** (battle-10 shows the opponent's
  full 7 five times).

B4 can therefore validate the owner's hand contents turn by turn; the opponent-visible
subset of a stream is precisely what an agent opponent may see (D1).

## 6. Known limits & hardening (tolerated, documented)

Hardening from the 2026-08-01 adversarial review (attack corpus committed as
`__tests__/fixtures/adversarial/`, invariants pinned in `battleevents.test.ts`):

- **Folds are adjacency-scoped**: a `Damage breakdown:` / reveal / drawn-cards
  directive only enriches the immediately preceding compatible event; distant or
  orphaned directives (and bullets after an unknown line) count unknown instead of
  mutating older history.
- **Numeric captures are capped** (≤9 digits) and any line containing a 10+ digit
  run is unknown wholesale — payloads can never carry non-finite numbers.
- **Attack riders are consumed exactly**: unrecognized trailing sentences after the
  damage clause land verbatim in `attack.payload.extra`, never silently dropped;
  a damage-clause line can never degrade into `use_move`.
- **Concede requires a word boundary**; **lines split on LF, CRLF and lone CR**.

Remaining tolerated limits:

- Bullet card lists split on `', '` — a card name containing a comma would mis-split
  (none exists in the corpus or Standard today).
- An attack whose move name contains ` on ` could mis-split move/target (none observed).
- `play_card` / `use_move` polysemy per §4 — downstream card data resolves.
- The stored `parsed` jsonb for battle #11 (written pre-fix) has flipped
  perspective fields (`players.me = OppBravo` at high confidence) — the nameKey
  ref-strip in battlelog.ts fixes the parser; the stored row heals if re-parsed
  (row-level result/opponent were caller-supplied and are correct). See DECISIONS.md
  2026-08-01.

## 7. Gating & runbook (until W0 merges)

Code is live in this branch but **no DB writes happen pre-020**: the ingest hook
(`POST /decks/:id/logs` → `tryWriteBattleEvents`) probes `to_regclass('battle_events')`
and no-ops while the table is missing. After W0 merges to main and migrates:

1. Rebase this branch onto main (verify migration 020 is exactly the DDL this code
   was written against — actor CHECK, turn CHECK, type regex).
2. `pnpm --filter pokedex-api backfill:events` (dry-run) → review per-log report.
3. `pnpm --filter pokedex-api backfill:events -- --write` — one connection, idempotent
   (replace-per-log). Expected: 9 logs written, battle-06 skipped (freetext).
4. New ingests populate `battle_events` automatically from then on.
