# Implementing a card for the simulator

This is the guide an agent follows, alone, to make one card playable in
`@deckpal/sim`. A card's behaviour is **data**: a `CardScript` (`src/dsl.ts`)
composed from a fixed vocabulary of clauses. You do not write engine code to
implement a card. If the vocabulary cannot say what the card says, that is a
vocabulary gap, and it gets reviewed before you fill it (step 2).

All commands run from `packages/sim`:

```bash
node --import tsx scripts/coverage.ts            # which cards still need scripts
node --import tsx scripts/roundtrip.ts <id|name> # printed text vs your script, rendered back to English
node --import tsx --test src/__tests__/*.test.ts # every test, including the round trip
npx tsc --noEmit -p .                            # typecheck
```

---

## The loop

Do these steps for every card, in order. A card is not implemented until all
six are done.

### 1. Gap analysis

```bash
node --import tsx scripts/coverage.ts
```

This lists every distinct card text in the gauntlet decks (`src/__tests__/gauntlet.ts`)
that has no script yet: the canonical id, category, name, how many decks use it,
and every printing that shares its text. Vanilla cards (no effect text) never
need a script. Pick a card, open its frame in `src/cards/frames.ts` (search for
`"<id>": {`), and read **only** the printed text there: `effect`, `abilities[].effect`
and `attacks[].effect`, plus the damage column `attacks[].damage`.

Before writing anything, list each sentence of the text and the clause that
expresses it (catalogue below). If a sentence has no clause, go to step 2.
Otherwise skip to step 3.

### 2. Extend the vocabulary, with review

`src/dsl.ts` is engine code: a change there changes every card that uses the
clause. In order of preference:

1. **Compose existing clauses.** Most "new" effects are a `chooseCards` + `move`,
   an `if` around something, or an `Expr` you haven't seen yet.
2. **Add a clause to `dsl.ts`** when the effect recurs, or plainly will (a new
   `Filter` field, a `StaticEffect` kind, a `TriggerOn`). You also implement it
   in `interp.ts`/`query.ts`, add a rule or card test that exercises it, and give
   it a rendering in `src/cards/render.ts`. The renderer's `switch` statements are
   exhaustive, so `tsc` fails until you add that rendering. Flag the change in
   your report for review. Don't slip it in as a side effect of scripting a card.
3. **Escape hatch** (`custom`) only when the effect really is one of a kind (see
   *Escape-hatch policy*).

### 3. Write the script from the printed text only

Add the script to the file for your lane (`src/cards/scripts/{sv,me,ghost,fighting,metal,misc}.ts`;
`index.ts` concatenates them). Rules:

- `id` is the canonical printing from `coverage.ts`; `name` must equal the frame's
  name exactly (the registry throws otherwise).
- Above each part, quote the printed sentence it implements, as a comment. The
  existing scripts all do this. A reviewer should be able to check the script
  against the quote without opening anything else.
- Attack scripts are keyed by the **exact** attack name and Ability scripts by the
  exact Ability name. A misspelt key is silently ignored by `buildDef`. The round
  trip reports it ("not on the card"), but get it right first time.
- The printed damage column is the attack's base. A script only adds what the text
  says: `damage: { add: [30, …] }` for "30+", and the first number must equal the
  printed one (the round trip checks this).
- Write what the card says, not what the game usually does. "Search your deck for
  a card" is `max: 1`; "up to 2" is `min: 0, max: 2`; "2 cards" is `min: 2, max: 2`
  (the engine clamps to what's available); "you may" is `may` (or `optional` on a
  trigger); "reveal it" is `reveal: true`.

### 4. One scenario test

Every card with effect text gets at least one test in a card test file
(`src/__tests__/cards.test.ts`, or your lane's `cards-<lane>.test.ts`). The test
builds a position with `scenario()`, plays the card through the real decision
interface, and asserts the outcome the text promises. Where the text has a
condition, test both sides of it ("+140 with 4 in the discard pile" means testing
3 and 4). See *Test helpers*.

### 5. Round-trip check

```bash
node --import tsx scripts/roundtrip.ts <id or name>
node --import tsx --test src/__tests__/roundtrip.test.ts
```

The script is rendered back to English (`src/cards/render.ts`) and compared with
the printed text. **Structural problems fail the test.** Each one means the
script is wrong, or the vocabulary can't say what the card says:

| Check | Catches |
|---|---|
| every number printed appears as often in the rendering | wrong threshold, count, damage, counters |
| every key noun printed (Basic, Stage 2, Supporter, Item, Tool, Bench, Active, discard pile, hand, deck, Prize, Energy, damage counter, heads/tails, Knocked Out, conditions, Rule Box, top/bottom, shuffle, search, draw, attach, switch, can't, …) is rendered | wrong zone, wrong destination, missing step |
| each Energy type printed ({P} ↔ Psychic) appears as often | wrong type filter |
| "may", "up to", "any number of", "reveal" agree **both** ways | optional vs mandatory, exact vs up to, hidden vs revealed |
| "your opponent's X" / "your X" for Active, Bench, discard pile, hand, deck, Prize, Pokémon | self/opponent swapped |
| "your next turn" / "your opponent's next turn" / "this turn" | wrong `Duration` |
| definition checks: attack/Ability names exist on the card, base damage matches the printed number, a printed damage isn't lost by a `program`, every `custom` names a real function | silent no-ops |

Similarity (the mean of a token-multiset Dice coefficient and an LCS ratio over
normalised tokens) is **reported, not trusted**. A paraphrase scores low and a
single wrong number still scores high. Only a floor (0.4) is asserted. Reminder
text that states a game-wide rule ("(Don't apply Weakness and Resistance for
Benched Pokémon.)", "(Pokémon ex, Pokémon V, etc. have Rule Boxes.)", "(Damage is
not an effect.)") is stripped before comparing; see `REMINDERS` in render.ts.

When a check fires and the script is in fact right (the check is too blunt), add
an entry to `ROUNDTRIP_ALLOW` in `src/cards/render.ts`, keyed `"<id>|<section>"`.
List the problem substrings it excuses and **why**. A stale entry fails the test.
Example: Slowpoke's "You *may* discard any number of cards" is `min: 0`, which
already is the option to discard none.

### 6. Rulings

Any effect that touches prevention, replacement, timing windows, "instead",
copying attacks, or an interaction the text doesn't settle needs a rulings
lookup. Cite the source in the script, next to the clause or in `notes`
(example: Metagross, "Compendium #2352; Japanese Q&A" on Metallic Hammer with
fewer than 3 Energy). If you can't find a ruling, implement the most literal
reading, set `status: 'needs_ruling'`, and write the open question in `notes`.
Never guess silently.

Three general rulings every script follows (each pinned in
`src/__tests__/rulings.test.ts` or `rules-audit.test.ts`):

- **"Up to X"**: on an attack it is 0 to X; on a Trainer or an Ability it is
  1 to X (TPCi 2026-02-19). A search of the deck for cards with a property can
  still find nothing. Write `min: 1` for a Trainer's or Ability's "up to", and
  a `playable` guard so the card isn't offered when nothing qualifies.
- **No effect, no play**: a Trainer can't be played if it would do nothing
  (TPCi 2014-11-13). A discard the card calls a cost ("You can use this card
  only if you discard ...") isn't an effect, so Ultra Ball needs a deck
  (2017-04-27); any other discard is one, so Gwynn can be played with an empty
  deck (2026-07-16). The engine's `needsDeck` check covers draw/search-only
  Trainers; write a `playable` guard for anything else (Special Red Card
  against an empty hand, Dark Bell with no valid target).
- **"{X} Energy"** means any Energy card providing {X} where it is attached,
  Basic or Special (Wash Out, 2026-03-26): use `providesType`, not
  `energyType` (which is Basic {X} Energy only).

---

## New set, rotation, FAQ update

The simulator has to catch up three times a year: a **new set** releases (new cards to script), Standard **rotates**
(`apps/api/src/deck/data/formats.json` changes its legal marks), and the TPCi Rules Team publishes an **FAQ update**
(new rulings on cards we already script). Each is a short, repeatable command sequence. All commands run from
`packages/sim`, make read-only GETs only (one request at a time, with a pause; `SIM_FETCH_CACHE=<dir>` caches them
while you iterate), and print what they would change before changing it. Nothing here writes to deckpal.app or the
database.

"Standard" is never a list in the sim. Every script and test below reads `standard.legal_marks` from `formats.json`
at run time, the same file the API's legality checks use.

### The commands

| Command | What it does |
|---|---|
| `node --import tsx scripts/sync-frames.ts [--dry-run] [--set sv11] [--limit N]` | Lists every Standard printing in the public catalog (`/api/search`, per set) and fetches the printed frame (`/api/cards/:id`) of each one the snapshot lacks into `src/cards/frames-extra/std-new.ts` (registered in `frames-extra/index.ts` on first use). Never edits an existing frame. `fetch-frames.mjs <ids>` still refreshes specific frames. |
| `node --import tsx scripts/refresh-card-tables.ts [--write] [--check]` | Regenerates `cards/tera.ts`, `cards/tags.ts` and `cards/printed-wr.ts` from pokemontcg.io, matching every entry against the FULL catalog (not the frame snapshot, which holds one printing per text), requiring the id to exist and the names to agree. Dry run by default: prints a diff summary per table, lists `problems` (wrong match: fails `--check`) and `gaps` (upstream lacks the data: does not). Run against the live API it reproduces the committed tables byte for byte when nothing changed upstream. |
| `node --import tsx scripts/standard-gap.ts [--list]` | The coverage numbers for the snapshot: Standard printings, distinct texts, scripted, vanilla, still to script (`--list` names them). Exit 1 when any is left. |
| `node --import tsx --test src/__tests__/standard-coverage.test.ts` | The coverage **gate** (also part of the normal suite): fails and lists every Standard printing in the snapshot that is neither scripted nor vanilla. |
| `node --import tsx scripts/new-card-lanes.ts <outDir> [--size 40]` | Splits the uncovered cards into batches: `std01.json`... each with the card, every printing sharing its text, its frame, and the Compendium rulings that name it (by card name, or by one of its attack/Ability names). Replaces the old `standard-lanes.ts`. |
| `node --import tsx scripts/standard-tiers.ts <lanesDir> <tiersDir>` | Routes the batches: a Pokémon without Abilities whose attack effects are worded like an already-scripted attack goes to the cheap tier (`h01.json`), the rest to model batches (`s01.json`, with a cookbook of similar scripted cards). |
| `node --import tsx scripts/codegen-cheap.ts <tiersDir> src/cards/scripts/std-gen-<set>.ts <tiersDir>/rejects.json --name STD_GEN_<SET>` | Generates the cheap tier's scripts deterministically from the tested ones; keeps one only if the text round trip is clean. Rejects go to a model batch. Register the new file in `src/cards/scripts/index.ts` and give it a test like `cards-std-gen.test.ts`. |
| `node --import tsx scripts/rulings-sync.ts [--no-write] [--all] [--uncited] [--verbose] [--from page.html]` | Downloads the Compendium's full by-date list (one GET), diffs it against `data/rulings-compendium.json`, reports the NEW rulings that name a scripted card (with the script file and whether a test or only a script cites the ruling id), and updates the snapshot. |

### New set released

1. `git pull`, then `node --import tsx scripts/standard-gap.ts`: the baseline (should be 0 to script).
2. `node --import tsx scripts/sync-frames.ts --dry-run`, then without `--dry-run`: the new set's printings, plus any older printing the snapshot never had, get frames. (Measured 2026-10-11: 1,431 Standard printings were missing, among them the whole of 30th Celebration and the Mega promos; 120 distinct texts of them have no script yet.)
3. `node --import tsx scripts/refresh-card-tables.ts`, read the diff, then `--write`. Tera, Ancient/Future and printed Weakness/Resistance for the new printings. **A printing's Weakness/Resistance is part of its text key** (`textKey` in `cards/frame.ts`), so a reprint whose catalog frame lacks them looks like a new, unscripted card until the table supplies them: this step comes before counting what is new. A set pokemontcg.io lists under an id the rule in `ptcgSetToOurs` does not know is printed under "unmapped sets": add one line to `PTCG_SET_OVERRIDES` (`src/maintenance/tables.ts`; key = pokemontcg.io set id from `https://api.pokemontcg.io/v2/sets`, value = our set id from `https://deckpal.app/api/series/<slug>`). A set that is not on pokemontcg.io yet shows as a `gap`: re-run when it is.
4. `node --import tsx scripts/standard-gap.ts --list`: what is really new. The gate test fails with the same list.
5. `node --import tsx scripts/rulings-sync.ts` (refreshes the rulings the lanes attach).
6. `node --import tsx scripts/new-card-lanes.ts <dir>/lanes`, `node --import tsx scripts/standard-tiers.ts <dir>/lanes <dir>/tiers`, `node --import tsx scripts/codegen-cheap.ts <dir>/tiers src/cards/scripts/std-gen-<set>.ts <dir>/rejects.json --name STD_GEN_<SET>`.
7. Script the rest in batches of about 25 cards with the brief in this file ("The loop"), one file per batch under `src/cards/scripts/` with its own test file. Every batch passes: typecheck; its tests; the full suite; the round trip; `scripts/dupes.ts`; `scripts/mutation-check.ts <batch module> <batch test>`; `scripts/fuzz-cards.ts <batch module>`; the real-log replay tests. Batches that need engine changes run one at a time.
8. Done when `standard-gap.ts` reports 0 to script and the full suite is green, the coverage gate included.

### Standard rotates

Rotation is a data change in `formats.json` (`legal_marks`), made for the API. What it changes in the sim:

- **Nothing to script, nothing to delete.** Scripts stay valid for Expanded and for the replay of old logs. The engine has no legality check of its own and no list of marks (`check_deck` in the API validates decks).
- **The gate, `standard-gap.ts`, `new-card-lanes.ts`, `sync-frames.ts` and `refresh-card-tables.ts` follow by themselves**: they read the marks from `formats.json`. The gate then covers fewer printings; a new mark brings its printings into scope, which is the New set sequence above.
- **`printed-wr.ts` is never shrunk by a rotation**: `refresh-card-tables.ts` recomputes entries only for printings that are Standard now and keeps the rest ("kept N entries for printings that are not Standard now"), because dropping a rotated printing's Weakness would change its text key. `tera.ts` and `tags.ts` cover every Scarlet & Violet / Mega Evolution printing regardless of mark.
- Not mark-driven and left alone: the replay prefers the newest printing by mark letter when a log names a card without a set code (`replay/replay.ts`), which keeps working while marks advance alphabetically; `apps/api/src/deck/prove.ts` is a manual DB proof with its own `['H','I','J']`, unrelated to the sim.

So after a rotation: run `scripts/standard-gap.ts` and `scripts/refresh-card-tables.ts --check` to confirm nothing moved, and nothing else.

### FAQ update (new rulings)

1. `node --import tsx scripts/rulings-sync.ts`. The first lines say how many rulings the page has and how many are new; then one row per NEW ruling that names a scripted card:

   ```
   #2429 2026-07-16 [category, UNCITED] Antique Armor Fossil (me05-072, src/cards/scripts/ghost.ts); Risky Ruins (...)
   ```

   `category` = filed under the card's, an attack's or an Ability's name (reliable); `text` = the card's name appears in the question or answer (read it, it can be a different card). `test` = a test cites `compendium.pokegym.net/ruling/<id>/` (or `Compendium #<id>`); `script only` = only a script's comment or `notes` does; `UNCITED` = nothing.
2. For each row that is not `test`, read the ruling. If the script already does what it says, add a scenario test that pins it and cites the id (`https://compendium.pokegym.net/ruling/<id>/`). If not, fix the script (and its `notes`), with the test. If the ruling contradicts an earlier one a script cites, the newer TPCi date wins; say so in `notes`.
3. `--uncited` re-lists what no test cites yet; `--all` lists every ruling on a scripted card (the backlog); `--no-write` reports without updating the snapshot (the next run reports the same rulings again). Commit the updated `data/rulings-compendium.json` (public Compendium text, attributed in its header) with the fixes.

---

## Clause catalogue

Every example is from a real script. Programs are lists of `Step`s, run in order.
Variables (`as: 'x'`) hold chosen cards, chosen Pokémon, coin results or numbers,
and later steps refer to them.

### Choosing and moving cards

| Clause | Example |
|---|---|
| `chooseCards` | Gwynn: `{ op: 'chooseCards', from: 'hand', filter: NO_RULE_BOX, min: 0, max: 2, as: 'x' }`. Options: `who` (whose zone), `chooser`, `others` (exclude the card being played: Ultra Ball's "2 other cards"), `oneEach` (Secret Box: one per filter), `reveal`. |
| `move` | `{ op: 'move', cards: 'x', to: 'discard' }`. `cards` can also be `{ top: 1 }` (Slowking: the top card of the deck, `as: 'x'` keeps it) or `{ all: 'hand' }` (Lillie's Determination). `to`: `hand`, `discard`, `deck`, `deckTop`, `deckBottom`, `bench` (Basic Pokémon into play), `lost`. |
| `putOnTop` | Put the cards in a variable on top of the deck, in an order the controller picks. |
| `draw` | Rellor: `{ op: 'draw', n: 1 }`. `n` is any `Expr`: Lillie's Determination uses `{ cond: …, then: 8, else: 6 }` and Gwynn `{ mul: [3, { len: 'x' }] }`. |
| `shuffle` | `{ op: 'shuffle' }`, after every deck search. |
| `attach` | Wondrous Patch: `{ op: 'attach', cards: 'e', to: { v: 't' } }`. |
| `discardEnergy` | Spectrier: `{ op: 'discardEnergy', from: 'self', count: 'all' }`. Metagross: `count: 3, filter: { energyType: 'Metal' }`. |

Helpers (`src/cards/scripts/helpers.ts`): `searchToHand(filter, n, { reveal })`,
`searchToBench(filter, n)` (adds `stage: 'basic'` and clamps to Bench space),
`discardOthers(n)` (the Ultra Ball cost), `damageOneOf(zone, amount, filter)`,
`inDiscard(filter)`, `NO_RULE_BOX`, `BENCH_SPACE`, `HIDE_N_SNEAK`.

### Filters

`{ cat, stage, ruleBox, ex, mega, tera, type, hpMax, ttype, basicEnergy, energyType, name, nameIncludes, hasAbility, damaged, energy, tool, condition, energized, not, any }`.
The in-play keys: `energy` (an attached Energy matches: Enhanced Hammer `{ energy: { basicEnergy: false } }`),
`tool` (has a Tool or not), `condition` (Binding Mochi `{ condition: 'poisoned' }`), `energized` (Crushing Hammer).
Examples: Buddy-Buddy Poffin `{ hpMax: 70, stage: 'basic' }`; Night Stretcher
`{ any: [{ cat: 'pokemon' }, { basicEnergy: true }] }`; Dhelmise
`{ cat: 'pokemon', hasAbility: "Hide 'n' Sneak" }`; Kyurem `{ nameIncludes: 'Colress' }`;
Zeraora `{ ex: true }`.

### Pokémon in play

| Clause | Example |
|---|---|
| `chooseSlots` | Spectrier: `{ op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' }`. Zones: `myActive myBench myPokemon oppActive oppBench oppPokemon allPokemon`. |
| `SlotRef` | `'self'` (this Pokémon; for a Tool or Energy, the Pokémon it's attached to), `'defender'`, `'myActive'`, `'oppActive'`, `{ v: 't' }`. |
| `damage` | Kyurem, Trifrost: `{ op: 'damage', amount: 110, to: { v: 't' } }`. Attack damage goes through Weakness, Resistance and every modifier, with no Weakness/Resistance on the Bench. `to: { each: 'oppBench' }` for spread. `ignore: { weakness, resistance, defenderEffects }` for "isn't affected by …" (Solrock; also `AttackScript.ignore` for the printed damage: Dudunsparce ex, Destructive Drill). |
| `counters` | Poltchageist: `{ op: 'counters', n: 1, to: 'oppActive' }`. Sinistcha: `to: { each: 'oppPokemon' }`. Not damage, so no modifiers apply. |
| `heal` | `{ op: 'heal', amount: 30, to: 'self' }`. |
| `condition` | Annihilape, Tantrum: `{ op: 'condition', cond: 'confused', to: 'self' }`. |
| `switch` | Switch: `{ op: 'switch', who: 'self' }`. Boss's Orders: `{ who: 'opp', chooser: 'self' }`. Metagross, Bounce Back: `{ who: 'opp', chooser: 'opp' }`. |
| `knockOut` | Annihilape, Destined Fight: `myActive`, then `oppActive`. |
| `useAttackOf` | Slowking: use an attack of the card in a variable as this attack. |

### Control

| Clause | Example |
|---|---|
| `flip` | Dunsparce: `{ op: 'flip', n: 1, as: 'h' }`. Mega Kangaskhan ex: `n: 'untilTails'`. The heads count lands in `h`. |
| `if` | Dunsparce: `{ op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [...] }`. Has an optional `else`. |
| `may` | Banette: `{ op: 'may', body: searchToHand({}, 1, { reveal: false }) }`. |
| `set` | Metagross: `set bonus 0`, then `may [discardEnergy …, set bonus 150]`, with `damage: { add: [150, { v: 'bonus' }] }`. |
| `repeat` | `{ op: 'repeat', n: 2, body: [...] }`. |
| `chooseOption` | A labelled choice; the index lands in `as`. |
| `end` | Stop the program. |
| `custom` | Meowth ex: `{ op: 'custom', fn: 'returnSelfToHand' }` (see the policy). |

### Expressions and conditions

`Expr`: a number, `{ v }`/`{ len }` (a number variable, or the size of a card/slot
variable), `count` (cards in a zone matching a filter), `pokemon` (Pokémon in a
slot zone), `prizesLeft`, `prizesTaken`, `energyOn`, `countersOn`, `handSize`,
`deckSize`, `add sub mul min max`, `cond`. Examples: Rabsca
`{ add: [10, { mul: [30, { energyOn: 'oppActive' }] }] }`; Lillie's Clefairy ex
`{ add: [20, { mul: [20, { add: [{ pokemon: { zone: 'myBench' } }, { pokemon: { zone: 'oppBench' } }] }] }] }`.

`Cond`: `gte gt lte lt eq and or not cardIs slotIs inActive onBench koLastTurn stadium benchFull firstTurn custom`.
`{ custom: 'name' }` is a named predicate registered with `registerCustomCond` (Rare Candy's `rareCandyPlayable`); give it a
`CUSTOM_COND_GLOSS` in render.ts, as for a custom step.
Examples: Fezandipiti ex `{ koLastTurn: 'self' }`; Slowking
`{ cardIs: { v: 'x', filter: NO_RULE_BOX } }`; Special Red Card
`{ lte: [{ prizesLeft: 'opp' }, 3] }`.

### Attacks

`attacks: { '<exact name>': AttackScript }` with `pre` (before damage: costs,
flips), `damage` (an `Expr`, default the printed number), `target` (default the
Defending Pokémon), `post` (after damage), or `program` (replaces the whole
sequence; put a `damage` step in it if the attack does damage). An attack without
effect text needs no script.

### Abilities

`abilities: [{ name, activated?, statics?, triggers? }]`.

- **Activated**: "Once during your turn, you may …". Mega Kangaskhan ex, Run Errand:
  `activated: { program: [{ op: 'draw', n: 2 }], activeOnly: true, globalOncePerTurn: true }`.
  `oncePerTurn` defaults to true. `when` is a `Cond` gate (Fezandipiti ex). `globalOncePerTurn`
  means "You can't use more than 1 <name> Ability each turn".
- **Statics** and **triggers**: below. Hide 'n' Sneak is a static (`HIDE_N_SNEAK`).

### Trainers and Energy

- `play`: what playing it does. `playable`: a `Cond` that must hold for the card to
  be playable (Ultra Ball: `handSize ≥ 3`, meaning itself plus 2 others; Boss's
  Orders: the opponent has a Benched Pokémon).
- Tools: `statics` (Air Balloon) and/or `triggers` (Lucky Helmet). `'self'` means
  the Pokémon the Tool is attached to.
- Stadiums: `stadiumAbility: { program, when }` for "Once during each player's
  turn, that player may …" (Prism Tower, Academy at Night). Stadium passives are
  `statics`.
- Energy: `provides` (Boomerang Energy `['Colorless']`, Telepathic Psychic Energy
  `['Psychic']`), `providesIf` (Ignition Energy: `{C}{C}{C}` on an Evolution Pokémon),
  `providesAny` (Legacy Energy `{ n: 1 }`; Neo Upper Energy `{ n: 2, when: { stage: 'stage2' } }`),
  `koPrizeDelta` (Legacy Energy `{ delta: -1, oncePerGame: true }`), `triggers` (Telepathic:
  `attachFromHand`; Ignition: `endOfTurn`), `reattachAfterOwnAttack`.
- Supporters: `firstTurnSupporter` for "If you go first, you may use this card during your first turn" (Carmine).
- Trainers played as Pokémon: `fix.playAsBasic` (Antique fossils, below). Such a card's printed Ability is an
  ordinary `abilities` entry.

---

## Statics, scopes, triggers and timed effects

A **static** is a passive `StaticDef { effect, scope, filter?, when? }`, from an
Ability, a Tool, a Stadium or an Energy, and it holds while its source is in play.

- `effect` is one of the `StaticEffect` kinds: `preventEffects` (Hide 'n' Sneak),
  `preventDamage` (`andEffects`: Rabsca, Spherical Shield), `retreatCost` (`delta`:
  Air Balloon −2; `set`: Latias ex 0), `attackCostC` (Bloodmoon Ursaluna ex, per
  Prize taken), `attackCostSet` (Kyurem, Trifrost for {C}), `weaknessType` (Lillie's
  Clefairy ex), `damageOut`, `damageIn`, `hp`, `cantAttack`, `cantRetreat`,
  `noAbilities`, `itemLock`, `countersFixed` (Patrat), `cantUseAttack` (Mega Lucario ex,
  Mega Brave), `extraPrize` (Togekiss, Wonder Kiss), `loseSelfKoAbilities` (Psyduck, Damp),
  `noToolEffects` (Jamming Tower). Added with std-engine4: `benchSize` (Area Zero Underdepths: `size: 8,
  withPokemon: { tera: true }`, scope `both`; the engine discards a Bench down to the limit when it stops
  applying, the Stadium's player first), `noWeakness` (Archaludon ex, a timed effect), `attackCostLess`
  ("costs 1 Energy less", any type: Sparkling Crystal; `canPayAttack` leaves a requirement out),
  `grantsAttacks` (a Tool whose printed attack the holder can use: Technical Machine, Core Memory; the Tool's
  `attacks` script is the attack's program, and `filter` limits it to a Pokémon), `attackTwice` (Festival
  Lead, with the Stadium as the static's `when`; a second attack must be a printed one), `playLock`
  (`what`: `stadium`, `supporter`, `aceSpec`, `evolve`; player-level like `itemLock`), and
  `preventTrainerEffects` (Item / Supporter effects the opponent plays done to the Pokémon; Unnerve, Wide Wall).
  An attack can carry `usable: Cond` ("You can use this attack only if ..."), `heal` takes
  `{ each: zone, filter }`, the `stadium` condition takes `of` (whose Stadium) and `{ benchRoom: who }` counts open Bench spaces.
  Added with std-engine5: `evolveTiming` (`firstTurn` / `justPlayed`, `into` a filter; a Pokémon that evolved this turn
  counts as played this turn: Forest of Vitality, Boosted Evolution, Fighting Roar; the first-turn ban stays unless
  `firstTurn`), `evolveInto` (Rainbow DNA: cards that evolve from another name), `koToHand` ("put it / the Basic
  {W} Energy attached into your hand instead of the discard pile" when Knocked Out by damage from an attack: Gengar,
  Huntail; `optional` asks the owner a yes/no before the Prize cards), and on `preventDamage`: `attacker` now
  limits the *effects* too with `andEffects` (Milotic ex, Carracosta, Acerola's Mischief), and `ifAtMost` /
  `ifAtLeast` prevent damage by its amount as it stands after Weakness and Resistance (Harden, Impervious Shell).
  `BENCH_SPACE` (helpers.ts) is `{ benchRoom: 'self' }`: use it, never `5 − Bench`. A `switch` from an attack or
  Ability that the attacking player aims at a Benched Pokémon protected from attack / Ability effects does nothing,
  and the rest of the program has no "new Active Pokémon" (`oppActive` resolves to nothing: ruling 2155).
  Added with std-engine6: `playLock` also stops `'tool'` cards and `'abilityPokemon'` (Pokémon with a printed Ability, put
  on the Bench or played to evolve; `except: Filter` spares some: Potent Glare; the Ability on the card in hand counts, so
  Team Rocket's Watchtower doesn't lift it, ruling 2147); `extraPrize` takes `ko: Filter` (a Knocked Out Pokémon of that kind,
  Active or Benched, by damage from an attack: 1 more per Pokémon) and `byThis` (the attack must be this Pokémon's: Greedy
  Eater); `koPrizes` takes `anyKo` (any Knock Out) and `duringTakersTurn` (an attack's "During your next turn, if the
  Defending Pokémon is Knocked Out, take 2 more Prize cards": Plentiful Pollen, it ends if the Pokémon leaves the Active
  Spot or evolves, ruling 1957); `condition` with `counters` also works on `burned` (instead of 2; the amount is cleared by a
  plain application); `checkupCounters` (`cond`, `n`, `noStack`: "During Pokémon Checkup, put N more damage counters on
  the Poisoned / Burned ...", added before the Burn flip: Magma Surge, Perilous Jungle, ruling 2112); `hp` takes `noStack`.
  Prize cards can be face up: the `turnPrizeUp` step ({ who, as }; the first face-down one), the `{ prizeCards: { who,
  face: 'up' | 'down', filter } }` count (the filter is for face-up cards only) and `PlayerState.prizesUp`, which the
  hidden-information copy keeps in place. The condition `{ attackedLastTurn: { who, filter, other } }` reads which of a
  player's Pokémon used an attack in their last turn (recorded per Pokémon in play, as the card when it has left; a
  Confused Pokémon that fails its flip did not attack, ruling 2087): Koraidon.
  Added with std-engine7: `toolSlots` (`n`: a Pokémon may hold up to n Tools, the most any effect on it allows; when the effect
  stops its owner discards down, checked after every action: Rotom ex, Multi Adapter), `damageCoinFlip` ("if any damage is done to
  this Pokémon by attacks, flip a coin. If heads, prevent that damage"; the owner flips, only when damage would really be done and
  not for an attack that ignores effects on the Defending Pokémon, ruling 2040; put "has any {D} Energy" in `when`: Cinccino ex,
  Fezandipiti, Kecleon), `retreatCoinFlip` (player-level, scope `opp`: Goodra, the retreat is used up on tails, never two flips),
  `coinReflip` (a Tool's: after the attack's coin flips, once during your turn, the same flip step is flipped again, offered when the
  attack's program flips in one place only; Confusion's flip is never offered, ruling 2417: Backtrack Badge), `keepConfusion`
  (Dizzying Valley: evolving keeps Confusion, `confusionKept` in query.ts), `energyProvides` (`cards`, `provides`: Basic {G} Energy
  provides {G}{G}; a replacement that never adds up, counts everywhere Energy is counted, and needs the game state: pass `s` to
  `energyUnits` / `cardUnits` / `pushUnits`, ctx flag `energyMods`: Meganium), `noReturnToHand` (player-level: nothing of that
  player's Pokémon in play or attached goes to their hand. Knock Out to hand is stopped in flow.ts; custom effects of other lanes
  run as written and `enforceHandGuard` in interp.ts takes the cards back, ctx flag `handLock`: Milotic), `previousAttacks` (an
  evolved Pokémon uses the attacks of the cards under it; they are attack options with `card` = that card, as a Tool's: Relicanth)
  and `cantAttack` with `ifEnergyAtMost` (Energy units, as `attackerMaxEnergy` counts: Walrein). `types` takes a `when` that is
  `slotIs` self (Iron Treads, with the Filter key `toolCard`: an attached Tool matches). The `delay` step takes `global`
  (Amarys: not tied to a Pokémon; if it and another effect wait for the end of the turn the turn's player is asked which first,
  ruling 2135). `move` takes `anyStage` (Klinklang puts a Stage 2 onto the Bench); an Ability can be `activated.fromHand` (an `ability`
  action with `card`, the card in the variable `__this`), have `setupActive` (Cinderace may start face down in the Active Spot, a card
  that still needs a Basic Pokémon in the hand to avoid a mulligan) and `putIntoPlayOnlyBy` (Palafin ex, Hero's Spirit: stopped from
  the hand and Rare Candy by `pokemonPlayLocked`; Palafin's Zero to Hero puts it into play with the custom `engine7.swapTopCard`).
  Triggers `damagedByAttack` / `damagedByAttackActive` take `minDamage` (the damage done in one hit, after every effect) and
  `attacker` (a Filter on the Attacking Pokémon; its slot is `__attacker`): Tremendous Bomb. Card fields: `extraStadium` (played
  though a Stadium was played this turn, with `playable` naming the Stadium it goes over: Ange Floette), `handAfterOwnAttack`
  (Energy discarded by its own Pokémon's attack goes to the hand after it, if the Pokémon matches `holder`: Nitro Fire Energy),
  `attachOnly` (Energy that only goes on some Pokémon, discarded if it is on another, checked after every action: Team Rocket's
  Energy), `providesFlex` (`n` Energy each any of `types`, an `EnergyUnit` like "Psychic|Darkness", pays any mix) and
  `noRecoverFromDiscard` (moves to the hand or deck from the discard pile do nothing, and `chooseCards` does not offer it when the
  chosen cards are about to go there: Neutralization Zone, Poké Vital A).
- **Say whose attacks.** `damageIn` applies to damage from *every* attack unless `fromOpp: true`.
  If the card says "from attacks from your opponent's Pokémon", set it (Full Metal Lab, Iron
  Defender, Antique Armor Fossil). The round trip caught Protective Armor without it.
  `preventDamage` is already opponent-only. `attackerMaxEnergy` limits it further (Bastiodon,
  "that have 2 or less Energy attached").
- `scope` says which Pokémon it applies to, **relative to the source's
  controller**: `self`, `myActive`, `myBench`, `myPokemon`, `oppActive`, `oppBench`,
  `oppPokemon`, `allPokemon`, or, for player-level effects (`itemLock`,
  `countersFixed`), `me`, `opp`, `both`. `filter` narrows it (Latias ex:
  `scope: 'myPokemon', filter: { stage: 'basic' }`; Fairy Zone:
  `scope: 'oppPokemon', filter: { type: 'Dragon' }`).
- `when` is a `Cond`, evaluated from the source's point of view (Kyurem: a
  "Colress" card in the opponent's discard pile).

A **trigger** is `TriggerScript { on, when?, optional?, program }`: `attachFromHand`
(an Energy's own script; Telepathic gates on `slotIs self {type: Psychic}`),
`playToBench` (Meowth ex), `evolveFromHand` (Kadabra), `damagedByAttackActive` (Lucky Helmet),
`knockedOutByAttack`, `damagedByAttack` (the damaged Pokémon wherever it is, Knocked Out or not: Orthworm ex; the
Attacking Pokémon is `{ v: '__attacker' }`), `damageReduced` (a Tool whose `damageIn` reduced the damage, even to 0, even
on the Bench: the Berries; discards itself with `discardThisCard`), `checkup` (Froslass), `endOfTurn` (Powerglass, Ignition Energy; only the
current player's Pokémon), `pokemonBenched` (a Stadium: Risky Ruins; `self` is the benched
Pokémon), `oppAttachFromHand` (Gengar ex, Gnawing Curse; the Pokémon is in `{ v: '__target' }`).
`movedToBench` / `movedToActive` (this Pokémon moved between the Active Spot and the Bench by a switch, retreat or, for
`movedToActive`, promotion; `oncePerTurn` is "Once during your turn, when this Pokémon moves ...": Cobalion ex, Yanmega ex)
and `allyMovedToActive` (one of your Pokémon moved up; the mover is `{ v: '__target' }`, ask about it in `when`: Latios).
std-engine6 added `allyAttachFromHand` (you attached an Energy card from your hand to one of your Pokémon, by an action
or an effect; `__target` is that Pokémon: Magearna), `oppEvolveFromHand` (the opponent played a Pokémon from their hand to
evolve one of theirs, Rare Candy too; `__target` is it; `noStack: true` lets only one copy fire: Ampharos),
`discardedFromDeck` (the card itself, in its owner's deck, was discarded by the opponent's attack, Ability, Item or
Supporter during their turn; no slot: Ferrothorn) and `allyActiveDamagedByAttack` (your Active Pokémon was damaged by an
attack, for each of your Pokémon with it, Benched ones too; `__target` is the damaged one, `__attacker` the attacker:
Spiritomb).
`optional: true` is "you may".

A **timed effect** is created by an attack or Ability with the `effect` step:
`{ op: 'effect', static, on | onPlayer, duration, filter?, scope? }` (`onPlayer` + `scope` covers that
player's Pokémon, matched live, so it includes new ones: Iron Defender, Gladion's Final Battle), where `duration` is
`thisTurn`, `oppNextTurn` ("during your opponent's next turn": Dunsparce, Dig) or
`myNextTurn` ("during your next turn, this Pokémon can't attack": Bloodmoon
Ursaluna ex, Latias ex). An attack's timed effect on a Pokémon ends when that
Pokémon leaves the Active Spot.

---

## Reprints resolve by text key

You write one script per distinct card **text**, against its canonical printing.
`textKey()` (`src/cards/frame.ts`) covers name, category, HP, stage, suffix,
evolves-from, Trainer type, types, Retreat, effect, attacks (name, cost, damage,
text), Abilities, Weakness and Resistance. Every printing with the same key (a
reprint, a full art, a promo) resolves to the same script (`scriptFor`).
A reworded printing gets a different key and needs its own script, and nothing
treats it as the same card silently. `coverage.ts` lists every printing that
shares the key. If the registry reports "two scripts for the same card text",
delete the duplicate.

## Data quirks (the `fix` field)

The catalog (TCGdex, via `scripts/fetch-frames.mjs`) is wrong in known ways.
Correct them on the script, never in `frames.ts`, which is generated:

- **Mega-era Special Energy is marked "Normal"**, so it would be treated as Basic.
  Set `fix: { specialEnergy: true }` (Telepathic Psychic Energy), plus `provides`.
- **Tera has no frame marker.** Set `fix: { tera: true }` on a Tera Pokémon. It
  feeds the Tera rule (no damage from attacks while on the Bench, `query.ts`) and
  `{ tera: true }` filters.
- **ACE SPEC has no reliable marker.** Set `fix: { aceSpec: true }` (Secret Box, Prime Catcher,
  Unfair Stamp, Precious Trolley, Legacy Energy, Neo Upper Energy) so the definition knows it is
  one (`CardDef.aceSpec`, which deck legality needs).
- **A Stage 1 or 2 with no "evolves from"** (TCGdex 30th-123 Hisuian Zoroark): `fix: { evolvesFrom: 'Hisuian Zorua' }`.
- **A Trainer played "as if it were a 60-HP Basic {C} Pokémon"** (Antique fossils):
  `fix: { playAsBasic: { hp, type, cantRetreat?, noConditions?, discardable? } }`.

## Escape-hatch policy

`{ op: 'custom', fn, args }` calls a named function in `src/customs.ts`. Use it
only when an effect is genuinely bespoke: it moves a Pokémon and its attached
cards out of play (Tuck Tail, Run Away Draw), it takes cards out of the deck
mid-shuffle (Ciphermaniac's Codebreaking), or it gates by Ability name across
Pokémon (Last-Ditch). The rules:

1. Prefer the vocabulary. Write a custom only when composing clauses can't
   express the effect, and when the effect is unlikely to recur. A second card
   needing the same custom means it should be a clause.
2. One function per effect, documented with the printed sentence it implements,
   returning `'next' | 'wait' | 'pop'`, with no hidden state outside `GameState`
   (the state is cloned for search).
3. Its card test is its proof. Add a gloss of what the function's **code** does
   to `CUSTOM_GLOSS` in `src/cards/render.ts` (`CUSTOM_COND_GLOSS` for a custom condition). Without a gloss, the section is
   "opaque": the round trip reports its problems but can't assert them. Write the
   gloss from the code, never by copying the card text, or the check proves nothing.

## Licensing

- Write every script **from the printed card text only** (`frames.ts`, which comes
  from the DeckPal catalog). Card text is the specification.
- **No twinleafgg code.** Don't read it, port it or paraphrase it.
- **No Kaggle or cabt competition material** (code, notebooks, card data).
- **ryuu-play (MIT)**: ideas and structure are fine, with credit in a comment
  where an idea is borrowed. Copying its card implementations is not.
- Rulings are cited by source (Compendium ruling number, official FAQ, Japanese Q&A).

## Test helpers

`src/scenario.ts`: `scenario(deckA, deckB, [sideA, sideB], options?, seed?)` builds
a game at a position reachable by legal play. Each placement takes a matching card
out of that player's deck. `SideLayout`: `active`, `bench`, `hand`, `discard`,
`energy` (`{ active: ['Psychic Energy'], 0: [...] }`), `tools`, `damage`, `cond`,
`evolve`, `prizes`, `deckTop`, `emptyDeck`. Options: `turn`, `current`, `first`,
`drawForTurn`. Force coin flips with `g.state.forcedCoins = [true, false]`.

`src/__tests__/cards.test.ts` defines the helpers: `labels(g)` (the current
decision's options as text), `has(g, text)`, `choose(g, text)` (submit the option
containing `text`, e.g. `'Attack: Dig'`, `'Play Ultra Ball'`), `pick(g, names)`
(a multi-select by card name), `yes(g)`, `name`/`names`. Decks: `HIDE_N_SNEAK` and
`TOOLBOX_SLOWKING` from `decks.ts`. `fromIds(name, [[id, count], …])` builds any
deck from frames, and `GAUNTLET_LISTS` holds the gauntlet. Read the position through
`g.state` (`p[0].active!.damage`, `p[1].hand`, `p[0].discard`, …) and card names
through `def(g.ctx, iid).name`. A typical test:

```ts
test('Poltchageist, Furtive Drop: 1 damage counter on the opponent\'s Active', () => {
  const g = H([{ active: 'Poltchageist', energy: { active: [P] } }, { active: 'Kyurem' }]);
  choose(g, 'Attack: Furtive Drop');
  assert.equal(g.state.p[1].active!.damage, 10);
});
```

## Checklist

- [ ] Card picked from `coverage.ts`; script written from its printed text, each part quoted.
- [ ] No new clause, or a new clause with an engine test, a rendering, and a flag for review.
- [ ] `fix` set where the catalog is wrong (Special Energy, Tera, ACE SPEC).
- [ ] One scenario test per card (both sides of every condition).
- [ ] `scripts/roundtrip.ts <id>` shows no structural problems, or an allowlist entry with a reason.
- [ ] Rulings cited, or `status: 'needs_ruling'` with the question in `notes`.
- [ ] `npx tsc --noEmit -p .` and the whole test suite pass.
