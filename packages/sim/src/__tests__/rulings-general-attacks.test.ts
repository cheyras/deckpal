/**
 * General rulings, attacks and Abilities lane: the Pokémon Rulings Compendium rulings filed under "*Attacks in General",
 * "*Abilities in General" and "Meta-Rulings" that still hold in today's Standard format (regulation marks H, I, J), each pinned
 * by a scenario test named after its Compendium id with a one-line summary in our own words (the ruling text stays on
 * compendium.pokegym.net). The cards are synthetic, with one-line scripts, unless a shipped card shows the rule best.
 *
 * Not pinned here, because they no longer apply or are not game rules a simulator plays: rulings 318 (a GX attack), 314 (asking
 * the opponent's leave to take back an illegal attack: the engine only offers legal ones) and 5 (announcing an Ability:
 * procedure). Ruling 787 (a card moved from the discard pile to the hand is revealed) applies but is not followed yet: a card
 * that an effect puts into the hand from the discard pile is not marked as known to the opponent (`PlayerState.revealed`).
 * Ruling 876 (also filed under Weakness and Resistance) is pinned in rulings-general-conditions.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardScript } from '../dsl.js';
import { FRAMES } from '../cards/frames-all.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import type { CardFrame, Decision } from '../types.js';
import { ASLEEP, POISONED } from '../types.js';
import { BIGEX, DOG, FIGHTING, PSYCHIC, PUP, deck, energy, pokemon } from './fixtures.js';

// ---------------------------------------------------------------------------------------------------------------- cards

function trainer(id: string, name: string, ttype: 'Item' | 'Supporter' | 'Tool', effect: string): CardFrame {
  return {
    cardId: id,
    name,
    category: 'Trainer',
    hp: null,
    stage: null,
    suffix: null,
    evolvesFrom: null,
    trainerType: ttype,
    energyType: null,
    retreat: null,
    types: [],
    effect,
    regulationMark: 'I',
    attacks: [],
    abilities: [],
    weaknesses: [],
    resistances: [],
  };
}

/** A synthetic Pokémon with effect text on its attacks and printed Abilities. */
function poke(
  id: string,
  name: string,
  o: Parameters<typeof pokemon>[2],
  attacks: [string, string, string | null, string | null][] = [],
  abilities: [string, string][] = [],
): CardFrame {
  const f = pokemon(id, name, { ...o, attacks: attacks.length ? attacks.map(([n, c, d]) => [n, c, d]) : o.attacks });
  attacks.forEach(([, , , text], i) => (f.attacks![i]!.effect = text));
  return { ...f, abilities: abilities.map(([n, effect]) => ({ kind: 'Ability', name: n, effect })) } as CardFrame;
}

const FIRE = energy('Fire');
const SEER = poke('ga-p01', 'Seer', { hp: 60 }, [], [['Peek', 'Once during your turn, you may draw a card.']]);
const KEEN = poke('ga-p02', 'Keen', { hp: 60 }, [], [['Restock', 'As often as you like during your turn, you may draw a card.']]);
const HERALD = poke('ga-p03', 'Herald', { hp: 60 }, [], [['Rally', 'Once during your turn, if this Pokémon is in the Active Spot, you may draw a card.']]);
const GREETER = poke('ga-p04', 'Greeter', { hp: 60 }, [], [['Warm Welcome', 'When you play this Pokémon from your hand onto your Bench during your turn, you may draw a card.']]);
const CRIER = poke('ga-p05', 'Crier', { hp: 60 }, [], [['Loud Arrival', 'When you play this Pokémon from your hand onto your Bench during your turn, draw a card.']]);
const SHELL = poke('ga-p06', 'Shell', { hp: 90 }, [], [['Harden Up', 'Once during your turn, you may use this Ability. During your opponent\'s next turn, this Pokémon takes 30 less damage from attacks.']]);
const SNIPER = poke('ga-p07', 'Sniper', { hp: 100, type: 'Psychic' }, [
  ['Snipe', 'Colorless', null, "This attack does 50 damage to 1 of your opponent's Pokémon."],
  ['Hex', 'Colorless', null, 'Put 3 damage counters on the Defending Pokémon.'],
  ['Mind Jab', 'Colorless', '30', null],
  ['Fist', 'Fighting', '30', null],
  ['Lock', 'Colorless', null, "During your opponent's next turn, the Defending Pokémon can't attack."],
  ['Toxic Mark', 'Colorless', null, "The Defending Pokémon is now Poisoned. During your opponent's next turn, it can't retreat."],
  ['Pierce', 'Colorless', '30', "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."],
]);
const BRUISER = poke('ga-p08', 'Bruiser', { hp: 120, type: 'Fighting', weak: 'Fighting' }, [
  ['Big Swing', 'Colorless', '60', "During your next turn, this Pokémon can't use Big Swing."],
  ['Reckless', 'Colorless', '30', 'This Pokémon also does 20 damage to itself.'],
  ['Stare', 'Colorless', null, "During your opponent's next turn, the Defending Pokémon can't retreat."],
  ['Coin Jab', 'Colorless', '20×', 'Flip 2 coins. This attack does 20 damage for each heads.'],
]);
const MIMIC = poke('ga-p09', 'Mimic', { hp: 100 }, [['Copycat', 'Colorless', null, "Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack."]]);
const FLAMER = poke('ga-p10', 'Flamer', { hp: 100, type: 'Fire' }, [['Flare', 'Fire', '20+', 'You may discard a Fire Energy from this Pokémon. If you do, this attack does 60 more damage.']]);
const WARDEN = poke('ga-p11', 'Warden', { hp: 120, weak: 'Psychic' }, [], [['Barrier', 'Prevent all damage done to this Pokémon by attacks.']]);
const THORNS = poke('ga-p12', 'Thorns', { hp: 120, weak: 'Psychic' }, [], [['Spikes', 'If this Pokémon is damaged by an attack, put 2 damage counters on the Attacking Pokémon.']]);
const HUMMER = poke('ga-p13', 'Hummer', { hp: 120, weak: 'Psychic' }, [], [['Clear Hum', 'This Pokémon has no Weakness.']]);
const WARD = poke('ga-p14', 'Ward', { hp: 120, resist: 'Psychic' }, [], [['Item Shield', 'Prevent all effects of Item cards your opponent plays done to this Pokémon.']]);
const SCARECROW = poke('ga-p15', 'Scarecrow', { hp: 200, weak: 'Fighting' });
const STURDY = poke('ga-p16', 'Sturdy', { hp: 200, weak: 'Fighting' }, [], [['Sturdy Body', 'This Pokémon takes 20 less damage from attacks.']]);
const BOOSTER = poke('ga-p17', 'Booster', { hp: 80, type: 'Fighting' }, [], [['Pep Talk', "Attacks used by your {F} Pokémon do 10 more damage to your opponent's Active Pokémon."]]);
const THRIFTY = poke('ga-p18', 'Thrifty', { hp: 100, attacks: [['Tap', 'Colorless,Colorless', '10']] }, [], [['Thrift', "This Pokémon's attacks cost {C} less."]]);
const TAXER = poke('ga-p19', 'Taxer', { hp: 100 }, [], [['Toll', "Attacks used by your opponent's Active Pokémon cost {C} more."]]);
const NETTER = poke('ga-p20', 'Netter', { hp: 100 }, [], [['Big Snare', "Your opponent's Active Pokémon's Retreat Cost is {C} more."]]);
const MOVER = poke('ga-p21', 'Mover', { hp: 80 }, [], [['Shift', 'Once during your turn, you may move 1 damage counter from your Active Pokémon to this Pokémon.']]);
const COLLECTOR = poke('ga-p22', 'Collector', { hp: 100 }, [
  ['Gather', 'Colorless', null, 'Search your deck for up to 2 Basic Energy cards and attach them to this Pokémon. Then, shuffle your deck.'],
  ['Pick', 'Colorless', null, 'Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.'],
]);

const SWAP = trainer('ga-t01', 'Swap', 'Item', 'Switch your Active Pokémon with 1 of your Benched Pokémon.');
const SCOUT = trainer('ga-t02', 'Scout', 'Item', 'Search your deck for a Basic Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.');
const RECALL = trainer('ga-t03', 'Recall', 'Item', 'Put a Pokémon from your discard pile into your hand.');
const REVIVE = trainer('ga-t04', 'Revive', 'Item', 'Put up to 2 Basic Pokémon from your discard pile onto your Bench.');
const RECLAIM = trainer('ga-t05', 'Reclaim', 'Item', 'Put up to 2 Basic Energy cards from your discard pile into your hand.');
const CYCLE = trainer('ga-t06', 'Cycle', 'Item', 'Discard any number of cards from your hand. Then, draw 2 cards.');
const JOLT = trainer('ga-t07', 'Jolt', 'Item', "You can use this card only if you discard another card from your hand. Put 2 damage counters on your opponent's Active Pokémon.");
const POTION = trainer('ga-t08', 'Potion', 'Item', 'Heal 30 damage from your Active Pokémon.');
const POWER_BAND = trainer('ga-t09', 'Power Band', 'Tool', "The attacks of the Pokémon this card is attached to do 30 more damage to your opponent's Active Pokémon.");
const GUARD_CHARM = trainer('ga-t10', 'Guard Charm', 'Tool', 'The Pokémon this card is attached to takes 30 less damage from attacks.');
const GLASS_CHARM = trainer('ga-t11', 'Glass Charm', 'Tool', 'The Pokémon this card is attached to takes 20 more damage from attacks.');
const CURSED_CHARM = trainer('ga-t12', 'Cursed Charm', 'Tool', "The Pokémon this card is attached to can't be healed.");
const RESCUE_PLANK = trainer('ga-t13', 'Rescue Plank', 'Tool', 'The Pokémon this card is attached to has no Retreat Cost.');
const LIGHT_BAND = trainer('ga-t14', 'Light Band', 'Tool', 'The Retreat Cost of the Pokémon this card is attached to is {C} less.');
const TM_STRIKE: CardFrame = {
  ...trainer('ga-t15', 'TM Strike', 'Tool', 'The Pokémon this card is attached to can use the attack on this card. (You still need the necessary Energy to use this attack.)'),
  attacks: [{ name: 'Tool Strike', cost: 'Colorless,Colorless', damage: '50', effect: null }],
};
const BOSS = FRAMES['me01-114']!; // Boss's Orders, the shipped card: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot."

const ME = 'self' as const;
const SCRIPTS: CardScript[] = [
  { id: 'ga-p01', name: 'Seer', abilities: [{ name: 'Peek', activated: { program: [{ op: 'draw', n: 1 }] } }] },
  { id: 'ga-p02', name: 'Keen', abilities: [{ name: 'Restock', activated: { program: [{ op: 'draw', n: 1 }], oncePerTurn: false } }] },
  { id: 'ga-p03', name: 'Herald', abilities: [{ name: 'Rally', activated: { program: [{ op: 'draw', n: 1 }], activeOnly: true } }] },
  { id: 'ga-p04', name: 'Greeter', abilities: [{ name: 'Warm Welcome', triggers: [{ on: 'playToBench', optional: true, program: [{ op: 'draw', n: 1 }] }] }] },
  { id: 'ga-p05', name: 'Crier', abilities: [{ name: 'Loud Arrival', triggers: [{ on: 'playToBench', program: [{ op: 'draw', n: 1 }] }] }] },
  {
    id: 'ga-p06',
    name: 'Shell',
    abilities: [{ name: 'Harden Up', activated: { program: [{ op: 'effect', static: { k: 'damageIn', amount: -30 }, on: ME, duration: 'oppNextTurn' }] } }],
  },
  {
    id: 'ga-p07',
    name: 'Sniper',
    attacks: {
      Snipe: { program: [{ op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' }, { op: 'damage', amount: 50, to: { v: 't' } }] },
      Hex: { program: [{ op: 'counters', n: 3, to: 'defender' }] },
      Lock: { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'defender', duration: 'oppNextTurn' }] },
      'Toxic Mark': {
        post: [
          { op: 'condition', cond: 'poisoned', to: 'defender' },
          { op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' },
        ],
      },
      Pierce: { ignore: { defenderEffects: true } },
    },
  },
  {
    id: 'ga-p08',
    name: 'Bruiser',
    attacks: {
      'Big Swing': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Big Swing' }, on: ME, duration: 'myNextTurn' }] },
      Reckless: { post: [{ op: 'damage', amount: 20, to: ME }] },
      Stare: { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
      'Coin Jab': { pre: [{ op: 'flip', n: 2, as: 'h' }], damage: { mul: [20, { v: 'h' }] } },
    },
  },
  {
    id: 'ga-p09',
    name: 'Mimic',
    attacks: {
      Copycat: {
        program: [
          { op: 'chooseSlots', from: 'oppActive', min: 1, max: 1, as: 't' },
          { op: 'custom', fn: 'slotTopCard', args: { from: 't', as: 'c' } },
          { op: 'useAttackOf', card: 'c' },
        ],
      },
    },
  },
  {
    id: 'ga-p10',
    name: 'Flamer',
    attacks: {
      Flare: {
        pre: [{ op: 'may', body: [{ op: 'discardEnergy', from: ME, count: 1, filter: { energyType: 'Fire' }, as: 'd' }] }],
        damage: { add: [20, { cond: { gte: [{ v: 'd' }, 1] }, then: 60, else: 0 }] },
      },
    },
  },
  { id: 'ga-p11', name: 'Warden', abilities: [{ name: 'Barrier', statics: [{ effect: { k: 'preventDamage' }, scope: 'self' }] }] },
  {
    id: 'ga-p12',
    name: 'Thorns',
    abilities: [{ name: 'Spikes', triggers: [{ on: 'damagedByAttack', program: [{ op: 'counters', n: 2, to: { v: '__attacker' } }] }] }],
  },
  { id: 'ga-p13', name: 'Hummer', abilities: [{ name: 'Clear Hum', statics: [{ effect: { k: 'noWeakness' }, scope: 'self' }] }] },
  { id: 'ga-p14', name: 'Ward', abilities: [{ name: 'Item Shield', statics: [{ effect: { k: 'preventTrainerEffects', from: ['item'] }, scope: 'self' }] }] },
  { id: 'ga-p16', name: 'Sturdy', abilities: [{ name: 'Sturdy Body', statics: [{ effect: { k: 'damageIn', amount: -20 }, scope: 'self' }] }] },
  {
    id: 'ga-p17',
    name: 'Booster',
    abilities: [{ name: 'Pep Talk', statics: [{ effect: { k: 'damageOut', amount: 10 }, scope: 'myPokemon', filter: { type: 'Fighting' } }] }],
  },
  { id: 'ga-p18', name: 'Thrifty', abilities: [{ name: 'Thrift', statics: [{ effect: { k: 'attackCostC', delta: -1 }, scope: 'self' }] }] },
  { id: 'ga-p19', name: 'Taxer', abilities: [{ name: 'Toll', statics: [{ effect: { k: 'attackCostC', delta: 1 }, scope: 'oppActive' }] }] },
  { id: 'ga-p20', name: 'Netter', abilities: [{ name: 'Big Snare', statics: [{ effect: { k: 'retreatCost', delta: 1 }, scope: 'oppActive' }] }] },
  {
    id: 'ga-p21',
    name: 'Mover',
    abilities: [
      {
        name: 'Shift',
        activated: {
          program: [
            { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'from' },
            { op: 'chooseSlots', from: 'myBench', filter: { name: 'Mover' }, min: 1, max: 1, as: 'to' },
            { op: 'custom', fn: 'moveCounters', args: { from: 'from', to: 'to', max: 1 } },
          ],
        },
      },
    ],
  },
  {
    id: 'ga-p22',
    name: 'Collector',
    attacks: {
      Gather: {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { basicEnergy: true }, min: 0, max: 2, as: 'e' },
          { op: 'attach', cards: 'e', to: ME },
          { op: 'shuffle' },
        ],
      },
      Pick: { program: [{ op: 'chooseCards', from: 'deck', min: 1, max: 2, as: 'x' }, { op: 'move', cards: 'x', to: 'hand' }, { op: 'shuffle' }] },
    },
  },
  { id: 'ga-t01', name: 'Swap', playable: { gte: [{ pokemon: { zone: 'myBench' } }, 1] }, play: [{ op: 'switch', who: ME }] },
  {
    id: 'ga-t02',
    name: 'Scout',
    play: [
      { op: 'chooseCards', from: 'deck', filter: { cat: 'pokemon', stage: 'basic' }, min: 0, max: 1, as: 'found', reveal: true },
      { op: 'move', cards: 'found', to: 'hand' },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'ga-t03',
    name: 'Recall',
    playable: { gte: [{ count: { zone: 'discard', filter: { cat: 'pokemon' } } }, 1] },
    play: [{ op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon' }, min: 1, max: 1, as: 'x' }, { op: 'move', cards: 'x', to: 'hand' }],
  },
  {
    id: 'ga-t04',
    name: 'Revive',
    playable: { gte: [{ count: { zone: 'discard', filter: { cat: 'pokemon', stage: 'basic' } } }, 1] },
    play: [{ op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon', stage: 'basic' }, min: 1, max: 2, as: 'x' }, { op: 'move', cards: 'x', to: 'bench' }],
  },
  {
    id: 'ga-t05',
    name: 'Reclaim',
    playable: { gte: [{ count: { zone: 'discard', filter: { basicEnergy: true } } }, 1] },
    play: [{ op: 'chooseCards', from: 'discard', filter: { basicEnergy: true }, min: 1, max: 2, as: 'x' }, { op: 'move', cards: 'x', to: 'hand' }],
  },
  {
    id: 'ga-t06',
    name: 'Cycle',
    play: [{ op: 'chooseCards', from: 'hand', min: 0, max: 60, as: 'x', others: true }, { op: 'move', cards: 'x', to: 'discard' }, { op: 'draw', n: 2 }],
  },
  {
    id: 'ga-t07',
    name: 'Jolt',
    playable: { gte: [{ handSize: ME }, 2] },
    play: [
      { op: 'chooseCards', from: 'hand', min: 1, max: 1, as: 'cost', others: true },
      { op: 'move', cards: 'cost', to: 'discard' },
      { op: 'counters', n: 2, to: 'oppActive' },
    ],
  },
  { id: 'ga-t08', name: 'Potion', play: [{ op: 'heal', amount: 30, to: 'myActive' }] },
  { id: 'ga-t09', name: 'Power Band', statics: [{ effect: { k: 'damageOut', amount: 30 }, scope: 'self' }] },
  { id: 'ga-t10', name: 'Guard Charm', statics: [{ effect: { k: 'damageIn', amount: -30 }, scope: 'self' }] },
  { id: 'ga-t11', name: 'Glass Charm', statics: [{ effect: { k: 'damageIn', amount: 20 }, scope: 'self' }] },
  { id: 'ga-t12', name: 'Cursed Charm', statics: [{ effect: { k: 'noHeal' }, scope: 'self' }] },
  { id: 'ga-t13', name: 'Rescue Plank', statics: [{ effect: { k: 'retreatCost', set: 0 }, scope: 'self' }] },
  { id: 'ga-t14', name: 'Light Band', statics: [{ effect: { k: 'retreatCost', delta: -1 }, scope: 'self' }] },
  { id: 'ga-t15', name: 'TM Strike', statics: [{ effect: { k: 'grantsAttacks' }, scope: 'self' }] },
];

const DK = deck('General rulings', [
  [PUP, 10],
  [DOG, 3],
  [BIGEX, 2],
  ...[SEER, KEEN, HERALD, GREETER, CRIER, SHELL, SNIPER, BRUISER, MIMIC, FLAMER, WARDEN, THORNS, HUMMER, WARD, SCARECROW, STURDY, BOOSTER, THRIFTY, TAXER, NETTER, MOVER, COLLECTOR].map(
    (f): [CardFrame, number] => [f, 3],
  ),
  ...[SWAP, SCOUT, RECALL, REVIVE, RECLAIM, CYCLE, JOLT, POTION, POWER_BAND, GUARD_CHARM, GLASS_CHARM, CURSED_CHARM, RESCUE_PLANK, LIGHT_BAND, TM_STRIKE, BOSS].map(
    (f): [CardFrame, number] => [f, 3],
  ),
  [FIGHTING, 16],
  [PSYCHIC, 12],
  [FIRE, 6],
]);

const F = 'Fighting Energy';
const P = 'Psychic Energy';
const R = 'Fire Energy';

function at(sides: [SideLayout, SideLayout], o: ScenarioOptions = {}): Game {
  return scenario(DK, DK, sides, { scripts: SCRIPTS, ...o });
}
function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function has(g: Game, text: string): boolean {
  return labels(g).some((l) => l.includes(text));
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
/** Choose the option whose label is exactly `text` (two Pokémon of one name: "Shell (Active)" and "Shell"). */
function chooseExact(g: Game, text: string): void {
  const i = labels(g).indexOf(text);
  assert.ok(i >= 0, `no option "${text}" in: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
function nameOf(g: Game, card: number): string {
  return g.ctx.defs[g.ctx.cardDef[card]!]!.name;
}
const names = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();

// ------------------------------------------------------------------------------------------------- Abilities in general

test('Compendium #1: a Benched Pokémon can use its Ability', () => {
  const g = at([{ active: 'Pup', bench: ['Seer'] }, { active: 'Pup' }]);
  const hand = g.state.p[0].hand.length;
  choose(g, 'Use Peek (Seer)');
  assert.equal(g.state.p[0].hand.length, hand + 1);
});

test('Compendium #2: when and how often an Ability can be used comes from its own text', () => {
  const g = at([{ active: 'Pup', bench: ['Seer', 'Keen', 'Herald'] }, { active: 'Pup' }]);
  choose(g, 'Use Peek');
  assert.ok(!has(g, 'Use Peek'), '"once during your turn": not a second time');
  choose(g, 'Use Restock');
  choose(g, 'Use Restock');
  assert.ok(has(g, 'Use Restock'), '"as often as you like": still offered after two uses');
  assert.ok(!has(g, 'Use Rally'), 'an Ability for the Active Spot only is not offered on the Bench');
  const a = at([{ active: 'Herald' }, { active: 'Pup' }]);
  assert.ok(has(a, 'Use Rally (Herald (Active))'));
});

test('Compendium #3: no Ability can be used while another effect is still resolving', () => {
  const g = at([{ active: 'Pup', bench: ['Seer'], hand: ['Scout'] }, { active: 'Pup' }]);
  assert.ok(has(g, 'Use Peek'));
  choose(g, 'Play Scout');
  assert.equal(g.decision?.kind, 'cards', "Scout's search is waiting for a choice");
  assert.equal(g.decision?.actions, undefined, 'no turn actions in the middle of an effect');
  assert.ok(!has(g, 'Use Peek'));
  g.submit([]);
  assert.equal(g.decision?.kind, 'main');
  assert.ok(has(g, 'Use Peek'), 'once the effect is done, the Ability can be used');
});

test('Compendium #4: two Pokémon with the same once-per-turn Ability can each use it', () => {
  const g = at([{ active: 'Seer', bench: ['Seer'] }, { active: 'Pup' }]);
  const peeks = (): string[] => labels(g).filter((l) => l.startsWith('Use Peek'));
  assert.deepEqual(peeks(), ['Use Peek (Seer (Active))', 'Use Peek (Seer)']);
  choose(g, 'Use Peek (Seer (Active))');
  assert.deepEqual(peeks(), ['Use Peek (Seer)'], 'the other Seer still has its own use');
  choose(g, 'Use Peek (Seer)');
  assert.deepEqual(peeks(), []);
});

// --------------------------------------------------------------------------------------------------- Attacks in general

test('Compendium #313: a Pokémon put into play this turn can attack once it is Active with the Energy it needs', () => {
  const g = at([{ active: 'Pup', energy: { active: [F] }, hand: ['Pup', F] }, { active: 'Dog' }]);
  choose(g, 'Bench Pup');
  choose(g, 'Retreat');
  assert.equal(g.state.p[0].active!.enteredTurn, g.state.turn, 'the new Active Pokémon was benched this turn');
  choose(g, 'Attach Fighting Energy to Pup (Active)');
  choose(g, 'Attack: Bite');
  assert.equal(g.state.p[1].active!.damage, 20);
});

test('Compendium #315: Weakness and Resistance are not applied to damage done to Benched Pokémon', () => {
  const snipe = (target: string): Game => {
    const g = at([{ active: 'Sniper', energy: { active: [P] } }, { active: 'Dog', bench: ['Pup', 'Ward'] }]);
    choose(g, 'Attack: Snipe');
    choose(g, target);
    return g;
  };
  assert.equal(snipe('Dog (Active)').state.p[1].active!.damage, 100, 'control: the Active Dog is Weak to {P}');
  assert.equal(snipe('Pup').state.p[1].bench[0]!.damage, 50, 'a Benched Pokémon Weak to {P} takes 50');
  assert.equal(snipe('Ward').state.p[1].bench[1]!.damage, 50, 'a Benched Pokémon that resists {P} takes 50');
});

test("Compendium #316: an effect from the attacker's side adds its damage before Weakness, the Defending Pokémon's own effect applies after", () => {
  const run = (bench: string[]): number => {
    const g = at([{ active: 'Pup', bench, energy: { active: [F, F] } }, { active: 'Sturdy' }]);
    choose(g, 'Attack: Headbutt');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([]), 80, '50 x2, then 20 less');
  assert.equal(run(['Booster']), 100, '(50 + 10 from Pep Talk) x2, then 20 less');
});

test('Compendium #317: "can\'t use this attack next turn" ends when the Pokémon goes to the Bench, but a used Ability stays used', () => {
  const g = at([{ active: 'Bruiser', energy: { active: [F] }, bench: ['Pup'], hand: ['Swap', 'Swap'] }, { active: 'Dog' }]);
  choose(g, 'Attack: Big Swing');
  choose(g, 'End turn'); // the opponent's turn
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack: Big Swing') && has(g, 'Attack: Reckless'), 'locked during the next turn');
  choose(g, 'Play Swap');
  choose(g, 'Play Swap');
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Bruiser');
  assert.ok(has(g, 'Attack: Big Swing'), 'the attack effect ended when it was moved to the Bench');

  const a = at([{ active: 'Seer', bench: ['Pup'], hand: ['Swap'] }, { active: 'Pup' }]);
  choose(a, 'Use Peek');
  choose(a, 'Play Swap');
  assert.equal(nameOf(a, a.state.p[0].bench[0]!.cards[0]!), 'Seer');
  assert.ok(!has(a, 'Use Peek'), 'moving to the Bench does not give it another use this turn');
});

test("Compendium #319: attacking is always optional, even with the Energy for it", () => {
  const g = at([{ active: 'Pup', energy: { active: [F, F] } }, { active: 'Dog' }]);
  assert.ok(has(g, 'Attack: Bite') && has(g, 'Attack: Headbutt') && has(g, 'End turn'));
  choose(g, 'End turn');
  assert.equal(g.state.current, 1);
  assert.equal(g.state.p[1].active!.damage, 0);
});

test('Compendium #320: damage counters an attack puts on a Pokémon ignore Weakness and damage prevention, and are not damage for "if damaged" effects', () => {
  const run = (target: string, attack: string): Game => {
    const g = at([{ active: 'Sniper', energy: { active: [P] } }, { active: target }]);
    choose(g, `Attack: ${attack}`);
    return g;
  };
  assert.equal(run('Warden', 'Hex').state.p[1].active!.damage, 30, 'not doubled for Weakness, not stopped by Barrier');
  assert.equal(run('Warden', 'Mind Jab').state.p[1].active!.damage, 0, 'control: Barrier prevents attack damage');
  const hex = run('Thorns', 'Hex');
  assert.equal(hex.state.p[1].active!.damage, 30);
  assert.equal(hex.state.p[0].active!.damage, 0, 'Spikes does not react to damage counters');
  const jab = run('Thorns', 'Mind Jab');
  assert.equal(jab.state.p[1].active!.damage, 60, 'control: 30 x2 for Weakness');
  assert.equal(jab.state.p[0].active!.damage, 20, 'control: Spikes reacts to damage');
});

test("Compendium #322: an attack is of the attacking Pokémon's type, whatever Energy it costs", () => {
  const run = (target: string): number => {
    const g = at([{ active: 'Sniper', energy: { active: [F] } }, { active: target }]);
    choose(g, 'Attack: Fist');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run('Pup'), 60, 'a {P} Pokémon paying {F}: Weakness to {P} applies');
  assert.equal(run('Scarecrow'), 30, 'Weakness to {F} does not');
});

test("Compendium #323: the Defending Pokémon is the opponent's Active Pokémon at the time of the attack", () => {
  const g = at([{ active: 'Sniper', energy: { active: [P] } }, { active: 'Pup', bench: ['Pup'], energy: { active: [F], 0: [F] } }]);
  choose(g, 'Attack: Lock');
  assert.equal(g.decision?.player, 1);
  assert.ok(!has(g, 'Attack'), 'the Active Pup was the Defending Pokémon: it cannot attack');
  choose(g, 'Retreat');
  assert.ok(has(g, 'Attack: Bite'), 'the Pup that was on the Bench was not the Defending Pokémon');
});

test('Compendium #324: damage an attack does to the attacker itself is attack damage (its Weakness and its damage reduction apply)', () => {
  const run = (tools: string[]): number => {
    const g = at([{ active: 'Bruiser', energy: { active: [F] }, tools: { active: tools } }, { active: 'Dog' }]);
    choose(g, 'Attack: Reckless');
    assert.equal(g.state.p[1].active!.damage, 30);
    return g.state.p[0].active!.damage;
  };
  assert.equal(run([]), 40, 'Bruiser is Weak to {F}: its own 20 becomes 40');
  assert.equal(run(['Guard Charm']), 10, '"takes 30 less damage from attacks" reduces it: 40 - 30');
});

test('Compendium #325: attacking does not use up Energy; it stays attached unless the attack says to discard it', () => {
  const g = at([{ active: 'Pup', energy: { active: [F] } }, { active: 'Dog' }]);
  choose(g, 'Attack: Bite');
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [F]);
  assert.deepEqual(g.state.p[0].discard, []);
});

test("Compendium #327: a copied attack's optional discard bonus needs the copier to make the discard; otherwise only the base attack happens", () => {
  const run = (energy: string[]): Game => {
    const g = at([{ active: 'Mimic', energy: { active: energy } }, { active: 'Flamer', energy: { active: [R] } }]);
    choose(g, 'Attack: Copycat');
    if (g.decision?.kind === 'yesno') choose(g, 'Yes');
    return g;
  };
  const none = run([P]);
  assert.equal(none.state.p[1].active!.damage, 20, 'no Fire Energy on Mimic: only the base 20');
  assert.deepEqual(names(none, none.state.p[0].active!.energy), [P]);
  assert.equal(none.state.p[1].active!.energy.length, 1, "the original's Fire Energy is not Mimic's to discard");
  const fire = run([R]);
  assert.equal(fire.state.p[1].active!.damage, 80, 'Mimic discards its own Fire Energy: 20 + 60');
  assert.equal(fire.state.p[0].active!.energy.length, 0);
});

// ------------------------------------------------------------------------------------------------------- Meta-rulings

test('Compendium #890: a copying attack can only choose attacks printed on the Pokémon, not ones it has from a Tool', () => {
  const own = at([{ active: 'Pup', tools: { active: ['TM Strike'] }, energy: { active: [F, F] } }, { active: 'Pup' }]);
  assert.ok(has(own, 'Attack: Tool Strike'), 'control: the Pup itself can use the Tool attack');
  const g = at([{ active: 'Mimic', energy: { active: [P] } }, { active: 'Pup', tools: { active: ['TM Strike'] } }]);
  choose(g, 'Attack: Copycat');
  assert.deepEqual(labels(g), ['Bite', 'Headbutt']);
});

test('Compendium #891: a Pokémon moved to the Bench loses its Special Conditions and the effects of attacks on it', () => {
  const g = at([{ active: 'Sniper', energy: { active: [P] } }, { active: 'Pup', bench: ['Dog'], energy: { active: [F] }, hand: ['Swap', 'Swap'] }]);
  choose(g, 'Attack: Toxic Mark');
  const pup = g.state.p[1].active!;
  assert.ok(pup.cond & POISONED);
  assert.ok(!has(g, 'Retreat'), "the attack's effect: it can't retreat");
  choose(g, 'Play Swap');
  assert.equal(g.state.p[1].bench[0], pup);
  assert.equal(pup.cond, 0, 'no longer Poisoned');
  assert.deepEqual(g.state.effects.filter((x) => x.slot === pup.id), [], 'the attack effect is gone');
  choose(g, 'Play Swap');
  assert.equal(g.state.p[1].active, pup);
  assert.ok(has(g, 'Retreat'), 'back in the Active Spot, it can retreat');
});

test('Compendium #892: no more than 6 Pokémon in play (Active plus a Bench of 5) unless a card allows it', () => {
  const g = at([{ active: 'Pup', bench: ['Pup', 'Pup', 'Pup', 'Pup'], hand: ['Pup', 'Revive'], discard: ['Pup', 'Pup'] }, { active: 'Pup' }]);
  assert.ok(has(g, 'Bench Pup'));
  choose(g, 'Play Revive');
  g.submit([0, 1]);
  assert.equal(g.state.p[0].bench.length, 5, 'only one of the two fits');
  assert.deepEqual(names(g, g.state.p[0].discard), ['Pup', 'Revive']);
  assert.ok(!has(g, 'Bench Pup'), 'a full Bench takes no more');
});

test('Compendium #893: after a Knock Out the new Active Pokémon is chosen at once, before Pokémon Checkup', () => {
  const g = at([{ active: 'Pup', energy: { active: [F] }, cond: POISONED }, { active: 'Pup', bench: ['Pup', 'Dog'], damage: { active: 60 } }]);
  choose(g, 'Attack: Bite');
  assert.equal(g.decision?.kind, 'promote');
  assert.equal(g.decision?.player, 1);
  assert.equal(g.state.p[0].active!.damage, 0, 'Checkup has not happened yet');
  choose(g, 'Dog');
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), 'Dog');
  assert.equal(g.state.p[0].active!.damage, 10, 'then Checkup: Poison');
  assert.equal(g.state.current, 1);
});

test('Compendium #894: an attack that does no damage gets none of the "more damage" effects', () => {
  const run = (attack: string, coins: boolean[] = []): number => {
    const g = at([{ active: 'Bruiser', energy: { active: [F] }, tools: { active: ['Power Band'] } }, { active: 'Dog' }]);
    g.state.forcedCoins = coins;
    choose(g, `Attack: ${attack}`);
    return g.state.p[1].active!.damage;
  };
  assert.equal(run('Stare'), 0, 'no damage printed: Power Band adds nothing');
  assert.equal(run('Coin Jab', [false, false]), 0, '0 heads: 0 damage, nothing added');
  assert.equal(run('Coin Jab', [true, false]), 50, 'control: 20 + 30');
});

test('Compendium #895: in a copied attack, "this Pokémon" is the Pokémon using the copy', () => {
  const g = at([{ active: 'Mimic', energy: { active: [P] } }, { active: 'Bruiser' }]);
  choose(g, 'Attack: Copycat');
  choose(g, 'Reckless');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.equal(g.state.p[0].active!.damage, 20, 'the 20 to "itself" goes on Mimic');
});

test("Compendium #896: an Ability's effect on a Pokémon does not end when the Pokémon moves between the Active Spot and the Bench", () => {
  const run = (harden: boolean): number => {
    const g = at([{ active: 'Shell', bench: ['Pup'], energy: { active: [F] } }, { active: 'Sniper', energy: { active: [P] } }]);
    const shell = g.state.p[0].active!;
    if (harden) choose(g, 'Use Harden Up');
    choose(g, 'Retreat');
    assert.equal(g.state.p[0].bench[0], shell);
    if (harden) assert.equal(g.state.effects.filter((x) => x.slot === shell.id).length, 1, 'still there after retreating');
    choose(g, 'End turn');
    choose(g, 'Attack: Snipe');
    choose(g, 'Shell');
    return shell.damage;
  };
  assert.equal(run(false), 50, 'control');
  assert.equal(run(true), 20, 'Harden Up still reduces the damage on the Bench');
});

test('Compendium #897: effects on the attacking Pokémon apply before Weakness and Resistance, effects on the Defending Pokémon after', () => {
  const g = at([{ active: 'Pup', energy: { active: [F] }, tools: { active: ['Power Band'] } }, { active: 'Scarecrow', tools: { active: ['Guard Charm'] } }]);
  choose(g, 'Attack: Bite');
  assert.equal(g.state.p[1].active!.damage, 70, '(20 + 30) x2 - 30');
});

test('Compendium #898: a Pokémon that can\'t be healed can still have its damage counters moved off it', () => {
  const g = at([{ active: 'Pup', bench: ['Mover'], damage: { active: 30 }, tools: { active: ['Cursed Charm'] }, hand: ['Potion'] }, { active: 'Pup' }]);
  choose(g, 'Play Potion');
  assert.equal(g.state.p[0].active!.damage, 30, 'control: it cannot be healed');
  choose(g, 'Use Shift');
  assert.equal(g.state.p[0].active!.damage, 20, 'one counter moved off it');
  assert.equal(g.state.p[0].bench[0]!.damage, 10);
});

test('Compendium #899: a Retreat Cost an effect sets to 0 can\'t be raised; one reduced to 0 can', () => {
  const plank = at([{ active: 'Pup', bench: ['Pup'], tools: { active: ['Rescue Plank'] } }, { active: 'Netter' }]);
  assert.ok(has(plank, 'Retreat'), '"has no Retreat Cost": Big Snare does not raise it');
  const band = at([{ active: 'Pup', bench: ['Pup'], tools: { active: ['Light Band'] } }, { active: 'Netter' }]);
  assert.ok(!has(band, 'Retreat'), '1 - 1 = 0, and Big Snare makes it 1');
  const free = at([{ active: 'Pup', bench: ['Pup'], tools: { active: ['Light Band'] } }, { active: 'Pup' }]);
  assert.ok(has(free, 'Retreat'), 'control: 0 without Big Snare');
  const paid = at([{ active: 'Pup', bench: ['Pup'], tools: { active: ['Light Band'] }, energy: { active: [F] } }, { active: 'Netter' }]);
  choose(paid, 'Retreat');
  assert.deepEqual(names(paid, paid.state.p[0].discard), [F], 'it retreats for 1 Energy');
});

test('Compendium #900: game actions the rules require happen without being asked (taking a Prize card, the Asleep check)', () => {
  const g = at([{ active: 'Pup', energy: { active: [F] } }, { active: 'Pup', bench: ['Pup'], damage: { active: 60 } }]);
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Bite');
  assert.equal(g.state.p[0].prizesTaken, 1);
  assert.equal(g.state.p[0].hand.length, hand + 1, 'the Prize card is in the hand');
  assert.equal(g.decision?.kind, 'main', 'no decision about it: straight to the next turn');
  assert.equal(g.state.current, 1);
  const s = at([{ active: 'Pup' }, { active: 'Pup', cond: ASLEEP }]);
  s.state.forcedCoins = [true];
  choose(s, 'End turn');
  assert.equal(s.state.p[1].active!.cond & ASLEEP, 0, 'the Asleep flip is made at Checkup');
});

test('Compendium #901: damage counters are not damage: effects that add to or reduce damage do not change them', () => {
  const run = (tool: string, attack: string): number => {
    const g = at([{ active: 'Sniper', energy: { active: [P] }, tools: { active: ['Power Band'] } }, { active: 'Big ex', tools: { active: [tool] } }]);
    choose(g, `Attack: ${attack}`);
    return g.state.p[1].active!.damage;
  };
  assert.equal(run('Glass Charm', 'Mind Jab'), 80, 'control: 30 + 30 + 20');
  assert.equal(run('Glass Charm', 'Hex'), 30, '3 counters, no more');
  assert.equal(run('Guard Charm', 'Hex'), 30, '3 counters, no fewer');
});

test('Compendium #902: an Ability\'s "this Pokémon" is that one Pokémon, not another in play with the same name', () => {
  const run = (target: string): number => {
    const g = at([{ active: 'Shell', bench: ['Shell'] }, { active: 'Sniper', energy: { active: [P] } }]);
    choose(g, 'Use Harden Up (Shell (Active))');
    choose(g, 'End turn');
    choose(g, 'Attack: Snipe');
    chooseExact(g, target);
    return target === 'Shell' ? g.state.p[0].bench[0]!.damage : g.state.p[0].active!.damage;
  };
  assert.equal(run('Shell (Active)'), 20, 'the Shell that used Harden Up');
  assert.equal(run('Shell'), 50, 'the other Shell is not protected');
});

test('Compendium #903: a search of the deck for a kind of card may find nothing, even when such a card is there', () => {
  const g = at([{ active: 'Pup', hand: ['Scout'] }, { active: 'Pup' }]);
  const basics = (): number => g.state.p[0].deck.filter((c) => g.ctx.defs[g.ctx.cardDef[c]!]!.kind === 'pokemon' && g.ctx.defs[g.ctx.cardDef[c]!]!.stage === 0).length;
  const before = basics();
  assert.ok(before > 0);
  choose(g, 'Play Scout');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.min, 0, 'the player may take none');
  g.submit([]);
  assert.deepEqual(g.state.p[0].hand, []);
  assert.equal(basics(), before);
});

test('Compendium #904: the game does not remember what a search found: after finding nothing, the same search can be made again', () => {
  // Every Basic Pokémon of this deck is in play: the deck holds none.
  const D = deck('No Basics left', [[PUP, 4], [DOG, 4], [SCOUT, 4], [FIGHTING, 48]]);
  const g = scenario(D, D, [{ active: 'Pup', bench: ['Pup', 'Pup', 'Pup'], hand: ['Scout', 'Scout'] }, { active: 'Pup' }], { scripts: SCRIPTS });
  choose(g, 'Play Scout');
  assert.equal(g.decision?.kind, 'main', 'nothing to find');
  assert.ok(has(g, 'Play Scout'), 'the second Scout can still be played');
  choose(g, 'Play Scout');
  assert.deepEqual(names(g, g.state.p[0].discard), ['Scout', 'Scout']);
});

test('Compendium #905: an effect is optional only when its text says so ("you may"); otherwise it must happen', () => {
  const g = at([{ active: 'Pup', hand: ['Greeter', 'Crier'] }, { active: 'Pup' }]);
  choose(g, 'Bench Crier');
  assert.equal(g.decision?.kind, 'main', 'Loud Arrival is not offered: it just happens');
  assert.equal(g.state.p[0].hand.length, 2, 'Crier left the hand and a card was drawn');
  choose(g, 'Bench Greeter');
  assert.equal(g.decision?.kind, 'yesno', 'Warm Welcome says "you may"');
  choose(g, 'No');
  assert.equal(g.state.p[0].hand.length, 1);
});

test('Compendium #906: a card with no valid target can\'t be played; one whose effect is blocked is still played, its cost paid and the card discarded', () => {
  const boss = at([{ active: 'Pup', hand: ["Boss's Orders"] }, { active: 'Pup' }]);
  assert.ok(!has(boss, "Play Boss's Orders"), 'no Benched Pokémon to switch in');
  const ok = at([{ active: 'Pup', hand: ["Boss's Orders"] }, { active: 'Pup', bench: ['Dog'] }]);
  assert.ok(has(ok, "Play Boss's Orders"));

  const g = at([{ active: 'Pup', hand: ['Jolt', F] }, { active: 'Ward' }]);
  choose(g, 'Play Jolt');
  assert.equal(g.state.p[1].active!.damage, 0, "Item Shield prevents Jolt's counters");
  assert.deepEqual(g.state.p[0].hand, []);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, 'Jolt'], 'the cost was paid and Jolt was discarded');
  const c = at([{ active: 'Pup', hand: ['Jolt', F] }, { active: 'Pup' }]);
  choose(c, 'Play Jolt');
  assert.equal(c.state.p[1].active!.damage, 20, 'control');
});

test('Compendium #1799: an effect that changes attack costs also changes the cost of an attack the Pokémon has from a Tool', () => {
  const g = at([{ active: 'Thrifty', tools: { active: ['TM Strike'] }, energy: { active: [P] } }, { active: 'Big ex' }]);
  assert.ok(has(g, 'Attack: Tap') && has(g, 'Attack: Tool Strike'), "Thrift takes {C} off the Tool's {C}{C} too");
  choose(g, 'Attack: Tool Strike');
  assert.equal(g.state.p[1].active!.damage, 50);
  const pup = at([{ active: 'Pup', tools: { active: ['TM Strike'] }, energy: { active: [F] } }, { active: 'Big ex' }]);
  assert.ok(!has(pup, 'Attack: Tool Strike'), 'control: {C}{C} with one Energy');
  const tax = at([{ active: 'Pup', tools: { active: ['TM Strike'] }, energy: { active: [F, F] } }, { active: 'Taxer' }]);
  assert.ok(has(tax, 'Attack: Bite'), 'Toll: Bite costs {C}{C}');
  assert.ok(!has(tax, 'Attack: Tool Strike'), 'Toll raises the Tool attack to {C}{C}{C}');
});

test('Compendium #2301: "up to" is 0 to the number on an attack and 1 to the number on a Trainer; "any number" allows 0; a search for any card at all takes at least 1', () => {
  const gather = at([{ active: 'Collector', energy: { active: [P] } }, { active: 'Pup' }]);
  choose(gather, 'Attack: Gather');
  assert.deepEqual([gather.decision?.min, gather.decision?.max], [0, 2], 'attack: up to 2 is 0 to 2');
  const reclaim = at([{ active: 'Pup', hand: ['Reclaim'], discard: [F, F, P] }, { active: 'Pup' }]);
  choose(reclaim, 'Play Reclaim');
  assert.deepEqual([reclaim.decision?.min, reclaim.decision?.max], [1, 2], 'Trainer: up to 2 is 1 to 2');
  const cycle = at([{ active: 'Pup', hand: ['Cycle', F, P] }, { active: 'Pup' }]);
  choose(cycle, 'Play Cycle');
  assert.equal(cycle.decision?.min, 0, '"any number" includes none');
  const pick = at([{ active: 'Collector', energy: { active: [P] } }, { active: 'Pup' }]);
  choose(pick, 'Attack: Pick');
  assert.deepEqual([pick.decision?.min, pick.decision?.max], [1, 2], 'any card at all: at least 1, even on an attack');
});

test('Compendium #787: a card put into the hand from the discard pile is shown to the opponent', () => {
  const g = at([{ active: 'Pup', hand: ['Recall'], discard: ['Dog'] }, { active: 'Pup' }]);
  const dog = g.state.p[0].discard.find((c) => nameOf(g, c) === 'Dog')!;
  choose(g, 'Play Recall');
  assert.ok(g.state.p[0].hand.includes(dog));
  assert.ok(g.state.p[0].revealed.includes(dog), 'it came from a face-up pile: the opponent knows it is in the hand');
});
