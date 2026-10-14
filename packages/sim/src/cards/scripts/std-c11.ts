/**
 * Standard batch c11 (Mega Evolution-era J cards, me05). Each part is written from the printed text only; the sentence is
 * quoted above the clause that implements it. Rulings are cited where they change behaviour and pinned in
 * src/__tests__/cards-std-c11.test.ts.
 *
 * Not scripted here (and why):
 *  - me04-086 Nitro Fire Energy: a discarded Energy that goes to the HAND after the attack (`reattachAfterOwnAttack` only
 *    re-attaches it to the Pokémon).
 *  - me05-004 Lurantis ex and me05-032 Jynx: already scripted in std-engine.ts.
 *  - me05-028 Miraidon: Photon Cord needs the `knockedOutByAttack` trigger, which is declared but never fired.
 *  - me05-031 Mega Slowbro ex: Shellnado Spin is a timed attack effect that reacts to being damaged; the only reaction hook
 *    is a card trigger, which is an Ability to the engine (switched off by Ability-stopping effects, and not stopped by the
 *    attack-effect protection of Compendium #2408's Mist Energy).
 *  - me05-041 Annihilape: Durable Body is a coin-flip Knock Out survival.
 */
import type { CardScript, Cond } from '../../dsl.js';
import { BENCH_SPACE, damageOneOf, inDiscard } from './helpers.js';
import './std-c01-customs.js'; // c01.benchCards (Lampent: Pokémon of any Stage onto the Bench)
import './std-seed4-customs.js'; // seed4.summoningGate, seed4.shuffleSlotIntoDeck
import './std-c11-customs.js';

const HIDE_N_SNEAK_NAME = "Hide 'n' Sneak";

/** "this Pokémon has no Voltaic {L} Energy attached" is the negation of this. */
const HAS_VOLTAIC: Cond = { slotIs: { ref: 'self', filter: { energy: { name: 'Voltaic Lightning Energy' } } } };

export const STD_C11: CardScript[] = [
  {
    id: 'me05-001',
    name: 'Tropius',
    attacks: {
      // "Look at the top 6 cards of your deck, and you may reveal any number of Pokémon you find there and put them into your hand. Shuffle the other cards back into your deck."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2403/): you don't shuffle if no cards go back into the deck.
      'Fruity Aroma': { program: [{ op: 'custom', fn: 'c11.lookTakeAny', args: { n: 6, filter: { cat: 'pokemon' } } }] },
    },
  },
  {
    id: 'me05-007',
    name: 'Heatran',
    attacks: {
      // "Your opponent's Active Pokémon is now Burned."
      Singe: { post: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
      // "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Burned Pokémon."
      'Lava Wall': {
        post: [{ op: 'effect', static: { k: 'preventDamage', attacker: { condition: 'burned' } }, on: 'self', duration: 'oppNextTurn' }],
      },
    },
  },
  {
    id: 'me05-008',
    name: 'Mega Delphox ex',
    attacks: {
      // "Look at the top 9 cards of your deck, and you may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck."
      // Rulings (TPCi Rules Team 2024-03-21, https://compendium.pokegym.net/ruling/1962/ and …/1959/), as for Reuniclus's identical Summoning Gate: Pokémon of any Stage, as many as the Bench has room for.
      'Trick Portal': { program: [{ op: 'custom', fn: 'seed4.summoningGate', args: { n: 9 } }] },
      // "Your opponent's Active Pokémon is now Burned and Confused."
      'Eerie Glow': {
        post: [
          { op: 'condition', cond: 'burned', to: 'oppActive' },
          { op: 'condition', cond: 'confused', to: 'oppActive' },
        ],
      },
    },
  },
  {
    id: 'me05-009',
    name: 'Sizzlipede',
    attacks: {
      // "Discard the top card of your opponent's deck."
      'Controlled Burn': { post: [{ op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp' }] },
      // "Reveal the bottom 7 cards of your deck, and this attack does 50 damage for each Pokémon you find there that has the Bug Out attack. Then, shuffle any revealed Pokémon back into your deck. Discard the other cards."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2401/): all revealed Pokémon get shuffled back; non-Pokémon are discarded.
      'Bug Out': {
        pre: [{ op: 'custom', fn: 'c11.revealBottom', args: { n: 7, attack: 'Bug Out', as: 'n' } }],
        damage: { mul: [50, { v: 'n' }] },
      },
    },
  },
  {
    id: 'me05-012',
    name: 'Armarouge',
    attacks: {
      // "This attack does 40 more damage for each of your Benched Pokémon that has any {R} Energy attached."
      'Flame Legion': {
        damage: { add: [40, { mul: [40, { pokemon: { zone: 'myBench', filter: { energy: { providesType: 'Fire' } } } }] }] },
      },
    },
  },
  {
    id: 'me05-014',
    name: 'Seaking',
    attacks: {
      // "This attack does 30 damage to 1 of your opponent's Pokémon for each {W} Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Hydro Jet': { program: damageOneOf('oppPokemon', { mul: [30, { energyOn: 'self', type: 'Water' }] }) },
    },
  },
  {
    id: 'me05-016',
    name: 'Wailord ex',
    attacks: {
      // "This Pokémon is now Asleep."
      'Falling Down': { post: [{ op: 'condition', cond: 'asleep', to: 'self' }] },
    },
  },
  {
    id: 'me05-017',
    name: 'Relicanth',
    attacks: {
      // "This attack does 30 more damage for each of your Benched Pokémon that has "Antique" in its name."
      'Fossil Beatdown': { damage: { add: [10, { mul: [30, { pokemon: { zone: 'myBench', filter: { nameIncludes: 'Antique' } } }] }] } },
    },
  },
  {
    id: 'me05-020',
    name: 'Primarina',
    abilities: [
      {
        // "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Heal all damage from 1 of your Pokémon."
        name: 'Enriching Melody',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            program: [
              { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Heal all damage from which of your Pokémon?' },
              { op: 'heal', amount: { mul: [10, { countersOn: { v: 't' } }] }, to: { v: 't' } },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "Shuffle this Pokémon and all attached cards into your deck."
      'Aqua Return': {
        post: [
          { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'me' },
          { op: 'custom', fn: 'seed4.shuffleSlotIntoDeck', args: { slot: 'me' } },
        ],
      },
    },
  },
  {
    id: 'me05-022',
    name: 'Palafin',
    attacks: {
      // "If your opponent has exactly 1 Prize card remaining, this attack does 200 more damage."
      'Knuckle Justice': { damage: { add: [80, { cond: { eq: [{ prizesLeft: 'opp' }, 1] }, then: 200, else: 0 }] } },
    },
  },
  {
    id: 'me05-024',
    name: 'Manectric',
    attacks: {
      // "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Evolution Pokémon."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2397/): Cinderace counts as an Evolution Pokemon even though it's not evolved, so Flashing Barrier blocks it.
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2402/): Thievul is an Evolution Pokemon, so its damage is prevented.
      'Flashing Barrier': {
        post: [{ op: 'effect', static: { k: 'preventDamage', attacker: { stage: 'evolution' } }, on: 'self', duration: 'oppNextTurn' }],
      },
      // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
      'Sonic Edge': { ignore: { defenderEffects: true } },
    },
  },
  {
    id: 'me05-026',
    name: 'Vikavolt',
    attacks: {
      // "This attack does 50 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Quick Dive': { program: damageOneOf('oppPokemon', 50) },
      // "If this Pokémon has no Voltaic {L} Energy attached, this attack does nothing."
      'Giga Railgun': { program: [{ op: 'if', cond: HAS_VOLTAIC, then: [{ op: 'damage', amount: 260 }] }] },
    },
  },
  {
    id: 'me05-027',
    name: 'Mega Zeraora ex',
    attacks: {
      // "This attack does 60 damage for each {L} Energy attached to this Pokémon."
      'Thunderous Fist': { damage: { mul: [60, { energyOn: 'self', type: 'Lightning' }] } },
      // "Switch this Pokémon with 1 of your Benched Pokémon."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2414/): attack effects finish before KOs are processed; switch happens first.
      'Zepto Turn': { post: [{ op: 'switch', who: 'self' }] },
    },
  },
  {
    id: 'me05-035',
    name: 'Spiritomb',
    attacks: {
      // "If you have 13 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, choose 2 of your opponent's Pokémon and quadruple the number of damage counters on each of them."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2411/): multiply existing counters by 4; if none, no counters appear.
      'Spiritual End': {
        program: [
          {
            op: 'if',
            cond: { gte: [inDiscard({ cat: 'pokemon', hasAbility: HIDE_N_SNEAK_NAME }), 13] },
            then: [
              { op: 'chooseSlots', from: 'oppPokemon', min: 2, max: 2, as: 't', prompt: "Choose 2 of your opponent's Pokémon" },
              { op: 'custom', fn: 'c11.multiplyCounters', args: { slots: 't', factor: 4 } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'me05-037',
    name: 'Lampent',
    attacks: {
      // "Search your deck for up to 3 Lampent and put them onto your Bench. Then, shuffle your deck."
      // (Lampent is a Stage 1: put onto the Bench as the Stage 1 card it is, like Ninjask's Shedinja, Compendium #994.)
      'Spreading Light': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { name: 'Lampent' }, min: 0, max: { min: [3, BENCH_SPACE] }, as: 'found', prompt: 'Put up to 3 Lampent onto your Bench' },
          { op: 'custom', fn: 'c01.benchCards', args: { cards: 'found' } },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'me05-038',
    name: 'Mega Chandelure ex',
    abilities: [
      {
        // "Your opponent's Active Pokémon's Retreat Cost is {C} more."
        name: 'Binding Flame',
        statics: [{ effect: { k: 'retreatCost', delta: 1 }, scope: 'oppActive' }],
      },
    ],
    attacks: {
      // "This attack does 50 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost."
      // Ruling (TPCi Rules Team 2026-04-02, https://compendium.pokegym.net/ruling/2386/): Antique Fossils have no Retreat Cost at all (not a cost of zero); that is fixed, so Binding Flame cannot give them one.
      // The count includes Binding Flame's own {C} (an Ability in play), and is 0 for an Antique fossil.
      'Phantom Maze': {
        pre: [{ op: 'custom', fn: 'c11.retreatCostOf', args: { as: 'n' } }],
        damage: { add: [130, { mul: [50, { v: 'n' }] }] },
      },
    },
  },
  {
    id: 'me05-044',
    name: 'Cranidos',
    attacks: {
      // "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
      'Push Down': { post: [{ op: 'switch', who: 'opp', chooser: 'opp' }] },
    },
  },
  {
    id: 'me05-045',
    name: 'Rampardos ex',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
        // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2393/): Destructive Headbutting requires opponent's Active to have Energy.
        name: 'Destructive Headbutting',
        activated: {
          activeOnly: true,
          when: { slotIs: { ref: 'oppActive', filter: { energized: true } } },
          program: [
            { op: 'flip', n: 1, as: 'h' },
            { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'custom', fn: 'c11.discardOppActiveEnergy' }] },
          ],
        },
      },
    ],
    attacks: {
      // "During your next turn, attacks used by this Pokémon do 150 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2407/): Rowdy Hammer tops out at 300 (+150 applies for the next turn only, no stacking); a different attack used next turn also gets +150 provided it does damage first.
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2398/): Rowdy Hammer's bonus damage isn't blocked by Hide 'n' Sneak.
      'Rowdy Hammer': { post: [{ op: 'effect', static: { k: 'damageOut', amount: 150 }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'me05-050',
    name: 'Mandibuzz',
    attacks: {
      // "This attack does 70 damage to 1 of your opponent's Pokémon that has any Special Energy attached. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Bone Sniper': { program: damageOneOf('oppPokemon', 70, { energy: { basicEnergy: false } }) },
    },
  },
];
