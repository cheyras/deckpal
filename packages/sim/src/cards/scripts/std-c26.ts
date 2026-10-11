/**
 * Standard batch c26: Pokémon of Journey Together-era sv08 (Surging Sparks) numbers 114-155 whose text no earlier script
 * covered. Each script is written from the printed text in frames; quotes below are that text.
 *
 * Not scripted (the vocabulary lacks the capability):
 *  - sv08-116 Koraidon: "If 1 of your other Ancient Pokémon used an attack during your last turn" needs the Ancient tag
 *    (being built).
 *  - sv08-130 Archaludon ex: Metal Defender ("During your opponent's next turn, this Pokémon has no Weakness") needs an effect
 *    that removes a Pokémon's Weakness; `weaknessType` can only swap the type.
 *  - sv08-143 Eevee: Boosted Evolution ("it can evolve during your first turn or the turn you play it") needs a static that
 *    changes evolution timing.
 *  - sv08-150 Kecleon: Expert Hider ("If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that
 *    damage") needs a coin flip that prevents damage at damage time.
 *  - sv08-151 Bouffalant: Ready to Ram ("if this Pokémon is damaged by an attack ... put 6 damage counters on the Attacking
 *    Pokémon") is an attack effect that reacts to the Pokémon being damaged (being built).
 *
 * Pokémon V: sv08-147 Slaking ex's "Pokémon ex or Pokémon V" is scripted as ex only. The filter vocabulary has no V test and
 * no Pokémon V is legal in Standard 2026 (as in std-c21 Galvantula ex).
 */
import type { CardScript, Cond } from '../../dsl.js';
import { searchToHand } from './helpers.js';
import './std-c01-customs.js'; // c01.benchCards
import './std-c04-customs.js'; // c04.evolvedFromThisTurn
import './std-c06-customs.js'; // c06.attachSplit
import './std-c11-customs.js'; // c11.discardOppActiveEnergy
import './std-c15-customs.js'; // c15.countAttached
import './std-c21-customs.js'; // c21.selfIntoDeck
import './std-c26-customs.js';
import './std-seed1-customs.js'; // std.discardStadium
import './std-seed2-customs.js'; // seed2.sumAttached

/** "Flip a coin. If heads, ..." */
const HEADS: Cond = { gte: [{ v: 'h' }, 1] };

/** Exactly n of the three coins were heads. */
function headsIs(n: number): Cond {
  return { eq: [{ v: 'h' }, n] };
}

const DEFENDER_IS_EX: Cond = { slotIs: { ref: 'defender', filter: { ex: true } } };

export const STD_C26: CardScript[] = [
  {
    id: 'sv08-114',
    name: 'Glimmet',
    attacks: {
      // "This attack's damage isn't affected by Resistance."
      'Rock Hurl': { ignore: { resistance: true } },
    },
  },
  {
    id: 'sv08-115',
    name: 'Glimmora',
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, Energy cards can't be attached from your opponent's hand to that Pokémon."
      'Corrosive Shards': {
        post: [
          { op: 'condition', cond: 'poisoned', to: 'defender' },
          { op: 'effect', static: { k: 'cantAttachFromHand' }, on: 'defender', duration: 'oppNextTurn' },
        ],
      },
    },
  },
  {
    id: 'sv08-121',
    name: 'Grafaiai',
    attacks: {
      // "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."
      // ("Up to" on an attack is 0 to 3.) You choose the cards and which of their Pokémon each one goes to.
      'Mischievous Painting': {
        program: [
          { op: 'chooseCards', from: 'discard', who: 'opp', filter: { cat: 'energy' }, min: 0, max: 3, as: 'e', prompt: "Choose up to 3 Energy cards from your opponent's discard pile" },
          { op: 'custom', fn: 'c26.attachToOppPokemon', args: { cards: 'e' } },
        ],
      },
      // "This attack does 40 damage for each Energy attached to all of your opponent's Pokémon."
      'Energized Graffiti': {
        pre: [{ op: 'custom', fn: 'seed2.sumAttached', args: { kind: 'energy', zone: 'oppPokemon', as: 'n' } }],
        damage: { mul: [40, { v: 'n' }] },
      },
    },
  },
  {
    id: 'sv08-123',
    name: 'Alolan Dugtrio',
    attacks: {
      // "If you don't have exactly 3 cards in your hand, this attack does nothing."
      'Trio-Cheehoo': {
        program: [{ op: 'if', cond: { eq: [{ handSize: 'self' }, 3] }, then: [{ op: 'damage', amount: 120 }] }],
      },
    },
  },
  {
    id: 'sv08-125',
    name: 'Registeel',
    attacks: {
      // "This attack does 10 more damage for each damage counter on this Pokémon."
      'Raging Hammer': { damage: { add: [60, { mul: [10, { countersOn: 'self' }] }] } },
    },
  },
  {
    id: 'sv08-128',
    name: 'Klefki',
    attacks: {
      // "Discard a card from your hand. If you do, draw 2 cards."
      "Stick 'n' Draw": {
        program: [
          { op: 'chooseCards', from: 'hand', min: 1, max: 1, as: 'd', prompt: 'Discard a card from your hand' },
          { op: 'if', cond: { gte: [{ len: 'd' }, 1] }, then: [{ op: 'move', cards: 'd', to: 'discard' }, { op: 'draw', n: 2 }] },
        ],
      },
    },
  },
  {
    id: 'sv08-131',
    name: 'Gholdengo',
    attacks: {
      // "If this Pokémon evolved from Gimmighoul during this turn, this attack does 90 more damage."
      'Strike It Rich': {
        damage: { add: [30, { cond: { custom: 'c04.evolvedFromThisTurn', args: { name: 'Gimmighoul' } }, then: 90, else: 0 }] },
      },
      // "You may shuffle this Pokémon and all attached cards into your deck."
      'Surf Back': {
        post: [
          {
            op: 'may',
            body: [
              { op: 'custom', fn: 'c21.selfIntoDeck', args: { as: 'done' } },
              { op: 'if', cond: { eq: [{ v: 'done' }, 1] }, then: [{ op: 'shuffle' }] },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv08-132',
    name: 'Iron Crown',
    attacks: {
      // "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage."
      'Deleting Slash': {
        damage: { add: [40, { cond: { gte: [{ pokemon: { zone: 'oppBench' } }, 3] }, then: 80, else: 0 }] },
      },
    },
  },
  {
    id: 'sv08-133',
    name: 'Alolan Exeggutor ex',
    attacks: {
      // "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like."
      'Tropical Frenzy': {
        post: [
          {
            op: 'may',
            body: [
              { op: 'chooseCards', from: 'hand', filter: { basicEnergy: true }, min: 0, max: { handSize: 'self' }, as: 'e', prompt: 'Choose any number of Basic Energy cards to attach' },
              { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myPokemon' } },
            ],
          },
        ],
      },
      // "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."
      'Swinging Sphene': {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: HEADS,
            then: [{ op: 'if', cond: { slotIs: { ref: 'oppActive', filter: { stage: 'basic' } } }, then: [{ op: 'knockOut', target: 'oppActive' }] }],
          },
          {
            op: 'if',
            cond: { lt: [{ v: 'h' }, 1] },
            then: [
              { op: 'chooseSlots', from: 'oppBench', filter: { stage: 'basic' }, min: 1, max: 1, as: 't', prompt: "Knock Out which of your opponent's Benched Basic Pokémon?" },
              { op: 'knockOut', target: { v: 't' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv08-135',
    name: 'Dialga',
    attacks: {
      // "Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order."
      'Time Manipulation': {
        program: [
          { op: 'chooseCards', from: 'deck', min: 2, max: 2, as: 'found', prompt: 'Search your deck for 2 cards' },
          { op: 'shuffle' },
          { op: 'putOnTop', cards: 'found' },
        ],
      },
    },
  },
  {
    id: 'sv08-136',
    name: 'Palkia',
    attacks: {
      // "This attack does 40 damage for each Basic Energy attached to this Pokémon."
      'Space Crash': {
        pre: [{ op: 'custom', fn: 'c15.countAttached', args: { filter: { basicEnergy: true }, as: 'n' } }],
        damage: { mul: [40, { v: 'n' }] },
      },
    },
  },
  {
    id: 'sv08-137',
    name: 'Turtonator',
    attacks: {
      // "Discard an Energy from your opponent's Active Pokémon ex."
      'Fully Singe': {
        post: [{ op: 'if', cond: DEFENDER_IS_EX, then: [{ op: 'custom', fn: 'c11.discardOppActiveEnergy' }] }],
      },
    },
  },
  {
    id: 'sv08-140',
    name: 'Appletun',
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't attack."
      'Melting Sweetness': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'defender', duration: 'oppNextTurn' }] },
      // "This Pokémon also does 20 damage to itself."
      'Wild Tackle': { post: [{ op: 'damage', amount: 20, to: 'self' }] },
    },
  },
  {
    id: 'sv08-141',
    name: 'Eternatus',
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 80 more damage."
      'Dyna-Blast': { damage: { add: [10, { cond: DEFENDER_IS_EX, then: 80, else: 0 }] } },
      // "Discard a Stadium in play. If you can't, this attack does nothing."
      'World Ender': {
        program: [{ op: 'if', cond: { stadium: true }, then: [{ op: 'custom', fn: 'std.discardStadium' }, { op: 'damage', amount: 230 }] }],
      },
    },
  },
  {
    id: 'sv08-142',
    name: 'Tatsugiri ex',
    attacks: {
      // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2040/): Damage ignores effects on the Defending Pokémon.
      // -- the damage skips every damage reduction and prevention effect on the Defending Pokémon (Kecleon's Expert Hider itself is not scripted yet).
      'Surprise Pump': { ignore: { defenderEffects: true } },
      // "Look at the top 10 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2045/): Put onto Bench only if space is available.
      // -- Stage 1 and Stage 2 cards go onto the Bench as the cards they are (c01.benchCards), as many as there is room for. Ruling 2044 / 2046: such a Pokémon is not an
      // "Evolved Pokémon" but is still an "Evolution Pokémon", which the `evolution` stage filter matches.
      'Cinnabar Lure': {
        program: [
          { op: 'custom', fn: 'c26.lookTopChoose', args: { n: 10, filter: { cat: 'pokemon' }, as: 'found' } },
          { op: 'custom', fn: 'c01.benchCards', args: { cards: 'found' } },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv08-144',
    name: 'Snorlax',
    attacks: {
      // "Draw a card."
      'Spike Draw': { post: [{ op: 'draw', n: 1 }] },
    },
  },
  {
    id: 'sv08-145',
    name: 'Slakoth',
    attacks: {
      // "Heal 60 damage from this Pokémon. During your next turn, this Pokémon can't retreat."
      'Take It Easy': {
        post: [
          { op: 'heal', amount: 60, to: 'self' },
          { op: 'effect', static: { k: 'cantRetreat' }, on: 'self', duration: 'myNextTurn' },
        ],
      },
    },
  },
  {
    id: 'sv08-147',
    name: 'Slaking ex',
    abilities: [
      {
        // "If your opponent has no Pokémon ex or Pokémon V in play, this Pokémon can't attack."
        name: 'Born to Slack',
        statics: [
          {
            effect: { k: 'cantAttack' },
            scope: 'self',
            when: { eq: [{ pokemon: { zone: 'oppPokemon', filter: { ex: true } } }, 0] },
          },
        ],
      },
    ],
    attacks: {
      // "Discard an Energy from this Pokémon."
      'Great Swing': { post: [{ op: 'discardEnergy', from: 'self', count: 1 }] },
    },
    notes: 'Pokémon V cards have rotated out of Standard and the filter vocabulary has no V test; only the ex half of the condition is expressible.',
  },
  {
    id: 'sv08-149',
    name: 'Zangoose',
    attacks: {
      // "Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 50 more damage. If all of them are heads, this attack does 80 more damage."
      'Fury Cutter': {
        pre: [{ op: 'flip', n: 3, as: 'h' }],
        damage: {
          add: [
            10,
            {
              cond: headsIs(1),
              then: 20,
              else: { cond: headsIs(2), then: 50, else: { cond: headsIs(3), then: 80, else: 0 } },
            },
          ],
        },
      },
    },
  },
  {
    id: 'sv08-155',
    name: 'Heliolisk',
    attacks: {
      // "Search your deck for up to 4 Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/541/): Special Energy cards count as Energy cards for the search.
      'Parabolic Charge': { program: searchToHand({ cat: 'energy' }, 4) },
    },
  },
];
