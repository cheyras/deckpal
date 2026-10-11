/**
 * Cards that were blocked on engine features, scripted once the features existed (see src/__tests__/engine-features-3.test.ts).
 * Written from the printed text in frames-extra/standard.ts; quotes below are that text. Tests: src/__tests__/cards-std-engine3.test.ts.
 *
 * Features used: Ancient / Future tags (Filter `tag`, per printing: src/cards/tags.ts) -- Iron Thorns, Scream Tail, Iron Crown ex,
 * Iron Valiant, Great Tusk, Roaring Moon, Koraidon, Awakening Drum, Miraidon, Iron Moth, Slither Wing, Iron Thorns ex;
 * Special Condition immunity (`conditionImmunity`) -- Bubbly Water Energy, Slowpoke; Special Condition counter amounts
 * (`condition` with `counters`) -- Mega Dragalge ex, Crobat, Lanturn; reacting timed effects (`react`) -- Mega Slowbro ex,
 * Iron Boulder ex, Hypno, Pachirisu; a many-coin attack flip (`attackCoinFlip` with `coins`) -- Octillery.
 * New steps used: `look` (Iron Thorns, Iron Valiant) and `endTurn` (Hypno).
 */
import type { CardScript, Filter } from '../../dsl.js';
import './metal-customs.js'; // metal.moveEnergy
import './std-c06-customs.js'; // c06.attachSplit
import './std-engine3-customs.js'; // engine3.discardOppToolsAndSpecial

const ANCIENT_SUPPORTER: Filter = { ttype: 'supporter', tag: 'Ancient' };
const FUTURE_SUPPORTER: Filter = { ttype: 'supporter', tag: 'Future' };
/** A card (any zone) or a Pokémon in play with the tag. */
const ANCIENT: Filter = { tag: 'Ancient' };
const FUTURE: Filter = { tag: 'Future' };

export const STD_ENGINE3: CardScript[] = [
  // ---------------------------------------------------------------- Ancient and Future cards
  {
    id: 'sv05-062',
    name: 'Iron Thorns',
    attacks: {
      // "Reveal the top 5 cards of your deck. This attack does 70 damage for each Future card you find there. Then, discard those Future cards and shuffle the other cards back into your deck."
      'Destructo-Press': {
        pre: [{ op: 'look', n: 5, filter: FUTURE, as: 'f', reveal: true }],
        damage: { mul: [70, { len: 'f' }] },
        post: [{ op: 'move', cards: 'f', to: 'discard' }, { op: 'shuffle' }],
      },
    },
  },
  {
    id: 'sv05-077',
    name: 'Scream Tail',
    attacks: {
      // "Heal 100 damage from 1 of your Benched Ancient Pokémon."
      'Supportive Singing': {
        post: [
          { op: 'chooseSlots', from: 'myBench', filter: ANCIENT, min: 1, max: 1, as: 't', prompt: 'Heal 100 damage from which Benched Ancient Pokémon?' },
          { op: 'heal', amount: 100, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'sv05-081',
    name: 'Iron Crown ex',
    abilities: [
      {
        // "Attacks used by your Future Pokémon, except any Iron Crown ex, do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
        name: 'Cobalt Command',
        statics: [{ effect: { k: 'damageOut', amount: 20 }, scope: 'myPokemon', filter: { tag: 'Future', not: { name: 'Iron Crown ex' } } }],
      },
    ],
    attacks: {
      // "This attack does 50 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon."
      // Open question (status needs_ruling): no ruling was found on whether "any effects on those Pokémon" also skips a Benched Tera
      // Pokémon's own "prevent all damage done to this Pokémon by attacks" -- read literally, that is an effect on it, so it is skipped.
      'Twin Shotels': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 2, max: 2, as: 't', prompt: "Choose 2 of your opponent's Pokémon" },
          { op: 'damage', amount: 50, to: { v: 't' }, ignore: { weakness: true, resistance: true, defenderEffects: true } },
        ],
      },
    },
    status: 'needs_ruling',
    notes: "Twin Shotels vs a Benched Tera Pokémon (its 'prevent all damage by attacks while Benched'): implemented as skipped (literal reading); no ruling found.",
  },
  {
    id: 'sv05-080',
    name: 'Iron Valiant',
    attacks: {
      // "Look at the top 4 cards of your deck and put them back in any order."
      Calculation: { post: [{ op: 'look', n: 4, as: 'x' }, { op: 'putOnTop', cards: 'x' }] },
      // "If you played a Future Supporter card from your hand during this turn, this attack does 100 more damage."
      'Majestic Sword': { damage: { add: [100, { cond: { playedThisTurn: { filter: FUTURE_SUPPORTER } }, then: 100, else: 0 }] } },
    },
  },
  {
    id: 'sv05-097',
    name: 'Great Tusk',
    attacks: {
      // "Discard the top card of your opponent's deck. If you played an Ancient Supporter card from your hand during this turn, discard 3 more cards in this way."
      'Land Collapse': {
        post: [
          { op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp' },
          { op: 'if', cond: { playedThisTurn: { filter: ANCIENT_SUPPORTER } }, then: [{ op: 'move', cards: { top: 3, who: 'opp' }, to: 'discard', who: 'opp' }] },
        ],
      },
    },
  },
  {
    id: 'sv05-109',
    name: 'Roaring Moon',
    attacks: {
      // "This attack does 10 more damage for each Ancient card in your discard pile."
      'Vengeance Fletching': { damage: { add: [70, { mul: [10, { count: { zone: 'discard', filter: { tag: 'Ancient' } } }] }] } },
    },
  },
  {
    id: 'sv05-119',
    name: 'Koraidon',
    attacks: {
      // "This attack does 30 damage for each of your Ancient Pokémon in play."
      'Primordial Beatdown': { damage: { mul: [30, { pokemon: { zone: 'myPokemon', filter: ANCIENT } }] } },
      // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
      Shred: { ignore: { defenderEffects: true } },
    },
  },
  {
    id: 'sv05-141',
    name: 'Awakening Drum',
    // "Draw a card for each of your Ancient Pokémon in play."
    // With no Ancient Pokémon in play it would do nothing, so it can't be played (TPCi 2014-11-13).
    playable: { gte: [{ pokemon: { zone: 'myPokemon', filter: ANCIENT } }, 1] },
    play: [{ op: 'draw', n: { pokemon: { zone: 'myPokemon', filter: ANCIENT } } }],
  },
  {
    id: 'sv05-121',
    name: 'Miraidon',
    attacks: {
      // "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck."
      // (Each card is attached to a Future Pokémon of its own choosing, the same shape as Dedenne, Tail Generator.)
      'Peak Acceleration': {
        post: [
          { op: 'chooseCards', from: 'deck', filter: { basicEnergy: true }, min: 0, max: 2, as: 'e', prompt: 'Choose up to 2 Basic Energy cards' },
          { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myPokemon', filter: FUTURE } },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv06.5-009',
    name: 'Iron Moth',
    attacks: {
      // "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon."
      // The damage done is the change in the Defending Pokémon's damage counters (after Weakness, Resistance and every modifier).
      Suction: {
        pre: [{ op: 'set', v: 'before', value: { countersOn: 'defender' } }],
        post: [{ op: 'heal', amount: { mul: [10, { max: [0, { sub: [{ countersOn: 'defender' }, { v: 'before' }] }] }] }, to: 'self' }],
      },
      // "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon."
      'Anachronism Repulsor': {
        post: [{ op: 'effect', static: { k: 'preventDamage', attacker: ANCIENT }, on: 'self', duration: 'oppNextTurn' }],
      },
    },
  },
  {
    id: 'sv06.5-026',
    name: 'Slither Wing',
    attacks: {
      // "If your opponent has any Future Pokémon in play, this attack does 120 more damage."
      'Iron Smasher': { damage: { add: [20, { cond: { gte: [{ pokemon: { zone: 'oppPokemon', filter: FUTURE } }, 1] }, then: 120, else: 0 }] } },
      // "Discard 2 Energy from this Pokémon."
      'Smashing Wing': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'sv06-077',
    name: 'Iron Thorns ex',
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, Pokémon with a Rule Box in play (both yours and your opponent's) have no Abilities, except for Future Pokémon."
        // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2309/): Luminous Wing supersedes Initialization regardless of play order.
        // (A Pokémon with an Ability that prevents the effects of Abilities done to it keeps its Abilities: see `lockBites` in query.ts.)
        name: 'Initialization',
        statics: [{ effect: { k: 'noAbilities' }, scope: 'allPokemon', filter: { ruleBox: true, not: FUTURE }, when: { inActive: 'self' } }],
      },
    ],
    attacks: {
      // "Move an Energy from this Pokémon to 1 of your Benched Pokémon."
      // The attacker is the Active Pokémon, so "another of your Pokémon" (metal.moveEnergy) is a Benched one.
      'Volt Cyclone': {
        post: [
          { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'src' },
          { op: 'if', cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] }, then: [{ op: 'custom', fn: 'metal.moveEnergy', args: { from: 'src' } }] },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Special Condition immunity
  {
    id: 'me04-084',
    name: 'Bubbly Water Energy',
    // "As long as this card is attached to a Pokémon, it provides {W} Energy.
    //  The {W} Pokémon this card is attached to recovers from all Special Conditions and can't be affected by any Special Conditions."
    // Ruling (TPCi Rules Team 2013-08-15, https://compendium.pokegym.net/ruling/290/), on a Pokémon that "can't be affected by special conditions": playing it is allowed but the effect gets blocked.
    provides: ['Water'],
    statics: [{ effect: { k: 'conditionImmunity' }, scope: 'self', filter: { type: 'Water' } }],
  },
  {
    id: 'mep-086',
    name: 'Slowpoke',
    abilities: [
      {
        // "This Pokémon can't be Confused."
        name: 'Dopey Face',
        statics: [{ effect: { k: 'conditionImmunity', conditions: ['confused'] }, scope: 'self' }],
      },
    ],
  },

  // ---------------------------------------------------------------- Special Condition counter amounts
  {
    id: 'me04-065',
    name: 'Mega Dragalge ex',
    attacks: {
      // "Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon."
      'Corrosive Liquid': { program: [{ op: 'custom', fn: 'engine3.discardOppToolsAndSpecial' }] },
      // "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, place 16 damage counters on that Pokémon instead of 1."
      // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2373/): each Pokémon Checkup places 16 counters if this Pokémon survives with Poison.
      // Ruling (TPCi Rules Team 2013-02-21, https://compendium.pokegym.net/ruling/1044/), on a later single-counter Poison: single-counter Poison supersedes the multi-counter version.
      'Pernicious Poison': { post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive', counters: 16 }] },
    },
  },
  {
    id: 'sv06.5-029',
    name: 'Crobat',
    abilities: [
      {
        // "Once during your turn, if you played Janine's Secret Art from your hand this turn, you may draw cards until you have 8 cards in your hand."
        name: 'Shadowy Envoy',
        activated: {
          when: { playedThisTurn: { filter: { name: "Janine's Secret Art" } } },
          program: [{ op: 'draw', n: { max: [0, { sub: [8, { handSize: 'self' }] }] } }],
        },
      },
    ],
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 2 damage counters on that Pokémon instead of 1."
      'Poison Fang': { post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive', counters: 2 }] },
    },
  },
  {
    id: 'sv07-049',
    name: 'Lanturn',
    attacks: {
      // "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition."
      'Disorienting Flash': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive', counters: 8 }] },
      // "During your next turn, this Pokémon can't attack."
      'Thunderous Bolt': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },

  // ---------------------------------------------------------------- Timed effects that react to events on the affected Pokémon
  {
    id: 'me05-031',
    name: 'Mega Slowbro ex',
    attacks: {
      // "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), place 12 damage counters on the Attacking Pokémon."
      // Ruling (Pitch Black FAQ, TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2408/): Mist Energy blocks the delayed counter effect since this is still an attack.
      'Shellnado Spin': {
        post: [
          {
            op: 'effect',
            static: { k: 'react', event: 'damagedByAttack', program: [{ op: 'counters', n: 12, to: { v: '__attacker' } }] },
            on: 'self',
            duration: 'oppNextTurn',
          },
        ],
      },
    },
  },
  {
    id: 'sv05-099',
    name: 'Iron Boulder ex',
    attacks: {
      // "During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put 8 damage counters on the Attacking Pokémon."
      // Ruling (Temporal Forces FAQ, TPCi Rules Team 2024-03-21, https://compendium.pokegym.net/ruling/1958/): the attacking Pokémon holding Mist Energy gets none of the 8 counters, since Repulsor Axe's counters are an attack effect that Mist Energy blocks.
      'Repulsor Axe': {
        post: [
          {
            op: 'effect',
            static: { k: 'react', event: 'damagedByAttack', program: [{ op: 'counters', n: 8, to: { v: '__attacker' } }] },
            on: 'self',
            duration: 'oppNextTurn',
          },
        ],
      },
      // "Discard 2 Energy from this Pokémon."
      'Power Stomp': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'sv06.5-017',
    name: 'Hypno',
    attacks: {
      // "During your opponent's next turn, if they attach an Energy card from their hand to the Defending Pokémon, their turn ends."
      Daydream: {
        post: [{ op: 'effect', static: { k: 'react', event: 'attachFromHand', program: [{ op: 'endTurn' }] }, on: 'defender', duration: 'oppNextTurn' }],
      },
    },
  },
  {
    id: 'me01-051',
    name: 'Pachirisu',
    attacks: {
      // "During your opponent's next turn, whenever they attach an Energy card from their hand to the Defending Pokémon, place 8 damage counters on that Pokémon."
      // Ruling (Mega Evolution FAQ, TPCi Rules Team 2025-09-25, https://compendium.pokegym.net/ruling/2223/): the effect targets the defender, not the opponent, so retreating removes it.
      'Electrified Incisors': {
        post: [
          {
            op: 'effect',
            static: { k: 'react', event: 'attachFromHand', program: [{ op: 'counters', n: 8, to: { v: '__target' } }] },
            on: 'defender',
            duration: 'oppNextTurn',
          },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Many-coin attack flip
  {
    id: 'me04-017',
    name: 'Octillery',
    attacks: {
      // "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips 2 coins. If either of them is tails, that attack doesn't happen."
      // Ruling (TPCi Rules Team 2026-04-02, https://compendium.pokegym.net/ruling/2326/), on Smokescreen: resolve this blocking flip before any Confusion flip.
      'Jet of Ink': { post: [{ op: 'effect', static: { k: 'attackCoinFlip', coins: 2 }, on: 'defender', duration: 'oppNextTurn' }] },
      // "This Pokémon is now Confused."
      Tantrum: { post: [{ op: 'condition', cond: 'confused', to: 'self' }] },
    },
  },
];
