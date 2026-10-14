/**
 * Cards that were blocked on engine features, scripted once the features existed (see src/__tests__/engine-features-4.test.ts).
 * Written from the printed text in frames-extra/standard.ts; quotes below are that text. Tests: src/__tests__/cards-std-engine4.test.ts.
 *
 * Features used:
 *  - Bench size from a static (`benchSize`) -- Area Zero Underdepths;
 *  - no Weakness (`noWeakness`) -- Archaludon ex;
 *  - an attack cost reduced by Energy of any type (`attackCostLess`) -- Sparkling Crystal;
 *  - attacks printed on an attached Tool (`grantsAttacks`) -- Technical Machine: Fluorite, Core Memory;
 *  - attacking twice (`attackTwice`) -- Dipplin, Swirlix, Goldeen, Seaking, with Festival Grounds;
 *  - play locks (`playLock`) and Item / Supporter effect prevention (`preventTrainerEffects`) -- Chi-Yu, Copperajah, Scream Tail ex,
 *    Genesect, Bronzong, Antique Sail Fossil, Fraxure, Rhyperior;
 *  - Berries and "damaged by an attack" wherever the Pokémon is (`damageReduced`, `damagedByAttack`) -- the five Berries, Orthworm ex.
 * New: the attack gate `usable` (Scream Tail ex), `heal` on every Pokémon of a zone, and the `of` owner on the `stadium` condition.
 */
import type { AbilityScript, CardScript, Cond, Program, PType } from '../../dsl.js';
import './misc-customs.js'; // discardThisCard
import './std-c03-customs.js'; // c03.ownFirstTurn
import './std-c06-customs.js'; // c06.attachSplit
import './std-seed1-customs.js'; // std.discardStadium

/** "You can use this attack only if you go second, and only during your first turn." */
const SECOND_FIRST_TURN: Cond = { and: [{ custom: 'c03.ownFirstTurn' }, { not: { firstTurn: true } }] };

/** "Festival Lead: If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon." */
const FESTIVAL_LEAD: AbilityScript = {
  name: 'Festival Lead',
  statics: [{ effect: { k: 'attackTwice' }, scope: 'self', when: { stadium: { name: 'Festival Grounds' } } }],
};

/** "Flip a coin. If heads, ..." */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

/**
 * A Berry: "If the Pokémon this card is attached to is damaged by an attack from your opponent's <type> Pokémon, it takes 60 less
 * damage (after applying Weakness and Resistance), and discard this card."
 * The reduction is a `damageIn`; the Tool is discarded whenever it reduced the damage, even to 0 and on the Bench (`damageReduced`).
 */
function berry(id: string, name: string, type: PType): CardScript {
  return {
    id,
    name,
    statics: [{ effect: { k: 'damageIn', amount: -60, fromOpp: true, attacker: { type } }, scope: 'self' }],
    triggers: [{ on: 'damageReduced', program: [{ op: 'custom', fn: 'discardThisCard' }] }],
  };
}

export const STD_ENGINE4: CardScript[] = [
  // ---------------------------------------------------------------- Stadiums
  {
    id: 'sv07-131',
    name: 'Area Zero Underdepths',
    // "Each player who has any Tera Pokémon in play can have up to 8 Pokémon on their Bench."
    // "If a player no longer has any Tera Pokémon in play, that player discards Pokémon from their Bench until they have 5. When this card leaves
    //  play, both players discard Pokémon from their Bench until they have 5, and the player who played this card discards first."
    // The second paragraph is the engine's Bench rule (flow.ts `enforceBenchLimit`): whenever a Bench holds more Pokémon than the limit
    // allows, its player discards down to it, the Stadium's owner first.
    // Ruling (TPCi Rules Team 2026-03-12, https://compendium.pokegym.net/ruling/2305/): finish the stadium change first, discarding Pokémon as needed (even a Charizard ex), and only then check for Knock Outs.
    // Ruling (TPCi Rules Team 2025-04-03, https://compendium.pokegym.net/ruling/2132/): bench discards to 5 happen before a new Active is promoted.
    // Ruling (TPCi Rules Team 2025-04-03, https://compendium.pokegym.net/ruling/2131/): bench discards to 5 happen before a new Active is promoted.
    // Ruling (TPCi Rules Team 2024-09-26, https://compendium.pokegym.net/ruling/2039/): if the new stadium's criteria are met, no bench discards occur since stadiums replace simultaneously.
    // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2026/): with 8 Benched, two of them and the only Tera Knocked Out by an attack, resolve the Knock Outs and Prizes first, then discard down to 5 (here one), then promote.
    // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2024/): with 4 Benched and no Tera in play when Form Ranks starts, it has room for one Pokémon; benching a Tera with it does not add room during that attack.
    statics: [{ effect: { k: 'benchSize', size: 8, withPokemon: { tera: true } }, scope: 'both' }],
  },
  {
    id: 'sv06-149',
    name: 'Festival Grounds',
    // "Each Pokémon that has any Energy attached (both yours and your opponent's) recovers from all Special Conditions and can't be affected by any Special Conditions."
    // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2428/): Kieran's +30 applies to every attack on a Pokemon ex made in the turn. (each attack is its own attack: see Dipplin)
    // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2359/): each Festival Lead attack that damages the Grass-Weak Active holding Adversity Policy draws 3 (6 for both hits, deck permitting).
    // Ruling (TPCi Rules Team 2025-01-09, https://compendium.pokegym.net/ruling/2093/): Festival Lead is no longer disabled once Dipplin Knocks Out the Flutter Mane that was switching Abilities off, so with Festival Grounds in play it can attack again.
    statics: [{ effect: { k: 'conditionImmunity' }, scope: 'allPokemon', filter: { energized: true } }],
  },

  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv08-130',
    name: 'Archaludon ex',
    abilities: [
      {
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may attach up to 2 Basic {M} Energy cards from your discard pile to your {M} Pokémon in any way you like."
        name: 'Assemble Alloy',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            program: [
              { op: 'chooseCards', from: 'discard', filter: { basicEnergy: true, energyType: 'Metal' }, min: 0, max: 2, as: 'e', prompt: 'Choose up to 2 Basic {M} Energy cards' },
              { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myPokemon', filter: { type: 'Metal' } } },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "During your opponent's next turn, this Pokémon has no Weakness."
      'Metal Defender': { post: [{ op: 'effect', static: { k: 'noWeakness' }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv06-018',
    name: 'Dipplin',
    // "If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon."
    // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2428/): Kieran's +30 applies to every attack on a Pokemon ex made in the turn. (Kieran's effect lasts the turn, so it applies to both attacks)
    // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2359/): each Festival Lead attack that damages the Grass-Weak Active holding Adversity Policy draws 3 (6 for both hits, deck permitting).
    // Ruling (TPCi Rules Team 2025-01-09, https://compendium.pokegym.net/ruling/2093/): Festival Lead is no longer disabled once Dipplin Knocks Out the Flutter Mane that was switching Abilities off, so with Festival Grounds in play it can attack again. (the Ability is checked when the second attack is chosen)
    abilities: [FESTIVAL_LEAD],
    attacks: {
      // "This attack does 20 damage for each of your Benched Pokémon."
      'Do the Wave': { damage: { mul: [20, { pokemon: { zone: 'myBench' } }] } },
    },
  },
  {
    id: 'sv06-089',
    name: 'Swirlix',
    // "If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon."
    abilities: [FESTIVAL_LEAD],
    attacks: {
      // "Put 2 damage counters on 1 of your opponent's Pokémon."
      'Sneaky Placement': {
        post: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: "Put 2 damage counters on which of your opponent's Pokémon?" },
          { op: 'counters', n: 2, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'sv06-044',
    name: 'Goldeen',
    // "If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon."
    // Ruling (TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1974/): Festival Lead only works with printed attacks, not Technical Machine attacks.
    abilities: [FESTIVAL_LEAD],
    attacks: {
      // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
      Whirlpool: { post: onHeads({ op: 'discardEnergy', from: 'oppActive', count: 1 }) },
    },
  },
  {
    id: 'sv08.5-021',
    name: 'Seaking',
    // "If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon."
    abilities: [FESTIVAL_LEAD],
    attacks: {
      // "Draw 2 cards."
      'Rapid Draw': { post: [{ op: 'draw', n: 2 }] },
    },
  },
  {
    id: 'me01-031',
    name: 'Chi-Yu',
    attacks: {
      // "If your opponent has a Stadium in play, discard it. If you do, your opponent can't play any Stadium cards from their hand during their next turn."
      'Scorching Earth': {
        post: [
          {
            op: 'if',
            cond: { stadium: true, of: 'opp' },
            then: [
              { op: 'custom', fn: 'std.discardStadium' },
              { op: 'effect', static: { k: 'playLock', what: 'stadium' }, onPlayer: 'opp', duration: 'oppNextTurn' },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv06.5-042',
    name: 'Copperajah',
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, your opponent can't play any Stadium cards from their hand."
        name: 'Massive Body',
        statics: [{ effect: { k: 'playLock', what: 'stadium' }, scope: 'opp', when: { inActive: 'self' } }],
      },
    ],
    attacks: {
      // "You may do 100 more damage. If you do, during your next turn, this Pokémon can't attack."
      'Nasal Lariat': {
        pre: [
          { op: 'set', v: 'bonus', value: 0 },
          { op: 'may', prompt: "Do 100 more damage? This Pokémon can't attack during your next turn.", body: [{ op: 'set', v: 'bonus', value: 100 }] },
        ],
        damage: { add: [130, { v: 'bonus' }] },
        post: [{ op: 'if', cond: { gt: [{ v: 'bonus' }, 0] }, then: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] }],
      },
    },
  },
  {
    id: 'sv06-094',
    name: 'Scream Tail ex',
    attacks: {
      Scream: {
        // "You can use this attack only if you go second, and only during your first turn."
        usable: SECOND_FIRST_TURN,
        // "Your opponent can't play any Supporter cards from their hand during their next turn."
        post: [{ op: 'effect', static: { k: 'playLock', what: 'supporter' }, onPlayer: 'opp', duration: 'oppNextTurn' }],
      },
      // "Discard an Energy from your opponent's Active Pokémon."
      Crunch: { post: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
    },
  },
  {
    id: 'sv06.5-040',
    name: 'Genesect',
    abilities: [
      {
        // "If this Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC cards from their hand."
        name: 'ACE Nullifier',
        statics: [{ effect: { k: 'playLock', what: 'aceSpec' }, scope: 'opp', when: { slotIs: { ref: 'self', filter: { tool: true } } } }],
      },
    ],
  },
  {
    id: 'sv05-069',
    name: 'Bronzong',
    attacks: {
      // "During your opponent's next turn, they can't play any Pokémon from their hand to evolve their Pokémon."
      'Evolution Jammer': { post: [{ op: 'effect', static: { k: 'playLock', what: 'evolve' }, onPlayer: 'opp', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv06.5-045',
    name: 'Fraxure',
    abilities: [
      {
        // "Whenever your opponent plays an Item or Supporter card from their hand, prevent all effects of that card done to this Pokémon."
        name: 'Unnerve',
        statics: [{ effect: { k: 'preventTrainerEffects', from: ['item', 'supporter'] }, scope: 'self' }],
      },
    ],
    attacks: {
      // "Discard the top card of your deck."
      'Dragon Pulse': { post: [{ op: 'move', cards: { top: 1 }, to: 'discard' }] },
    },
  },
  {
    id: 'sv07-076',
    name: 'Rhyperior',
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, whenever your opponent plays a Supporter card from their hand, prevent all effects of that card done to all of your Pokémon."
        name: 'Wide Wall',
        statics: [{ effect: { k: 'preventTrainerEffects', from: ['supporter'] }, scope: 'myPokemon', when: { inActive: 'self' } }],
      },
    ],
    attacks: {
      // "Discard an Energy from your opponent's Active Pokémon."
      // Ruling (TPCi Rules Team 2020-08-13, https://compendium.pokegym.net/ruling/77/): Darkness Guard's damage reduction is applied first, then the attack's effects such as the discard. (the damage is done before the discard)
      'Drill Run': { post: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
    },
  },
  {
    id: 'sv07-110',
    name: 'Orthworm ex',
    abilities: [
      {
        // "If this Pokémon is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 2 damage counters on the Attacking Pokémon for each {M} Energy attached to this Pokémon."
        // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2012/): no counters are placed if no Metal Energy are attached when the Ability triggers.
        // The Energy is counted when the Ability resolves, after the attack's own effects (an Energy discard after the damage).
        name: 'Pummeling Payback',
        triggers: [{ on: 'damagedByAttack', program: [{ op: 'counters', n: { mul: [2, { energyOn: 'self', type: 'Metal' }] }, to: { v: '__attacker' } }] }],
      },
    ],
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      'Rock Tomb': { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },

  // ---------------------------------------------------------------- Trainers: Items
  {
    id: 'me03-069',
    name: 'Antique Sail Fossil',
    // "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.
    //  At any time during your turn, you may discard this card from play."
    fix: { playAsBasic: { hp: 60, type: 'Colorless', cantRetreat: true, noConditions: true, discardable: true } },
    abilities: [
      {
        // "Whenever your opponent plays a Supporter card from their hand, prevent all effects of that card done to this Pokémon."
        name: 'Protective Sail',
        statics: [{ effect: { k: 'preventTrainerEffects', from: ['supporter'] }, scope: 'self' }],
      },
    ],
    notes: 'Played and discarded like the other Antique fossils (see ghost.ts).',
  },

  // ---------------------------------------------------------------- Trainers: Tools
  {
    id: 'sv07-142',
    name: 'Sparkling Crystal',
    // "When the Tera Pokémon this card is attached to uses an attack, that attack costs 1 Energy less. (The Energy can be of any type.)"
    // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2031/): an attack-cost reduction like this one only changes what has to be paid, not what the attack's own effects count (the ruling is about Wellspring Mask Ogerpon ex's Torrential Pump, which shuffles 3 Energy).
    statics: [{ effect: { k: 'attackCostLess', n: 1 }, scope: 'self', filter: { tera: true } }],
  },
  {
    id: 'sv08-188',
    name: 'Technical Machine: Fluorite',
    // "The Pokémon this card is attached to can use the attack on this card. (You still need the necessary Energy to use this attack.) If this card is attached to 1 of your Pokémon, discard it at the end of your turn."
    statics: [{ effect: { k: 'grantsAttacks' }, scope: 'self' }],
    triggers: [{ on: 'endOfTurn', program: [{ op: 'custom', fn: 'discardThisCard' }] }],
    attacks: {
      // "Discard all Energy from this Pokémon, and heal all damage from each of your Tera Pokémon."
      Fluorite: {
        program: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          { op: 'heal', amount: 999, to: { each: 'myPokemon', filter: { tera: true } } },
        ],
      },
    },
  },
  {
    id: 'me03-070',
    name: 'Core Memory',
    // "The Mega Zygarde ex this card is attached to can use the attack on this card. (You still need the necessary Energy to use this attack.)"
    statics: [{ effect: { k: 'grantsAttacks' }, scope: 'self', filter: { name: 'Mega Zygarde ex' } }],
    attacks: {
      // "Discard all Energy from this Pokémon."
      Geobuster: { post: [{ op: 'discardEnergy', from: 'self', count: 'all' }] },
    },
  },
  berry('sv07-140', 'Occa Berry', 'Fire'),
  berry('sv07-141', 'Payapa Berry', 'Psychic'),
  berry('sv08-163', 'Babiri Berry', 'Metal'),
  berry('sv08-168', 'Colbur Berry', 'Darkness'),
  berry('sv08-184', 'Passho Berry', 'Water'),
];
