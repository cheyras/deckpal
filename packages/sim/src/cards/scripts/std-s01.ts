/**
 * Cards that earlier batches skipped for lack of an engine capability, scripted now that it exists (sweep batch s01).
 * Written from the printed text in frames-extra/standard.ts; quotes below are that text.
 * Tests: src/__tests__/cards-std-s01.test.ts.
 *
 * Not scripted (the vocabulary or the engine can't say it yet):
 *  - me01-101 Latios            Lustrous Assist: "when your Mega Latias ex moves from your Bench to the Active Spot, you may use this
 *                               Ability" (a trigger on ANOTHER Pokémon of yours moving Bench -> Active; `movedToBench` is only the
 *                               Pokémon's own move, and nothing fires when a different Pokémon becomes Active).
 *  - me01-113 Acerola's Mischief "prevent all damage from AND effects of attacks done to that Pokémon by your opponent's Pokémon ex"
 *                               (the effects half: `preventEffects` can't be limited to attackers matching a filter, and an
 *                               attacker-filtered `preventDamage` is honoured for damage only).
 *  - sv05-118 Iron Treads       Dual Core: "As long as this Pokémon has a Future Booster Energy Capsule attached, it is {F} and {M} type"
 *                               (the `types` static takes no `when`, so it can't depend on an attached Tool).
 *  - sv06-060 Palafin           Zero to Hero swaps in Palafin ex, whose Hero's Spirit is below; scripting one without the other would
 *                               leave the swapped-in card half scripted.
 *  - sv06-061 Palafin ex        Hero's Spirit: "Put this Pokémon into play only with the effect of Palafin's Zero to Hero Ability"
 *                               (no way to forbid playing or evolving a Pokémon from the hand).
 */
import type { AbilityScript, CardScript, Cond, Program } from '../../dsl.js';
import './std-c06-customs.js'; // c06.ownFirstTurn
import './std-s01-customs.js';

/** "Photon Cord": Miraidon's Ability, the same on both printings. */
const PHOTON_CORD: AbilityScript = {
  name: 'Photon Cord',
  triggers: [
    // (bookkeeping, not printed) remember that an attack's damage hit this Pokémon in the Active Spot; see s01.markHitWhileActive.
    { on: 'damagedByAttackActive', program: [{ op: 'custom', fn: 's01.markHitWhileActive' }] },
    // "If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon, move up to 2
    //  Basic {L} Energy cards from this Pokémon to 1 of your Benched Pokémon."
    // Ruling (Pitch Black FAQ, TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2400/): the ability triggers even after being benched by Push Down, but energy must move to a different Pokémon.
    // Ruling (Pitch Black FAQ, TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2399/): you must move at least one Basic Lightning Energy because Abilities cannot use 'up to' with zero.
    {
      on: 'knockedOutByAttack',
      when: { or: [{ inActive: 'self' }, { custom: 's01.hitWhileActive' }] },
      program: [{ op: 'custom', fn: 's01.moveEnergyToBenched', args: { max: 2, filter: { energyType: 'Lightning' } } }],
    },
  ],
};

const playedThisTurn = (name: string): Cond => ({ playedThisTurn: { filter: { name } } });

/** "Discard the top 3 cards of your opponent's deck." */
const DISCARD_TOP_3_OF_OPP: Program = [{ op: 'move', cards: { top: 3, who: 'opp' }, to: 'discard', who: 'opp' }];

export const STD_S01: CardScript[] = [
  {
    id: 'me02.5-153',
    name: 'Rayquaza',
    attacks: {
      // "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 90 more damage."
      // Ruling (TPCi Rules Team 2025-12-04, https://compendium.pokegym.net/ruling/2265/): it must have happened during your turn, and evolving afterwards resets it.
      'Breakthrough Assault': { damage: { add: [20, { cond: { movedToActiveThisTurn: 'self' }, then: 90, else: 0 }] } },
    },
  },
  {
    id: 'me02.5-179',
    name: 'Terapagos ex',
    // "If you go second, you can't use this attack during your first turn."
    // Printed on the card itself, not in an Ability. The first turn you take is turn 2 if you went second; turn 1 (when nobody may
    // attack anyway, this attack not being a first-turn attack) if you went first.
    attacks: {
      // "This attack does 30 damage for each of your Benched Pokémon."
      'Unified Beatdown': { damage: { mul: [30, { pokemon: { zone: 'myBench' } }] } },
      // "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic non-{C} Pokémon."
      'Crown Opal': {
        post: [
          {
            op: 'effect',
            static: { k: 'preventDamage', attacker: { stage: 'basic', not: { type: 'Colorless' } } },
            on: 'self',
            duration: 'oppNextTurn',
          },
        ],
      },
    },
    statics: [
      {
        effect: { k: 'cantUseAttack', attack: 'Unified Beatdown' },
        scope: 'self',
        when: { and: [{ custom: 'c06.ownFirstTurn' }, { not: { firstTurn: true } }] },
      },
    ],
  },
  {
    id: 'me02-022',
    name: 'Dewgong',
    abilities: [
      {
        // "This Pokémon takes 30 less damage from attacks from your opponent's {R} or {W} Pokémon (after applying Weakness and Resistance)."
        name: 'Thick Fat',
        statics: [{ effect: { k: 'damageIn', amount: -30, fromOpp: true, attacker: { type: ['Fire', 'Water'] } }, scope: 'self' }],
      },
    ],
    attacks: {
      // "Flip 2 coins. This attack does 70 damage for each heads."
      Slam: { pre: [{ op: 'flip', n: 2, as: 'h' }], damage: { mul: [70, { v: 'h' }] } },
    },
  },
  {
    id: 'me02.5-211',
    name: 'Thick Scale',
    // "The {N} Pokémon this card is attached to takes 50 less damage from attacks from your opponent's {G}, {R}, {W}, or {L} Pokémon (after applying Weakness and Resistance)."
    // A Tool can be attached to any Pokémon; it only does something on a {N} Pokémon.
    statics: [
      {
        effect: { k: 'damageIn', amount: -50, fromOpp: true, attacker: { type: ['Grass', 'Fire', 'Water', 'Lightning'] } },
        scope: 'self',
        when: { slotIs: { ref: 'self', filter: { type: 'Dragon' } } },
      },
    ],
  },
  {
    id: 'sv06.5-034',
    name: 'Malamar',
    attacks: {
      // "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 120 damage to the new Active Pokémon.
      //  If you didn't play Xerosic's Machinations from your hand during this turn, this attack does nothing."
      'Colluding Tentacles': {
        post: [
          {
            op: 'if',
            cond: { and: [playedThisTurn("Xerosic's Machinations"), { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }] },
            then: [
              { op: 'switch', who: 'opp', chooser: 'self' },
              { op: 'damage', amount: 120, to: 'oppActive' },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv06.5-037',
    name: 'Munkidori ex',
    abilities: [
      {
        // "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, and if you have any Pecharunt ex in play, your opponent takes 1 fewer Prize card."
        // Checked before the Knock Out, so a Pecharunt ex Knocked Out in the same moment still counts (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2262/).
        name: 'Oh No You Don\'t',
        statics: [
          {
            effect: { k: 'koPrizes', delta: -1 },
            scope: 'self',
            when: { gte: [{ pokemon: { zone: 'myPokemon', filter: { name: 'Pecharunt ex' } } }, 1] },
          },
        ],
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't use Dirty Headbutt."
      'Dirty Headbutt': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Dirty Headbutt' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'me03-040',
    name: 'Hippowdon',
    attacks: {
      // "If you played Tarragon from your hand during this turn, discard the top 3 cards of your opponent's deck."
      'Twister Spewing': { post: [{ op: 'if', cond: playedThisTurn('Tarragon'), then: DISCARD_TOP_3_OF_OPP }] },
    },
  },
  {
    id: 'me04-036',
    name: 'Espurr',
    attacks: {
      // "If you played Emma from your hand during this turn, this attack does 60 more damage."
      'Buddy Attack': { damage: { add: [10, { cond: playedThisTurn('Emma'), then: 60, else: 0 }] } },
    },
  },
  {
    id: 'me04-033',
    name: 'Deoxys',
    attacks: {
      // "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Pokémon that have an Ability."
      'Psy Protection': {
        post: [{ op: 'effect', static: { k: 'preventDamage', attacker: { anyAbility: true } }, on: 'self', duration: 'oppNextTurn' }],
      },
    },
  },
  {
    id: 'me05-028',
    name: 'Miraidon',
    abilities: [PHOTON_CORD],
    attacks: {
      // "This Pokémon also does 30 damage to itself."
      Thunder: { post: [{ op: 'damage', amount: 30, to: 'self' }] },
    },
  },
  {
    id: 'mep-082',
    name: 'Miraidon',
    abilities: [PHOTON_CORD],
    attacks: {
      // "This Pokémon does 30 damage to itself."
      Thunder: { post: [{ op: 'damage', amount: 30, to: 'self' }] },
    },
  },
  {
    id: 'me05-041',
    name: 'Annihilape',
    abilities: [
      {
        // "If this Pokémon would be Knocked Out by damage from an attack, flip a coin. If heads, this Pokémon is not Knocked Out, and its remaining HP becomes 10."
        // Ruling (TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2287/): the full damage is dealt first, then the coin is flipped.
        name: 'Durable Body',
        statics: [{ effect: { k: 'surviveKoCoinFlip' }, scope: 'self' }],
      },
    ],
    attacks: {
      // "Place 5 damage counters on 1 of your opponent's Benched Pokémon."
      'Ghostly Blow': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] },
            then: [
              { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: 'Place 5 damage counters on which Benched Pokémon?' },
              { op: 'counters', n: 5, to: { v: 't' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv05-029',
    name: 'Magcargo',
    abilities: [
      {
        // "Whenever your opponent's Active Pokémon moves to the Bench during their turn, their new Active Pokémon is now Burned."
        name: 'Lava Zone',
        triggers: [{ on: 'oppActiveMovedToBench', program: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] }],
      },
    ],
  },
  {
    id: 'sv06-112',
    name: 'Cornerstone Mask Ogerpon ex',
    abilities: [
      {
        // "Prevent all damage from attacks done to this Pokémon by your opponent's Pokémon that have an Ability."
        name: 'Cornerstone Stance',
        statics: [{ effect: { k: 'preventDamage', attacker: { anyAbility: true } }, scope: 'self' }],
      },
    ],
    attacks: {
      // "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon."
      Demolish: { ignore: { weakness: true, resistance: true, defenderEffects: true } },
    },
  },
];
