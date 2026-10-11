/**
 * Standard batch c37: Black Bolt / White Flare (sv10.5w) cards 005-048 that no other lane scripted. Written from the printed
 * text in frames.ts; quotes below are that text. Tests: src/__tests__/cards-std-c37.test.ts.
 *
 * Skipped (needs vocabulary the engine does not have yet):
 *  - sv10.5w-008 Shelmet (Stimulated Evolution): "If you have Karrablast in play, this Pokémon can evolve during your first turn
 *    or the turn you play it." A static that changes evolution timing.
 *  - sv10.5w-045 Jellicent ex (Oceanic Curse): "your opponent can't play any Item cards or Pokémon Tool cards from their hand."
 *    The Item lock exists but there is no play lock on Pokémon Tool cards.
 *  - sv10.5w-046 Roggenrola (Harden): "prevent all damage done to this Pokémon by attacks if that damage is 40 or less."
 *    Damage prevention up to an amount.
 */
import type { CardScript, Cond, Filter, Program } from '../../dsl.js';
import './fighting-customs.js'; // sumCounters
import { searchToHand } from './helpers.js';
import './std-c17-customs.js'; // c17.lookTopMayDiscard
import './std-c19-customs.js'; // c19.scoopUp
import './std-c33-customs.js'; // c33.reorderOppTop
import './std-c37-customs.js'; // c37.moveAllCounters, c37.defenderResists
import './std-seed1-customs.js'; // std.revealHand

const HEADS: Cond = { gte: [{ v: 'h' }, 1] };
const FIRE_POKEMON_OR_BASIC_FIRE: Filter = { any: [{ cat: 'pokemon', type: 'Fire' }, { basicEnergy: true, energyType: 'Fire' }] };

/**
 * "Search your deck for up to n Basic Energy cards and attach them to your Pokémon in any way you like." as repeated optional
 * single picks, each attached to a Pokémon of its own choosing (the same shape as Altaria, Humming Charge). The caller shuffles.
 */
function attachSearched(n: number): Program {
  return [
    {
      op: 'repeat',
      n,
      body: [
        { op: 'chooseCards', from: 'deck', filter: { basicEnergy: true }, min: 0, max: 1, as: 'e', prompt: 'Choose a Basic Energy to attach (or none)' },
        {
          op: 'if',
          cond: { gte: [{ len: 'e' }, 1] },
          then: [
            { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach it to which of your Pokémon?' },
            { op: 'attach', cards: 'e', to: { v: 't' } },
          ],
        },
      ],
    },
  ];
}

export const STD_C37: CardScript[] = [
  {
    id: 'sv10.5w-005',
    name: 'Whimsicott ex',
    attacks: {
      // "Search your deck for up to 3 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck."
      'Energy Gift': { program: [...attachSearched(3), { op: 'shuffle' }] },
      // "Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there."
      'Wondrous Cotton': {
        pre: [{ op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } }],
        damage: { mul: [50, { count: { zone: 'hand', who: 'opp', filter: { cat: 'trainer' } } }] },
      },
    },
  },
  {
    id: 'sv10.5w-009',
    name: 'Accelgor',
    attacks: {
      // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
      'Acid Spray': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: HEADS, then: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
        ],
      },
    },
  },
  {
    id: 'sv10.5w-010',
    name: 'Virizion',
    attacks: {
      // "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon."
      // The damage done is the change in the Defending Pokémon's damage counters (after Weakness, Resistance and every modifier).
      'Giga Drain': {
        pre: [{ op: 'set', v: 'before', value: { countersOn: 'defender' } }],
        post: [{ op: 'heal', amount: { mul: [10, { max: [0, { sub: [{ countersOn: 'defender' }, { v: 'before' }] }] }] }, to: 'self' }],
      },
      // "During your next turn, this Pokémon can't use attacks."
      'Emerald Blade': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv10.5w-013',
    name: 'Emboar',
    abilities: [
      {
        // "As often as you like during your turn, you may attach a Basic {R} Energy card from your hand to 1 of your Pokémon."
        name: 'Inferno Fandango',
        activated: {
          oncePerTurn: false,
          when: { gte: [{ count: { zone: 'hand', filter: { energyType: 'Fire' } } }, 1] },
          program: [
            { op: 'chooseCards', from: 'hand', filter: { energyType: 'Fire' }, min: 1, max: 1, as: 'e', prompt: 'Choose a Basic {R} Energy' },
            { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach it to which of your Pokémon?' },
            { op: 'attach', cards: 'e', to: { v: 't' } },
          ],
        },
      },
    ],
  },
  {
    id: 'sv10.5w-016',
    name: 'Litwick',
    attacks: {
      // "Look at the top card of your deck. You may discard that card."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2189/): card goes back on top if not discarded.
      'Brighten and Burn': { program: [{ op: 'custom', fn: 'c17.lookTopMayDiscard' }] },
    },
  },
  {
    id: 'sv10.5w-018',
    name: 'Chandelure',
    attacks: {
      // "If you have 10 or more Basic {R} Energy cards in your discard pile, this attack does 100 more damage."
      'Incendiary Pillar': {
        damage: { add: [50, { cond: { gte: [{ count: { zone: 'discard', filter: { energyType: 'Fire' } } }, 10] }, then: 100, else: 0 }] },
      },
      // "Discard all Energy from this Pokémon."
      'Burn It All Up': { post: [{ op: 'discardEnergy', from: 'self', count: 'all' }] },
    },
  },
  {
    id: 'sv10.5w-019',
    name: 'Heatmor',
    attacks: {
      // "Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
      'Licking Catch': { program: searchToHand(FIRE_POKEMON_OR_BASIC_FIRE, 3) },
    },
  },
  {
    id: 'sv10.5w-020',
    name: 'Reshiram ex',
    attacks: {
      // "This attack does 50 more damage for each Prize card your opponent has taken. Discard an Energy from this Pokémon."
      'Blazing Burst': {
        damage: { add: [130, { mul: [50, { prizesTaken: 'opp' }] }] },
        post: [{ op: 'discardEnergy', from: 'self', count: 1 }],
      },
    },
  },
  {
    id: 'sv10.5w-023',
    name: 'Samurott',
    abilities: [
      {
        // "Once during your turn, you may switch your Active Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2187/): each Samurott can use once per turn. (each Samurott in play can use it once)
        // Usable only with a Benched Pokémon to switch with ("If you do").
        name: 'Torrential Whirlpool',
        activated: {
          when: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
          program: [
            { op: 'switch', who: 'self' },
            { op: 'switch', who: 'opp', chooser: 'opp' },
          ],
        },
      },
    ],
    attacks: {
      // "This attack does 50 more damage for each Energy attached to this Pokémon."
      'Energized Slash': { damage: { add: [30, { mul: [50, { energyOn: 'self' }] }] } },
    },
  },
  {
    id: 'sv10.5w-024',
    name: 'Basculin',
    attacks: {
      // "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing."
      'Bared Fangs': {
        program: [{ op: 'if', cond: { slotIs: { ref: 'oppActive', filter: { damaged: true } } }, then: [{ op: 'damage', amount: 50 }] }],
      },
    },
  },
  {
    id: 'sv10.5w-025',
    name: 'Ducklett',
    attacks: {
      // "Discard a {R} Energy from your opponent's Active Pokémon."
      // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2194/): Prism counts as Fire if on Basic, not on other Pokémon. ("{R} Energy" is any Energy providing {R}.)
      Firefighting: { post: [{ op: 'discardEnergy', from: 'oppActive', count: 1, filter: { providesType: 'Fire' } }] },
    },
  },
  {
    id: 'sv10.5w-029',
    name: 'Vanilluxe',
    attacks: {
      // "Flip 2 coins. This attack does 90 damage for each heads. If either of them is heads, your opponent's Active Pokémon is now Paralyzed."
      'Double Freeze': {
        pre: [{ op: 'flip', n: 2, as: 'h' }],
        damage: { mul: [90, { v: 'h' }] },
        post: [{ op: 'if', cond: HEADS, then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }] }],
      },
    },
  },
  {
    id: 'sv10.5w-030',
    name: 'Keldeo ex',
    attacks: {
      // "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 90 more damage."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2195/): it was moved up during the opponent's turn, not "this turn", so no bonus. (replacing a Knocked Out Active Pokémon)
      'Gale Thrust': { damage: { add: [30, { cond: { movedToActiveThisTurn: 'self' }, then: 90, else: 0 }] } },
      // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
      'Sonic Edge': { ignore: { defenderEffects: true } },
    },
  },
  {
    id: 'sv10.5w-034',
    name: 'Galvantula',
    attacks: {
      // "Discard all {L} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way."
      Discharge: {
        pre: [{ op: 'discardEnergy', from: 'self', count: 'all', filter: { providesType: 'Lightning' }, as: 'gone' }],
        damage: { mul: [50, { len: 'gone' }] },
      },
    },
  },
  {
    id: 'sv10.5w-035',
    name: 'Stunfisk',
    attacks: {
      // "If this Pokémon has any {F} Energy attached, this attack does 20 more damage."
      'Muddy Bolt': {
        damage: { add: [20, { cond: { slotIs: { ref: 'self', filter: { energy: { providesType: 'Fighting' } } } }, then: 20, else: 0 }] },
      },
    },
  },
  {
    id: 'sv10.5w-037',
    name: 'Swoobat',
    attacks: {
      // "Put 1 of your Benched Pokémon and all attached cards into your hand."
      'Happy Return': {
        program: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [
              { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Put which of your Benched Pokémon and all attached cards into your hand?' },
              { op: 'custom', fn: 'c19.scoopUp', args: { slot: 't' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv10.5w-038',
    name: 'Sigilyph',
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 40 less damage from attacks (after applying Weakness and Resistance)."
      Reflect: { post: [{ op: 'effect', static: { k: 'damageIn', amount: -40 }, on: 'self', duration: 'oppNextTurn' }] },
      // "This attack does 70 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance."
      Telekinesis: {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: "Do 70 damage to which of your opponent's Pokémon?" },
          { op: 'damage', amount: 70, to: { v: 't' }, ignore: { weakness: true, resistance: true } },
        ],
      },
    },
  },
  {
    id: 'sv10.5w-040',
    name: 'Cofagrigus',
    attacks: {
      // "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2192/): the source Pokémon loses its counters, but the protected Antique Cover Fossil neither receives them nor loses any; counters aimed at a blocker vanish, counters on a blocker stay.
      'Extended Damagriiigus': {
        program: [
          { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 'from', prompt: 'Move all damage counters from which of your Benched Pokémon?' },
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 'to', prompt: "Move them to which of your opponent's Pokémon?" },
          { op: 'custom', fn: 'c37.moveAllCounters', args: { from: 'from', to: 'to' } },
        ],
      },
      // "Your opponent's Active Pokémon is now Confused."
      Perplex: { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv10.5w-042',
    name: 'Gothorita',
    attacks: {
      // "Look at the top 5 cards of your opponent's deck and put them back in any order."
      'Fortunate Eye': { program: [{ op: 'custom', fn: 'c33.reorderOppTop', args: { n: 5 } }] },
    },
  },
  {
    id: 'sv10.5w-047',
    name: 'Boldore',
    attacks: {
      // "If your opponent's Active Pokémon has {F} Resistance, this attack does 50 more damage."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/597/): the extra damage is added first and the Resistance subtracted afterwards ("it does not ignore the Resistance").
      'Smack Down': {
        damage: { add: [30, { cond: { custom: 'c37.defenderResists', args: { type: 'Fighting' } }, then: 50, else: 0 }] },
      },
    },
  },
  {
    id: 'sv10.5w-048',
    name: 'Gigalith',
    attacks: {
      // "This attack does 20 damage for each damage counter on all of your Benched {F} Pokémon."
      'Vengeful Cannon': {
        pre: [{ op: 'custom', fn: 'sumCounters', args: { zone: 'myBench', filter: { type: 'Fighting' }, as: 'n' } }],
        damage: { mul: [20, { v: 'n' }] },
      },
    },
  },
];
