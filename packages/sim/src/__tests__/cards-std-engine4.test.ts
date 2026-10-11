/**
 * Card tests, batch "std-engine4": every card scripted in cards/scripts/std-engine4.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 * The engine features themselves are tested in engine-features-4.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript, Program, StaticEffect } from '../dsl.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { scenario } from '../scenario.js';
import { findSlot } from '../state.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';

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
/** The legal actions were listed when the position was built: list them again after changing it by hand. */
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const names = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c));
const benchNames = (g: Game, p: 0 | 1): string[] => g.state.p[p].bench.map((b) => nameOf(g, b.cards[b.cards.length - 1]!));
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = false): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack, src: 0 });
}
/** Put the Stadium card from this player's deck into play, as if that player had played it. */
function stadium(g: Game, name: string, owner: 0 | 1 = 0): number {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in P${owner + 1}'s deck`);
  const card = dk.splice(i, 1)[0] as number;
  g.state.stadium = { card, owner };
  return card;
}
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  'Area Zero Underdepths': 'sv07-131',
  'Gravity Mountain': 'sv08-177',
  'Festival Grounds': 'sv06-149',
  'Jamming Tower': 'sv06-153',
  'Archaludon ex': 'sv08-130',
  Duraludon: 'sv08-129',
  'Sparkling Crystal': 'sv07-142',
  'Technical Machine: Fluorite': 'sv08-188',
  'Core Memory': 'me03-070',
  'Mega Zygarde ex': 'me03-047',
  Dipplin: 'sv06-018',
  Swirlix: 'sv06-089',
  Goldeen: 'sv06-044',
  Seaking: 'sv08.5-021',
  'Chi-Yu': 'me01-031',
  Copperajah: 'sv06.5-042',
  'Scream Tail ex': 'sv06-094',
  Genesect: 'sv06.5-040',
  Bronzong: 'sv05-069',
  'Antique Sail Fossil': 'me03-069',
  Fraxure: 'sv06.5-045',
  Rhyperior: 'sv07-076',
  'Occa Berry': 'sv07-140',
  'Payapa Berry': 'sv07-141',
  'Babiri Berry': 'sv08-163',
  'Colbur Berry': 'sv08-168',
  'Passho Berry': 'sv08-184',
  'Orthworm ex': 'sv07-110',
  'Pikachu ex': 'sv08.5-028', // Tera, 190 HP
  'Eevee ex': 'sv08.5-075', // Tera, 200 HP
  'Tatsugiri ex': 'sv08-142', // Tera, 160 HP; Surprise Pump {R}{W} 100
  Dreepy: 'sv06-128', // 70 HP, no Weakness
  Drakloak: 'sv06-129',
  'Dragapult ex': 'sv06-130', // 320 HP, no Weakness
  Chikorita: 'me01-008', // Fire-weak
  "N's Darumaka": 'me02.5-032', // Fire; Rolling Tackle {C}{C} 20
  "N's Zorua": 'sv09-097', // Darkness, Grass-weak; Scratch {D} 20
  Togepi: 'me02.5-080', // Psychic; Pound {C}{C} 30
  Beldum: 'me04-059', // Metal; Headbutt {M} 10
  Lotad: 'sv09-035', // Water; Water Gun {W} 20
  Tauros: 'sv07-112',
  'Flutter Mane': 'sv05-078',
  Kieran: 'sv06-154',
  Switch: 'me01-130',
  "Boss's Orders": 'me01-114',
  'Rare Candy': 'me01-125',
  "Hero's Cape": 'sv05-152',
  'Prime Catcher': 'sv05-157',
  'Adversity Policy': 'me04-074',
};
/** A test deck of the named cards (10 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('engine4', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const MET = 'Metal Energy';
const FIR = 'Fire Energy';
const WAT = 'Water Energy';
const PSY = 'Psychic Energy';
const GRA = 'Grass Energy';
const DAR = 'Darkness Energy';
const FIG = 'Fighting Energy';

/** A Supporter / Item that does these things to the opponent's Active Pokémon (a stand-in that the effect-prevention cards can be tested against). */
const HARASS: Program = [
  { op: 'counters', n: 2, to: 'oppActive' },
  { op: 'condition', cond: 'poisoned', to: 'oppActive' },
  { op: 'damage', amount: 20, to: 'oppActive' },
];
const STAND_ITEM: CardScript = { id: 'me01-130', name: 'Switch', play: HARASS };
const STAND_SUPPORTER: CardScript = { id: 'sv06-154', name: 'Kieran', play: HARASS };

// ------------------------------------------------------------------ Area Zero Underdepths

test('Area Zero Underdepths: replacing it makes the player discard first, so a Pokémon with lethal damage can be the one discarded (ruling 2305)', () => {
  const dk = deck('Pikachu ex', 'Dreepy', 'Area Zero Underdepths', 'Gravity Mountain');
  const mk = (): Game => {
    const g = scenario(dk, dk, [
      { active: 'Pikachu ex', bench: rep('Dreepy', 7), damage: { 0: 70 }, hand: ['Gravity Mountain'] },
      { active: 'Dreepy' },
    ]);
    stadium(g, 'Area Zero Underdepths', 0);
    refresh(g);
    return g;
  };
  const g = mk();
  const doomed = g.state.p[0].bench[0]!;
  assert.equal(doomed.damage, 70, 'a Dreepy with as much damage as HP');
  choose(g, 'Play Gravity Mountain');
  const d = g.decision!;
  assert.equal(d.kind, 'slots');
  assert.equal(d.min, 2, '7 on the Bench, 5 allowed now');
  assert.equal(g.state.p[0].bench.length, 7, 'nothing Knocked Out yet: the discard comes first');
  g.submit([(d.values as number[]).indexOf(doomed.id), 0 === (d.values as number[]).indexOf(doomed.id) ? 1 : 0]);
  assert.equal(g.state.p[1].prizes.length, 6, 'it was discarded, not Knocked Out: no Prize card');
  assert.equal(g.state.p[0].bench.length, 5);
  // The same position when the player keeps it: it is Knocked Out afterwards and the opponent takes a Prize card.
  const k = mk();
  choose(k, 'Play Gravity Mountain');
  const keep = (k.decision!.values as number[]).filter((id) => id !== doomed.id);
  assert.equal(keep.length, 6);
  k.submit([(k.decision!.values as number[]).indexOf(keep[0]!), (k.decision!.values as number[]).indexOf(keep[1]!)]);
  assert.equal(k.state.p[1].prizes.length, 5, 'Knocked Out after the discard');
});

test('Area Zero Underdepths: a Tera Pokémon picked up (not Knocked Out) leaves the Bench cut down before the new Active Pokémon (rulings 2131 and 2132)', () => {
  const dk = deck('Pikachu ex', 'Dreepy', 'Area Zero Underdepths', "Hero's Cape");
  // A stand-in for "put your Pokémon into your hand" (Professor Turo's Scenario is not in the card snapshot): a Tool that picks its holder up.
  const pickUp: CardScript = { id: 'sv05-152', name: "Hero's Cape", triggers: [{ on: 'endOfTurn', program: [{ op: 'custom', fn: 'returnSelfToHand' }] }] };
  const g = scenario(dk, dk, [{ active: 'Pikachu ex', bench: rep('Dreepy', 8), tools: { active: ["Hero's Cape"] } }, { active: 'Dreepy' }], { scripts: [pickUp] });
  stadium(g, 'Area Zero Underdepths', 1);
  refresh(g);
  choose(g, 'End turn');
  assert.equal(g.state.p[0].active, null, 'the Tera Pokémon is in the hand');
  assert.equal(g.decision!.kind, 'slots', 'the discard comes before the new Active Pokémon is chosen');
  assert.equal(g.decision!.min, 3);
  assert.equal(g.state.pending!.resume.k, 'benchDiscard');
  g.submit([0, 1, 2]);
  assert.equal(g.decision!.kind, 'promote');
  assert.equal(g.state.p[0].bench.length, 5);
});

test('Area Zero Underdepths: when the Tera Pokémon and Benched Pokémon are Knocked Out together the Knock Outs and Prize cards come first, then one more is discarded, then the new Active Pokémon (ruling 2026)', () => {
  const dk = deck('Pikachu ex', 'Dreepy', "N's Darumaka", 'Area Zero Underdepths');
  // 20 to the Defending Pokémon and 20 to each Benched Pokémon.
  const sweep: CardScript = {
    id: 'me02.5-032',
    name: "N's Darumaka",
    attacks: { 'Rolling Tackle': { program: [{ op: 'damage', amount: 20, to: 'defender' }, { op: 'damage', amount: 20, to: { each: 'oppBench' } }] } },
  };
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Pikachu ex', bench: rep('Dreepy', 8), damage: { active: 180, 0: 60, 1: 60 } },
      { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
    ],
    { current: 1, turn: 4, scripts: [sweep] },
  );
  stadium(g, 'Area Zero Underdepths', 0);
  refresh(g);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.p[1].prizes.length, 6 - 2 - 1 - 1, 'the Tera Pokémon (2) and the two Benched Pokémon (1 each) were Knocked Out and their Prize cards taken');
  assert.equal(g.state.p[0].bench.length, 6);
  assert.equal(g.decision!.kind, 'slots', 'then one more is discarded...');
  assert.equal(g.decision!.min, 1);
  assert.equal(g.state.p[0].active, null);
  g.submit([0]);
  assert.equal(g.decision!.kind, 'promote', '...and then a new Active Pokémon is chosen');
  assert.equal(g.state.p[0].bench.length, 5);
});

test('Area Zero Underdepths: a Stadium that replaces it with the same effect makes nobody discard (ruling 2039)', () => {
  const dk = deck('Pikachu ex', 'Dreepy', 'Area Zero Underdepths', 'Gravity Mountain');
  // Sky Field is not in the card snapshot: a stand-in Stadium that also allows 8 on the Bench.
  const skyField: CardScript = { id: 'sv08-177', name: 'Gravity Mountain', statics: [{ effect: { k: 'benchSize', size: 8 }, scope: 'both' }] };
  const g = scenario(dk, dk, [{ active: 'Pikachu ex', bench: rep('Dreepy', 8), hand: ['Gravity Mountain'] }, { active: 'Dreepy' }], { scripts: [skyField] });
  stadium(g, 'Area Zero Underdepths', 1);
  refresh(g);
  choose(g, 'Play Gravity Mountain');
  assert.equal(g.decision!.kind, 'main', 'no discard: one Stadium replaced the other');
  assert.equal(g.state.p[0].bench.length, 8);
});

test('Area Zero Underdepths: the room for an effect is counted when it starts (ruling 2024)', () => {
  const dk = deck('Pikachu ex', 'Dreepy', 'Area Zero Underdepths', 'Switch');
  // Form Ranks: "Search your deck for any number of Pokémon and put them onto your Bench", as many as there is room for.
  const formRanks: CardScript = {
    id: 'me01-130',
    name: 'Switch',
    play: [
      { op: 'chooseCards', from: 'deck', filter: { cat: 'pokemon', stage: 'basic' }, min: 0, max: { benchRoom: 'self' }, as: 'f' },
      { op: 'move', cards: 'f', to: 'bench' },
    ],
  };
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: rep('Dreepy', 4), hand: ['Switch'] }, { active: 'Dreepy' }], { scripts: [formRanks] });
  stadium(g, 'Area Zero Underdepths', 0);
  refresh(g);
  choose(g, 'Play Switch');
  assert.equal(g.decision!.kind, 'cards');
  assert.equal(g.decision!.max, 1, 'only one space: there was no Tera Pokémon in play when the effect was used');
  const tera = (g.decision!.values as number[]).findIndex((c) => nameOf(g, c) === 'Pikachu ex');
  g.submit([tera]);
  assert.deepEqual(benchNames(g, 0), [...rep('Dreepy', 4), 'Pikachu ex']);
});

// ------------------------------------------------------------------ Archaludon ex

test('Archaludon ex, Assemble Alloy: evolving from the hand, you may attach up to 2 Basic {M} Energy cards from the discard pile to your {M} Pokémon in any way', () => {
  const dk = deck('Archaludon ex', 'Duraludon', 'Beldum', 'Dreepy');
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Duraludon', bench: ['Beldum', 'Dreepy'], hand: ['Archaludon ex'], discard: [MET, MET, MET, FIR] },
      { active: 'Dreepy' },
    ]);
  const g = mk();
  choose(g, 'Evolve Duraludon');
  choose(g, 'Yes');
  const pick = g.decision!;
  assert.equal(pick.kind, 'cards');
  assert.deepEqual(names(g, pick.values as number[]), [MET, MET, MET], 'only Basic {M} Energy: not the Fire Energy');
  assert.equal(pick.max, 2);
  g.submit([0, 1]);
  const where = g.decision!;
  assert.equal(where.kind, 'slots');
  assert.equal((where.values as number[]).length, 2, 'only {M} Pokémon: Archaludon ex and Beldum, not Dreepy');
  const beldum = g.state.p[0].bench[0]!;
  g.submit([(where.values as number[]).indexOf(beldum.id)]);
  g.submit([0]);
  assert.equal(beldum.energy.length, 1);
  assert.equal(g.state.p[0].active!.energy.length, 1, 'in any way you like: one each');
  assert.equal(g.state.p[0].discard.filter((c) => nameOf(g, c) === MET).length, 1);
  // "You may": declining attaches nothing.
  const n = mk();
  choose(n, 'Evolve Duraludon');
  choose(n, 'No');
  assert.equal(n.state.p[0].active!.energy.length + n.state.p[0].bench[0]!.energy.length, 0);
  assert.equal(n.state.p[0].discard.length, 4);
});

test('Archaludon ex, Metal Defender: during the opponent\'s next turn this Pokémon has no Weakness (and only then)', () => {
  const dk = deck('Archaludon ex', "N's Darumaka", 'Dreepy');
  const g = scenario(dk, dk, [
    { active: 'Archaludon ex', energy: { active: [MET, MET, MET] } },
    { active: "N's Darumaka", bench: ["N's Darumaka"], energy: { active: [FIR, FIR], 0: [FIR, FIR] } },
  ]);
  choose(g, 'Attack: Metal Defender');
  assert.equal(g.state.p[0].prizes.length, 5, '220 damage Knocks Out the 80-HP Darumaka');
  assert.equal(g.state.current, 1);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(dmg(g, 0), 20, 'Fire against a Fire-weak Pokémon, but no Weakness this turn');
  choose(g, 'End turn'); // P1's turn 6 is next: the effect is over
  assert.equal(g.state.current, 1);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(dmg(g, 0), 20 + 40, 'Weakness applies again');
});

// ------------------------------------------------------------------ Sparkling Crystal

test('Sparkling Crystal: the Tera Pokémon it is attached to uses attacks for 1 Energy less, of any type; another Pokémon does not', () => {
  const dk = deck('Tatsugiri ex', 'Pikachu ex', 'Lotad', 'Sparkling Crystal');
  const tera = scenario(dk, dk, [{ active: 'Tatsugiri ex', tools: { active: ['Sparkling Crystal'] }, energy: { active: [WAT] } }, { active: 'Lotad' }]);
  assert.ok(has(tera, 'Attack: Surprise Pump'), '{R}{W} with one {W}');
  const grass = scenario(dk, dk, [{ active: 'Tatsugiri ex', tools: { active: ['Sparkling Crystal'] }, energy: { active: [GRA] } }, { active: 'Lotad' }]);
  assert.ok(!has(grass, 'Attack: Surprise Pump'), 'the Energy still has to be of a type the attack uses');
  const plain = scenario(dk, dk, [{ active: 'Tatsugiri ex', energy: { active: [WAT] } }, { active: 'Lotad' }]);
  assert.ok(!has(plain, 'Attack: Surprise Pump'), 'without the Tool it is two Energy');
  const free = scenario(dk, dk, [{ active: 'Pikachu ex', tools: { active: ['Sparkling Crystal'] } }, { active: 'Lotad' }]);
  assert.ok(has(free, 'Attack: Tail Whap'), 'a {C} attack costs nothing');
  const notTera = scenario(dk, dk, [{ active: 'Lotad', tools: { active: ['Sparkling Crystal'] } }, { active: 'Lotad' }]);
  assert.ok(!has(notTera, 'Attack: Water Gun'), 'a Pokémon that is not a Tera Pokémon gets nothing from it');
});

// ------------------------------------------------------------------ Technical Machine: Fluorite and Core Memory

test('Technical Machine: Fluorite: discarded at the end of your turn even if you did not attack; the attack heals Tera Pokémon only', () => {
  const dk = deck('Pikachu ex', 'Eevee ex', 'Dreepy', 'Technical Machine: Fluorite');
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Dreepy', bench: ['Eevee ex', 'Dreepy'], tools: { active: ['Technical Machine: Fluorite'] }, energy: { active: [GRA, WAT, PSY] }, damage: { active: 40, 0: 100, 1: 20 } },
      { active: 'Dreepy' },
    ]);
  const idle = mk();
  choose(idle, 'End turn');
  assert.ok(idle.state.p[0].discard.some((c) => nameOf(idle, c) === 'Technical Machine: Fluorite'));
  assert.equal(idle.state.p[0].active!.tools.length, 0);
  const g = mk();
  choose(g, 'Attack: Fluorite');
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.equal(g.state.p[0].active!.damage, 40, 'the user is not a Tera Pokémon: not healed');
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'the Benched Tera Pokémon is healed of all damage');
  assert.equal(g.state.p[0].bench[1]!.damage, 20);
});

test('Core Memory: only the Mega Zygarde ex it is attached to can use Geobuster', () => {
  const dk = deck('Mega Zygarde ex', 'Core Memory', 'Dragapult ex');
  const four = [FIG, FIG, FIG, FIG];
  const z = scenario(dk, dk, [{ active: 'Mega Zygarde ex', tools: { active: ['Core Memory'] }, energy: { active: four } }, { active: 'Dragapult ex' }]);
  choose(z, 'Attack: Geobuster');
  assert.equal(z.state.p[0].prizes.length, 4, 'Geobuster does 350: more than the 320 HP, so the Dragapult ex (2 Prize cards) is Knocked Out');
  assert.equal(z.state.p[0].active!.energy.length, 0, '"Discard all Energy from this Pokémon."');
});

// ------------------------------------------------------------------ Festival Grounds and Festival Lead

test('Festival Grounds: every Pokémon with Energy attached recovers from Special Conditions and can\'t be affected by them', () => {
  const dk = deck('Dreepy', 'Festival Grounds', 'Switch');
  const g = scenario(dk, dk, [
    { active: 'Dreepy', cond: 8 | 2, energy: { active: [PSY] }, hand: ['Switch'] },
    { active: 'Dreepy', cond: 8 },
  ]);
  assert.ok(g.state.p[0].active!.cond, 'Poisoned and Confused');
  stadium(g, 'Festival Grounds', 1);
  refresh(g);
  choose(g, 'End turn'); // any action: conditions are checked as Knock Outs are
  assert.equal(g.state.p[0].active!.cond, 0, 'the Pokémon with Energy attached recovered');
  assert.equal(g.state.p[1].active!.cond, 8, 'one with no Energy did not');
});

test('Festival Grounds: a Special Condition can\'t be put on a Pokémon with Energy attached (and can on one without)', () => {
  const dk = deck('Dreepy', 'Festival Grounds');
  const poison: CardScript = { id: 'sv06-128', name: 'Dreepy', attacks: { 'Petty Grudge': { post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }] } } };
  const mk = (energized: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', energy: { active: [PSY] } }, energized ? { active: 'Dreepy', energy: { active: [FIR] } } : { active: 'Dreepy' }], { scripts: [poison] });
    stadium(g, 'Festival Grounds', 0);
    refresh(g);
    return g;
  };
  const a = mk(true);
  choose(a, 'Attack: Petty Grudge');
  assert.equal(a.state.p[1].active!.cond, 0);
  const b = mk(false);
  choose(b, 'Attack: Petty Grudge');
  assert.equal(b.state.p[1].active!.cond, 8);
});

test('Dipplin, Festival Lead: with Festival Grounds in play it may attack twice; without it, once. Do the Wave: 20 for each of your Benched Pokémon', () => {
  const dk = deck('Dipplin', 'Dreepy', 'Festival Grounds');
  const mk = (grounds: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Dipplin', bench: ['Dreepy', 'Dreepy'], energy: { active: [GRA] } }, { active: 'Dreepy', bench: ['Dreepy'] }]);
    if (grounds) stadium(g, 'Festival Grounds', 1);
    refresh(g);
    return g;
  };
  const none = mk(false);
  choose(none, 'Attack: Do the Wave');
  assert.equal(dmg(none, 1), 40);
  assert.equal(none.state.current, 1, 'one attack ends the turn');
  const g = mk(true);
  choose(g, 'Attack: Do the Wave');
  assert.equal(g.state.current, 0);
  assert.deepEqual(labels(g), ['Attack: Do the Wave', 'End turn']);
  choose(g, 'Attack: Do the Wave');
  assert.equal(g.state.p[0].prizes.length, 5, 'the second attack took the Dreepy to 80 damage: Knocked Out');
  assert.equal(g.state.current, 1, 'two attacks end the turn');
});

test('Festival Lead: the Ability needs Festival Grounds when the second attack is chosen', () => {
  const dk = deck('Dipplin', 'Dreepy', 'Festival Grounds');
  const g = scenario(dk, dk, [{ active: 'Dipplin', bench: ['Dreepy'], energy: { active: [GRA] } }, { active: 'Dreepy', bench: ['Dreepy'] }]);
  stadium(g, 'Festival Grounds', 1);
  refresh(g);
  choose(g, 'Attack: Do the Wave');
  assert.ok(has(g, 'Attack: Do the Wave'));
  g.state.stadium = null; // the Stadium is gone before the second attack
  assert.ok(!g.legal().some((a) => a.t === 'attack'));
});

test('Festival Lead: Kieran\'s +30 applies to each attack on a Pokémon ex, so the new Active Pokémon after a Knock Out is checked on its own (ruling 2428)', () => {
  const dk = deck('Dipplin', 'Dreepy', 'Eevee ex', 'Festival Grounds', 'Kieran');
  const g = scenario(dk, dk, [
    { active: 'Dipplin', bench: ['Dreepy', 'Dreepy'], energy: { active: [GRA] }, hand: ['Kieran'] },
    { active: 'Dreepy', bench: ['Eevee ex'], damage: { active: 30 } },
  ]);
  stadium(g, 'Festival Grounds', 1);
  refresh(g);
  choose(g, 'Play Kieran');
  choose(g, '+30 damage');
  choose(g, 'Attack: Do the Wave');
  // 40 on a Dreepy that is not an ex: no bonus, 30 + 40 = 70 Knocks it Out. The Eevee ex comes up.
  assert.equal(g.state.p[0].prizes.length, 5);
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), 'Eevee ex');
  choose(g, 'Attack: Do the Wave');
  assert.equal(dmg(g, 1), 40 + 30, 'the second attack, on an ex, does 30 more');
  // The converse: an ex first (+30), then not.
  const h = scenario(dk, dk, [
    { active: 'Dipplin', bench: ['Dreepy', 'Dreepy'], energy: { active: [GRA] }, hand: ['Kieran'] },
    { active: 'Eevee ex', bench: ['Dreepy'], damage: { active: 130 } },
  ]);
  stadium(h, 'Festival Grounds', 1);
  refresh(h);
  choose(h, 'Play Kieran');
  choose(h, '+30 damage');
  choose(h, 'Attack: Do the Wave'); // 40 + 30 on the Eevee ex with 130 damage: Knocked Out
  assert.equal(h.state.p[0].prizes.length, 4, 'an ex is worth 2 Prize cards');
  assert.equal(nameOf(h, h.state.p[1].active!.cards[0]!), 'Dreepy');
  choose(h, 'Attack: Do the Wave');
  assert.equal(dmg(h, 1), 40, 'a Pokémon that is not an ex: no bonus');
});

test('Festival Lead: an Energy-attached Pokémon with Adversity Policy draws 3 cards for each of the two attacks (ruling 2359)', () => {
  const dk = deck('Dipplin', "N's Zorua", 'Dreepy', 'Festival Grounds', 'Adversity Policy');
  const g = scenario(dk, dk, [
    { active: 'Dipplin', bench: ['Dreepy'], energy: { active: [GRA] } },
    { active: "N's Zorua", bench: ['Dreepy'], tools: { active: ['Adversity Policy'] } },
  ]);
  stadium(g, 'Festival Grounds', 1);
  refresh(g);
  const hand = g.state.p[1].hand.length;
  choose(g, 'Attack: Do the Wave'); // Grass against a Grass-weak Pokémon: 20 x 2 = 40
  assert.equal(g.state.p[1].hand.length, hand + 3);
  choose(g, 'Attack: Do the Wave');
  assert.equal(g.state.p[1].hand.length, hand + 6 + 1, 'three cards for each attack, six in all (and the card drawn for their turn, which comes next)');
});

test('Festival Lead: if the first attack Knocks Out a Flutter Mane that switched Abilities off, Dipplin may attack again; if it did not, it may not (ruling 2093)', () => {
  const dk = deck('Dipplin', 'Dreepy', 'Flutter Mane', 'Festival Grounds');
  const mk = (damage: number): Game => {
    const g = scenario(dk, dk, [
      { active: 'Dipplin', bench: ['Dreepy', 'Dreepy'], energy: { active: [GRA] } },
      { active: 'Flutter Mane', bench: ['Dreepy'], damage: { active: damage } },
    ]);
    stadium(g, 'Festival Grounds', 1);
    refresh(g);
    return g;
  };
  const kill = mk(60);
  choose(kill, 'Attack: Do the Wave'); // 40 on the 90-HP Flutter Mane with 60 damage: Knocked Out
  assert.equal(nameOf(kill, kill.state.p[1].active!.cards[0]!), 'Dreepy', 'its only Benched Pokémon came up');
  assert.deepEqual(labels(kill), ['Attack: Do the Wave', 'End turn'], 'Festival Lead works again');
  const stay = mk(0);
  choose(stay, 'Attack: Do the Wave');
  assert.equal(stay.state.current, 1, 'Midnight Fluttering is still switching Festival Lead off: no second attack');
});

test('Swirlix, Sneaky Placement: 2 damage counters on 1 of the opponent\'s Pokémon; Festival Lead lets it do so twice', () => {
  const dk = deck('Swirlix', 'Dreepy', 'Festival Grounds');
  const g = scenario(dk, dk, [{ active: 'Swirlix', energy: { active: [PSY] } }, { active: 'Dreepy', bench: ['Dreepy'] }]);
  stadium(g, 'Festival Grounds', 0);
  refresh(g);
  choose(g, 'Attack: Sneaky Placement');
  const bench = g.state.p[1].bench[0]!;
  g.submit([(g.decision!.values as number[]).indexOf(bench.id)]);
  assert.equal(bench.damage, 20);
  assert.deepEqual(labels(g), ['Attack: Sneaky Placement', 'End turn']);
  choose(g, 'Attack: Sneaky Placement');
  g.submit([(g.decision!.values as number[]).indexOf(g.state.p[1].active!.id)]);
  assert.equal(dmg(g, 1), 20);
});

test('Goldeen, Whirlpool: flip a coin, on heads discard an Energy from the Defending Pokémon; Festival Lead does not work with a Technical Machine (ruling 1974)', () => {
  const dk = deck('Goldeen', 'Dreepy', 'Festival Grounds', 'Technical Machine: Fluorite');
  const mk = (tm: boolean): Game => {
    const g = scenario(dk, dk, [
      { active: 'Goldeen', energy: { active: [GRA, WAT, PSY] }, ...(tm ? { tools: { active: ['Technical Machine: Fluorite'] } } : {}) },
      { active: 'Dreepy', energy: { active: [FIR, FIR] } },
    ]);
    stadium(g, 'Festival Grounds', 1);
    g.state.forcedCoins = [true, false];
    refresh(g);
    return g;
  };
  const g = mk(false);
  choose(g, 'Attack: Whirlpool');
  g.submit([0]); // heads: which Energy to discard
  assert.equal(g.state.p[1].active!.energy.length, 1, 'heads');
  choose(g, 'Attack: Whirlpool');
  assert.equal(g.state.p[1].active!.energy.length, 1, 'tails');
  const t = mk(true);
  assert.ok(has(t, 'Attack: Fluorite'), 'the Technical Machine\'s attack is there for the first attack');
  choose(t, 'Attack: Whirlpool');
  t.submit([0]);
  assert.deepEqual(labels(t), ['Attack: Whirlpool', 'End turn'], 'but not for the second');
  const u = mk(true);
  choose(u, 'Attack: Fluorite');
  assert.equal(u.state.current, 1, 'and a Technical Machine attack first is the only attack');
});

test('Seaking, Rapid Draw: draw 2 cards, twice with Festival Lead', () => {
  const dk = deck('Seaking', 'Dreepy', 'Festival Grounds');
  const g = scenario(dk, dk, [{ active: 'Seaking', energy: { active: [WAT] } }, { active: 'Dreepy', bench: ['Dreepy'] }]);
  stadium(g, 'Festival Grounds', 1);
  refresh(g);
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Rapid Draw');
  assert.equal(g.state.p[0].hand.length, hand + 2);
  assert.equal(dmg(g, 1), 60);
  choose(g, 'Attack: Rapid Draw');
  assert.equal(g.state.p[0].hand.length, hand + 4 + 1, 'four cards drawn, and the Prize card for the Knocked Out Dreepy');
});

// ------------------------------------------------------------------ Stadium and Supporter locks

test('Chi-Yu, Scorching Earth: discards the opponent\'s Stadium, and then they can\'t play Stadium cards during their next turn', () => {
  const dk = deck('Chi-Yu', 'Dreepy', 'Gravity Mountain', 'Jamming Tower');
  const mk = (owner: 0 | 1 | null): Game => {
    const g = scenario(dk, dk, [{ active: 'Chi-Yu', energy: { active: [FIR] } }, { active: 'Dreepy', hand: ['Jamming Tower'] }]);
    if (owner !== null) stadium(g, 'Gravity Mountain', owner);
    refresh(g);
    return g;
  };
  const g = mk(1);
  choose(g, 'Attack: Scorching Earth');
  assert.equal(dmg(g, 1), 40);
  assert.equal(g.state.stadium, null, 'discarded');
  assert.equal(g.state.p[1].discard.filter((c) => nameOf(g, c) === 'Gravity Mountain').length, 1, 'to its owner\'s discard pile');
  assert.equal(g.state.current, 1);
  assert.ok(!has(g, 'Play Jamming Tower'), 'locked during their next turn');
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Play Jamming Tower'), 'and free again after that');
  // Your own Stadium is not "a Stadium your opponent has": nothing is discarded and nothing is locked.
  const own = mk(0);
  choose(own, 'Attack: Scorching Earth');
  assert.ok(own.state.stadium, 'still in play');
  assert.ok(has(own, 'Play Jamming Tower'));
  const none = mk(null);
  choose(none, 'Attack: Scorching Earth');
  assert.ok(has(none, 'Play Jamming Tower'), 'no Stadium was discarded: no lock');
});

test('Copperajah, Massive Body: while Active, the opponent can\'t play Stadium cards from their hand; Nasal Lariat: 100 more, then it can\'t attack next turn', () => {
  const dk = deck('Copperajah', 'Dreepy', 'Gravity Mountain');
  const four = [MET, MET, MET, MET];
  const mk = (copperajahActive: boolean): Game => {
    const g = scenario(dk, dk, [
      copperajahActive ? { active: 'Copperajah', bench: ['Dreepy'], energy: { active: four } } : { active: 'Dreepy', bench: ['Copperajah'] },
      { active: 'Dreepy', hand: ['Gravity Mountain'] },
    ]);
    g.state.current = 1;
    g.state.turn = 4;
    refresh(g);
    return g;
  };
  assert.ok(!has(mk(true), 'Play Gravity Mountain'));
  assert.ok(has(mk(false), 'Play Gravity Mountain'), 'on the Bench it does nothing');
});

test('Copperajah, Nasal Lariat: "You may do 100 more damage. If you do, during your next turn, this Pokémon can\'t attack."', () => {
  const dk = deck('Copperajah', 'Dragapult ex');
  const four = [MET, MET, MET, MET];
  const mk = (): Game => scenario(dk, dk, [{ active: 'Copperajah', energy: { active: four } }, { active: 'Dragapult ex' }]);
  const more = mk();
  choose(more, 'Attack: Nasal Lariat');
  choose(more, 'Yes');
  assert.equal(dmg(more, 1), 230);
  choose(more, 'End turn'); // P2's turn; back to P1: Copperajah can't attack
  assert.equal(more.state.current, 0);
  assert.ok(!has(more, 'Attack:'), "can't attack during your next turn");
  const less = mk();
  choose(less, 'Attack: Nasal Lariat');
  choose(less, 'No');
  assert.equal(dmg(less, 1), 130);
  choose(less, 'End turn');
  assert.ok(has(less, 'Attack: Nasal Lariat'));
});

test('Scream Tail ex, Scream: only if you go second and only during your first turn; then the opponent can\'t play Supporter cards during their next turn', () => {
  const dk = deck('Scream Tail ex', 'Dreepy', "Boss's Orders");
  // P2 (the player who went second) in its first turn: turn 2.
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'], hand: ["Boss's Orders"] }, { active: 'Scream Tail ex', bench: ['Dreepy'], energy: { active: [PSY] } }], { turn: 2, current: 1, first: 0 });
  assert.ok(has(g, 'Attack: Scream'), 'second player, first turn');
  choose(g, 'Attack: Scream');
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, "Play Boss's Orders"), 'no Supporter during their next turn');
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, "Play Boss's Orders"), 'the turn after, they can');
  // The first player never can: turn 1 (nobody attacks) and its later turns are not its first turn.
  const first = scenario(dk, dk, [{ active: 'Scream Tail ex', energy: { active: [PSY] } }, { active: 'Dreepy' }], { turn: 3, current: 0, first: 0 });
  assert.ok(!has(first, 'Attack: Scream'), 'a later turn');
  const later = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Scream Tail ex', energy: { active: [PSY] } }], { turn: 4, current: 1, first: 0 });
  assert.ok(!has(later, 'Attack: Scream'), 'the second player\'s second turn');
  const goingFirst = scenario(dk, dk, [{ active: 'Scream Tail ex', energy: { active: [PSY] } }, { active: 'Dreepy' }], { turn: 1, current: 0, first: 0 });
  assert.ok(!has(goingFirst, 'Attack: Scream'), 'the first player\'s first turn: nobody attacks, and it did not go second');
});

test('Scream Tail ex, Crunch: discard an Energy from the Defending Pokémon', () => {
  const dk = deck('Scream Tail ex', 'Dragapult ex');
  const g = scenario(dk, dk, [{ active: 'Scream Tail ex', energy: { active: [PSY, PSY, PSY] } }, { active: 'Dragapult ex', energy: { active: [FIR, WAT] } }]);
  choose(g, 'Attack: Crunch');
  g.submit([0]); // which Energy
  assert.equal(dmg(g, 1), 120);
  assert.equal(g.state.p[1].active!.energy.length, 1);
});

test('Genesect, ACE Nullifier: with a Tool attached, the opponent can\'t play ACE SPEC cards from their hand (their other cards, and your own ACE SPEC cards, are fine)', () => {
  const dk = deck('Genesect', 'Dreepy', "Hero's Cape", 'Prime Catcher', 'Switch');
  const mk = (tool: boolean): Game =>
    scenario(dk, dk, [
      { active: 'Dreepy', bench: ['Dreepy'], hand: ["Hero's Cape", 'Prime Catcher', 'Switch'] },
      { active: 'Genesect', bench: ['Dreepy'], ...(tool ? { tools: { active: ["Hero's Cape"] } } : {}), hand: ["Hero's Cape"] },
    ]);
  const locked = mk(true);
  assert.ok(!has(locked, "Attach Hero's Cape") && !has(locked, 'Play Prime Catcher'), 'both ACE SPEC cards are stopped');
  assert.ok(has(locked, 'Play Switch'), 'Switch is not an ACE SPEC card');
  const free = mk(false);
  assert.ok(has(free, "Attach Hero's Cape") && has(free, 'Play Prime Catcher'), 'without a Tool on Genesect');
  // The lock is on the opponent only.
  const own = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'] }, { active: 'Genesect', bench: ['Dreepy'], tools: { active: ["Hero's Cape"] }, hand: ["Hero's Cape"] }], { turn: 4, current: 1 });
  assert.ok(has(own, "Attach Hero's Cape"), "Genesect's own player can still play ACE SPEC cards");
});

test('Bronzong, Evolution Jammer: 30 damage; during their next turn the opponent can\'t play Pokémon from their hand to evolve (Rare Candy included)', () => {
  const dk = deck('Bronzong', 'Dreepy', 'Drakloak', 'Dragapult ex', 'Rare Candy');
  const g = scenario(dk, dk, [{ active: 'Bronzong', energy: { active: [PSY] } }, { active: 'Dreepy', hand: ['Drakloak', 'Dragapult ex', 'Rare Candy'] }]);
  choose(g, 'Attack: Evolution Jammer');
  assert.equal(dmg(g, 1), 30);
  assert.ok(!has(g, 'Evolve') && !has(g, 'Play Rare Candy'), 'they can\'t evolve this turn');
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'into Drakloak') && has(g, 'Play Rare Candy'), 'but can the turn after');
});

// ------------------------------------------------------------------ Item / Supporter effect prevention

test('Antique Sail Fossil, Protective Sail: a Supporter the opponent plays does nothing to it (Items still do)', () => {
  const dk = deck('Antique Sail Fossil', 'Dreepy', 'Switch', 'Kieran');
  const mk = (): Game => scenario(dk, dk, [{ active: 'Dreepy', hand: ['Switch', 'Kieran'] }, { active: 'Antique Sail Fossil' }], { scripts: [STAND_ITEM, STAND_SUPPORTER] });
  const m = mk();
  assert.equal(def(m.ctx, m.state.p[1].active!.cards[0]!).hp, 60);
  const s = mk();
  choose(s, 'Play Kieran');
  assert.equal(dmg(s, 1), 0, 'no counters, no damage');
  assert.equal(s.state.p[1].active!.cond, 0);
  const i = mk();
  choose(i, 'Play Switch');
  assert.equal(dmg(i, 1), 40, 'an Item works');
  // Played from the hand it goes onto the Bench like the other Antique fossils.
  const b = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Antique Sail Fossil'] }, { active: 'Dreepy' }]);
  assert.ok(has(b, 'Bench Antique Sail Fossil'));
});

test('Fraxure, Unnerve: the effects of an Item or Supporter the opponent plays are not done to it; Dragon Pulse discards the top card of your deck', () => {
  const dk = deck('Fraxure', 'Dreepy', 'Dragapult ex', 'Switch', 'Kieran');
  const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Switch', 'Kieran'] }, { active: 'Fraxure' }], { scripts: [STAND_ITEM, STAND_SUPPORTER] });
  choose(g, 'Play Switch');
  choose(g, 'Play Kieran');
  assert.equal(dmg(g, 1), 0);
  assert.equal(g.state.p[1].active!.cond, 0);
  const h = scenario(dk, dk, [{ active: 'Fraxure', energy: { active: [FIG, MET] } }, { active: 'Dragapult ex' }]);
  const top = h.state.p[0].deck[h.state.p[0].deck.length - 1]!;
  const deckBefore = h.state.p[0].deck.length;
  choose(h, 'Attack: Dragon Pulse');
  assert.equal(dmg(h, 1), 80);
  assert.equal(h.state.p[0].deck.length, deckBefore - 1);
  assert.equal(h.state.p[0].discard[h.state.p[0].discard.length - 1], top);
});

test('Rhyperior, Wide Wall: while Active, Supporters the opponent plays do nothing to any of your Pokémon (Items do); on the Bench it does nothing', () => {
  const dk = deck('Rhyperior', 'Dreepy', 'Switch', 'Kieran');
  // These stand-ins hit the Defending Pokémon and the Benched ones.
  const wide: Program = [
    { op: 'counters', n: 2, to: 'oppActive' },
    { op: 'counters', n: 2, to: { each: 'oppBench' } },
  ];
  const stand: CardScript[] = [
    { id: 'me01-130', name: 'Switch', play: wide },
    { id: 'sv06-154', name: 'Kieran', play: wide },
  ];
  const mk = (rhyActive: boolean): Game =>
    scenario(dk, dk, [{ active: 'Dreepy', hand: ['Switch', 'Kieran'] }, rhyActive ? { active: 'Rhyperior', bench: ['Dreepy'] } : { active: 'Dreepy', bench: ['Rhyperior', 'Dreepy'] }], { scripts: stand });
  const g = mk(true);
  choose(g, 'Play Kieran');
  assert.equal(dmg(g, 1), 0);
  assert.equal(g.state.p[1].bench[0]!.damage, 0, 'the Benched Pokémon too');
  choose(g, 'Play Switch');
  assert.equal(dmg(g, 1), 20, 'an Item does its work');
  assert.equal(g.state.p[1].bench[0]!.damage, 20);
  const b = mk(false);
  choose(b, 'Play Kieran');
  assert.equal(dmg(b, 1), 20, 'Rhyperior is on the Bench: no protection');
  assert.equal(b.state.p[1].bench[1]!.damage, 20);
});

test('Rhyperior, Drill Run: the damage is done first (with the defender\'s Energy-dependent effects), then an Energy is discarded (ruling 77)', () => {
  const dk = deck('Rhyperior', 'Dragapult ex');
  // The defender takes 20 less damage while it has Energy attached.
  const guard: CardScript = {
    id: 'sv06-130',
    name: 'Dragapult ex',
    statics: [{ effect: { k: 'damageIn', amount: -20 }, scope: 'self', when: { slotIs: { ref: 'self', filter: { energized: true } } } }],
  };
  const g = scenario(dk, dk, [{ active: 'Rhyperior', energy: { active: [FIG, FIG, FIG] } }, { active: 'Dragapult ex', energy: { active: [PSY] } }], { scripts: [guard] });
  choose(g, 'Attack: Drill Run');
  assert.equal(dmg(g, 1), 180 - 20, 'reduced by the effect that needs the Energy...');
  assert.equal(g.state.p[1].active!.energy.length, 0, '...which is discarded afterwards');
});

// ------------------------------------------------------------------ Berries

const BERRIES: [string, string, string, string, string][] = [
  // berry, attacker type's Pokémon, its attack, an attacker of another type, its attack
  ['Occa Berry', "N's Darumaka", 'Rolling Tackle', 'Togepi', 'Pound'],
  ['Payapa Berry', 'Togepi', 'Pound', 'Beldum', 'Headbutt'],
  ['Babiri Berry', 'Beldum', 'Headbutt', "N's Zorua", 'Scratch'],
  ['Colbur Berry', "N's Zorua", 'Scratch', 'Lotad', 'Water Gun'],
  ['Passho Berry', 'Lotad', 'Water Gun', "N's Darumaka", 'Rolling Tackle'],
];

for (const [berry, matching, matchingAttack, other, otherAttack] of BERRIES) {
  test(`${berry}: 60 less damage from a Pokémon of its type (then it is discarded); a Pokémon of another type does full damage and the Berry stays`, () => {
    const dk = deck(berry, matching, other, 'Dragapult ex');
    const stand = (name: string, attack: string): CardScript => ({ id: IDS[name]!, name, attacks: { [attack]: { damage: 100 } } });
    const mk = (attacker: string, attack: string): Game => {
      const g = scenario(
        dk,
        dk,
        [{ active: 'Dragapult ex', tools: { active: [berry] } }, { active: attacker, energy: { active: [FIR, WAT, PSY, DAR, MET, GRA] } }],
        { current: 1, turn: 4, scripts: [stand(attacker, attack)] },
      );
      return g;
    };
    const hit = mk(matching, matchingAttack);
    choose(hit, `Attack: ${matchingAttack}`);
    assert.equal(dmg(hit, 0), 40, '100 - 60');
    assert.equal(hit.state.p[0].active!.tools.length, 0);
    assert.ok(hit.state.p[0].discard.some((c) => nameOf(hit, c) === berry));
    const miss = mk(other, otherAttack);
    choose(miss, `Attack: ${otherAttack}`);
    assert.equal(dmg(miss, 0), 100);
    assert.equal(miss.state.p[0].active!.tools.length, 1, 'not discarded');
  });
}

test('Occa Berry: the 60 less is taken after Weakness is applied', () => {
  const dk = deck('Occa Berry', 'Chikorita', "N's Darumaka");
  const strong: CardScript = { id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { damage: 60 } } };
  const g = scenario(dk, dk, [{ active: 'Chikorita', tools: { active: ['Occa Berry'] } }, { active: "N's Darumaka", energy: { active: [FIR, FIR] } }], { current: 1, turn: 4, scripts: [strong] });
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.p[0].active!.damage, 60 * 2 - 60, 'Fire x2 first, then 60 less (the other way round it would be 0)');
});

// ------------------------------------------------------------------ Orthworm ex

test('Orthworm ex, Pummeling Payback: damaged by an attack (Active, Benched, or Knocked Out), 2 damage counters on the Attacking Pokémon for each {M} Energy attached to it', () => {
  const dk = deck('Orthworm ex', 'Dreepy', "N's Darumaka");
  const sweep: CardScript = { id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { target: { each: 'oppBench' } } } };
  const energy = { active: [MET, MET, FIR] };
  // Active.
  const a = scenario(dk, dk, [{ active: 'Orthworm ex', energy }, { active: "N's Darumaka", energy: { active: [FIR, FIR] } }], { current: 1, turn: 4 });
  choose(a, 'Attack: Rolling Tackle');
  assert.equal(dmg(a, 1), 40, '2 {M} Energy: 4 damage counters');
  // On the Bench.
  const b = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Orthworm ex'], energy: { 0: [MET, MET, MET] } }, { active: "N's Darumaka", energy: { active: [FIR, FIR] } }], { current: 1, turn: 4, scripts: [sweep] });
  choose(b, 'Attack: Rolling Tackle');
  assert.equal(b.state.p[0].bench[0]!.damage, 20);
  assert.equal(dmg(b, 1), 60, '3 {M} Energy: 6 counters');
  // Knocked Out.
  const k = scenario(dk, dk, [{ active: 'Orthworm ex', bench: ['Dreepy'], energy, damage: { active: 210 } }, { active: "N's Darumaka", energy: { active: [FIR, FIR] } }], { current: 1, turn: 4 });
  choose(k, 'Attack: Rolling Tackle');
  assert.equal(dmg(k, 1), 40, 'even though Orthworm ex was Knocked Out');
  // No {M} Energy, no counters.
  const n = scenario(dk, dk, [{ active: 'Orthworm ex', energy: { active: [FIR] } }, { active: "N's Darumaka", energy: { active: [FIR, FIR] } }], { current: 1, turn: 4 });
  choose(n, 'Attack: Rolling Tackle');
  assert.equal(dmg(n, 1), 0);
});

test('Orthworm ex, Pummeling Payback: the Energy is counted when the Ability resolves, after the attack\'s own effects (ruling 2012)', () => {
  const dk = deck('Orthworm ex', 'Tauros');
  const g = scenario(dk, dk, [{ active: 'Orthworm ex', energy: { active: [MET] } }, { active: 'Tauros', energy: { active: [FIR, FIR, FIR] } }], { current: 1, turn: 4 });
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Destructive Horn');
  assert.equal(g.state.p[0].active!.energy.length, 0, 'the only {M} Energy was discarded by Destructive Horn');
  assert.equal(dmg(g, 1), 0, 'so no damage counters were placed on Tauros');
  assert.equal(dmg(g, 0), 70);
});

test('Orthworm ex, Rock Tomb: the Defending Pokémon can\'t retreat during the opponent\'s next turn', () => {
  const dk = deck('Orthworm ex', 'Dreepy', 'Dragapult ex');
  const g = scenario(dk, dk, [{ active: 'Orthworm ex', energy: { active: [MET, MET, MET, MET] } }, { active: 'Dragapult ex', bench: ['Dreepy'], energy: { active: [FIR] } }]);
  choose(g, 'Attack: Rock Tomb');
  assert.equal(dmg(g, 1), 150);
  assert.ok(!has(g, 'Retreat'), "can't retreat during their next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Retreat'), 'but can the turn after');
});
