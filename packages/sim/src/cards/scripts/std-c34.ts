/**
 * Standard batch c34: Destined Rivals (sv10) cards 125-181 that no other lane scripted. Written from the printed text in
 * frames.ts; quotes below are that text. Tests: src/__tests__/cards-std-c34.test.ts.
 *
 * Skipped (needs vocabulary the engine does not have yet):
 *  - sv10-146 Zamazenta (Strong Bash): "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this
 *    Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon." An attack
 *    effect that reacts to the Pokémon being damaged (and needs the amount of damage done); being built.
 *  - sv10-172 Team Rocket's Bother-Bot: "(That Prize card remains face up for the rest of the game.)" Face-up Prize records.
 */
import type { CardScript, Cond, Expr, Filter } from '../../dsl.js';
import { BENCH_SPACE, searchToHand } from './helpers.js';
import './std-c34-customs.js'; // c34.moveEnergyAny, c34.revealOppTopPick
import './std-c01-customs.js'; // c01.benchCards
import './std-seed1-customs.js'; // std.discardOppActiveTools

const KOFFING: Filter = { cat: 'pokemon', nameIncludes: 'Koffing' };
const KOFFING_OR_WEEZING: Filter = { any: [{ nameIncludes: 'Koffing' }, { nameIncludes: 'Weezing' }] };
const TEAM_ROCKET_SUPPORTER: Filter = { ttype: 'supporter', nameIncludes: 'Team Rocket' };
const ARVENS_SANDWICH: Filter = { name: "Arven's Sandwich" };
const STEVENS_POKEMON: Filter = { cat: 'pokemon', nameIncludes: "Steven's" };
const ETHANS_OR_FIRE: Filter = { any: [{ cat: 'pokemon', nameIncludes: "Ethan's" }, { basicEnergy: true, energyType: 'Fire' }] };
const TECHNICAL_MACHINE: Filter = { ttype: 'tool', nameIncludes: 'Technical Machine' };

/** "If your opponent's Active Pokémon is a Pokémon ex": `bonus` more damage. */
const IF_OPP_ACTIVE_EX = (bonus: number): Expr => ({ cond: { slotIs: { ref: 'oppActive', filter: { ex: true } } }, then: bonus, else: 0 });

/** At least one card in the controller's deck matches (a search that finds nothing is not an effect, so the card can't be played). */
const DECK_HAS = (filter: Filter): Cond => ({ gte: [{ count: { zone: 'deck', filter } }, 1] });

export const STD_C34: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv10-125',
    name: "Team Rocket's Koffing",
    abilities: [
      {
        // "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), search your deck for up to 2 Pokémon that have "Koffing" in their name and put them onto your Bench. Then, shuffle your deck."
        // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2153/): Smog Signals activates before the KO check.
        // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2172/): Attack effects resolve before triggered effects from damage.
        // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2171/): Mandatory if bench space exists; nothing searches if bench full.
        // -- not optional (no `optional`), "up to 2" is 1 to 2 for an Ability (TPCi 2026-02-19); with a full Bench nothing is searched or shuffled.
        // The Pokémon go onto the Bench as they are, whatever their Stage.
        name: 'Smog Signals',
        triggers: [
          {
            on: 'damagedByAttackActive',
            program: [
              {
                op: 'if',
                cond: { gte: [BENCH_SPACE, 1] },
                then: [
                  { op: 'chooseCards', from: 'deck', filter: KOFFING, min: 1, max: { min: [2, BENCH_SPACE] }, as: 'found', prompt: 'Put up to 2 Pokémon with "Koffing" in their name onto your Bench' },
                  { op: 'custom', fn: 'c01.benchCards', args: { cards: 'found' } },
                  { op: 'shuffle' },
                ],
              },
            ],
          },
        ],
      },
    ],
    notes: 'Compendium #2153 (works while it is being Knocked Out), #2172 (after the attack\'s own effects), #2171 (mandatory; no search with a full Bench).',
  },
  {
    id: 'sv10-126',
    name: "Team Rocket's Weezing",
    attacks: {
      // "This attack does 40 damage for each Pokémon in play that has "Koffing" or "Weezing" in its name (both yours and your opponent's)."
      'Explode Together Now': { damage: { mul: [40, { pokemon: { zone: 'allPokemon', filter: KOFFING_OR_WEEZING } }] } },
    },
    notes: 'Compendium #2171 asks about "Smog Signals" on this card, but the printed card has no Ability (a card-text mismatch in the ruling); nothing to apply.',
  },
  {
    id: 'sv10-128',
    name: "Team Rocket's Sneasel",
    attacks: {
      // "This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Strike the Sleeper': {
        program: [
          { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Benched Pokémon" },
          { op: 'damage', amount: { mul: [20, { countersOn: { v: 't' } }] }, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'sv10-130',
    name: "Marnie's Purrloin",
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 40 more damage."
      'Pointy Nails': { damage: { add: [20, IF_OPP_ACTIVE_EX(40)] } },
    },
  },
  {
    id: 'sv10-131',
    name: "Marnie's Liepard",
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 70 more damage."
      'Pointy Claws': { damage: { add: [70, IF_OPP_ACTIVE_EX(70)] } },
    },
  },
  {
    id: 'sv10-139',
    name: "Arven's Mabosstiff ex",
    attacks: {
      // "If this Pokémon has no damage counters on it, this attack does 120 more damage."
      'Vigorous Tackle': { damage: { add: [30, { cond: { eq: [{ countersOn: 'self' }, 0] }, then: 120, else: 0 }] } },
      // "During your next turn, this Pokémon can't use Boss Headbutt."
      'Boss Headbutt': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Boss Headbutt' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv10-140',
    name: 'Forretress',
    attacks: {
      // "You may move any amount of {M} Energy from your Pokémon to your other Pokémon in any way you like."
      // "{M} Energy" is any Energy card providing {M}, Basic or Special (Wash Out ruling, TPCi Rules Team 2026-03-26).
      'Iron Shake-Up': { post: [{ op: 'may', body: [{ op: 'custom', fn: 'c34.moveEnergyAny', args: { filter: { providesType: 'Metal' } } }] }] },
      // "Flip 4 coins. This attack does 80 damage for each heads."
      'Hurricane of Needles': { pre: [{ op: 'flip', n: 4, as: 'h' }], damage: { mul: [80, { v: 'h' }] } },
    },
  },
  {
    id: 'sv10-141',
    name: 'Skarmory',
    attacks: {
      // "Heal 50 damage from this Pokémon. During your next turn, this Pokémon can't retreat."
      Roost: {
        program: [
          { op: 'heal', amount: 50, to: 'self' },
          { op: 'effect', static: { k: 'cantRetreat' }, on: 'self', duration: 'myNextTurn' },
        ],
      },
    },
  },
  {
    id: 'sv10-148',
    name: "Team Rocket's Raticate",
    attacks: {
      // "Flip 2 coins. If both of them are tails, this Pokémon also does 90 damage to itself."
      'Reckless Abandon': {
        post: [
          { op: 'flip', n: 2, as: 'h' },
          { op: 'if', cond: { eq: [{ v: 'h' }, 0] }, then: [{ op: 'damage', amount: 90, to: 'self' }] },
        ],
      },
    },
  },
  {
    id: 'sv10-150',
    name: "Team Rocket's Persian ex",
    attacks: {
      // "Reveal the top 10 cards of your opponent's deck. You may choose an attack from a Pokémon you find there and use it as this attack. Shuffle the revealed cards into your opponent's deck."
      // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2157/): The copied attack's cost is not paid; only Haughty Order's cost.
      // -- the copied attack's cost is not paid (`useAttackOf`). The revealed cards are shuffled into the deck after the attack.
      'Haughty Order': {
        program: [
          { op: 'custom', fn: 'c34.revealOppTopPick', args: { n: 10, as: 'c' } },
          { op: 'useAttackOf', card: 'c' },
          { op: 'shuffle', who: 'opp' },
        ],
      },
      // "Your opponent's Active Pokémon is now Confused."
      'Cruel Slash': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv10-152',
    name: 'Tauros',
    attacks: {
      // "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage."
      // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2046/): a Stage 1 Pokémon put into play without evolving "is still considered an "Evolution Pokemon" (Stage 1)".
      // -- the check is the card's Stage, not how it came into play.
      'Clean Hit': { damage: { add: [50, { cond: { slotIs: { ref: 'oppActive', filter: { stage: 'evolution' } } }, then: 50, else: 0 }] } },
    },
  },
  {
    id: 'sv10-153',
    name: "Team Rocket's Porygon",
    attacks: {
      // "Discard a card from your hand. If you do, your opponent discards a card from their hand."
      // Your opponent picks the card to discard.
      Hacking: {
        program: [
          { op: 'chooseCards', from: 'hand', min: 1, max: 1, as: 'd', prompt: 'Discard a card from your hand' },
          { op: 'move', cards: 'd', to: 'discard' },
          {
            op: 'if',
            cond: { gte: [{ len: 'd' }, 1] },
            then: [
              { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'opp', min: 1, max: 1, as: 'o', prompt: 'Discard a card from your hand' },
              { op: 'move', cards: 'o', to: 'discard', who: 'opp' },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv10-154',
    name: "Team Rocket's Porygon2",
    attacks: {
      // "This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile."
      'R Command': { damage: { mul: [20, { count: { zone: 'discard', filter: TEAM_ROCKET_SUPPORTER } }] } },
    },
  },
  {
    id: 'sv10-155',
    name: "Team Rocket's Porygon-Z",
    abilities: [
      {
        // "You must discard 2 cards from your hand in order to use this Ability. Once during your turn, you may draw a card."
        // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2149/): Needs 2 cards to discard and 1 card to draw available.
        // -- usable only with 2 cards in hand and at least 1 card in the deck.
        name: 'Reconstitute',
        activated: {
          when: { and: [{ gte: [{ handSize: 'self' }, 2] }, { gte: [{ deckSize: 'self' }, 1] }] },
          program: [
            { op: 'chooseCards', from: 'hand', min: 2, max: 2, as: 'cost', prompt: 'Discard 2 cards from your hand' },
            { op: 'move', cards: 'cost', to: 'discard' },
            { op: 'draw', n: 1 },
          ],
        },
      },
    ],
    attacks: {
      // "This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile."
      'R Command': { damage: { mul: [20, { count: { zone: 'discard', filter: TEAM_ROCKET_SUPPORTER } }] } },
    },
  },
  {
    id: 'sv10-158',
    name: "Arven's Skwovet",
    attacks: {
      // "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."
      'Gnaw Through': { pre: [{ op: 'custom', fn: 'std.discardOppActiveTools' }] },
    },
  },
  {
    id: 'sv10-159',
    name: "Arven's Greedent",
    abilities: [
      {
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may put up to 2 Arven's Sandwich cards from your discard pile into your hand."
        // -- "up to 2" of an Ability is 1 to 2 (TPCi 2026-02-19); not offered with no Arven's Sandwich in the discard pile.
        // Compendium #2147 is about Team Rocket's Arbok's Potent Glare stopping this card being played from hand (a lock on another
        // card's text, not built).
        name: 'Greedy Order',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            when: { gte: [{ count: { zone: 'discard', filter: ARVENS_SANDWICH } }, 1] },
            program: [
              { op: 'chooseCards', from: 'discard', filter: ARVENS_SANDWICH, min: 1, max: 2, as: 'got', prompt: "Put up to 2 Arven's Sandwich into your hand" },
              { op: 'move', cards: 'got', to: 'hand' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'sv10-160',
    name: 'Squawkabilly',
    attacks: {
      // "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
      // (The rulings the compendium lists for this name are about Squawkabilly ex's Ability.)
      'Push Down': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] },
            then: [{ op: 'may', body: [{ op: 'switch', who: 'opp', chooser: 'opp' }] }],
          },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv10-161',
    name: "Arven's Sandwich",
    // "Heal 30 damage from your Active Pokémon. If that Pokémon is an Arven's Pokémon, heal 100 damage from it instead."
    // No damage to heal, no effect, no play.
    playable: { slotIs: { ref: 'myActive', filter: { damaged: true } } },
    play: [{ op: 'heal', amount: { cond: { slotIs: { ref: 'myActive', filter: { cat: 'pokemon', nameIncludes: "Arven's" } } }, then: 100, else: 30 }, to: 'myActive' }],
  },
  {
    id: 'sv10-163',
    name: "Emcee's Hype",
    // "Draw 2 cards. If your opponent has 3 or fewer Prize cards remaining, draw 2 more cards."
    play: [
      { op: 'draw', n: 2 },
      { op: 'if', cond: { lte: [{ prizesLeft: 'opp' }, 3] }, then: [{ op: 'draw', n: 2 }] },
    ],
  },
  {
    id: 'sv10-165',
    name: "Ethan's Adventure",
    // "Search your deck for up to 3 in any combination of Ethan's Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
    // "Up to 3" of a Trainer is 1 to 3 (TPCi 2026-02-19); nothing to find, no play.
    playable: DECK_HAS(ETHANS_OR_FIRE),
    play: searchToHand(ETHANS_OR_FIRE, 3, { min: 1 }),
  },
  {
    id: 'sv10-166',
    name: 'Granite Cave',
    // "Steven's Pokémon (both yours and your opponent's) take 30 less damage from attacks from the opponent's Pokémon (after applying Weakness and Resistance)."
    // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2161/): all of an attack's damage modifiers are applied to the total for each Pokémon, so 40 to a Steven's Pokémon is 10.
    statics: [{ effect: { k: 'damageIn', amount: -30, fromOpp: true }, scope: 'allPokemon', filter: STEVENS_POKEMON }],
  },
  {
    id: 'sv10-179',
    name: "Team Rocket's Venture Bomb",
    // "Flip a coin. If heads, put 2 damage counters on 1 of your opponent's Pokémon. If tails, put 2 damage counters on your Active Pokémon."
    play: [
      { op: 'flip', n: 1, as: 'h' },
      {
        op: 'if',
        cond: { gte: [{ v: 'h' }, 1] },
        then: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Pokémon" },
          { op: 'counters', n: 2, to: { v: 't' } },
        ],
        else: [{ op: 'counters', n: 2, to: 'myActive' }],
      },
    ],
  },
  {
    id: 'sv10-181',
    name: 'TM Machine',
    // "Search your deck for up to 3 Pokémon Tool cards that have "Technical Machine" in their name, reveal them, and put them into your hand. Then, shuffle your deck."
    playable: DECK_HAS(TECHNICAL_MACHINE),
    play: searchToHand(TECHNICAL_MACHINE, 3, { min: 1 }),
  },
];
