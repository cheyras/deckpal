/**
 * Cards that were blocked on engine features, scripted once the features existed (see src/__tests__/engine-features.test.ts).
 * Written from the printed text in frames-extra/standard.ts; quotes below are that text.
 * Tests: src/__tests__/cards-std-engine.test.ts.
 *
 * Features used: attacker-filtered damage prevention (Archaludon, Mega Manectric ex), a coin-gated attack (Sandslash),
 * "moved to the Active Spot this turn" (Mega Lopunny ex), "healed this turn" (Lurantis ex, Vileplume), statics printed on a
 * Pokémon card (Crawdaunt), an Energy-from-hand lock (Trevenant), and a delayed end-of-turn effect (Jynx, Glaceon).
 */
import type { CardScript, Program } from '../../dsl.js';
import './fighting-customs.js'; // sumCounters
import './std-engine-customs.js';

/** "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon." */
const BASIC_ATTACKERS_BLOCKED: Program = [
  { op: 'effect', static: { k: 'preventDamage', attacker: { stage: 'basic' } }, on: 'self', duration: 'oppNextTurn' },
];

export const STD_ENGINE: CardScript[] = [
  {
    id: 'me02-075',
    name: 'Archaludon',
    attacks: {
      'Coated Attack': { post: BASIC_ATTACKERS_BLOCKED },
    },
  },
  {
    id: 'me01-050',
    name: 'Mega Manectric ex',
    attacks: {
      'Flash Ray': { post: BASIC_ATTACKERS_BLOCKED },
      // "You may discard all Energy from this Pokémon and have this attack do 130 more damage."
      'Riotous Blasting': {
        pre: [
          { op: 'set', v: 'bonus', value: 0 },
          {
            op: 'may',
            prompt: 'Discard all Energy for +130 damage?',
            body: [
              { op: 'discardEnergy', from: 'self', count: 'all' },
              { op: 'set', v: 'bonus', value: 130 },
            ],
          },
        ],
        damage: { add: [200, { v: 'bonus' }] },
      },
    },
  },
  {
    id: 'me01-069',
    name: 'Sandslash',
    attacks: {
      // "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen."
      // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2317/): "You would flip for Sand Attack's effect first, then flip for Confusion."
      // Ruling (TPCi Rules Team 2026-04-02, https://compendium.pokegym.net/ruling/2326/): "Since Horsea's Smokescreen says 'if tails that attack doesn't happen', you would flip for Smokescreen's effect first to see if the attack happens, then flip for Confusion if the Smokescreen flip was heads."
      // The effect is an attack effect on the Defending Pokémon, so it ends if that Pokémon leaves the Active Spot or evolves.
      'Sand Attack': { post: [{ op: 'effect', static: { k: 'attackCoinFlip' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me02-084',
    name: 'Mega Lopunny ex',
    attacks: {
      // "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 170 more damage."
      // Ruling (TPCi Rules Team 2025-12-04, https://compendium.pokegym.net/ruling/2265/): "Your turn starts when you draw a card. If Mega Lopunny ex moved to the Active Spot prior to that, it is not during your turn. For example, if your opponent KO'd your Active at the end of their turn, moving Mega Lopunny ex to the Active Spot at that time is during their turn. Or if your Active was KO'd by Poison during Pokemon Checkup between turns, that is also not during your turn. And finally, if Buneary moved to the Active Spot during your turn and then evolved into Mega Lopunny ex, that would not count because it was Buneary when it moved to the Active Spot."
      'Gale Thrust': { damage: { add: [60, { cond: { movedToActiveThisTurn: 'self' }, then: 170, else: 0 }] } },
      // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2424/): "...Spiky Hopper's attack damage ignores any effects on the opponent's Active Pokemon."
      'Spiky Hopper': { ignore: { defenderEffects: true } },
    },
  },
  {
    id: 'me05-004',
    name: 'Lurantis ex',
    attacks: {
      // "If this Pokémon was healed during this turn, this attack does 200 more damage."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2405/): "Moving damage counters is not the same thing as Healing, so Lively Cutter would not do any additional damage due to Adrena-Brain."
      'Lively Cutter': { damage: { add: [60, { cond: { healedThisTurn: 'self' }, then: 200, else: 0 }] } },
      // "During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance)."
      'Leaf Guard': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -50 }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me02-003',
    name: 'Vileplume',
    attacks: {
      // "Your opponent's Active Pokémon is now Asleep and Poisoned."
      'Pollen Bomb': {
        post: [
          { op: 'condition', cond: 'asleep', to: 'oppActive' },
          { op: 'condition', cond: 'poisoned', to: 'oppActive' },
        ],
      },
      // "If this Pokémon was healed during this turn, this attack does 120 more damage."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2405/): "Moving damage counters is not the same thing as Healing, so Lively Cutter would not do any additional damage due to Adrena-Brain."
      'Lively Flower': { damage: { add: [60, { cond: { healedThisTurn: 'self' }, then: 120, else: 0 }] } },
    },
  },
  {
    id: 'me01-085',
    name: 'Crawdaunt',
    // "If this Pokémon has any damage counters on it, this attack can be used for {D}."
    // Printed on the card itself, not in an Ability, so "no Abilities" effects don't switch it off.
    attacks: { 'Cutting Riposte': {} },
    statics: [
      {
        effect: { k: 'attackCostSet', attack: 'Cutting Riposte', cost: ['Darkness'] },
        scope: 'self',
        when: { slotIs: { ref: 'self', filter: { damaged: true } } },
      },
    ],
  },
  {
    id: 'me04-039',
    name: 'Trevenant',
    attacks: {
      // "During your opponent's next turn, Energy can't be attached from your opponent's hand to the Defending Pokémon."
      'Cursed Roots': { post: [{ op: 'effect', static: { k: 'cantAttachFromHand' }, on: 'defender', duration: 'oppNextTurn' }] },
      // "This attack does 10 more damage for each damage counter on all of your opponent's Pokémon."
      'Overwhelming Pain': {
        pre: [{ op: 'custom', fn: 'sumCounters', args: { zone: 'oppPokemon', as: 'n' } }],
        damage: { add: [60, { mul: [10, { v: 'n' }] }] },
      },
    },
  },
  {
    id: 'me05-032',
    name: 'Jynx',
    attacks: {
      // "At the end of your opponent's next turn, discard the Defending Pokémon and all attached cards."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2404/): "Since the Defending Pokemon that Jynx attacked was moved to the Bench, the attack effect which Intense Kiss placed on that Pokemon was removed. Neither the old Active nor the new Active are discarded."
      'Intense Kiss': {
        post: [{ op: 'delay', duration: 'oppNextTurn', program: [{ op: 'custom', fn: 'stdEngine.discardDefender' }] }],
      },
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      'Psy Bolt': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }] },
        ],
      },
    },
  },
  {
    id: 'sv06-054',
    name: 'Glaceon',
    attacks: {
      // "At the end of your opponent's next turn, put 9 damage counters on the Defending Pokémon."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2404/): "Since the Defending Pokemon that Jynx attacked was moved to the Bench, the attack effect which Intense Kiss placed on that Pokemon was removed. Neither the old Active nor the new Active are discarded." (same rule for any such delayed attack effect)
      'Permeating Chill': {
        post: [{ op: 'delay', duration: 'oppNextTurn', program: [{ op: 'counters', n: 9, to: 'defender' }] }],
      },
    },
  },
];
