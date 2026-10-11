/**
 * Standard batch c06: the Mega Evolution - Ascended Heroes (me02.5) cards from Team Rocket's Honchkrow to Team Rocket's
 * Archer, plus their reprints. Written from the printed text in frames.ts; quotes below are that text.
 * Tests: src/__tests__/cards-std-c06.test.ts. Bespoke effects: std-c06-customs.ts.
 *
 * Not scripted (the DSL lacks the capability, and this batch may not add one):
 *  - me02.5-143 Pecharunt, Final Chain: "If this Pokémon is Knocked Out by damage from an attack from your opponent's
 *    Pokémon, search your deck for a card ..." needs the `knockedOutByAttack` trigger, which the DSL declares but the
 *    engine never fires (no Knock Out queues it), so it would never run.
 *  - me02.5-153 Rayquaza, Breakthrough Assault: "If this Pokémon moved from your Bench to the Active Spot this turn" needs
 *    "moved to the Active Spot this turn" tracking.
 *  - me02.5-162 Team Rocket's Kangaskhan ex, Wicked Impact: "If you played a Supporter card that has \"Team Rocket\" in its
 *    name from your hand during this turn" needs a record of the Supporter played this turn (the engine keeps only that
 *    one was played).
 *  - me02.5-179 Terapagos ex, Crown Opal: "prevent all damage done to this Pokémon by attacks from Basic non-{C} Pokémon"
 *    needs attacker-filtered damage prevention.
 *  - me02.5-182 Anthea & Concordia: "if your opponent's Active Pokémon is Knocked Out by damage from an attack used by
 *    your N's Pokémon, take 3 more Prize cards" needs an attacker-filtered extra-Prize effect worth 3 (`extraPrize` is
 *    always 1 and never filtered by attacker).
 *  - me02.5-201 Team Rocket's Archer: "if any of your Team Rocket's Pokémon were Knocked Out during your opponent's last
 *    turn" needs a Knock Out record that keeps which Pokémon were Knocked Out (`koLastTurn` is only whether any were).
 */
import type { AbilityScript, CardScript, Cond, Filter, Program } from '../../dsl.js';
import './std-seed1-customs.js'; // std.discardRandomFromHand (Mega Scrafty ex, Outlaw Leg)
import './std-c06-customs.js';
import { damageOneOf, searchToHand } from './helpers.js';

/** "Flip a coin. If heads, ..." */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

/** "...this attack does N more damage": the bonus when `cond` holds, else nothing. */
function moreIf(cond: Cond, n: number) {
  return { cond, then: n, else: 0 } as const;
}

/** A Tera Pokémon in play (the frame has no Tera marker; scripts set `fix.tera`). */
const TERA_IN_PLAY: Cond = { gte: [{ pokemon: { zone: 'myPokemon', filter: { tera: true } } }, 1] };

/** "{C} Pokémon" in play: the Pokémon's type. */
const COLORLESS: Filter = { type: 'Colorless' };

/** Spiky Rolling's memory: "used Spiky Rolling during your last turn". */
const SPIKY_LAST_TURN: Cond = { custom: 'c06.usedLastTurn', args: { attack: 'Spiky Rolling' } };

/**
 * "Search your deck for up to n Basic Energy cards and attach them to your Pokémon in any way you like." as repeated
 * optional single picks, each attached to a Pokémon of its own choosing (the same shape as Altaria, Humming Charge).
 * The caller shuffles afterwards.
 */
function attachSearched(picks: ProgramCount): Program {
  return [
    {
      op: 'repeat',
      n: picks,
      body: [
        { op: 'chooseCards', from: 'deck', filter: { basicEnergy: true }, min: 0, max: 1, as: 'e', prompt: 'Choose a Basic Energy to attach (or none)' },
        {
          op: 'if',
          cond: { gte: [{ len: 'e' }, 1] },
          then: [
            { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach it to which of your Pokémon?' },
            { op: 'attach', cards: 'e', to: { v: 't' } },
          ],
        },
      ],
    },
  ];
}
type ProgramCount = Extract<Program[number], { op: 'repeat' }>['n'];

/** "Once during your turn, you may use this Ability. Search your deck for ..." -- needs a card to find (an Ability that would do nothing can't be used). */
const FAN_CALL_FILTER: Filter = { cat: 'pokemon', type: 'Colorless', hpMax: 100 };

const FAN_CALL: AbilityScript = {
  // "Once during your first turn, you may search your deck for up to 3 {C} Pokémon with 100 HP or less, reveal them, and put them into your hand. Then, shuffle your deck. You can't use more than 1 Fan Call Ability during your turn."
  name: 'Fan Call',
  activated: {
    // "up to 3" on an Ability is 1 to 3 (TPCi 2026-02-19)
    program: searchToHand(FAN_CALL_FILTER, 3, { min: 1 }),
    globalOncePerTurn: true,
    when: { and: [{ custom: 'c06.ownFirstTurn' }, { gte: [{ count: { zone: 'deck', filter: FAN_CALL_FILTER } }, 1] }] },
  },
};

export const STD_C06: CardScript[] = [
  {
    id: 'me02.5-127',
    name: "Team Rocket's Honchkrow",
    attacks: {
      // "You may discard any number of Supporter cards that have "Team Rocket" in their name from your hand, and this attack does 60 damage for each card you discarded in this way."
      'Rocket Feathers': {
        pre: [
          {
            op: 'chooseCards',
            from: 'hand',
            filter: { ttype: 'supporter', nameIncludes: 'Team Rocket' },
            min: 0,
            max: { handSize: 'self' },
            as: 'x',
            prompt: 'Discard any number of Team Rocket Supporters (or none)',
          },
          { op: 'move', cards: 'x', to: 'discard' },
        ],
        damage: { mul: [60, { len: 'x' }] },
      },
    },
  },
  {
    id: 'me02.5-135',
    name: 'Mega Scrafty ex',
    abilities: [
      {
        // "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 5 damage counters on the Attacking Pokémon."
        name: 'Counterattacking Crest',
        triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'counters', n: 5, to: 'oppActive' }] }],
      },
    ],
    attacks: {
      // "Discard a random card from your opponent's hand. Discard the top card of your opponent's deck."
      'Outlaw Leg': {
        post: [
          { op: 'custom', fn: 'std.discardRandomFromHand', args: { who: 'opp' } },
          { op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp' },
        ],
      },
    },
    notes:
      'The Attacking Pokémon is the opponent\'s Active Pokémon when the trigger resolves: the trigger runs once the attack is over, ' +
      'before Knock Outs, so it is the Pokémon that attacked unless the attack moved it out of the Active Spot first.',
  },
  {
    id: 'me02.5-140',
    name: 'Pangoro',
    attacks: {
      // "If any of your Benched Pancham have any damage counters on them, this attack does 120 more damage."
      "Master's Punch": {
        damage: {
          add: [80, moreIf({ gte: [{ pokemon: { zone: 'myBench', filter: { name: 'Pancham', damaged: true } } }, 1] }, 120)],
        },
      },
    },
  },
  {
    id: 'me02.5-148',
    name: 'Kingambit',
    abilities: [
      {
        // "Attacks used by this Pokémon do 30 more damage to your opponent's Active Pokémon for each Prize card your opponent has taken (before applying Weakness and Resistance)."
        // (One +30 for each Prize card taken, 1 to 6: the effects add up.)
        name: 'Supreme Overlord',
        statics: [1, 2, 3, 4, 5, 6].map((n) => ({
          effect: { k: 'damageOut' as const, amount: 30 },
          scope: 'self' as const,
          when: { gte: [{ prizesTaken: 'opp' as const }, n] } as Cond,
        })),
      },
    ],
    attacks: {
      // "This Pokémon also does 50 damage to itself."
      'Double-Edged Slash': { post: [{ op: 'damage', amount: 50, to: 'self' }] },
    },
  },
  {
    id: 'me02.5-149',
    name: 'Togedemaru ex',
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      'Stun Needle': { post: onHeads({ op: 'condition', cond: 'paralyzed', to: 'oppActive' }) },
      // "If this Pokémon used Spiky Rolling during your last turn, this attack does 80 more damage."
      'Spiky Rolling': {
        damage: { add: [80, moreIf(SPIKY_LAST_TURN, 80)] },
        post: [{ op: 'custom', fn: 'c06.rememberAttack', args: { attack: 'Spiky Rolling' } }],
      },
    },
    notes:
      '"Used Spiky Rolling during your last turn" is a marker the attack leaves on the Pokémon (c06.rememberAttack) that lasts through your next turn; ' +
      'it survives the Pokémon moving to the Bench and back, and is checked before the new use writes a fresh one.',
  },
  {
    id: 'me02.5-151',
    name: 'Dragonair',
    abilities: [
      {
        // "Once during your turn, if this Pokémon has any Energy attached, you may use this Ability. Search your deck for an Evolution Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
        name: 'Evolutionary Guidance',
        activated: {
          program: searchToHand({ cat: 'pokemon', stage: 'evolution' }, 1, { min: 1 }),
          when: {
            and: [
              { slotIs: { ref: 'self', filter: { energized: true } } },
              { gte: [{ count: { zone: 'deck', filter: { cat: 'pokemon', stage: 'evolution' } } }, 1] },
            ],
          },
        },
      },
    ],
  },
  {
    id: 'me02.5-152',
    name: 'Mega Dragonite ex',
    abilities: [
      {
        // "Once during your turn, you may use this Ability. Switch your Active Pokémon with 1 of your Benched Pokémon."
        name: 'Sky Transport',
        activated: { program: [{ op: 'switch', who: 'self' }], when: { gte: [{ pokemon: { zone: 'myBench' } }, 1] } },
      },
    ],
    attacks: {
      // "Discard 2 Energy from this Pokémon."
      'Ryuno Glide': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'me02.5-164',
    name: "Larry's Dudunsparce ex",
    attacks: {
      // "Flip a coin for each Energy attached to this Pokémon. This attack does 80 damage for each heads."
      'Work Rush': {
        pre: [{ op: 'flip', n: { energyOn: 'self' }, as: 'h' }],
        damage: { mul: [80, { v: 'h' }] },
      },
    },
  },
  {
    id: 'me02.5-170',
    name: "Larry's Staraptor",
    attacks: {
      // "If this Pokémon is Burned or Poisoned, this attack does 100 more damage."
      Facade: {
        damage: {
          add: [
            60,
            moreIf({ or: [{ slotIs: { ref: 'self', filter: { condition: 'burned' } } }, { slotIs: { ref: 'self', filter: { condition: 'poisoned' } } }] }, 100),
          ],
        },
      },
      // "Discard 2 Energy from this Pokémon, and this attack also does 50 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Feathery Strike': {
        post: [
          { op: 'discardEnergy', from: 'self', count: 2 },
          { op: 'if', cond: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }, then: damageOneOf('oppBench', 50) },
        ],
      },
    },
  },
  {
    id: 'me02.5-171',
    name: 'Fan Rotom',
    abilities: [FAN_CALL],
    attacks: {
      // "If there is no Stadium in play, this attack does nothing."
      'Assault Landing': {
        program: [{ op: 'if', cond: { stadium: true }, then: [{ op: 'damage', amount: 70 }] }],
      },
    },
  },
  {
    id: 'me02.5-172',
    name: 'Mega Audino ex',
    attacks: {
      // "Flip 3 coins. For each heads, search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck."
      // (Two optional single picks per heads, each attached to a Pokémon of its own choosing, cover every choice of 0-2 cards and targets.)
      Kaleidowaltz: {
        program: [
          { op: 'flip', n: 3, as: 'h' },
          ...attachSearched({ mul: [2, { v: 'h' }] }),
          { op: 'shuffle' },
        ],
      },
      // "This attack does 80 more damage for each Energy attached to your opponent's Active Pokémon."
      'Ear Force': { damage: { add: [20, { mul: [80, { energyOn: 'oppActive' }] }] } },
    },
  },
  {
    id: 'me02.5-173',
    name: "Larry's Rufflet",
    attacks: {
      // "If your opponent's Active Pokémon already has any damage counters on it, this attack does 80 more damage."
      'Peck the Wound': {
        damage: { add: [20, moreIf({ slotIs: { ref: 'oppActive', filter: { damaged: true } } }, 80)] },
      },
    },
  },
  {
    id: 'me02.5-175',
    name: "Larry's Komala",
    abilities: [
      {
        // "Once during your turn, if this Pokémon is on your Bench, you may use this Ability. Attach an Energy card from your hand to your Active Larry's Pokémon."
        name: 'Lethargic Charge',
        activated: {
          when: {
            and: [
              { onBench: 'self' },
              { slotIs: { ref: 'myActive', filter: { nameIncludes: "Larry's" } } },
              { gte: [{ count: { zone: 'hand', filter: { cat: 'energy' } } }, 1] },
            ],
          },
          program: [
            { op: 'chooseCards', from: 'hand', filter: { cat: 'energy' }, min: 1, max: 1, as: 'e', prompt: "Attach an Energy card to your Active Larry's Pokémon" },
            { op: 'attach', cards: 'e', to: 'myActive' },
          ],
        },
      },
    ],
    attacks: {
      // "This Pokémon is now Asleep. Draw 2 cards."
      'Dozing Draw': {
        post: [
          { op: 'condition', cond: 'asleep', to: 'self' },
          { op: 'draw', n: 2 },
        ],
      },
    },
  },
  {
    id: 'me02.5-176',
    name: 'Drampa',
    attacks: {
      // "During your next turn, this Pokémon can't use Dragon Strike."
      'Dragon Strike': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Dragon Strike' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'me02.5-178',
    name: 'Terapagos',
    attacks: {
      // "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck."
      // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2059/): "No, although Terapagos' *category* is literally "Tera Pokemon" that doesn't count for the purposes of this attack which only counts for Pokemon with the "Tera Pokemon" attribute."
      // (Terapagos itself carries no `fix.tera`, so it is not one of its own targets. With no Tera Pokémon in play there is nothing to attach to, so the attack does nothing.)
      'Prism Charge': {
        program: [
          {
            op: 'if',
            cond: TERA_IN_PLAY,
            then: [
              { op: 'custom', fn: 'c06.pickDifferentEnergy', args: { n: 3, as: 'es' } },
              { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'es', zone: 'myPokemon', filter: { tera: true } } },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    },
    notes: 'Ruling (TPCi Rules Team, Compendium #2059): Terapagos is not a "Tera Pokémon" for its own Prism Charge.',
  },
  {
    id: 'me02.5-186',
    name: 'Counter Gain',
    // "If you have more Prize cards remaining than your opponent, attacks used by the Pokémon this card is attached to cost {C} less."
    // Ruling (TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2290/): "Yes, even though you are only discarding two Energy you can use the attack."
    statics: [{ effect: { k: 'attackCostC', delta: -1 }, scope: 'self', when: { gt: [{ prizesLeft: 'self' }, { prizesLeft: 'opp' }] } }],
  },
  {
    id: 'me02.5-189',
    name: 'Glass Trumpet',
    // "You can use this card only if you have any Tera Pokémon in play."
    // (and, as a Trainer that would do nothing can't be played: a Benched {C} Pokémon and a Basic Energy card in the discard pile)
    playable: {
      and: [
        TERA_IN_PLAY,
        { gte: [{ pokemon: { zone: 'myBench', filter: COLORLESS } }, 1] },
        { gte: [{ count: { zone: 'discard', filter: { basicEnergy: true } } }, 1] },
      ],
    },
    // "Choose up to 2 of your Benched {C} Pokémon and attach a Basic Energy card from your discard pile to each of them."
    // ("up to 2" on a Trainer is 1 to 2. With fewer Basic Energy cards than Pokémon chosen, each card still goes to a different one.)
    play: [
      { op: 'chooseSlots', from: 'myBench', filter: COLORLESS, min: 1, max: 2, as: 'a', prompt: 'Choose up to 2 of your Benched {C} Pokémon' },
      {
        op: 'chooseCards',
        from: 'discard',
        filter: { basicEnergy: true },
        min: { min: [{ len: 'a' }, { count: { zone: 'discard', filter: { basicEnergy: true } } }] },
        max: { min: [{ len: 'a' }, { count: { zone: 'discard', filter: { basicEnergy: true } } }] },
        as: 'e',
        prompt: 'Choose a Basic Energy card for each',
      },
      { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', slots: 'a', distinct: true } },
    ],
  },
  {
    id: 'me02.5-191',
    name: 'Light Ball',
    // "Attacks used by the Pikachu ex this card is attached to do 50 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance)."
    statics: [{ effect: { k: 'damageOut', amount: 50, vs: { ex: true } }, scope: 'self', filter: { name: 'Pikachu ex' } }],
  },
  {
    id: 'me02.5-197',
    name: 'Nighttime Mine',
    // "Attacks used by each Tera Pokémon in play (both yours and your opponent's) cost {C} more."
    // Ruling (TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2288/): "Yes, you can. Wild Growth counts the 2 Basic Grass energy cards as 4 energy, so you satisfy the new attack cost of 4 Energy due to the Nighttime Mine."
    statics: [{ effect: { k: 'attackCostC', delta: 1 }, scope: 'allPokemon', filter: { tera: true } }],
  },
];
