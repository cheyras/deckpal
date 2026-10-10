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

`{ cat, stage, ruleBox, ex, mega, tera, type, hpMax, ttype, basicEnergy, energyType, name, nameIncludes, hasAbility, damaged, not, any }`.
Examples: Buddy-Buddy Poffin `{ hpMax: 70, stage: 'basic' }`; Night Stretcher
`{ any: [{ cat: 'pokemon' }, { basicEnergy: true }] }`; Dhelmise
`{ cat: 'pokemon', hasAbility: "Hide 'n' Sneak" }`; Kyurem `{ nameIncludes: 'Colress' }`;
Zeraora `{ ex: true }`.

### Pokémon in play

| Clause | Example |
|---|---|
| `chooseSlots` | Spectrier: `{ op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' }`. Zones: `myActive myBench myPokemon oppActive oppBench oppPokemon allPokemon`. |
| `SlotRef` | `'self'` (this Pokémon; for a Tool or Energy, the Pokémon it's attached to), `'defender'`, `'myActive'`, `'oppActive'`, `{ v: 't' }`. |
| `damage` | Kyurem, Trifrost: `{ op: 'damage', amount: 110, to: { v: 't' } }`. Attack damage goes through Weakness, Resistance and every modifier, with no Weakness/Resistance on the Bench. `to: { each: 'oppBench' }` for spread. |
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

`Cond`: `gte gt lte lt eq and or not cardIs slotIs inActive onBench koLastTurn stadium benchFull firstTurn`.
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
  `['Psychic']`), `triggers` (Telepathic: `attachFromHand`), `reattachAfterOwnAttack`.

---

## Statics, scopes, triggers and timed effects

A **static** is a passive `StaticDef { effect, scope, filter?, when? }`, from an
Ability, a Tool, a Stadium or an Energy, and it holds while its source is in play.

- `effect` is one of the `StaticEffect` kinds: `preventEffects` (Hide 'n' Sneak),
  `preventDamage` (`andEffects`: Rabsca, Spherical Shield), `retreatCost` (`delta`:
  Air Balloon −2; `set`: Latias ex 0), `attackCostC` (Bloodmoon Ursaluna ex, per
  Prize taken), `attackCostSet` (Kyurem, Trifrost for {C}), `weaknessType` (Lillie's
  Clefairy ex), `damageOut`, `damageIn`, `hp`, `cantAttack`, `cantRetreat`,
  `noAbilities`, `itemLock`, `countersFixed` (Patrat).
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
`playToBench` (Meowth ex), `evolveFromHand`, `damagedByAttackActive` (Lucky Helmet),
`knockedOutByAttack`. `optional: true` is "you may".

A **timed effect** is created by an attack or Ability with the `effect` step:
`{ op: 'effect', static, on | onPlayer, duration, filter? }`, where `duration` is
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
- **ACE SPEC has no reliable marker.** Set `fix: { aceSpec: true }` (Secret Box) so
  the definition knows it is one (`CardDef.aceSpec`, which deck legality needs).

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
   to `CUSTOM_GLOSS` in `src/cards/render.ts`. Without a gloss, the section is
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
