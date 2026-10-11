/**
 * Standard batch c08: Mega Evolution - Perfect Order (me03) Luxray .. Energy Swatter. Written from the printed text in
 * frames.ts; quotes below are that text. Tests: src/__tests__/cards-std-c08.test.ts. Bespoke effects: std-c08-customs.ts.
 *
 * Not scripted (the DSL lacks the capability, and this batch may not add one):
 *  - me03-027 Luxio            Fighting Roar: "this Pokémon can evolve during your first turn or the turn you play it" -- the evolve
 *                              rule (not on your own first turn, not a Pokémon put into play this turn) is hard-coded in flow.ts;
 *                              no static changes evolution timing.
 *  - me03-040 Hippowdon        Twister Spewing: "If you played Tarragon from your hand during this turn" needs a record of which
 *                              named Supporter was played this turn (the engine keeps only that one was played).
 *  - me03-050 Gengar           Infinite Shadow: "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon,
 *                              put it into your hand instead of the discard pile" needs the `knockedOutByAttack` trigger (declared in
 *                              dsl.ts, never fired by the engine) and a replacement of the discard destination, with the evolution
 *                              stack going to hand too (Compendium #2308). Mind Jack alone would be scriptable, but the card is skipped whole.
 *  - me03-069 Antique Sail Fossil  Protective Sail: "Whenever your opponent plays a Supporter card from their hand, prevent all effects of
 *                              that card done to this Pokémon" needs prevention of the effects of a Supporter card
 *                              (`preventEffects` only covers attacks and Abilities).
 *  - me03-070 Core Memory      "The Mega Zygarde ex this card is attached to can use the attack on this card": the engine only offers the
 *                              attacks printed on a Pokémon's own top card; no Tool can grant an attack.
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import './std-c08-customs.js'; // c08.flipEach, c08.koLowHp, c08.pickByResistance
import './std-seed1-customs.js'; // std.revealHand, std.discardRandomFromHand, std.discardOppActiveTools
import './std-seed2-customs.js'; // seed2.sumAttached
import './std-c06-customs.js'; // c06.attachSplit
import './fighting-customs.js'; // sumCounters
import { searchToHand } from './helpers.js';

/** "Flip a coin. If heads, ..." */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

/** "...this attack does N more damage": the bonus when `cond` holds, else nothing. */
function moreIf(cond: Cond, n: number) {
  return { cond, then: n, else: 0 } as const;
}

export const STD_C08: CardScript[] = [
  {
    id: 'me03-028',
    name: 'Luxray',
    attacks: {
      // "This attack does 70 damage for each Prize card you have taken."
      'Incessant Onslaught': { damage: { mul: [70, { prizesTaken: 'self' }] } },
      // "Discard 2 Energy from this Pokémon."
      'Strong Volt': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'me03-029',
    name: 'Dedenne',
    attacks: {
      // "Choose Basic {L} Energy cards from your discard pile up to the amount of Energy attached to all of your opponent's Pokémon and attach them to your {L} Pokémon in any way you like."
      'Tail Generator': {
        program: [
          { op: 'custom', fn: 'seed2.sumAttached', args: { kind: 'energy', zone: 'oppPokemon', as: 'n' } },
          { op: 'chooseCards', from: 'discard', filter: { energyType: 'Lightning' }, min: 0, max: { v: 'n' }, as: 'e', prompt: 'Choose Basic {L} Energy cards to attach' },
          { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myPokemon', filter: { type: 'Lightning' } } },
        ],
      },
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      'Thunder Shock': { post: onHeads({ op: 'condition', cond: 'paralyzed', to: 'oppActive' }) },
    },
  },
  {
    id: 'me03-031',
    name: 'Mega Clefable ex',
    abilities: [
      {
        // "Prevent all effects of your opponent's Pokémon's Abilities done to this Pokémon."
        // Rulings (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2309/): "Luminous Wing takes precedence over Initialization. It doesn't matter which one comes into play first."
        // (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2369/): "No, the protective effect of Safeguard is on Mimikyu, not Mega Clefable ex; so Luminous Wing does not interact with it and the damage is blocked."
        name: 'Luminous Wing',
        statics: [{ effect: { k: 'preventEffects', from: ['ability'] }, scope: 'self' }],
      },
    ],
    attacks: {
      // "You may discard up to 4 Energy cards from your hand, and this attack does 40 more damage for each card you discarded in this way."
      'Shooting Moons': {
        pre: [
          { op: 'chooseCards', from: 'hand', filter: { cat: 'energy' }, min: 0, max: 4, as: 'x', prompt: 'Discard up to 4 Energy cards from your hand (or none)' },
          { op: 'move', cards: 'x', to: 'discard' },
        ],
        damage: { add: [120, { mul: [40, { len: 'x' }] }] },
      },
    },
  },
  {
    id: 'me03-032',
    name: 'Mawile',
    attacks: {
      // "Discard up to 2 Energy cards from your hand, and this attack does 60 damage for each card you discarded in this way."
      // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2313/): "Yes you can, and then it would do zero damage. But it would still count as doing an attack."
      'Double Eater': {
        pre: [
          { op: 'chooseCards', from: 'hand', filter: { cat: 'energy' }, min: 0, max: 2, as: 'x', prompt: 'Discard up to 2 Energy cards from your hand (or none)' },
          { op: 'move', cards: 'x', to: 'discard' },
        ],
        damage: { mul: [60, { len: 'x' }] },
      },
    },
  },
  {
    id: 'me03-036',
    name: 'Aromatisse',
    abilities: [
      {
        // "Once during your turn, you may use this Ability. Search your deck for up to 2 Basic {P} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
        // "up to 2" on an Ability is 1 to 2 (TPCi 2026-02-19), and an Ability that would find nothing can't be used.
        name: 'Scent Collection',
        activated: {
          program: searchToHand({ energyType: 'Psychic' }, 2, { min: 1 }),
          when: { gte: [{ count: { zone: 'deck', filter: { energyType: 'Psychic' } } }, 1] },
        },
      },
    ],
    attacks: {
      // "Heal 30 damage from this Pokémon."
      'Draining Kiss': { post: [{ op: 'heal', amount: 30, to: 'self' }] },
    },
  },
  {
    id: 'me03-039',
    name: 'Hippopotas',
    attacks: {
      // "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen."
      // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2317/): "You would flip for Sand Attack's effect first, then flip for Confusion."
      'Sand Attack': { post: [{ op: 'effect', static: { k: 'attackCoinFlip' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me03-043',
    name: 'Barbaracle',
    abilities: [
      {
        // "Once during your turn, you may use this Ability. Attach a Basic {F} Energy card from your hand to 1 of your {F} Pokémon."
        name: 'Stone Arms',
        activated: {
          when: { gte: [{ count: { zone: 'hand', filter: { energyType: 'Fighting' } } }, 1] },
          program: [
            { op: 'chooseCards', from: 'hand', filter: { energyType: 'Fighting' }, min: 1, max: 1, as: 'e', prompt: 'Attach which Basic {F} Energy card?' },
            { op: 'chooseSlots', from: 'myPokemon', filter: { type: 'Fighting' }, min: 1, max: 1, as: 't', prompt: 'Attach it to which of your {F} Pokémon?' },
            { op: 'attach', cards: 'e', to: { v: 't' } },
          ],
        },
      },
    ],
  },
  {
    id: 'me03-045',
    name: 'Tyrantrum',
    abilities: [
      {
        // "If this Pokémon has any Special Energy attached, it gets +150 HP."
        name: 'Tyrannically Gutsy',
        statics: [{ effect: { k: 'hp', delta: 150 }, scope: 'self', when: { slotIs: { ref: 'self', filter: { energy: { basicEnergy: false } } } } }],
      },
    ],
    attacks: {
      // "Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck."
      'Wreak Havoc': {
        post: [
          { op: 'flip', n: 'untilTails', as: 'h' },
          { op: 'repeat', n: { v: 'h' }, body: [{ op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp' }] },
        ],
      },
    },
  },
  {
    id: 'me03-046',
    name: 'Hawlucha',
    attacks: {
      // "If your Benched Pokémon have any damage counters on them, this attack does 60 more damage."
      'Vengeful Kick': { damage: { add: [30, moreIf({ gte: [{ pokemon: { zone: 'myBench', filter: { damaged: true } } }, 1] }, 60)] } },
    },
  },
  {
    id: 'me03-047',
    name: 'Mega Zygarde ex',
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."
      'Gaia Wave': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -30, fromOpp: true }, on: 'self', duration: 'oppNextTurn' }] },
      // "For each of your opponent's Pokémon, flip a coin. If heads, this attack does 150 damage to that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2316/): "You would flip a coin for each and every Pokemon they have in play. ... Note that Tera Pokemon can't be damaged on the Bench, but you would still flip for them."
      'Nullifying Zero': {
        program: [
          { op: 'custom', fn: 'c08.flipEach', args: { zone: 'oppPokemon', as: 'hit' } },
          { op: 'damage', amount: 150, to: { v: 'hit' } },
        ],
      },
    },
  },
  {
    id: 'me03-049',
    name: 'Haunter',
    attacks: {
      // "Place 3 damage counters on your opponent's Active Pokémon."
      Haunt: { program: [{ op: 'counters', n: 3, to: 'oppActive' }] },
    },
  },
  {
    id: 'me03-052',
    name: 'Drapion',
    attacks: {
      // "This Pokémon also does 70 damage to itself. Your opponent's Active Pokémon is now Paralyzed and Poisoned."
      'Hazardous Tail': {
        post: [
          { op: 'damage', amount: 70, to: 'self' },
          { op: 'condition', cond: 'paralyzed', to: 'oppActive' },
          { op: 'condition', cond: 'poisoned', to: 'oppActive' },
        ],
      },
    },
  },
  {
    id: 'me03-053',
    name: 'Yveltal ex',
    attacks: {
      // "Knock Out each of your opponent's Pokémon that has 50 HP or less remaining."
      'Soul Destroyer': { program: [{ op: 'custom', fn: 'c08.koLowHp', args: { max: 50 } }] },
      // "During your next turn, this Pokémon can't use Dark Strike."
      'Dark Strike': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Dark Strike' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'me03-054',
    name: 'Chien-Pao',
    attacks: {
      // "You may switch this Pokémon with 1 of your Benched Pokémon."
      Strafe: {
        post: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [{ op: 'may', prompt: 'Switch this Pokémon with 1 of your Benched Pokémon?', body: [{ op: 'switch', who: 'self' }] }],
          },
        ],
      },
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 80 more damage."
      'Rising Blade': { damage: { add: [80, moreIf({ slotIs: { ref: 'oppActive', filter: { ex: true } } }, 80)] } },
    },
  },
  {
    id: 'me03-057',
    name: 'Doublade',
    attacks: {
      // "Reveal any number of Honedge, Doublade, and Aegislash from your hand, and this attack does 60 damage for each card you revealed in this way."
      // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2320/): "No, the names of the cards revealed must be an exact match of those listed; "Aegislash ex" is not the same as "Aegislash"."
      'Weaponized Swords': {
        pre: [
          {
            op: 'chooseCards',
            from: 'hand',
            filter: { name: ['Honedge', 'Doublade', 'Aegislash'] },
            min: 0,
            max: { handSize: 'self' },
            as: 'x',
            reveal: true,
            prompt: 'Reveal any number of Honedge, Doublade, and Aegislash',
          },
        ],
        damage: { mul: [60, { len: 'x' }] },
      },
    },
  },
  {
    id: 'me03-061',
    name: 'Raticate',
    attacks: {
      // "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."
      'Scrape Off': { pre: [{ op: 'custom', fn: 'std.discardOppActiveTools' }] },
      // "This attack does 40 damage for each damage counter on all of your Benched Rattata."
      'Retaliatory Incisors': {
        pre: [{ op: 'custom', fn: 'sumCounters', args: { zone: 'myBench', filter: { name: 'Rattata' }, as: 'n' } }],
        damage: { mul: [40, { v: 'n' }] },
      },
    },
  },
  {
    id: 'me03-066',
    name: 'Fletchling',
    attacks: {
      // "Search your deck for up to 2 Pokémon with {F} Resistance, reveal them, and put them into your hand. Then, shuffle your deck."
      Chirp: {
        program: [
          { op: 'custom', fn: 'c08.pickByResistance', args: { type: 'Fighting', max: 2, as: 'found' } },
          { op: 'move', cards: 'found', to: 'hand' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'me03-067',
    name: 'Furfrou',
    attacks: {
      // "Discard random cards from your opponent's hand until they have 5 cards in their hand."
      'Hand Trim': {
        program: [
          {
            op: 'repeat',
            n: { max: [0, { sub: [{ handSize: 'opp' }, 5] }] },
            body: [{ op: 'custom', fn: 'std.discardRandomFromHand', args: { who: 'opp' } }],
          },
        ],
      },
    },
  },
  {
    id: 'me03-068',
    name: 'Antique Jaw Fossil',
    // "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.
    //  At any time during your turn, you may discard this card from play."
    fix: { playAsBasic: { hp: 60, type: 'Colorless', cantRetreat: true, noConditions: true, discardable: true } },
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 30 less damage (before applying Weakness and Resistance)."
        name: 'Intimidating Jaw',
        statics: [{ effect: { k: 'damageOut', amount: -30 }, scope: 'oppActive', when: { inActive: 'self' } }],
      },
    ],
    status: 'implemented',
    notes:
      "Played and discarded like Antique Armor Fossil (see ghost.ts). The reduction is a damageOut on the opponent's Active Pokémon, which the engine applies to everything that Pokémon's attacks damage, Benched Pokémon included (ruling 1822).",
  },
  {
    id: 'me03-073',
    name: 'Energy Swatter',
    // "Your opponent reveals their hand, and you choose an Energy card you find there and put it on the bottom of their deck."
    // Revealing a hand is an effect, so the card can be played whenever the opponent has a hand to reveal.
    playable: { gte: [{ handSize: 'opp' }, 1] },
    play: [
      { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
      { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'self', filter: { cat: 'energy' }, min: 1, max: 1, as: 'c', prompt: "Choose an Energy card in your opponent's hand" },
      { op: 'move', cards: 'c', to: 'deckBottom', who: 'opp' },
    ],
  },
];
