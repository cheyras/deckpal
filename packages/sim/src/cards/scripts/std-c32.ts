/**
 * Standard batch c32: Destined Rivals (sv10) cards 028-077. Written from the printed text in frames.ts; quotes below are
 * that text. Tests: src/__tests__/cards-std-c32.test.ts.
 *
 * Skipped (needs vocabulary the engine does not have yet):
 *  - sv10-055 Huntail, Diver's Catch: "...you may put all Basic {W} Energy attached to that Pokémon into your hand instead of the
 *    discard pile." Needs a Knock Out replacement ("to hand instead of discard").
 *  - sv10-048 Misty's Magikarp, So Submerged: the static itself (prevent all damage and effects of attacks while on the Bench) is
 *    expressible, but ruling 2155 says an attack that switches it in ("Primeape's Drag Off") can't bring it to the Active Spot.
 *    The `switch` step only checks the effects-prevention of the Pokémon being switched OUT, never of the Benched Pokémon chosen
 *    to come in, so a gust attack would drag it up (and the following damage would hit it). Needs the incoming Pokémon's
 *    protection from attack effects to be checked in `switch`.
 *  - sv10-065 Cetitan ex, Snow Camouflage: "Whenever your opponent plays an Item or Supporter card from their hand, prevent all
 *    effects of that card done to this Pokémon." Needs preventing the effects of Item or Supporter cards.
 *  - sv10-074 Team Rocket's Ampharos, Darkest Impulse: "Whenever your opponent plays a Pokémon from their hand to evolve 1 of their
 *    Pokémon, put 4 damage counters on that Pokémon." Needs a trigger for the opponent evolving a Pokémon (only `evolveFromHand`
 *    for the Pokémon's own evolution, and `oppAttachFromHand`, exist).
 */
import type { CardScript, Cond, Filter } from '../../dsl.js';
import { damageOneOf, inDiscard, searchToHand } from './helpers.js';
import './ghost-customs.js'; // moveOppActiveEnergy
import './std-c04-customs.js'; // c04.evolvedFromThisTurn
import './std-c09-customs.js'; // c09.discardTopCount
import './std-c32-customs.js';
import './std-engine-customs.js'; // stdEngine.discardDefender
import './std-seed2-customs.js'; // seed2.randomOppHandCard

/** "If this Pokémon has any Team Rocket's Energy attached" (Team Rocket's Energy is a Special Energy card by that name). */
const HAS_TR_ENERGY: Cond = { slotIs: { ref: 'self', filter: { energy: { name: "Team Rocket's Energy" } } } };

const MISTYS_POKEMON: Filter = { cat: 'pokemon', nameIncludes: "Misty's" };

export const STD_C32: CardScript[] = [
  {
    id: 'sv10-028',
    name: 'Arcanine',
    attacks: {
      // "If your opponent's Active Pokémon is a {D} Pokémon, this attack does 100 more damage."
      'Punishing Fang': {
        damage: { add: [100, { cond: { slotIs: { ref: 'oppActive', filter: { type: 'Darkness' } } }, then: 100, else: 0 }] },
      },
    },
  },
  {
    id: 'sv10-030',
    name: 'Rapidash',
    abilities: [
      {
        // "Once during your turn, you may draw a card."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2148/): each Rapidash can use its own Hurried Gait (each Rapidash uses its own Hurried Gait)
        name: 'Hurried Gait',
        activated: { program: [{ op: 'draw', n: 1 }] },
      },
    ],
  },
  {
    id: 'sv10-031',
    name: "Team Rocket's Moltres ex",
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance)."
      'Flame Screen': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -50, fromOpp: true }, on: 'self', duration: 'oppNextTurn' }] },
      // "Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2156/): discarding isn't knocking out, so no prize cards. (no Prize cards)
      'Evil Incineration': {
        program: [
          { op: 'discardEnergy', from: 'self', count: 1, filter: { name: "Team Rocket's Energy" }, as: 'tr' },
          { op: 'if', cond: { gte: [{ len: 'tr' }, 1] }, then: [{ op: 'custom', fn: 'stdEngine.discardDefender' }] },
        ],
      },
    },
    notes: 'Evil Incineration discards the Defending Pokémon and everything on it (a discard, not a Knock Out: ruling 2156), via the same custom as Jynx.',
  },
  {
    id: 'sv10-033',
    name: "Ethan's Quilava",
    abilities: [
      {
        // "Once during your turn, you may search your deck for an Ethan's Adventure card, reveal it, and put it into your hand. Then, shuffle your deck."
        name: 'Bonded by the Journey',
        activated: { program: searchToHand({ name: "Ethan's Adventure" }, 1, { reveal: true }) },
      },
    ],
  },
  {
    id: 'sv10-034',
    name: "Ethan's Typhlosion",
    attacks: {
      // "This attack does 60 more damage for each Ethan's Adventure card in your discard pile."
      'Buddy Blast': { damage: { add: [40, { mul: [60, inDiscard({ name: "Ethan's Adventure" })] }] } },
    },
  },
  {
    id: 'sv10-042',
    name: 'Blaziken',
    attacks: {
      // "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2159/): Energy discard is mandatory, separate from damage. (even with no Benched Pokémon to hit)
      'Inferno Kick Flurry': {
        pre: [{ op: 'discardEnergy', from: 'self', count: 2 }],
        post: [{ op: 'if', cond: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }, then: damageOneOf('oppBench', 120) }],
      },
    },
  },
  {
    id: 'sv10-045',
    name: "Misty's Psyduck",
    abilities: [
      {
        // "Once during your turn, if this Pokémon is on your Bench, you may discard the bottom card of your deck. If you do, discard all
        //  cards from this Pokémon and put this Pokémon on top of your deck."
        name: 'Flustered Leap',
        activated: {
          when: { and: [{ onBench: 'self' }, { gte: [{ deckSize: 'self' }, 1] }] },
          program: [{ op: 'custom', fn: 'c32.flusteredLeap' }],
        },
      },
    ],
    notes: 'The Ability is only offered with a card in the deck: with none there is no bottom card to discard, so "if you do" could not happen.',
  },
  {
    id: 'sv10-047',
    name: "Misty's Starmie",
    attacks: {
      // "If this Pokémon evolved from Misty's Staryu during this turn, this attack does 80 more damage."
      'Abrupt Flash': {
        damage: { add: [60, { cond: { custom: 'c04.evolvedFromThisTurn', args: { name: "Misty's Staryu" } }, then: 80, else: 0 }] },
      },
    },
  },
  {
    id: 'sv10-049',
    name: "Misty's Gyarados",
    attacks: {
      // "Discard the top 7 cards of your deck, and this attack does 70 damage for each Misty's Pokémon that you discarded in this way."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2164/): discard as many as possible if fewer than 7. (fewer than 7 cards in the deck)
      'Splashing Panic': {
        pre: [{ op: 'custom', fn: 'c09.discardTopCount', args: { n: 7, filter: MISTYS_POKEMON, as: 'n' } }],
        damage: { mul: [70, { v: 'n' }] },
      },
    },
  },
  {
    id: 'sv10-050',
    name: "Misty's Lapras",
    attacks: {
      // "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
      'Swim Together': { program: searchToHand(MISTYS_POKEMON, 3, { reveal: true }) },
    },
  },
  {
    id: 'sv10-051',
    name: "Team Rocket's Articuno",
    abilities: [
      {
        // "Prevent all effects of attacks used by your opponent's Pokémon done to your Basic Team Rocket's Pokémon. (Existing effects are not removed. Damage is not an effect.)"
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2150/): damage moved onto an effect-blocking Pokémon vanishes; damage moved off one stays where it was.
        name: 'Repelling Veil',
        statics: [{ effect: { k: 'preventEffects', from: ['attack'] }, scope: 'myPokemon', filter: { stage: 'basic', nameIncludes: "Team Rocket's" } }],
      },
    ],
    attacks: {
      // "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage."
      'Dark Frost': { damage: { add: [60, { cond: HAS_TR_ENERGY, then: 60, else: 0 }] } },
    },
  },
  {
    id: 'sv10-052',
    name: "Cynthia's Feebas",
    attacks: {
      // "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon."
      Undulate: {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'effect', static: { k: 'preventDamage', andEffects: true }, on: 'self', duration: 'oppNextTurn' }] },
        ],
      },
    },
  },
  {
    id: 'sv10-054',
    name: 'Clamperl',
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 10 less damage from attacks (after applying Weakness and Resistance)."
      'Shell Press': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -10, fromOpp: true }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv10-056',
    name: 'Gorebyss',
    attacks: {
      // "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon."
      'Crescendo Wave': {
        pre: [
          {
            op: 'chooseCards',
            from: 'hand',
            filter: { energyType: 'Water' },
            min: 0,
            max: { count: { zone: 'hand', filter: { energyType: 'Water' } } },
            as: 'e',
            prompt: 'Attach any number of Basic {W} Energy cards to this Pokémon',
          },
          { op: 'attach', cards: 'e', to: 'self' },
        ],
        damage: { mul: [30, { energyOn: 'self', type: 'Water' }] },
      },
    },
  },
  {
    id: 'sv10-060',
    name: 'Abomasnow',
    attacks: {
      // "If this Pokémon has 2 or more {G} Energy attached, this attack does 120 more damage."
      'Frozen Wood': { damage: { add: [120, { cond: { gte: [{ energyOn: 'self', type: 'Grass' }, 2] }, then: 120, else: 0 }] } },
    },
  },
  {
    id: 'sv10-066',
    name: 'Dondozo ex',
    attacks: {
      // "This attack does 10 more damage for each damage counter on this Pokémon."
      'Avenging Billow': { damage: { add: [30, { mul: [10, { countersOn: 'self' }] }] } },
      // "You may do 120 more damage. If you do, this Pokémon also does 50 damage to itself."
      'Dynamic Dive': {
        pre: [
          { op: 'set', v: 'more', value: 0 },
          { op: 'may', prompt: 'Do 120 more damage (and 50 damage to this Pokémon)?', body: [{ op: 'set', v: 'more', value: 120 }] },
        ],
        damage: { add: [120, { v: 'more' }] },
        post: [{ op: 'if', cond: { gt: [{ v: 'more' }, 0] }, then: [{ op: 'damage', amount: 50, to: 'self' }] }],
      },
    },
  },
  {
    id: 'sv10-069',
    name: 'Electivire ex',
    attacks: {
      // "This attack does 50 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Dual Bolt': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 2, max: 2, as: 't', prompt: "Choose 2 of your opponent's Pokémon" },
          { op: 'damage', amount: 50, to: { v: 't' } },
        ],
      },
      // "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 100 more damage."
      // The cost is {L}{L}{C}: 3 Energy, counted in units provided, so "2 extra" = 5 or more.
      'High-Voltage Press': { damage: { add: [180, { cond: { gte: [{ energyOn: 'self' }, 5] }, then: 100, else: 0 }] } },
    },
  },
  {
    id: 'sv10-070',
    name: "Team Rocket's Zapdos",
    attacks: {
      // "You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon."
      'Jamming Wing': {
        post: [
          {
            op: 'if',
            cond: { and: [{ gte: [{ energyOn: 'oppActive' }, 1] }, { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }] },
            then: [
              {
                op: 'may',
                prompt: "Move an Energy from your opponent's Active Pokémon to their Bench?",
                body: [
                  { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: 'Move it to which Benched Pokémon?' },
                  { op: 'custom', fn: 'moveOppActiveEnergy', args: { to: 't' } },
                ],
              },
            ],
          },
        ],
      },
      // "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage."
      'Wicked Thunder': { damage: { add: [60, { cond: HAS_TR_ENERGY, then: 60, else: 0 }] } },
    },
  },
  {
    id: 'sv10-071',
    name: "Ethan's Pichu",
    attacks: {
      // "Draw a card."
      'Zapping Draw': { post: [{ op: 'draw', n: 1 }] },
    },
  },
  {
    id: 'sv10-072',
    name: "Team Rocket's Mareep",
    attacks: {
      // "Search your deck for an Item card, reveal it, and put it into your hand. Then, shuffle your deck."
      Procurement: { program: searchToHand({ ttype: 'item' }, 1, { reveal: true }) },
    },
  },
  {
    id: 'sv10-077',
    name: 'Rotom',
    attacks: {
      // "Choose a random card from your opponent's hand. Your opponent reveals that card and shuffles it into their deck."
      Astonish: {
        post: [
          {
            op: 'if',
            cond: { gte: [{ handSize: 'opp' }, 1] },
            then: [
              { op: 'custom', fn: 'seed2.randomOppHandCard', args: { as: 'x' } },
              { op: 'move', cards: 'x', to: 'deck', who: 'opp' },
              { op: 'shuffle', who: 'opp' },
            ],
          },
        ],
      },
      // "This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/1077/): effects depending on Tool presence work; only the Tool's own effects are cancelled.
      // (a Pokémon holds one Tool, so counting the Pokémon with a Tool counts the Tools)
      'Gadget Show': { damage: { mul: [30, { pokemon: { zone: 'myPokemon', filter: { tool: true } } }] } },
    },
  },
];
