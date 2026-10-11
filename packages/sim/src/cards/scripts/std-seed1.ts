/**
 * Standard seed batch 1: Pokémon whose attack wording no earlier script implemented.
 * Each script is written from the printed text in frames.ts; quotes below are that text.
 */
import type { CardScript, Cond, Step } from '../../dsl.js';
import { searchToBench, searchToHand } from './helpers.js';
import './std-seed1-customs.js';

/** "heads" after `{ op: 'flip', n: 1, as: 'h' }`. */
const HEADS: Cond = { gte: [{ v: 'h' }, 1] };
const FLIP: Step = { op: 'flip', n: 1, as: 'h' };

export const STD_SEED1: CardScript[] = [
  {
    id: 'me01-022',
    name: 'Mega Camerupt ex',
    attacks: {
      // "If your opponent's Active Pokémon is Burned, this attack does 160 more damage."
      'Roasting Heat': {
        damage: { add: [80, { cond: { slotIs: { ref: 'defender', filter: { condition: 'burned' } } }, then: 160, else: 0 }] },
      },
      // "Discard 2 Energy from this Pokémon."
      'Volcanic Meteor': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'me01-026',
    name: 'Scorbunny',
    attacks: {
      // "Flip a coin. If tails, this attack does nothing."
      'Wild Kick': { program: [FLIP, { op: 'if', cond: { lt: [{ v: 'h' }, 1] }, then: [{ op: 'end' }] }, { op: 'damage', amount: 30 }] },
    },
  },
  {
    id: 'me02.5-030',
    name: 'Pignite',
    attacks: {
      // "Your opponent's Active Pokémon is now Burned."
      'Super Singe': { post: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
    },
  },
  {
    id: 'me01-005',
    name: 'Exeggutor',
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."
      'Guard Press': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -30 }, on: 'self', duration: 'oppNextTurn' }] },
      // "This attack does 30 more damage for each {G} Energy attached to this Pokémon."
      'Stomping Wood': { damage: { add: [60, { mul: [30, { energyOn: 'self', type: 'Grass' }] }] } },
    },
  },
  {
    id: 'me03-023',
    name: 'Amaura',
    attacks: {
      // "Your opponent's Active Pokémon is now Asleep."
      'Icy Wind': { post: [{ op: 'condition', cond: 'asleep', to: 'oppActive' }] },
    },
  },
  {
    id: 'me01-107',
    name: 'Buneary',
    attacks: {
      // "During your opponent's next turn, attacks used by the Defending Pokémon do 20 less damage (before applying Weakness and Resistance)."
      Charm: { program: [{ op: 'effect', static: { k: 'damageOut', amount: -20 }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me02.5-134',
    name: 'Scraggy',
    attacks: {
      // "Discard a random card from your opponent's hand."
      'Knock Off': { post: [{ op: 'custom', fn: 'std.discardRandomFromHand', args: { who: 'opp' } }] },
    },
  },
  {
    id: 'me02-019',
    name: 'Charcadet',
    attacks: {
      // "Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
      'Gather Strength': { program: searchToHand({ basicEnergy: true }, 2) },
    },
  },
  {
    id: 'me02-042',
    name: 'Mimikyu',
    attacks: {
      // "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck."
      'Call for Family': { program: searchToBench({}, 1) },
    },
  },
  {
    id: 'sv08-108',
    name: 'Drilbur',
    attacks: {
      // "Discard the top card of your opponent's deck."
      Burrow: { program: [{ op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp' }] },
    },
  },
  {
    id: 'me01-102',
    name: 'Spearow',
    attacks: {
      // "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."
      Pluck: { pre: [{ op: 'custom', fn: 'std.discardOppActiveTools' }] },
    },
  },
  {
    id: 'me02-038',
    name: 'Granbull',
    attacks: {
      // "If your opponent's Active Pokémon already has any damage counters on it, this attack does 90 more damage."
      'Finishing Blow': {
        damage: { add: [90, { cond: { slotIs: { ref: 'defender', filter: { damaged: true } } }, then: 90, else: 0 }] },
      },
    },
  },
  {
    id: 'me02-066',
    name: 'Krookodile',
    attacks: {
      // "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 160 more damage."
      // Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2245/): A Pokémon removed from play counts as knocked out regardless of Prize cards awarded.
      // The condition tests the Knock Out itself, never the Prize cards.
      'Vengeful Fang': { damage: { add: [60, { cond: { custom: 'std.attackKoLastTurn' }, then: 160, else: 0 }] } },
    },
  },
  {
    id: 'sv05-126',
    name: 'Hoothoot',
    attacks: {
      // "Your opponent reveals their hand."
      'Silent Wing': { post: [{ op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } }] },
    },
  },
  {
    id: 'me01-004',
    name: 'Exeggcute',
    attacks: {
      // "Search your deck for a Basic {G} Energy card and attach it to this Pokémon. Then, shuffle your deck."
      'Jam-Packed': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { energyType: 'Grass' }, min: 0, max: 1, as: 'e' },
          { op: 'attach', cards: 'e', to: 'self' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'me02-071',
    name: 'Bronzor',
    attacks: {
      // "Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks."
      'Iron Defense': {
        program: [FLIP, { op: 'if', cond: HEADS, then: [{ op: 'effect', static: { k: 'preventDamage' }, on: 'self', duration: 'oppNextTurn' }] }],
      },
    },
  },
  {
    id: 'sv10-009',
    name: 'Mow Rotom',
    attacks: {
      // "Discard a Stadium in play."
      'Trimming Mower': { post: [{ op: 'custom', fn: 'std.discardStadium' }] },
      // "This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."
      // One Tool per Pokémon, so the Pokémon that have a Tool are the Tools.
      'Gadget Show': { damage: { mul: [30, { pokemon: { zone: 'myPokemon', filter: { tool: true } } }] } },
    },
  },
  {
    id: 'me03-065',
    name: 'Diggersby',
    attacks: {
      // "This attack also does 30 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      Earthquake: { post: [{ op: 'damage', amount: 30, to: { each: 'myBench' } }] },
    },
  },
  {
    id: 'me05-055',
    name: 'Morpeko ex',
    attacks: {
      // "Shuffle your hand into your deck. Then, draw 6 cards."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2413/): The deck is shuffled even when no hand cards exist.
      'Wheely Draw': {
        program: [{ op: 'move', cards: { all: 'hand' }, to: 'deck' }, { op: 'shuffle' }, { op: 'draw', n: 6 }],
      },
      // "This attack does 40 more damage for each damage counter on this Pokémon."
      'Hangry Blaster': { damage: { add: [40, { mul: [40, { countersOn: 'self' }] }] } },
    },
  },
  {
    id: 'sv05-112',
    name: 'Mawile',
    attacks: {
      // "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon."
      // Ruling (TPCi Rules Team 2024-03-21, https://compendium.pokegym.net/ruling/1956/): Damage is only dealt if the switch succeeds.
      'Invite and Strike': {
        program: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] },
            then: [
              { op: 'switch', who: 'opp', chooser: 'self' },
              { op: 'damage', amount: 30, to: 'oppActive' },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv06-013',
    name: 'Trevenant',
    attacks: {
      // "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon."
      // The damage done is the change in the Defending Pokémon's damage counters (after Weakness, Resistance and every modifier).
      'Giga Drain': {
        pre: [{ op: 'set', v: 'before', value: { countersOn: 'defender' } }],
        post: [{ op: 'heal', amount: { mul: [10, { max: [0, { sub: [{ countersOn: 'defender' }, { v: 'before' }] }] }] }, to: 'self' }],
      },
    },
  },
  {
    id: 'me01-048',
    name: 'Raikou',
    attacks: {
      // "If you have at least 4 {L} Energy in play, this attack does 90 more damage."
      'Electro Fall': {
        pre: [{ op: 'custom', fn: 'std.energyInPlay', args: { type: 'Lightning', as: 'n' } }],
        damage: { add: [30, { cond: { gte: [{ v: 'n' }, 4] }, then: 90, else: 0 }] },
      },
    },
  },
  {
    id: 'me01-100',
    name: 'Mega Latias ex',
    attacks: {
      // "You may switch this Pokémon with 1 of your Benched Pokémon."
      Strafe: {
        post: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [{ op: 'may', prompt: 'Switch this Pokémon with a Benched Pokémon?', body: [{ op: 'switch', who: 'self' }] }],
          },
        ],
      },
      // "Discard all Energy from this Pokémon."
      'Illusory Impulse': { post: [{ op: 'discardEnergy', from: 'self', count: 'all' }] },
    },
  },
  {
    id: 'me02-073',
    name: 'Togedemaru',
    attacks: {
      // "Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
      'Find a Friend': { program: searchToHand({ cat: 'pokemon' }, 1) },
    },
  },
  {
    id: 'me02.5-056',
    name: 'Raichu',
    attacks: {
      // "Flip a coin. If heads, this attack does 50 more damage."
      'Quick Blow': { pre: [FLIP], damage: { add: [20, { cond: HEADS, then: 50, else: 0 }] } },
      // "Discard a {L} Energy from this Pokémon."
      'Strong Volt': { post: [{ op: 'discardEnergy', from: 'self', count: 1, filter: { providesType: 'Lightning' } }] },
    },
  },
];
