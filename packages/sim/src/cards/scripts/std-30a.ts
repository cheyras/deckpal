/**
 * Standard batch 30a: 30th Celebration (30th) Pokémon, written from the printed text in the frames. Quotes below are that text.
 * Tests: src/__tests__/cards-std-30a.test.ts.
 *
 * Not here: 30th-004 Illumise (Weakness as ×3) is scripted in std-30e.ts, with the `weaknessMultiplier` static it needs.
 *
 * Rulings: none of the Compendium rulings attached to this batch is about these cards' own text (they are filed under other
 * cards that share a name or an attack name), so none changes behaviour. Spiritomb's Spiteful Swirl (2217 / 2218) has the same
 * shape as Wishiwashi's Ability and the engine does the same there (it works from the Bench, each copy puts its own counters).
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import { damageOneOf, searchToHand } from './helpers.js';
import './std-seed1-customs.js'; // std.attackKoLastTurn, std.revealHand

/** "Flip a coin. If heads, <program>". */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

/** "if you have <A> and <B> in play" (Pokémon of those names). */
function haveBoth(a: string, b: string): Cond {
  return {
    and: [
      { gte: [{ pokemon: { zone: 'myPokemon', filter: { name: a } } }, 1] },
      { gte: [{ pokemon: { zone: 'myPokemon', filter: { name: b } } }, 1] },
    ],
  };
}

/** "Attach a Basic <type> Energy card from your hand to this Pokémon." */
function attachBasicFromHand(type: 'Fire' | 'Water'): Program {
  return [
    { op: 'chooseCards', from: 'hand', filter: { energyType: type }, min: 1, max: 1, as: 'e', prompt: `Attach which Basic ${type} Energy card?` },
    { op: 'attach', cards: 'e', to: 'self' },
  ];
}

export const STD_30A: CardScript[] = [
  {
    id: '30th-002',
    name: 'Alolan Exeggutor',
    abilities: [
      {
        // "If this Pokémon has 6 or more Grass Energy attached, it gets +250 HP."
        name: 'Scale Up',
        statics: [{ effect: { k: 'hp', delta: 250 }, scope: 'self', when: { gte: [{ energyOn: 'self', type: 'Grass' }, 6] } }],
      },
    ],
    attacks: {
      // "Heal 50 damage from this Pokémon."
      'Mega Drain': { post: [{ op: 'heal', amount: 50, to: 'self' }] },
    },
  },
  {
    id: '30th-005',
    name: 'Tropius',
    attacks: {
      // "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 90 more damage."
      // (Same condition and wording as Revavroom, Rally Back.)
      'Rally Back': { damage: { add: [30, { cond: { custom: 'std.attackKoLastTurn' }, then: 90, else: 0 }] } },
    },
  },
  {
    id: '30th-008',
    name: 'Vivillon',
    abilities: [
      {
        // "Once during your turn, you may use this Ability. Flip a coin. If heads, search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
        // With an empty deck nothing can change, so the Ability can't be used. By analogy, not a ruling on this card: Ruling (TPCi Rules Team 2016-06-09, https://compendium.pokegym.net/ruling/219/): you cannot use an Ability if you know it won't affect the game state. (Ho-Oh EX, Rebirth)
        name: 'Guiding Dance',
        activated: {
          when: { gte: [{ deckSize: 'self' }, 1] },
          program: onHeads(...searchToHand({ cat: 'pokemon' }, 1, { reveal: true })),
        },
      },
    ],
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned."
      'Poison Powder': { post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }] },
    },
  },
  {
    id: '30th-011',
    name: 'Moltres',
    abilities: [
      {
        // "Once during your turn, if you have Articuno and Zapdos in play, you may use this Ability. Attach a Basic Fire Energy card from your hand to this Pokémon."
        name: 'Fiery Flapping',
        activated: {
          when: { and: [haveBoth('Articuno', 'Zapdos'), { gte: [{ count: { zone: 'hand', filter: { energyType: 'Fire' } } }, 1] }] },
          program: attachBasicFromHand('Fire'),
        },
      },
    ],
    attacks: {
      // "Discard 2 Energy from this Pokémon."
      'Fire Spin': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: '30th-012',
    name: 'Ho-Oh',
    attacks: {
      // "Discard all Energy from this Pokémon. Heal all damage from 1 of your Benched Pokémon."
      'Sacred Breath': {
        program: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [
              { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Heal all damage from which Benched Pokémon?' },
              { op: 'heal', amount: { mul: [10, { countersOn: { v: 't' } }] }, to: { v: 't' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: '30th-014',
    name: 'Reshiram',
    attacks: {
      // "If this Pokémon has any Lightning Energy attached, this attack does 80 more damage."
      'Laser Flame': { damage: { add: [80, { cond: { gte: [{ energyOn: 'self', type: 'Lightning' }, 1] }, then: 80, else: 0 }] } },
    },
  },
  {
    id: '30th-017',
    name: 'Lapras',
    attacks: {
      // "Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck."
      'Ferry Across': { program: searchToHand({ ttype: 'supporter' }, 1, { reveal: true }) },
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      'Ice Beam': { post: onHeads({ op: 'condition', cond: 'paralyzed', to: 'oppActive' }) },
    },
  },
  {
    id: '30th-018',
    name: 'Articuno',
    abilities: [
      {
        // "Once during your turn, if you have Moltres and Zapdos in play, you may use this Ability. Attach a Basic Water Energy card from your hand to this Pokémon."
        name: 'Frosty Flapping',
        activated: {
          when: { and: [haveBoth('Moltres', 'Zapdos'), { gte: [{ count: { zone: 'hand', filter: { energyType: 'Water' } } }, 1] }] },
          program: attachBasicFromHand('Water'),
        },
      },
    ],
    attacks: {
      // "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      Hail: { program: [{ op: 'damage', amount: 30, to: { each: 'oppPokemon' } }] },
    },
  },
  {
    id: '30th-019',
    name: 'Kyogre',
    attacks: {
      // "This attack does 30 more damage for each Water Energy attached to this Pokémon."
      'Hydro Pump': { damage: { add: [60, { mul: [30, { energyOn: 'self', type: 'Water' }] }] } },
    },
  },
  {
    id: '30th-020',
    name: 'Palkia',
    attacks: {
      // "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
      Wormhole: {
        post: [
          { op: 'switch', who: 'self' },
          { op: 'if', cond: { onBench: 'self' }, then: [{ op: 'switch', who: 'opp', chooser: 'opp' }] },
        ],
      },
    },
  },
  {
    id: '30th-021',
    name: 'Greninja ex',
    attacks: {
      // "This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Stealthy Slash': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Pokémon" },
          { op: 'damage', amount: { mul: [30, { countersOn: { v: 't' } }] }, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: '30th-022',
    name: 'Wishiwashi',
    abilities: [
      {
        // "If your Wishiwashi or Wishiwashi ex is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if your Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon."
        // Works from the Bench, and each copy places its own counters (as Spiritomb, Spiteful Swirl: Compendium #2217, #2218).
        name: 'Counterattack Grouping',
        triggers: [
          {
            on: 'allyActiveDamagedByAttack',
            when: { slotIs: { ref: { v: '__target' }, filter: { name: ['Wishiwashi', 'Wishiwashi ex'] } } },
            program: [{ op: 'counters', n: 3, to: { v: '__attacker' } }],
          },
        ],
      },
    ],
    attacks: {
      // "Flip a coin. If tails, this attack does nothing."
      'Surprise Attack': {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { lt: [{ v: 'h' }, 1] }, then: [{ op: 'end' }] },
          { op: 'damage', amount: 30 },
        ],
      },
    },
  },
  {
    id: '30th-025',
    name: 'Pikachu',
    attacks: {
      // "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      Spark: { post: [{ op: 'if', cond: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }, then: damageOneOf('oppBench', 20) }] },
    },
  },
  {
    id: '30th-026',
    name: 'Pikachu',
    attacks: {
      // "Your opponent reveals their hand."
      'Peer At': { program: [{ op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } }] },
    },
  },
  {
    id: '30th-028',
    name: 'Pikachu',
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 20 less damage (before applying Weakness and Resistance)."
        // The reduction applies to everything the opponent's Active attack damages, Benched Pokémon included (ruling 1822; the reading of Garbodor, Gloomy Garbage: #2345).
        name: 'Lonely Gaze',
        statics: [
          { effect: { k: 'damageOut', amount: -20 }, scope: 'oppActive', when: { inActive: 'self' } },
        ],
      },
    ],
  },
  {
    id: '30th-033',
    name: 'Pikachu',
    abilities: [
      {
        // "As long as this Pokémon is on your Bench, prevent all damage from and effects of attacks from your opponent's Pokémon done to this Pokémon."
        name: 'Keep Hidden',
        statics: [{ effect: { k: 'preventDamage', andEffects: true }, scope: 'self', when: { onBench: 'self' } }],
      },
    ],
  },
  {
    id: '30th-034',
    name: 'Pikachu',
    attacks: {
      // "This attack does 40 damage for each of your Pikachu and Pikachu ex in play."
      'Pika Chain': { damage: { mul: [40, { pokemon: { zone: 'myPokemon', filter: { name: ['Pikachu', 'Pikachu ex'] } } }] } },
    },
  },
  {
    id: '30th-037',
    name: 'Pikachu',
    attacks: {
      // "Search your deck for an Energy card, reveal it, and put it into your hand. Then, shuffle your deck."
      'Energized Tail': { program: searchToHand({ cat: 'energy' }, 1, { reveal: true }) },
    },
  },
  {
    id: '30th-038',
    name: 'Pikachu',
    attacks: {
      // "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Targeted Spark': { program: damageOneOf('oppPokemon', 20) },
    },
  },
  {
    id: '30th-040',
    name: 'Pikachu',
    attacks: {
      // "The Defending Pokémon's Weakness is now Lightning until the end of your next turn. (Apply Weakness as ×2.)"
      // As Oranguru, Now You're in My Power (Compendium #2057): a Defending Pokémon with no printed Weakness is weak to it too.
      'Overwriting Bolt': { post: [{ op: 'effect', static: { k: 'weaknessType', type: 'Lightning' }, on: 'defender', duration: 'throughMyNextTurn' }] },
    },
  },
  {
    id: '30th-042',
    name: 'Pikachu',
    attacks: {
      // "Flip a coin until you get tails. Search your deck for an amount of Basic Lightning Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck."
      'Charge-Up Dash': {
        program: [
          { op: 'flip', n: 'untilTails', as: 'h' },
          { op: 'chooseCards', from: 'deck', filter: { energyType: 'Lightning' }, min: 0, max: { v: 'h' }, as: 'e' },
          { op: 'attach', cards: 'e', to: 'self' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: '30th-043',
    name: 'Pikachu',
    attacks: {
      // "This Pokémon is now Asleep. Draw cards until you have 6 cards in your hand."
      'Tropical Vibes': {
        program: [
          { op: 'condition', cond: 'asleep', to: 'self' },
          { op: 'draw', n: { max: [0, { sub: [6, { handSize: 'self' }] }] } },
        ],
      },
    },
  },
];
