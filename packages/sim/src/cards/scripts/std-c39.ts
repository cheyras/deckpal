/**
 * Standard batch c39: Scarlet & Violet Black Star Promos (svp) whose printed text no script covered. Most share their text
 * with a script for another printing, but the promo frames carry no Weakness/Resistance, so their text key differs and each
 * needs its own entry. Each script is written from the printed text in frames; quotes below are that text.
 *
 * Not scripted (the vocabulary lacks the capability):
 *  - svp-173 Eevee: Boosted Evolution ("As long as this Pokémon is in the Active Spot, it can evolve during your first turn or
 *    the turn you play it") needs a static that changes evolution timing; no StaticEffect lifts the evolve restrictions.
 *  - svp-174 Eevee ex: Rainbow DNA ("can evolve into any Pokémon ex that evolves from Eevee") needs a static that changes what
 *    a Pokémon may evolve into; the engine only evolves a card whose "evolves from" names the Pokémon.
 */
import type { CardScript, Filter, Program } from '../../dsl.js';
import { damageOneOf, searchToHand } from './helpers.js';
import './std-c06-customs.js'; // c06.attachSplit
import './std-seed1-customs.js'; // std.revealHand
import './std-seed4-customs.js'; // seed4.shuffleSlotIntoDeck

const BASIC_L: Filter = { cat: 'energy', energyType: 'Lightning' };
const IONO: Filter = { nameIncludes: "Iono's" };
const HOPS: Filter = { cat: 'pokemon', nameIncludes: "Hop's" };

/** "Flip a coin. If heads, ..." */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

export const STD_C39: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'svp-155',
    name: 'Wooper',
    attacks: {
      // "Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck."
      'Scoop Water': {
        post: [
          { op: 'chooseCards', from: 'discard', filter: { energyType: 'Water' }, min: 0, max: 3, as: 'e', prompt: 'Choose up to 3 Basic {W} Energy cards' },
          { op: 'move', cards: 'e', to: 'deck' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'svp-156',
    name: 'Quagsire',
    attacks: {
      // "Discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way."
      'Drenched Headbutt': {
        pre: [
          { op: 'look', n: 3, filter: { cat: 'energy' }, as: 'en' },
          { op: 'move', cards: { top: 3 }, to: 'discard' },
        ],
        damage: { mul: [80, { len: 'en' }] },
      },
    },
  },
  {
    id: 'svp-157',
    name: 'Zapdos',
    attacks: {
      // "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon."
      'Follow-Up Bolt': { damage: { add: [20, { mul: [10, { countersOn: 'defender' }] }] } },
    },
  },
  {
    id: 'svp-158',
    name: 'Pachirisu',
    attacks: {
      // "Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."
      'Crackling Charge': {
        post: [
          { op: 'flip', n: 3, as: 'h' },
          {
            op: 'if',
            cond: { and: [{ gte: [{ v: 'h' }, 1] }, { gte: [{ pokemon: { zone: 'myBench' } }, 1] }] },
            then: [
              { op: 'chooseCards', from: 'discard', filter: BASIC_L, min: 0, max: { v: 'h' }, as: 'e', prompt: 'Choose Basic {L} Energy cards (up to the number of heads)' },
              { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myBench' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'svp-162',
    name: 'Houndstone ex',
    attacks: {
      // "Flip a coin until you get tails. This attack does 20 more damage for each heads."
      'Horrifying Fang': {
        pre: [{ op: 'flip', n: 'untilTails', as: 'h' }],
        damage: { add: [100, { mul: [20, { v: 'h' }] }] },
      },
    },
  },
  {
    id: 'svp-166',
    name: 'Teal Mask Ogerpon ex',
    abilities: [
      {
        // "Once during your turn, you may attach a Basic {G} Energy card from your hand to this Pokémon. If you attached Energy to a Pokémon in this way, draw a card."
        name: 'Teal Dance',
        activated: {
          when: { gte: [{ count: { zone: 'hand', filter: { energyType: 'Grass' } } }, 1] },
          program: [
            { op: 'chooseCards', from: 'hand', filter: { energyType: 'Grass' }, min: 1, max: 1, as: 'e', prompt: 'Attach a Basic {G} Energy card' },
            { op: 'attach', cards: 'e', to: 'self' },
            { op: 'draw', n: 1 },
          ],
        },
      },
    ],
    attacks: {
      // "This attack does 30 more damage for each Energy attached to both Active Pokémon."
      'Myriad Leaf Shower': { damage: { add: [30, { mul: [30, { add: [{ energyOn: 'self' }, { energyOn: 'defender' }] }] }] } },
    },
  },
  {
    id: 'svp-170',
    name: 'Leafeon',
    attacks: {
      // "Attach a Basic {G} Energy card from your hand to 1 of your Benched Pokémon. If you do, heal all damage from that Pokémon."
      'Leaflet Blessings': {
        program: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [
              { op: 'chooseCards', from: 'hand', filter: { energyType: 'Grass' }, min: 1, max: 1, as: 'e', prompt: 'Choose a Basic {G} Energy card to attach' },
              {
                op: 'if',
                cond: { gte: [{ len: 'e' }, 1] },
                then: [
                  { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Attach it to which Benched Pokémon?' },
                  { op: 'attach', cards: 'e', to: { v: 't' } },
                  { op: 'heal', amount: { mul: [10, { countersOn: { v: 't' } }] }, to: { v: 't' } },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'svp-171',
    name: 'Glaceon',
    attacks: {
      // "At the end of your opponent's next turn, put 9 damage counters on the Defending Pokémon."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2404/): "Since the Defending Pokemon that Jynx attacked was moved to the Bench, the attack effect which Intense Kiss placed on that Pokemon was removed. Neither the old Active nor the new Active are discarded." (same rule for any such delayed attack effect)
      'Permeating Chill': {
        post: [{ op: 'delay', duration: 'oppNextTurn', program: [{ op: 'counters', n: 9, to: 'defender' }] }],
      },
    },
  },
  {
    id: 'svp-172',
    name: 'Sylveon',
    attacks: {
      // "Flip a coin. If heads, choose 1 of your opponent's Benched Pokémon. Shuffle that Pokémon and all attached cards into their deck."
      'Mystical Return': {
        program: onHeads(
          { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Benched Pokémon" },
          { op: 'custom', fn: 'seed4.shuffleSlotIntoDeck', args: { slot: 't' } },
        ),
      },
      // "Your opponent's Active Pokémon is now Confused."
      'Disarming Voice': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'svp-177',
    name: 'Bloodmoon Ursaluna ex',
    abilities: [
      {
        // "Blood Moon used by this Pokémon costs {C} less for each Prize card your opponent has taken."
        name: 'Seasoned Skill',
        statics: [{ effect: { k: 'attackCostC', attack: 'Blood Moon', delta: { mul: [-1, { prizesTaken: 'opp' }] } }, scope: 'self' }],
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't attack."
      'Blood Moon': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'svp-178',
    name: 'Kyogre ex',
    attacks: {
      // "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
      'Winding Waves': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] },
            then: [{ op: 'may', body: [{ op: 'switch', who: 'opp', chooser: 'opp' }] }],
          },
        ],
      },
      // "Discard 2 Energy from this Pokémon."
      'Tidal Surge': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'svp-179',
    name: 'Xerneas ex',
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 100 more damage."
      'Rising Horns': { damage: { add: [120, { cond: { slotIs: { ref: 'defender', filter: { ex: true } } }, then: 100, else: 0 }] } },
    },
  },
  {
    id: 'svp-180',
    name: 'Dialga ex',
    attacks: {
      // "Draw a card."
      'Time Bellow': { post: [{ op: 'draw', n: 1 }] },
      // "This attack does 20 more damage for each {M} Energy attached to this Pokémon."
      'Metal Blast': { damage: { add: [100, { mul: [20, { energyOn: 'self', type: 'Metal' }] }] } },
    },
  },
  {
    id: 'svp-182',
    name: "Iono's Kilowattrel",
    abilities: [
      {
        // "You must discard a Basic {L} Energy from this Pokémon in order to use this Ability. Once during your turn, you may draw cards until you have 6 cards in your hand."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2108/): "No.  The effect of Flashing Draw is to draw cards, so if you have no cards in your deck or if you already have 6 or more cards in hand you can't use it."
        // -- so it needs a Basic {L} Energy to pay, a card in the deck, and fewer than 6 cards in hand.
        name: 'Flashing Draw',
        activated: {
          when: {
            and: [
              { slotIs: { ref: 'self', filter: { energy: { energyType: 'Lightning' } } } },
              { lt: [{ handSize: 'self' }, 6] },
              { gte: [{ deckSize: 'self' }, 1] },
            ],
          },
          program: [
            { op: 'discardEnergy', from: 'self', count: 1, filter: { energyType: 'Lightning' } },
            { op: 'draw', n: { sub: [6, { handSize: 'self' }] } },
          ],
        },
      },
    ],
  },
  {
    id: 'svp-183',
    name: "Lillie's Ribombee",
    abilities: [
      {
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may have your opponent
        //  reveal their hand and you put any number of Basic Pokémon you find there onto their Bench."
        // Ruling (TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2109/): "No. It's public knowledge that you can't put down any additional Basic Pokemon on your opponent's Bench, so you cannot use the Ability."
        // -- not offered while the opponent's Bench is full.
        // Ruling (TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2111/): "No, you can choose to put zero Pokemon onto the opponent's Bench."
        // -- the choice is 0 to as many as fit on their Bench.
        name: 'Inviting Wink',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            when: { not: { benchFull: 'opp' } },
            program: [
              { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
              {
                op: 'chooseCards',
                from: 'hand',
                who: 'opp',
                chooser: 'self',
                filter: { cat: 'pokemon', stage: 'basic' },
                min: 0,
                max: { sub: [5, { pokemon: { zone: 'oppBench' } }] },
                as: 'x',
                reveal: true,
                prompt: "Choose any number of Basic Pokémon in your opponent's hand",
              },
              { op: 'move', cards: 'x', to: 'bench', who: 'opp' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'svp-184',
    name: "Hop's Snorlax",
    abilities: [
      {
        // "Attacks used by your Hop's Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). The effect of Extra Helpings doesn't stack."
        name: 'Extra Helpings',
        statics: [{ effect: { k: 'damageOut', amount: 30, noStack: 'Extra Helpings' }, scope: 'myPokemon', filter: HOPS }],
      },
    ],
    attacks: {
      // "This Pokémon also does 80 damage to itself."
      'Dynamic Press': { post: [{ op: 'damage', amount: 80, to: 'self' }] },
    },
  },
  {
    id: 'svp-185',
    name: 'Yanma',
    attacks: {
      // "Your opponent reveals their hand."
      'Silent Wing': { post: [{ op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } }] },
    },
  },
  {
    id: 'svp-188',
    name: 'Scrafty',
    attacks: {
      // "Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck."
      "Nab 'n' Dash": { post: searchToHand({}, { pokemon: { zone: 'myBench' } }, { reveal: false }) },
    },
  },
  {
    id: 'svp-193',
    name: "Hop's Zacian ex",
    attacks: {
      // "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Insta-Strike': { post: damageOneOf('oppBench', 30) },
      // "During your next turn, this Pokémon can't use Brave Slash."
      'Brave Slash': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Brave Slash' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'svp-194',
    name: "Iono's Bellibolt ex",
    abilities: [
      {
        // "As often as you like during your turn, you may attach a Basic {L} Energy card from your hand to 1 of your Iono's Pokémon."
        name: 'Electric Streamer',
        activated: {
          oncePerTurn: false,
          when: {
            and: [
              { gte: [{ count: { zone: 'hand', filter: BASIC_L } }, 1] },
              { gte: [{ pokemon: { zone: 'myPokemon', filter: IONO } }, 1] },
            ],
          },
          program: [
            { op: 'chooseCards', from: 'hand', filter: BASIC_L, min: 1, max: 1, as: 'e', prompt: 'Choose a Basic {L} Energy' },
            { op: 'chooseSlots', from: 'myPokemon', filter: IONO, min: 1, max: 1, as: 't', prompt: "Attach it to which of your Iono's Pokémon?" },
            { op: 'attach', cards: 'e', to: { v: 't' } },
          ],
        },
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't attack."
      'Thunderous Bolt': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'svp-195',
    name: "Lillie's Clefairy ex",
    abilities: [
      {
        // "The Weakness of each of your opponent's {N} Pokémon in play is now {P}. (Apply Weakness as ×2.)"
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2107/): "Yes it will!" -- a {N} Pokémon with no Weakness gets {P} ×2 too.
        name: 'Fairy Zone',
        statics: [{ effect: { k: 'weaknessType', type: 'Psychic' }, scope: 'oppPokemon', filter: { type: 'Dragon' } }],
      },
    ],
    attacks: {
      // "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's)."
      'Full Moon Rondo': {
        damage: { add: [20, { mul: [20, { add: [{ pokemon: { zone: 'myBench' } }, { pokemon: { zone: 'oppBench' } }] }] }] },
      },
    },
  },
  {
    id: 'svp-197',
    name: 'Koraidon ex',
    attacks: {
      // "If your Benched Pokémon have any damage counters on them, this attack does 120 more damage."
      'Revenge Buster': {
        damage: { add: [100, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { damaged: true } } }, 1] }, then: 120, else: 0 }] },
      },
    },
  },
  {
    id: 'svp-198',
    name: 'Zacian ex',
    attacks: {
      // "Search your deck for a Basic {M} Energy card and attach it to this Pokémon. Then, shuffle your deck."
      'Steel Armament': {
        post: [
          { op: 'chooseCards', from: 'deck', filter: { energyType: 'Metal' }, min: 0, max: 1, as: 'e', prompt: 'Choose a Basic {M} Energy card' },
          { op: 'if', cond: { gte: [{ len: 'e' }, 1] }, then: [{ op: 'attach', cards: 'e', to: 'self' }] },
          { op: 'shuffle' },
        ],
      },
      // "During your next turn, this Pokémon can't use Slashing Strike."
      'Slashing Strike': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Slashing Strike' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
];
