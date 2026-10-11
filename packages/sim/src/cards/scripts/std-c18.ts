/**
 * Standard batch c18: Pokémon of Twilight Masquerade (sv06), Psychic through Metal. Each part is written from the printed
 * text only; the sentence is quoted above the clause that implements it. Rulings are cited where they change behaviour and
 * pinned in src/__tests__/cards-std-c18.test.ts.
 *
 * Not scripted (the vocabulary lacks the capability):
 *  - sv06-089 Swirlix: Festival Lead lets the Pokémon use an attack it has twice, and attack again after a Knock Out;
 *    nothing in the engine repeats an attack.
 *  - sv06-094 Scream Tail ex: Scream stops the opponent from playing Supporter cards from their hand during their next
 *    turn. `itemLock` is the only play lock; there is no Supporter lock. (Crunch alone would be a half-implemented card.)
 *  - sv06-096 Fezandipiti: Adrena-Pheromone flips a coin when damaged and prevents that damage on heads; a coin flip
 *    that cancels damage at damage time is not available.
 *  - sv06-112 Cornerstone Mask Ogerpon ex: Cornerstone Stance prevents damage from "Pokémon that have an Ability"; the
 *    Filter has no "has any Ability" test (`hasAbility` takes one name).
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import { searchToHand } from './helpers.js';
import './std-c18-customs.js'; // c18.sharesTypeWithOpp (Enamorus)
import './std-seed4-customs.js'; // seed4.shuffleSlotIntoDeck (Chimecho)

/** "Flip a coin. If tails, <then>." */
function onTails(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { eq: [{ v: 'h' }, 0] }, then }];
}

const STADIUM_DISCARD: Program = [{ op: 'custom', fn: 'std.discardStadium' }];

/** "If this Pokémon is affected by a Special Condition". */
const SELF_HAS_CONDITION: Cond = {
  slotIs: {
    ref: 'self',
    filter: { any: [{ condition: 'asleep' }, { condition: 'confused' }, { condition: 'paralyzed' }, { condition: 'poisoned' }, { condition: 'burned' }] },
  },
};

/** "If this Pokémon has any {D} Energy attached" -- any Energy providing {D} where it is attached (Compendium #2170). */
const HAS_DARK_ENERGY: Cond = { slotIs: { ref: 'self', filter: { energy: { providesType: 'Darkness' } } } };

export const STD_C18: CardScript[] = [
  {
    id: 'sv06-084',
    name: 'Farigiraf',
    attacks: {
      // "This attack does 40 damage for each of your Stage 1 Pokémon in play."
      'One-derful Rumble': { damage: { mul: [40, { pokemon: { zone: 'myPokemon', filter: { stage: 'stage1' } } }] } },
      // "Your opponent's Active Pokémon is now Confused."
      'Eerie Wave': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv06-085',
    name: 'Chimecho',
    attacks: {
      // "Shuffle 1 of your Benched Pokémon and all attached cards into your deck."
      'Homeward Chime': {
        program: [
          { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Shuffle which of your Benched Pokémon into your deck?' },
          { op: 'custom', fn: 'seed4.shuffleSlotIntoDeck', args: { slot: 't' } },
        ],
      },
    },
  },
  {
    id: 'sv06-088',
    name: 'Florges',
    abilities: [
      {
        name: 'Captivating Invitation',
        // "Once during your turn, you may flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot, and the new Active Pokémon is now Confused."
        // As for Mawile's Invite and Strike (Compendium #1956): the new Active Pokémon only exists if a switch happened, so with no Benched Pokémon nothing is confused.
        activated: {
          program: [
            { op: 'flip', n: 1, as: 'h' },
            {
              op: 'if',
              cond: { and: [{ gte: [{ v: 'h' }, 1] }, { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }] },
              then: [
                { op: 'switch', who: 'opp', chooser: 'self' },
                { op: 'condition', cond: 'confused', to: 'oppActive' },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'sv06-090',
    name: 'Slurpuff',
    attacks: {
      // "Flip 2 coins. This attack does 90 damage for each heads. If both of them are tails, your opponent's Active Pokémon is now Confused."
      'Slurp Slurp': {
        pre: [{ op: 'flip', n: 2, as: 'h' }],
        damage: { mul: [90, { v: 'h' }] },
        post: [{ op: 'if', cond: { eq: [{ v: 'h' }, 0] }, then: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] }],
      },
    },
  },
  {
    id: 'sv06-091',
    name: 'Sandygast',
    attacks: {
      // "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen."
      // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2317/): "You would flip for Sand Attack's effect first, then flip for Confusion."
      'Sand Attack': { post: [{ op: 'effect', static: { k: 'attackCoinFlip' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv06-092',
    name: 'Palossand',
    attacks: {
      // "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen."
      // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2317/): "You would flip for Sand Attack's effect first, then flip for Confusion."
      'Sand Attack': { post: [{ op: 'effect', static: { k: 'attackCoinFlip' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv06-093',
    name: 'Enamorus',
    attacks: {
      // "If any of your Pokémon in play are the same type as any of your opponent's Pokémon in play, this attack does 120 more damage."
      'Love Resonance': { damage: { add: [80, { cond: { custom: 'c18.sharesTypeWithOpp' }, then: 120, else: 0 }] } },
    },
  },
  {
    id: 'sv06-099',
    name: 'Hisuian Growlithe',
    attacks: {
      // "Discard a Stadium in play."
      'Blazing Destruction': { post: STADIUM_DISCARD },
      // "This Pokémon also does 10 damage to itself."
      'Take Down': { post: [{ op: 'damage', amount: 10, to: 'self' }] },
    },
  },
  {
    id: 'sv06-100',
    name: 'Hisuian Arcanine',
    attacks: {
      // "If your Benched Pokémon have any damage counters on them, this attack does 90 more damage."
      'Proud Fangs': {
        damage: { add: [30, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { damaged: true } } }, 1] }, then: 90, else: 0 }] },
      },
      // "Your opponent's Active Pokémon is now Burned."
      'Searing Flame': { post: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv06-101',
    name: 'Nosepass',
    attacks: {
      // "Flip a coin. If tails, during your next turn, this Pokémon can't attack."
      'Power Rush': { post: onTails({ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }) },
    },
  },
  {
    id: 'sv06-102',
    name: 'Probopass',
    attacks: {
      // "If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage."
      'Assault Laser': {
        damage: { add: [80, { cond: { slotIs: { ref: 'oppActive', filter: { tool: true } } }, then: 80, else: 0 }] },
      },
    },
  },
  {
    id: 'sv06-105',
    name: 'Conkeldurr',
    attacks: {
      // "This Pokémon is now Confused."
      Tantrum: { post: [{ op: 'condition', cond: 'confused', to: 'self' }] },
      // "If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost."
      // Printed on the card itself, not in an Ability, so "no Abilities" effects don't switch it off.
      'Gutsy Swing': {},
    },
    statics: [{ effect: { k: 'attackCostSet', attack: 'Gutsy Swing', cost: [] }, scope: 'self', when: SELF_HAS_CONDITION }],
  },
  {
    id: 'sv06-106',
    name: 'Greninja ex',
    attacks: {
      // "You may search your deck for a card and put it into your hand. Then, shuffle your deck."
      // Ruling (TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1980/): "You don't have to search, but if you do you must take a card and put it into your hand."
      'Shinobi Blade': { post: [{ op: 'may', body: searchToHand({}, 1, { reveal: false, min: 1 }) }] },
      // "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (TPCi Rules Team 2024-07-11, https://compendium.pokegym.net/ruling/2002/): "You do 100 damage to the two. You first CHOOSE the energy you're going to discard, then do the damage (which is reduced for Double Turbo), and THEN discard the energy."
      // The damage is done while the Energy is still attached and the discard follows; which Energy is discarded can't change the damage, so choosing it after the damage is the same.
      'Mirage Barrage': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 2, max: 2, as: 't', prompt: "Choose 2 of your opponent's Pokémon" },
          { op: 'damage', amount: 120, to: { v: 't' } },
          { op: 'discardEnergy', from: 'self', count: 2 },
        ],
      },
    },
  },
  {
    id: 'sv06-110',
    name: 'Ting-Lu',
    attacks: {
      // "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (TPCi Rules Team 2024-09-05, https://compendium.pokegym.net/ruling/2008/): "The damage is indeed done first and then Jamming Tower is discarded, but lucky for Cleffa the check for KO does not happen until all damage and effects have been resolved. Cleffa would have 80HP and is not KO'd by Ground Crasher."
      // The Knock Out check runs after the whole attack, so it sees the Stadium already discarded.
      'Ground Crasher': {
        post: [
          {
            op: 'if',
            cond: { stadium: true },
            then: [{ op: 'damage', amount: 30, to: { each: 'oppBench' } }, ...STADIUM_DISCARD],
          },
        ],
      },
    },
  },
  {
    id: 'sv06-111',
    name: 'Okidogi',
    abilities: [
      {
        name: 'Adrena-Power',
        // "If this Pokémon has any {D} Energy attached, it gets +100 HP, and the attacks it uses do 100 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
        // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2170/): "Yes, although Luminous Energy only provides one unit of energy, it is providing all energy types all the time." (Pinned with Legacy Energy, which provides every type too.)
        statics: [
          { effect: { k: 'hp', delta: 100 }, scope: 'self', when: HAS_DARK_ENERGY },
          { effect: { k: 'damageOut', amount: 100 }, scope: 'self', when: HAS_DARK_ENERGY },
        ],
      },
    ],
  },
  {
    id: 'sv06-114',
    name: 'Mightyena',
    attacks: {
      // "If Mightyena is on your Bench, this attack does 90 more damage."
      'Hunting Pack': { damage: { add: [30, { cond: { onBench: 'self' }, then: 90, else: 0 }] } },
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      Corner: { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv06-116',
    name: 'Whirlipede',
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, the Defending Pokémon can't retreat."
      'Poison Ring': {
        post: [
          { op: 'condition', cond: 'poisoned', to: 'oppActive' },
          { op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' },
        ],
      },
    },
  },
  {
    id: 'sv06-118',
    name: 'Brute Bonnet',
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned."
      'Poison Spray': { post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }] },
      // "This attack does 50 more damage for each damage counter on your opponent's Active Pokémon."
      'Relentless Punches': { damage: { add: [50, { mul: [50, { countersOn: 'oppActive' }] }] } },
    },
  },
  {
    id: 'sv06-119',
    name: 'Skarmory',
    attacks: {
      // "Discard a Stadium in play."
      'Big Storm': { post: STADIUM_DISCARD },
    },
  },
  {
    id: 'sv06-122',
    name: 'Aggron',
    attacks: {
      // "This attack does 50 damage for each of your Pokémon that has any damage counters on it."
      'Angry Slam': { damage: { mul: [50, { pokemon: { zone: 'myPokemon', filter: { damaged: true } } }] } },
      // "During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance)."
      'Guard Claw': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -50 }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv06-123',
    name: 'Heatran',
    abilities: [
      {
        name: 'Incandescent Body',
        // "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), the Attacking Pokémon is now Burned."
        // The trigger is queued when the damage lands, so it still resolves when that damage Knocks this Pokémon Out.
        triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] }],
      },
    ],
    attacks: {
      // "Discard all {M} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way."
      'Steel Burst': {
        pre: [{ op: 'discardEnergy', from: 'self', count: 'all', filter: { providesType: 'Metal' }, as: 'gone' }],
        damage: { mul: [50, { len: 'gone' }] },
      },
    },
    notes: "The Attacking Pokémon is taken to be the opponent's Active Pokémon when the trigger resolves (as for Numel's identical Ability).",
  },
];
