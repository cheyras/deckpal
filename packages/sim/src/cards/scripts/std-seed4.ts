/**
 * Standard seed batch 4: Pokémon whose attacks use effect wording no earlier script implements. Written from the
 * printed text in frames.ts; quotes below are that text. Tests: src/__tests__/cards-std-seed4.test.ts.
 *
 * Not scripted (the DSL has no clause for them, and this batch may not add one):
 *  - me05-032 Jynx, Intense Kiss, and sv06-054 Glaceon, Permeating Chill: "At the end of your opponent's next turn, <do
 *    something to the Defending Pokémon>" needs a delayed effect that fires at the end of a turn (and is removed if
 *    that Pokémon leaves the Active Spot, Compendium #2404).
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import { damageOneOf, searchToHand } from './helpers.js';
import './std-seed1-customs.js'; // std.attackKoLastTurn (Iron Leaves, Avenging Edge)
import './std-seed4-customs.js';

/** "Flip a coin. If heads, ..." */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

/** "...this attack does N more damage": the bonus when `cond` holds, else nothing. */
function moreIf(cond: Cond, n: number) {
  return { cond, then: n, else: 0 } as const;
}

/** "You have more Prize cards remaining than your opponent." */
const MORE_PRIZES_LEFT: Cond = { gt: [{ prizesLeft: 'self' }, { prizesLeft: 'opp' }] };

/**
 * "Attach <up to n / a> Basic Energy card(s) from your discard pile to 1 of your Benched Pokémon." Needs a Benched
 * Pokémon and an Energy to attach; `upTo` makes the pick optional ("up to"), a plain "a Basic Energy card" is 1.
 */
function discardEnergyToBench(n: 1 | 2, upTo: boolean): Program {
  return [
    {
      op: 'if',
      cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
      then: [
        { op: 'chooseCards', from: 'discard', filter: { basicEnergy: true }, min: upTo ? 0 : 1, max: n, as: 'e', prompt: 'Choose a Basic Energy card to attach' },
        {
          op: 'if',
          cond: { gte: [{ len: 'e' }, 1] },
          then: [
            { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Attach to which of your Benched Pokémon?' },
            { op: 'attach', cards: 'e', to: { v: 't' } },
          ],
        },
      ],
    },
  ];
}

export const STD_SEED4: CardScript[] = [
  {
    id: 'me05-040',
    name: 'Marshadow',
    attacks: {
      // "This attack does 30 damage for each {C} in your opponent's Active Pokémon's Retreat Cost."
      // The Retreat Cost it has now, after Air Balloon and the like (see the note).
      'Shadowy Knot': {
        pre: [{ op: 'custom', fn: 'seed4.retreatCostOf', args: { as: 'n' } }],
        damage: { mul: [30, { v: 'n' }] },
      },
    },
    notes:
      'The count is the Retreat Cost as modified by effects: a Tool or Energy that lowers it lowers the damage. ' +
      'Compendium #1620 (TPCi Rules Team 2021-10-07, about Leafeon VMAX, Grass Knot) settles the same question for an identical damage clause: ' +
      '"it is still 60x the Retreat Cost, but the Retreat Cost is now effectively zero."',
  },
  {
    id: 'me05-067',
    name: 'Trumbeak',
    attacks: {
      // "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon."
      // (the printed 30 damage is the attack's damage; on tails the attack does nothing, so no damage either)
      Fly: {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [
              { op: 'damage', amount: 30 },
              { op: 'effect', static: { k: 'preventDamage', andEffects: true }, on: 'self', duration: 'oppNextTurn' },
            ],
            else: [{ op: 'end' }],
          },
        ],
      },
    },
  },
  {
    id: 'sv05-001',
    name: 'Scyther',
    attacks: {
      // "During your next turn, this Pokémon can't use Slashing Strike."
      'Slashing Strike': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Slashing Strike' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv05-019',
    name: 'Dhelmise',
    attacks: {
      // "If you have any {M} Pokémon on your Bench, this attack does 80 more damage."
      'Steel Anchor': { damage: { add: [80, moreIf({ gte: [{ pokemon: { zone: 'myBench', filter: { type: 'Metal' } } }, 1] }, 80)] } },
    },
  },
  {
    id: 'sv05-030',
    name: 'Victini',
    attacks: {
      // "Shuffle your hand into your deck. Then, draw 6 cards."
      'Flippity Flap': {
        program: [
          { op: 'move', cards: { all: 'hand' }, to: 'deck' },
          { op: 'shuffle' },
          { op: 'draw', n: 6 },
        ],
      },
      // "Discard a Special Energy from your opponent's Active Pokémon."
      'Singe Off': { post: [{ op: 'discardEnergy', from: 'defender', count: 1, filter: { basicEnergy: false } }] },
    },
  },
  {
    id: 'sv05-046',
    name: 'Frosmoth',
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't attack."
      'Freezing Chill': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv05-072',
    name: 'Reuniclus',
    attacks: {
      // "Look at the top 8 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck."
      // Ruling (TPCi Rules Team 2024-03-21, https://compendium.pokegym.net/ruling/1962/): "No, Summoning Gate does not allow you to exceed the normal limits of the game. You can put any number of Pokemon you find onto your Bench up to the maximum size of the Bench. In fact, if you use this attack when your Bench is full, the attack does nothing; you can't even look at the top 8 cards of your deck."
      // Ruling (TPCi Rules Team 2024-03-21, https://compendium.pokegym.net/ruling/1959/): "Yes, you can do that." (non-Basic Pokémon too)
      'Summoning Gate': { program: [{ op: 'custom', fn: 'seed4.summoningGate', args: { n: 8 } }] },
      // "Your opponent's Active Pokémon is now Confused."
      'Brain Shake': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv05-123',
    name: 'Raging Bolt ex',
    attacks: {
      // "Discard your hand and draw 6 cards."
      'Burst Roar': {
        program: [
          { op: 'move', cards: { all: 'hand' }, to: 'discard' },
          { op: 'draw', n: 6 },
        ],
      },
      // "You may discard any amount of Basic Energy from your Pokémon. This attack does 70 damage for each card you discarded in this way."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2423/): "Bellowing Thunder does damage first, and then the energy is discarded. So Ancient Bulwark would not prevent the damage because it was done before the energy was discarded."
      // -- the cards are chosen first (that sets the damage), the damage is done, and only then are they discarded.
      'Bellowing Thunder': {
        pre: [{ op: 'custom', fn: 'seed4.pickBasicEnergyAmong', args: { as: 'd' } }],
        damage: { mul: [70, { len: 'd' }] },
        post: [{ op: 'custom', fn: 'seed4.discardPicked', args: { cards: 'd' } }],
      },
    },
  },
  {
    id: 'sv05-135',
    name: 'Unfezant',
    attacks: {
      // "You may put 2 Energy attached to your opponent's Active Pokémon into their hand."
      'Opposing Winds': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ energyOn: 'defender', cards: true }, 1] },
            then: [{ op: 'may', prompt: "Put 2 Energy attached to your opponent's Active Pokémon into their hand?", body: [{ op: 'custom', fn: 'seed4.energyToOppHand', args: { n: 2 } }] }],
          },
        ],
      },
      // "During your next turn, this Pokémon can't attack."
      'Boundless Power': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv06-011',
    name: 'Leafeon',
    attacks: {
      // "Attach a Basic {G} Energy card from your hand to 1 of your Benched Pokémon. If you do, heal all damage from that Pokémon."
      // (A card from the hand is not searched for, so it is not optional: with one in hand and a Benched Pokémon, you attach.)
      'Leaflet Blessings': {
        program: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [
              { op: 'chooseCards', from: 'hand', filter: { energyType: 'Grass' }, min: 1, max: 1, as: 'e', prompt: 'Choose a Basic Grass Energy card to attach' },
              {
                op: 'if',
                cond: { gte: [{ len: 'e' }, 1] },
                then: [
                  { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Attach it to which Benched Pokémon?' },
                  { op: 'attach', cards: 'e', to: { v: 't' } },
                  { op: 'heal', amount: { mul: [10, { countersOn: { v: 't' } }] }, to: { v: 't' } },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv06-019',
    name: 'Iron Leaves',
    attacks: {
      // "Put up to 2 Pokémon from your discard pile into your hand."
      'Recovery Net': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon' }, min: 0, max: 2, as: 'x', prompt: 'Choose up to 2 Pokémon' },
          { op: 'move', cards: 'x', to: 'hand' },
        ],
      },
      // "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 60 more damage."
      'Avenging Edge': { damage: { add: [100, moreIf({ custom: 'std.attackKoLastTurn' }, 60)] } },
    },
  },
  {
    id: 'sv06-024',
    name: 'Teal Mask Ogerpon',
    attacks: {
      // "Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
      'Mountain Stroll': { program: searchToHand({ basicEnergy: true }, 2) },
      // "This attack does 20 more damage for each of your opponent's Benched Pokémon."
      'Ogre Comeback': { damage: { add: [20, { mul: [20, { pokemon: { zone: 'oppBench' } }] }] } },
    },
  },
  {
    id: 'sv06-055',
    name: 'Phione',
    attacks: {
      // "Put a Supporter card from your discard pile into your hand."
      Beckon: {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { ttype: 'supporter' }, min: 1, max: 1, as: 'x', prompt: 'Choose a Supporter card' },
          { op: 'move', cards: 'x', to: 'hand' },
        ],
      },
      // "This attack does 20 damage for each Energy attached to your opponent's Active Pokémon."
      'Energy Press': { damage: { mul: [20, { energyOn: 'defender' }] } },
    },
  },
  {
    id: 'sv06-104',
    name: 'Gurdurr',
    attacks: {
      // "You may do 30 more damage. If you do, this Pokémon also does 30 damage to itself."
      Superpower: {
        pre: [
          { op: 'set', v: 'bonus', value: 0 },
          { op: 'may', prompt: 'Do 30 more damage and 30 damage to this Pokémon?', body: [{ op: 'set', v: 'bonus', value: 30 }] },
        ],
        damage: { add: [50, { v: 'bonus' }] },
        post: [{ op: 'if', cond: { gt: [{ v: 'bonus' }, 0] }, then: [{ op: 'damage', amount: 30, to: 'self' }] }],
      },
    },
  },
  {
    id: 'sv06-107',
    name: 'Hawlucha',
    attacks: {
      // "If you have more Prize cards remaining than your opponent, this attack does 90 more damage."
      'Prize Count': { damage: { add: [50, moreIf(MORE_PRIZES_LEFT, 90)] } },
    },
  },
  {
    id: 'sv06-109',
    name: 'Glimmora',
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned."
      'Stun Poison': {
        program: onHeads({ op: 'condition', cond: 'paralyzed', to: 'oppActive' }, { op: 'condition', cond: 'poisoned', to: 'oppActive' }),
      },
      // "If your opponent's Active Pokémon is Poisoned, this attack does 100 more damage."
      Venoshock: { damage: { add: [30, moreIf({ slotIs: { ref: 'defender', filter: { condition: 'poisoned' } } }, 100)] } },
    },
  },
  {
    id: 'sv06-117',
    name: 'Scolipede',
    attacks: {
      // "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10."
      'Dastardly Jab': {
        program: [
          { op: 'custom', fn: 'countersUntilHp', args: { hp: 10, as: 'n' } },
          { op: 'counters', n: { v: 'n' }, to: 'oppActive' },
        ],
      },
    },
  },
  {
    id: 'sv06-124',
    name: 'Varoom',
    attacks: {
      // "Attach a Basic {M} Energy card from your discard pile to this Pokémon."
      'Metal Coating': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { energyType: 'Metal' }, min: 1, max: 1, as: 'e', prompt: 'Choose a Basic Metal Energy card' },
          { op: 'attach', cards: 'e', to: 'self' },
        ],
      },
    },
  },
  {
    id: 'sv06.5-022',
    name: 'Sylveon',
    attacks: {
      // "Flip a coin. If heads, choose 1 of your opponent's Benched Pokémon. Shuffle that Pokémon and all attached cards into their deck."
      'Mystical Return': {
        program: onHeads(
          { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Benched Pokémon" },
          { op: 'custom', fn: 'seed4.shuffleSlotIntoDeck', args: { slot: 't' } },
        ),
      },
      // "Your opponent's Active Pokémon is now Confused."
      'Disarming Voice': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv06.5-046',
    name: 'Haxorus',
    attacks: {
      // "If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."
      'Bring Down the Axe': {
        program: [{ op: 'if', cond: { slotIs: { ref: 'defender', filter: { energy: { basicEnergy: false } } } }, then: [{ op: 'knockOut', target: 'defender' }] }],
      },
      // "Discard the top 3 cards of your deck."
      'Dragon Pulse': { post: [{ op: 'move', cards: { top: 3 }, to: 'discard' }] },
    },
    notes:
      'Compendium #2033 (TPCi Rules Team 2024-09-12): a Special Energy whose text is switched off by Temple of Sinnoh is still a Special Energy card, so it still counts. ' +
      'The test looks at the Energy card, never at its text, so the rule holds; Temple of Sinnoh has no card in the simulator to pin it with.',
  },
  {
    id: 'sv06.5-051',
    name: 'Furfrou',
    attacks: {
      // "Attach a Basic Energy card from your discard pile to 1 of your Benched Pokémon."
      'Energy Assist': { post: discardEnergyToBench(1, false) },
    },
  },
  {
    id: 'sv07-084',
    name: 'Mienshao',
    attacks: {
      // "If your opponent has 5 or fewer cards in their hand, this attack does 60 more damage."
      'Gale Roundhouse': { damage: { add: [30, moreIf({ lte: [{ handSize: 'opp' }, 5] }, 60)] } },
    },
  },
  {
    id: 'sv07-111',
    name: 'Raging Bolt',
    attacks: {
      // "This attack does 30 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Thunderburst Storm': { program: damageOneOf('oppPokemon', { mul: [30, { energyOn: 'self' }] }) },
    },
  },
  {
    id: 'sv08-026',
    name: 'Oricorio',
    attacks: {
      // "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon."
      'Energy Assist': { post: discardEnergyToBench(2, true) },
      // "Discard an Energy from this Pokémon."
      Fireworks: { post: [{ op: 'discardEnergy', from: 'self', count: 1 }] },
    },
  },
  {
    id: 'sv08-055',
    name: 'Iron Bundle',
    attacks: {
      // "This attack does 50 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost."
      'Gusting Collision': {
        pre: [{ op: 'custom', fn: 'seed4.retreatCostOf', args: { as: 'n' } }],
        damage: { sub: [200, { mul: [50, { v: 'n' }] }] },
      },
    },
  },
  {
    id: 'sv08-060',
    name: 'Magnezone',
    attacks: {
      'Mighty Magnetism': {
        post: [
          // "Your opponent's Active Pokémon is now Confused."
          { op: 'condition', cond: 'confused', to: 'oppActive' },
          // "During your opponent's next turn, that Pokémon can't retreat."
          { op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' },
        ],
      },
      // "During your next turn, this Pokémon can't use Zap Cannon."
      'Zap Cannon': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Zap Cannon' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv08-065',
    name: 'Tapu Koko',
    attacks: {
      // "Search your deck for up to 2 {L} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
      'Summon Lightning': { program: searchToHand({ cat: 'pokemon', type: 'Lightning' }, 2) },
      // "If you have more Prize cards remaining than your opponent, this attack does 90 more damage."
      'Prize Count': { damage: { add: [90, moreIf(MORE_PRIZES_LEFT, 90)] } },
    },
  },
];
