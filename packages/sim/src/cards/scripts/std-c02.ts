/**
 * Standard batch c02. Written from the printed text in frames.ts; quotes below are that text.
 * Tests: src/__tests__/cards-std-c02.test.ts.
 *
 * Not scripted (the vocabulary or the engine can't say it yet):
 *  - me01-085 Crawdaunt        Cutting Riposte: "can be used for {D}" is a cost static printed on the Pokémon (no Ability carries it).
 *  - me01-087 Spiritomb        Spiteful Swirl: an Ability that reacts to ANOTHER of your Pokémon (Active {D}) being damaged,
 *                              from the Bench, and names the attacker; no trigger for that.
 *  - me01-101 Latios           Lustrous Assist: "when your Mega Latias ex moves from your Bench to the Active Spot" (not tracked).
 *  - me01-105 Delibird         Quick Gift: "If you go first, you can use this attack during your first turn" (no attack on turn 1).
 *  - me01-113 Acerola's Mischief  prevention only against attacks by the opponent's Pokémon ex (attacker-filtered prevention).
 *  - me01-117 Forest of Vitality  a Stadium that lets {G} Pokémon evolve the turn they are played (the evolve rule is hard-coded).
 *  - me02-003 Vileplume        Lively Flower: "was healed during this turn" is not tracked.
 *  - me02-004 Mega Heracross ex   Juggernaut Horn: "damaged by an attack during your opponent's last turn ... that much more" (not tracked).
 */
import type { CardScript, Cond, Program, SpecialCondition } from '../../dsl.js';
import { searchToHand } from './helpers.js';
import './std-seed4-customs.js'; // seed4.shuffleSlotIntoDeck (Lokix)
import './std-c02-customs.js';
import './metal-customs.js'; // metal.energyToDeck (Dialga)
import './std-seed1-customs.js'; // std.revealHand (Mega Absol ex)

/** "Flip a coin. If heads, ..." */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

const SPECIALS: [string, SpecialCondition][] = [
  ['Asleep', 'asleep'],
  ['Confused', 'confused'],
  ['Paralyzed', 'paralyzed'],
  ['Poisoned', 'poisoned'],
  ['Burned', 'burned'],
];

/** A Pokémon of yours that is damaged or has a Special Condition: Pokémon Center Lady would do something to it. */
const NEEDS_CARE: Cond = {
  gte: [
    {
      pokemon: {
        zone: 'myPokemon',
        filter: { any: [{ damaged: true }, ...SPECIALS.map(([, c]) => ({ condition: c }))] },
      },
    },
    1,
  ],
};

const MEGA_EX = { mega: true, ex: true } as const;

export const STD_C02: CardScript[] = [
  {
    id: 'me01-084',
    name: 'Garganacl',
    abilities: [
      {
        name: 'Powerful a-Salt',
        // "Attacks used by your {F} Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2215/): Multiple copies of the ability stack for cumulative bonuses.
        statics: [{ effect: { k: 'damageOut', amount: 30 }, scope: 'myPokemon', filter: { type: 'Fighting' } }],
      },
    ],
    notes: 'Two Garganacl in play add +60 (Compendium #2215).',
  },
  {
    id: 'me01-086',
    name: 'Mega Absol ex',
    attacks: {
      // "If your opponent's Active Pokémon has exactly 6 damage counters on it, that Pokémon is Knocked Out."
      'Terminal Period': {
        program: [{ op: 'if', cond: { eq: [{ countersOn: 'oppActive' }, 6] }, then: [{ op: 'knockOut', target: 'oppActive' }] }],
      },
      // "Your opponent reveals their hand, and you discard a card you find there."
      'Claw of Darkness': {
        post: [
          { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
          { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'self', min: 1, max: 1, as: 'c', prompt: "Discard a card from your opponent's hand" },
          { op: 'move', cards: 'c', to: 'discard', who: 'opp' },
        ],
      },
    },
  },
  {
    id: 'me01-092',
    name: 'Grafaiai',
    attacks: {
      // "Flip a coin. If heads, choose a Special Condition. Your opponent's Active Pokémon is now affected by that Special Condition."
      'Miraculous Paint': {
        post: onHeads(
          { op: 'chooseOption', options: SPECIALS.map(([label]) => label), as: 'c', prompt: 'Choose a Special Condition' },
          ...SPECIALS.map(
            ([, cond], i): Program[number] => ({ op: 'if', cond: { eq: [{ v: 'c' }, i] }, then: [{ op: 'condition', cond, to: 'oppActive' }] }),
          ),
        ),
      },
    },
  },
  {
    id: 'me01-093',
    name: 'Steelix',
    attacks: {
      // "If you have exactly 6 Prize cards remaining, this attack does 200 more damage."
      'Welcoming Tail': { damage: { add: [40, { cond: { eq: [{ prizesLeft: 'self' }, 6] }, then: 200, else: 0 }] } },
    },
  },
  {
    id: 'me01-095',
    name: 'Dialga',
    attacks: {
      // "You may shuffle all Energy attached to this Pokémon into your deck and have this attack do 80 more damage."
      'Chrono Burst': {
        pre: [
          { op: 'set', v: 'bonus', value: 0 },
          {
            op: 'may',
            prompt: 'Shuffle all Energy attached to this Pokémon into your deck for 80 more damage?',
            body: [{ op: 'custom', fn: 'metal.energyToDeck' }, { op: 'shuffle' }, { op: 'set', v: 'bonus', value: 80 }],
          },
        ],
        damage: { add: [80, { v: 'bonus' }] },
      },
    },
  },
  {
    id: 'me01-097',
    name: 'Tinkatuff',
    abilities: [
      {
        name: 'Haphazard Hammer',
        // "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            program: onHeads({ op: 'discardEnergy', from: 'oppActive', count: 1 }),
          },
        ],
      },
    ],
  },
  {
    id: 'me01-098',
    name: 'Tinkaton',
    attacks: {
      // "This attack does 60 less damage for each Energy attached to your opponent's Active Pokémon."
      'Windup Swing': { damage: { sub: [240, { mul: [60, { energyOn: 'defender' }] }] } },
    },
  },
  {
    id: 'me01-099',
    name: 'Gholdengo',
    attacks: {
      // "Flip a coin until you get tails. Search your deck for a number of cards up to the number of heads and put them into your hand. Then, shuffle your deck."
      'All-You-Can-Grab': {
        program: [{ op: 'flip', n: 'untilTails', as: 'h' }, ...searchToHand({}, { v: 'h' }, { reveal: false })],
      },
    },
  },
  {
    id: 'me01-106',
    name: 'Miltank',
    attacks: {
      // "Flip 2 coins. If both of them are heads, heal all damage from 1 of your Pokémon."
      'Bellyful of Milk': {
        program: [
          { op: 'flip', n: 2, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 2] },
            then: [
              { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Heal all damage from which of your Pokémon?' },
              { op: 'heal', amount: { mul: [10, { countersOn: { v: 't' } }] }, to: { v: 't' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'me01-112',
    name: 'Bewear',
    attacks: {
      // "Flip 2 coins. If both of them are heads, this attack does 100 more damage."
      'Hyper Lariat': {
        pre: [{ op: 'flip', n: 2, as: 'h' }],
        damage: { add: [100, { cond: { gte: [{ v: 'h' }, 2] }, then: 100, else: 0 }] },
      },
    },
  },
  {
    id: 'me01-120',
    name: "Lt. Surge's Bargain",
    // "Ask your opponent if each player may take a Prize card. If yes, each player takes a Prize card. If no, you draw 4 cards."
    play: [
      {
        op: 'chooseOption',
        chooser: 'opp',
        options: ['Yes: each player takes a Prize card', 'No: the player who used it draws 4 cards'],
        as: 'a',
        prompt: "Lt. Surge's Bargain: may each player take a Prize card? (If not, the player who used it draws 4 cards.)",
      },
      {
        op: 'if',
        cond: { eq: [{ v: 'a' }, 0] },
        then: [{ op: 'custom', fn: 'c02.takePrize', args: { who: 'both' } }],
        else: [{ op: 'draw', n: 4 }],
      },
    ],
  },
  {
    id: 'me01-123',
    name: 'Pokémon Center Lady',
    // "Heal 60 damage from 1 of your Pokémon, and it recovers from all Special Conditions."
    // (No effect, no play, TPCi 2014-11-13: playable only if a Pokémon of yours is damaged or has a Special Condition.)
    playable: NEEDS_CARE,
    play: [
      { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Heal 60 damage from which of your Pokémon?' },
      { op: 'heal', amount: 60, to: { v: 't' } },
      { op: 'custom', fn: 'c02.cureConditions', args: { slot: 't' } },
    ],
  },
  {
    id: 'me01-126',
    name: 'Repel',
    // "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
    playable: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] },
    play: [{ op: 'switch', who: 'opp', chooser: 'opp' }],
  },
  {
    id: 'me01-128',
    name: 'Strange Timepiece',
    // "Devolve 1 of your evolved {P} Pokémon by putting any number of Evolution cards on it into your hand. (That Pokémon can't evolve this turn.)"
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2328/): devolving a Pokémon does not count as putting it onto the Bench. Ruling #2327 (https://compendium.pokegym.net/ruling/2327/): the parenthesis is only reminder text of the normal rules, and Boosted Evolution overrides them, so Espeon can evolve back at once.
    playable: { gte: [{ pokemon: { zone: 'myPokemon', filter: { type: 'Psychic', stage: 'evolution' } } }, 1] },
    play: [
      { op: 'chooseSlots', from: 'myPokemon', filter: { type: 'Psychic', stage: 'evolution' }, min: 1, max: 1, as: 't', prompt: 'Devolve which of your evolved {P} Pokémon?' },
      { op: 'set', v: 'n', value: 1 },
      {
        op: 'if',
        cond: { slotIs: { ref: { v: 't' }, filter: { stage: 'stage2' } } },
        then: [{ op: 'chooseOption', options: ['1 Evolution card', '2 Evolution cards'], as: 'k', prompt: 'Put how many Evolution cards into your hand?' }, { op: 'set', v: 'n', value: { add: [{ v: 'k' }, 1] } }],
      },
      { op: 'custom', fn: 'c02.devolve', args: { slot: 't', n: 'n' } },
    ],
    notes:
      'Devolving takes the top Evolution card(s) of the stack to the hand and clears Special Conditions and attack effects, as the existing Claydol devolve does. ' +
      'No Bench trigger runs (#2328). The Pokémon is marked evolved this turn, so it cannot evolve again by the normal rule; an Ability that overrides the rule is #2327 (Boosted Evolution), not modelled by this engine.',
  },
  {
    id: 'me01-132',
    name: "Wally's Compassion",
    // "Heal all damage from 1 of your Mega Evolution Pokémon ex. If you healed any damage in this way, put all Energy attached to that Pokémon into your hand."
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2234/): yes, it can heal a Mega Evolution Pokémon ex that has no Energy attached.
    playable: { gte: [{ pokemon: { zone: 'myPokemon', filter: MEGA_EX } }, 1] },
    play: [
      { op: 'chooseSlots', from: 'myPokemon', filter: MEGA_EX, min: 1, max: 1, as: 't', prompt: 'Heal all damage from which Mega Evolution Pokémon ex?' },
      { op: 'set', v: 'n', value: { countersOn: { v: 't' } } },
      { op: 'heal', amount: { mul: [10, { v: 'n' }] }, to: { v: 't' }, as: 'd' }, // d: the damage actually removed (0 under a heal lock)
      { op: 'if', cond: { gte: [{ v: 'd' }, 1] }, then: [{ op: 'custom', fn: 'c02.energyAllToHand', args: { slot: 't' } }] },
    ],
  },
  {
    id: 'me02-007',
    name: 'Ludicolo',
    abilities: [
      {
        name: 'Excited Heal',
        // "Once during your turn, if you have any {G} Mega Evolution Pokémon ex in play, you may use this Ability. Heal 60 damage from 1 of your Pokémon."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2241/): a Basic Mega Heracross ex satisfies the requirement; the {G} Mega Evolution Pokémon ex need not be an evolved Pokémon.
        activated: {
          when: { gte: [{ pokemon: { zone: 'myPokemon', filter: { type: 'Grass', ...MEGA_EX } } }, 1] },
          program: [
            { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Heal 60 damage from which of your Pokémon?' },
            { op: 'heal', amount: 60, to: { v: 't' } },
          ],
        },
      },
    ],
  },
  {
    id: 'me02-010',
    name: 'Lokix',
    attacks: {
      // "Shuffle this Pokémon and all attached cards into your deck."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2248/): the Pokémon that replaces a Confused Lokix is not Confused.
      'Jumping Shot': {
        post: [
          { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'me' },
          { op: 'custom', fn: 'seed4.shuffleSlotIntoDeck', args: { slot: 'me' } },
        ],
      },
    },
  },
];

