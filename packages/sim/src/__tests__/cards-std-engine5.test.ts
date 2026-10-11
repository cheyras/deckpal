/**
 * Card tests, batch "std-engine5": every card scripted in cards/scripts/std-engine5.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from the frames.
 * The engine features themselves are tested in engine-features-5.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript, Program } from '../dsl.js';
import { advance, legalActions } from '../flow.js';
import type { Game } from '../game.js';
import { scenario } from '../scenario.js';
import { ASLEEP, POISONED, type Decision } from '../types.js';
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
/** Answer a slot decision with the Pokémon whose slot id this is. */
function pickSlot(g: Game, id: number): void {
  const i = (g.decision!.values as number[]).indexOf(id);
  assert.ok(i >= 0, `slot ${id} is not offered: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const names = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c));
const count = (g: Game, cards: number[], name: string): number => names(g, cards).filter((n) => n === name).length;
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);
function canEvolve(g: Game, into: string, slotId: number, p: 0 | 1 = 0): boolean {
  return legalActions(g.env, g.state, p).some((a) => a.t === 'evolve' && a.slot === slotId && nameOf(g, a.card) === into);
}
/** Put the Stadium card from this player's deck into play, as if that player had played it. */
function stadium(g: Game, name: string, owner: 0 | 1 = 0): void {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in P${owner + 1}'s deck`);
  g.state.stadium = { card: dk.splice(i, 1)[0] as number, owner };
  g.state.pending = null;
  advance(g.env, g.state);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Shinx: 'me03-026',
  Luxio: 'me03-027',
  Luxray: 'me03-028',
  Snivy: 'me03-004',
  Servine: 'sv10.5b-002',
  Serperior: 'me03-006',
  'Forest of Vitality': 'me01-117',
  Eevee: 'sv08-143',
  'Eevee ex': 'sv08.5-075',
  'Vaporeon ex': 'sv08.5-023',
  'Espeon ex': 'sv08.5-034',
  Leafeon: 'sv06-011',
  'Strange Timepiece': 'me01-128',
  Karrablast: 'sv10.5b-009',
  Escavalier: 'sv10.5b-060',
  Shelmet: 'sv10.5w-008',
  Accelgor: 'sv10.5w-009',
  "Acerola's Mischief": 'me01-113',
  Feebas: 'sv08-041',
  'Milotic ex': 'sv08-042',
  Tirtouga: 'sv10.5b-022',
  Carracosta: 'sv10.5b-023',
  'Enriching Energy': 'sv08-191',
  Metapod: 'sv09-002',
  Roggenrola: 'sv10.5w-046',
  Drednaw: 'sv07-044',
  'Cobalion ex': 'me04-064',
  Beldum: 'me04-059',
  Latios: 'me01-101',
  'Mega Latias ex': 'me01-100',
  Yanma: 'sv10-002',
  'Yanmega ex': 'sv10-003',
  Surfer: 'sv08-187',
  Clamperl: 'sv10-054',
  Huntail: 'sv10-055',
  Lotad: 'sv09-035',
  Gastly: 'me03-048',
  Haunter: 'me03-049',
  Gengar: 'me03-050',
  "Misty's Magikarp": 'sv10-048',
  Mankey: 'sv10-090',
  Primeape: 'sv10-091',
  Switch: 'me01-130',
  "Boss's Orders": 'me01-114',
  'Pikachu ex': 'sv08.5-028', // Tera ex, Lightning, 190 HP; Tail Whap {C} 30
  Dreepy: 'sv06-128', // Dragon, 70 HP, no Weakness
  Chikorita: 'me01-008', // Grass, 70 HP
  "N's Darumaka": 'me02.5-032', // Fire, 80 HP; Rolling Tackle {C}{C} 20
  'Dragapult ex': 'sv06-130', // 320 HP, no Weakness
};
/** A test deck of the named cards (10 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('engine5', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const GRA = 'Grass Energy';
const FIR = 'Fire Energy';
const WAT = 'Water Energy';
const LIG = 'Lightning Energy';
const PSY = 'Psychic Energy';
const FIG = 'Fighting Energy';
const DAR = 'Darkness Energy';
const MET = 'Metal Energy';

// Stand-ins for the attacks of the opposing Pokémon in these tests: Fire (N's Darumaka) and Lightning (Pikachu ex).
const darumaka = (program: Program): CardScript[] => [{ id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { program } } }];
const pikachu = (program: Program): CardScript[] => [{ id: 'sv08.5-028', name: 'Pikachu ex', attacks: { 'Tail Whap': { program } } }];
const deal = (n: number): Program => [{ op: 'damage', amount: n, to: 'defender' }];
const dealBench = (n: number): Program => [{ op: 'damage', amount: n, to: { each: 'oppBench' } }];
/** 30 damage and every kind of effect on the Defending Pokémon. */
const HARASS: Program = [
  { op: 'damage', amount: 30, to: 'defender' },
  { op: 'counters', n: 2, to: 'defender' },
  { op: 'condition', cond: 'poisoned', to: 'defender' },
];
const HARASSERS: CardScript[] = [...pikachu(HARASS), ...darumaka(HARASS)];

// ------------------------------------------------------------------ Luxio

test('Luxio, Fighting Roar: while your opponent\'s Active Pokémon is a Pokémon ex it can evolve in your first turn or the turn it was played', () => {
  const dk = deck('Shinx', 'Luxio', 'Luxray', 'Pikachu ex', 'Dreepy');
  const mk = (oppActive: string, turn = 3): Game =>
    scenario(dk, dk, [{ active: 'Shinx', evolve: { active: ['Luxio'] }, hand: ['Luxray'] }, { active: oppActive }], { turn, current: 0, first: 0 });
  // The turn it was played: Luxio evolved from Shinx this turn.
  const ex = mk('Pikachu ex');
  const luxio = ex.state.p[0].active!;
  luxio.evolvedTurn = ex.state.turn;
  assert.ok(canEvolve(ex, 'Luxray', luxio.id), 'against a Pokémon ex');
  const plain = mk('Dreepy');
  plain.state.p[0].active!.evolvedTurn = plain.state.turn;
  assert.ok(!canEvolve(plain, 'Luxray', plain.state.p[0].active!.id), 'not against a Pokémon that is not an ex');
  // The first turn.
  const first = mk('Pikachu ex', 1);
  assert.ok(canEvolve(first, 'Luxray', first.state.p[0].active!.id), 'in the first turn, against a Pokémon ex');
  assert.ok(!canEvolve(mk('Dreepy', 1), 'Luxray', first.state.p[0].active!.id));
  // Later turns are as usual either way, and the evolution works.
  const later = mk('Dreepy');
  assert.ok(canEvolve(later, 'Luxray', later.state.p[0].active!.id));
  choose(ex, 'into Luxray');
  assert.equal(names(ex, ex.state.p[0].active!.cards).at(-1), 'Luxray');
});

// ------------------------------------------------------------------ Forest of Vitality

test('Forest of Vitality: each player\'s {G} Pokémon can evolve into {G} Pokémon the turn they were played, except in their first turn (ruling 2229)', () => {
  const dk = deck('Snivy', 'Servine', 'Serperior', 'Shinx', 'Luxio', 'Dreepy', 'Forest of Vitality');
  const mk = (o: { turn?: number; current?: 0 | 1 } = {}): Game => {
    const g = scenario(
      dk,
      dk,
      [
        { active: 'Dreepy', bench: ['Snivy', 'Shinx'], hand: ['Servine', 'Serperior', 'Luxio'] },
        { active: 'Dreepy', bench: ['Snivy'], hand: ['Servine'] },
      ],
      { turn: o.turn ?? 3, current: o.current ?? 0, first: 0 },
    );
    for (const p of [0, 1] as const) for (const b of g.state.p[p].bench) b.enteredTurn = g.state.turn; // all just played
    return g;
  };
  const g = mk();
  const [snivy, shinx] = g.state.p[0].bench;
  assert.ok(!canEvolve(g, 'Servine', snivy!.id), 'without the Stadium a Pokémon cannot evolve the turn it is played');
  stadium(g, 'Forest of Vitality', 1); // played by the opponent: it covers each player
  assert.ok(canEvolve(g, 'Servine', snivy!.id));
  assert.ok(!canEvolve(g, 'Luxio', shinx!.id), 'only {G} Pokémon');
  assert.ok(!canEvolve(g, 'Serperior', snivy!.id), 'a Stage 2 does not evolve from a Basic');
  // Ruling 2229: Bulbasaur -> Ivysaur -> Venusaur in one turn.
  choose(g, 'into Servine');
  assert.ok(canEvolve(g, 'Serperior', snivy!.id), 'the Servine that was just played can evolve again');
  choose(g, 'into Serperior');
  assert.deepEqual(names(g, snivy!.cards), ['Snivy', 'Servine', 'Serperior']);
  // The second player's Pokémon on their own turn.
  const h = mk({ turn: 4, current: 1 });
  stadium(h, 'Forest of Vitality', 0);
  assert.ok(canEvolve(h, 'Servine', h.state.p[1].bench[0]!.id, 1));
  // Not in the first turn of the game.
  const f = mk({ turn: 1 });
  stadium(f, 'Forest of Vitality', 1);
  assert.ok(!canEvolve(f, 'Servine', f.state.p[0].bench[0]!.id), 'the first turn');
});

// ------------------------------------------------------------------ Eevee

test('Eevee, Boosted Evolution: while it is in the Active Spot it can evolve in your first turn or the turn it was played', () => {
  const dk = deck('Eevee', 'Vaporeon ex', 'Espeon ex', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Eevee', bench: ['Eevee'], hand: ['Vaporeon ex'] }, { active: 'Dreepy' }], { turn: 1, current: 0, first: 0 });
  const [act, bench] = [g.state.p[0].active!, g.state.p[0].bench[0]!];
  assert.ok(canEvolve(g, 'Vaporeon ex', act.id), 'in the first turn, in the Active Spot');
  assert.ok(!canEvolve(g, 'Vaporeon ex', bench.id), 'not on the Bench');
  // The turn it was played.
  const h = scenario(dk, dk, [{ active: 'Eevee', bench: ['Eevee'], hand: ['Vaporeon ex'] }, { active: 'Dreepy' }]);
  for (const sl of [h.state.p[0].active!, h.state.p[0].bench[0]!]) sl.enteredTurn = h.state.turn;
  assert.ok(canEvolve(h, 'Vaporeon ex', h.state.p[0].active!.id));
  assert.ok(!canEvolve(h, 'Vaporeon ex', h.state.p[0].bench[0]!.id));
  choose(h, 'into Vaporeon ex');
  assert.deepEqual(names(h, h.state.p[0].active!.cards), ['Eevee', 'Vaporeon ex']);
});

test('Eevee, Boosted Evolution: the Active Eevee that Strange Timepiece devolved can evolve right away; a Benched one cannot (ruling 2327)', () => {
  const dk = deck('Eevee', 'Vaporeon ex', 'Espeon ex', 'Dreepy', 'Strange Timepiece');
  const g = scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Espeon ex'] }, hand: ['Strange Timepiece', 'Vaporeon ex'] }, { active: 'Dreepy' }]);
  assert.ok(!canEvolve(g, 'Vaporeon ex', g.state.p[0].active!.id), 'an Espeon ex: Vaporeon ex does not evolve from it');
  choose(g, 'Play Strange Timepiece');
  if (g.decision!.kind === 'slots') pickSlot(g, g.state.p[0].active!.id);
  assert.deepEqual(names(g, g.state.p[0].active!.cards), ['Eevee'], 'devolved');
  assert.ok(canEvolve(g, 'Vaporeon ex', g.state.p[0].active!.id), 'Strange Timepiece\'s "can\'t evolve this turn" is reminder text: Boosted Evolution overrides it');
  // The same devolved Eevee on the Bench has no Ability to do that.
  const h = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Eevee'], evolve: { 0: ['Espeon ex'] }, hand: ['Strange Timepiece', 'Vaporeon ex'] }, { active: 'Dreepy' }]);
  choose(h, 'Play Strange Timepiece');
  if (h.decision!.kind === 'slots') pickSlot(h, h.state.p[0].bench[0]!.id);
  assert.deepEqual(names(h, h.state.p[0].bench[0]!.cards), ['Eevee']);
  assert.ok(!canEvolve(h, 'Vaporeon ex', h.state.p[0].bench[0]!.id), 'on the Bench: it evolved this turn, so it cannot evolve again');
});

test('Eevee, Reckless Charge: 30 damage, and this Pokémon also does 10 damage to itself', () => {
  const dk = deck('Eevee', 'Dragapult ex');
  const g = scenario(dk, dk, [{ active: 'Eevee', energy: { active: [PSY, PSY] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Reckless Charge');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.equal(g.state.p[0].active!.damage, 10);
});

test('Eevee (the promo printing, svp-173) has the same Ability', () => {
  const dk = fromIds('promo', [['svp-173', 10], ['sv08.5-023', 10], ['sv06-128', 10], ...ENERGY]);
  const g = scenario(dk, dk, [{ active: 'Eevee', hand: ['Vaporeon ex'] }, { active: 'Dreepy' }], { turn: 1, current: 0, first: 0 });
  assert.ok(canEvolve(g, 'Vaporeon ex', g.state.p[0].active!.id));
});

// ------------------------------------------------------------------ Eevee ex

test('Eevee ex, Rainbow DNA: it can evolve into any Pokémon ex that evolves from Eevee, not into one that is not an ex; the usual timing still applies', () => {
  const dk = deck('Eevee', 'Eevee ex', 'Vaporeon ex', 'Espeon ex', 'Leafeon', 'Luxio', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Eevee ex', 'Eevee'], hand: ['Vaporeon ex', 'Espeon ex', 'Leafeon', 'Luxio'] }, { active: 'Dreepy' }]);
  const [exx, plain] = g.state.p[0].bench;
  assert.ok(canEvolve(g, 'Vaporeon ex', exx!.id));
  assert.ok(canEvolve(g, 'Espeon ex', exx!.id), 'any Pokémon ex that evolves from Eevee');
  assert.ok(!canEvolve(g, 'Leafeon', exx!.id), 'not one that is not a Pokémon ex');
  assert.ok(!canEvolve(g, 'Luxio', exx!.id), 'not a card that evolves from something else');
  assert.ok(canEvolve(g, 'Leafeon', plain!.id), 'an ordinary Eevee evolves as always');
  // "(This Pokémon can't evolve during your first turn or the turn you play it.)"
  exx!.enteredTurn = g.state.turn;
  assert.ok(!canEvolve(g, 'Vaporeon ex', exx!.id), 'the turn it was played');
  exx!.enteredTurn = 0;
  const f = scenario(dk, dk, [{ active: 'Eevee ex', hand: ['Vaporeon ex'] }, { active: 'Dreepy' }], { turn: 1, current: 0, first: 0 });
  assert.ok(!canEvolve(f, 'Vaporeon ex', f.state.p[0].active!.id), 'the first turn');
  // The evolution is played from the hand onto it.
  const h = scenario(dk, dk, [{ active: 'Eevee ex', hand: ['Espeon ex'] }, { active: 'Dreepy' }]);
  choose(h, 'into Espeon ex');
  assert.deepEqual(names(h, h.state.p[0].active!.cards), ['Eevee ex', 'Espeon ex']);
});

test('Eevee ex (the promo printing, svp-174) has the same Ability', () => {
  const dk = fromIds('promo', [['svp-174', 10], ['sv08.5-023', 10], ['sv06-128', 10], ...ENERGY]);
  const g = scenario(dk, dk, [{ active: 'Eevee ex', hand: ['Vaporeon ex'] }, { active: 'Dreepy' }]);
  assert.ok(canEvolve(g, 'Vaporeon ex', g.state.p[0].active!.id));
});

// ------------------------------------------------------------------ Karrablast, Shelmet

test('Karrablast and Shelmet, Stimulated Evolution: with the other one in play they can evolve in your first turn or the turn they were played', () => {
  const dk = deck('Karrablast', 'Escavalier', 'Shelmet', 'Accelgor', 'Dreepy');
  const first = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Karrablast', 'Shelmet'], hand: ['Escavalier', 'Accelgor'] }, { active: 'Dreepy' }], { turn: 1, current: 0, first: 0 });
  const [k, s] = first.state.p[0].bench;
  assert.ok(canEvolve(first, 'Escavalier', k!.id), 'Karrablast, with Shelmet in play, in the first turn');
  assert.ok(canEvolve(first, 'Accelgor', s!.id), 'Shelmet, with Karrablast in play, in the first turn');
  // The turn it was played.
  const played = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Karrablast', 'Shelmet'], hand: ['Escavalier', 'Accelgor'] }, { active: 'Dreepy' }]);
  for (const b of played.state.p[0].bench) b.enteredTurn = played.state.turn;
  assert.ok(canEvolve(played, 'Escavalier', played.state.p[0].bench[0]!.id));
  assert.ok(canEvolve(played, 'Accelgor', played.state.p[0].bench[1]!.id));
  choose(played, 'into Escavalier');
  // Without the other one in play, or with the opponent's, nothing.
  const alone = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Karrablast'], hand: ['Escavalier'] }, { active: 'Dreepy', bench: ['Shelmet'] }], { turn: 1, current: 0, first: 0 });
  assert.ok(!canEvolve(alone, 'Escavalier', alone.state.p[0].bench[0]!.id), '"If you have Shelmet in play": the opponent\'s Shelmet does not count');
  const ordinary = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Karrablast'], hand: ['Escavalier'] }, { active: 'Dreepy' }]);
  assert.ok(canEvolve(ordinary, 'Escavalier', ordinary.state.p[0].bench[0]!.id), 'an ordinary evolution in turn 3');
  ordinary.state.p[0].bench[0]!.enteredTurn = ordinary.state.turn;
  assert.ok(!canEvolve(ordinary, 'Escavalier', ordinary.state.p[0].bench[0]!.id), 'the turn it was played, with no Shelmet');
});

// ------------------------------------------------------------------ Acerola's Mischief

test("Acerola's Mischief: usable only against 2 or fewer Prize cards; the chosen Pokémon takes no damage or effects from the opponent's Pokémon ex during their next turn", () => {
  const dk = deck("Acerola's Mischief", 'Pikachu ex', "N's Darumaka", 'Dreepy', 'Chikorita');
  const mk = (attacker: string, prizes: number): Game =>
    scenario(
      dk,
      dk,
      [
        { active: 'Dreepy', bench: ['Chikorita'], hand: ["Acerola's Mischief"] },
        { active: attacker, energy: { active: attacker === 'Pikachu ex' ? [LIG] : [FIR, FIR] }, prizes },
      ],
      { scripts: HARASSERS },
    );
  assert.ok(!has(mk('Pikachu ex', 3), "Play Acerola's Mischief"), 'the opponent has 3 Prize cards remaining');
  const g = mk('Pikachu ex', 2);
  choose(g, "Play Acerola's Mischief");
  assert.equal(g.decision!.kind, 'slots');
  pickSlot(g, g.state.p[0].active!.id);
  choose(g, 'End turn');
  const target = g.state.p[0].active!;
  choose(g, 'Attack: Tail Whap');
  assert.equal(target.damage, 0, 'no damage from a Pokémon ex');
  assert.equal(target.cond, 0, 'no Special Condition');
  // From a Pokémon that is not an ex: damage and effects as usual.
  const h = mk("N's Darumaka", 1);
  choose(h, "Play Acerola's Mischief");
  pickSlot(h, h.state.p[0].active!.id);
  choose(h, 'End turn');
  choose(h, 'Attack: Rolling Tackle');
  assert.equal(h.state.p[0].active!.damage, 30 + 20 + 10, '30 damage, 2 damage counters and the Poison counter at Checkup');
  assert.equal(h.state.p[0].active!.cond & POISONED, POISONED);
});

test("Acerola's Mischief: moving the protected Pokémon to the Bench does not remove the protection (ruling 2228)", () => {
  const dk = deck("Acerola's Mischief", 'Pikachu ex', 'Dreepy', 'Chikorita');
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Dreepy', bench: ['Chikorita', 'Chikorita'], energy: { active: [PSY, PSY] }, hand: ["Acerola's Mischief"] },
      { active: 'Pikachu ex', energy: { active: [LIG] }, prizes: 2 },
    ],
    { scripts: pikachu(dealBench(30)) },
  );
  const dreepy = g.state.p[0].active!;
  choose(g, "Play Acerola's Mischief");
  pickSlot(g, dreepy.id);
  choose(g, 'Retreat');
  g.submit([0]); // the Energy to discard
  pickSlot(g, g.state.p[0].bench[0]!.id);
  assert.notEqual(g.state.p[0].active, dreepy);
  choose(g, 'End turn');
  choose(g, 'Attack: Tail Whap');
  assert.equal(dreepy.damage, 0, 'the Benched Dreepy is still protected from the Pokémon ex');
  assert.equal(g.state.p[0].bench.filter((b) => b !== dreepy).map((b) => b.damage).join(), '30', 'the other Benched Pokémon took the 30');
});

// ------------------------------------------------------------------ Milotic ex

test('Milotic ex, Sparkling Scales: no damage and no effects from your opponent\'s Tera Pokémon, but from other Pokémon as usual', () => {
  const dk = deck('Feebas', 'Milotic ex', 'Pikachu ex', "N's Darumaka", 'Dreepy');
  const mk = (attacker: string): Game =>
    scenario(dk, dk, [{ active: 'Feebas', evolve: { active: ['Milotic ex'] } }, { active: attacker, energy: { active: attacker === 'Pikachu ex' ? [LIG] : [FIR, FIR] } }], {
      current: 1,
      turn: 4,
      scripts: HARASSERS,
    });
  const tera = mk('Pikachu ex');
  choose(tera, 'Attack: Tail Whap');
  assert.equal(tera.state.p[0].active!.damage, 0);
  assert.equal(tera.state.p[0].active!.cond, 0);
  const plain = mk("N's Darumaka");
  choose(plain, 'Attack: Rolling Tackle');
  assert.equal(plain.state.p[0].active!.damage, 30 + 20 + 10);
  assert.equal(plain.state.p[0].active!.cond & POISONED, POISONED);
});

test('Milotic ex, Hypno Splash: 160 damage, and your opponent\'s Active Pokémon is now Asleep', () => {
  const dk = deck('Feebas', 'Milotic ex', 'Dragapult ex');
  const g = scenario(dk, dk, [{ active: 'Feebas', evolve: { active: ['Milotic ex'] }, energy: { active: [WAT, WAT, WAT] } }, { active: 'Dragapult ex' }]);
  g.state.forcedCoins = [false]; // the Asleep check at Pokémon Checkup: tails, so it stays Asleep
  choose(g, 'Attack: Hypno Splash');
  assert.equal(g.state.p[1].active!.damage, 160);
  assert.equal(g.state.p[1].active!.cond & ASLEEP, ASLEEP);
});

// ------------------------------------------------------------------ Carracosta

test('Carracosta, Mighty Shell: no damage or effects from Pokémon that have any Special Energy attached', () => {
  const dk = deck('Tirtouga', 'Carracosta', 'Pikachu ex', 'Dreepy', 'Enriching Energy');
  const mk = (energy: string): Game =>
    scenario(dk, dk, [{ active: 'Tirtouga', evolve: { active: ['Carracosta'] } }, { active: 'Pikachu ex', energy: { active: [energy] } }], {
      current: 1,
      turn: 4,
      scripts: HARASSERS,
    });
  const special = mk('Enriching Energy');
  choose(special, 'Attack: Tail Whap');
  assert.equal(special.state.p[0].active!.damage, 0);
  assert.equal(special.state.p[0].active!.cond, 0);
  const basic = mk(LIG);
  choose(basic, 'Attack: Tail Whap');
  // 30 doubled by Carracosta's printed Weakness to {L} (cards/printed-wr.ts), 2 damage counters, then Poison at Checkup.
  assert.equal(basic.state.p[0].active!.damage, 30 * 2 + 20 + 10, 'a Basic Energy is not a Special Energy');
});

test('Carracosta, Big Bite: 150 damage, and the Defending Pokémon can\'t retreat during your opponent\'s next turn', () => {
  const dk = deck('Tirtouga', 'Carracosta', 'Dragapult ex', 'Dreepy');
  const mk = (): Game =>
    scenario(dk, dk, [{ active: 'Tirtouga', evolve: { active: ['Carracosta'] }, energy: { active: [WAT, WAT, WAT] } }, { active: 'Dragapult ex', bench: ['Dreepy'], energy: { active: [PSY, PSY, PSY] } }]);
  const g = mk();
  choose(g, 'Attack: Big Bite');
  assert.equal(g.state.p[1].active!.damage, 150);
  assert.ok(!has(g, 'Retreat'), 'the Defending Pokémon can\'t retreat');
  assert.ok(has(g, 'Attack:'), 'but it has a turn');
});

// ------------------------------------------------------------------ Metapod, Roggenrola

test("Metapod, Harden: during the opponent's next turn damage of 60 or less is prevented, counted after Weakness (ruling 2197)", () => {
  const dk = deck('Metapod', "N's Darumaka", 'Dreepy');
  const run = (base: number): number => {
    const g = scenario(dk, dk, [{ active: 'Metapod', energy: { active: [GRA] } }, { active: "N's Darumaka", energy: { active: [FIR, FIR] } }], { scripts: darumaka(deal(base)) });
    choose(g, 'Attack: Harden');
    choose(g, 'Attack: Rolling Tackle');
    return g.state.p[0].active!.damage;
  };
  assert.equal(run(20), 0, '20: prevented');
  assert.equal(run(30), 0, '30, doubled by Metapod\'s Fire Weakness to 60: prevented');
  assert.equal(run(40), 80, '40, doubled to 80: not prevented');
});

test("Roggenrola, Harden: during the opponent's next turn damage of 40 or less is prevented; Rolling Rocks does 30", () => {
  const dk = deck('Roggenrola', 'Pikachu ex', 'Dragapult ex', 'Dreepy');
  const run = (base: number): number => {
    const g = scenario(dk, dk, [{ active: 'Roggenrola', energy: { active: [FIG] } }, { active: 'Pikachu ex', energy: { active: [LIG] } }], { scripts: pikachu(deal(base)) });
    choose(g, 'Attack: Harden');
    choose(g, 'Attack: Tail Whap');
    return g.state.p[0].active!.damage;
  };
  assert.equal(run(40), 0, '40: prevented');
  assert.equal(run(50), 50, '50: not prevented');
  const g = scenario(dk, dk, [{ active: 'Roggenrola', energy: { active: [FIG, FIG] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Rolling Rocks');
  assert.equal(g.state.p[1].active!.damage, 30);
});

test('Roggenrola, Harden: once it leaves the Active Spot the effect goes away (ruling 2196)', () => {
  const dk = deck('Roggenrola', 'Pikachu ex', 'Dreepy', "Boss's Orders");
  const g = scenario(
    dk,
    dk,
    [{ active: 'Roggenrola', bench: ['Dreepy'], energy: { active: [FIG] } }, { active: 'Pikachu ex', energy: { active: [LIG] }, hand: ["Boss's Orders"] }],
    { scripts: pikachu(dealBench(40)) },
  );
  const rog = g.state.p[0].active!;
  choose(g, 'Attack: Harden');
  choose(g, "Play Boss's Orders"); // brings the Benched Dreepy up; Roggenrola goes to the Bench
  if (g.decision!.kind === 'slots') pickSlot(g, g.state.p[0].bench[0]!.id);
  assert.notEqual(g.state.p[0].active, rog);
  choose(g, 'Attack: Tail Whap');
  assert.equal(rog.damage, 40, 'Benched, the 40 damage is no longer prevented');
});

// ------------------------------------------------------------------ Drednaw

test('Drednaw, Impervious Shell: damage from your opponent\'s Pokémon of 200 or more is prevented, counted after Weakness', () => {
  const dk = deck('Drednaw', 'Pikachu ex', 'Dreepy');
  const run = (base: number): { damage: number; prizes: number } => {
    const g = scenario(dk, dk, [{ active: 'Drednaw', bench: ['Dreepy'] }, { active: 'Pikachu ex', energy: { active: [LIG] } }], { current: 1, turn: 4, scripts: pikachu(deal(base)) });
    choose(g, 'Attack: Tail Whap');
    const sl = g.state.p[0].active!;
    return { damage: names(g, sl.cards)[0] === 'Drednaw' ? sl.damage : -1, prizes: g.state.p[1].prizes.length };
  };
  assert.deepEqual(run(100), { damage: 0, prizes: 6 }, '100, doubled by the Lightning Weakness to 200: prevented');
  assert.deepEqual(run(200), { damage: 0, prizes: 6 }, '200: prevented');
  assert.deepEqual(run(90), { damage: -1, prizes: 5 }, '90, doubled to 180: not prevented (Knocked Out)');
  // On the Bench too.
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Drednaw'] }, { active: 'Pikachu ex', energy: { active: [LIG] } }], { current: 1, turn: 4, scripts: pikachu(dealBench(200)) });
  choose(g, 'Attack: Tail Whap');
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
});

test('Drednaw, Hard Crunch: 80 damage, and 80 more if your opponent\'s Active Pokémon already has damage counters on it', () => {
  const dk = deck('Drednaw', 'Dragapult ex');
  const run = (damage: number): number => {
    const g = scenario(dk, dk, [{ active: 'Drednaw', energy: { active: [WAT, WAT, WAT] } }, { active: 'Dragapult ex', damage: { active: damage } }]);
    choose(g, 'Attack: Hard Crunch');
    return g.state.p[1].active!.damage - damage;
  };
  assert.equal(run(0), 80);
  assert.equal(run(10), 160);
});

// ------------------------------------------------------------------ Cobalion ex

test('Cobalion ex, Metal Road: once during your turn, when it moves from the Bench to the Active Spot, you may move any amount of {M} Energy from your other Pokémon to it', () => {
  const dk = deck('Cobalion ex', 'Beldum', 'Dreepy', 'Switch');
  const g = scenario(dk, dk, [
    { active: 'Dreepy', bench: ['Cobalion ex', 'Beldum', 'Dreepy'], hand: ['Switch', 'Switch', 'Switch'], energy: { 1: [MET, MET, FIR], 2: [MET] } },
    { active: 'Dreepy' },
  ]);
  const cob = g.state.p[0].bench[0]!;
  const dreepy = g.state.p[0].active!;
  choose(g, 'Play Switch');
  pickSlot(g, cob.id);
  assert.equal(g.decision!.kind, 'yesno', 'you may use this Ability');
  choose(g, 'Yes');
  assert.equal(g.decision!.kind, 'cards');
  assert.deepEqual(names(g, g.decision!.values as number[]), [MET, MET, MET], '{M} Energy only: not the Fire Energy');
  assert.equal(g.decision!.min, 0, 'any amount');
  g.submit([0, 1]);
  assert.deepEqual(names(g, cob.energy), [MET, MET]);
  assert.equal(g.state.p[0].bench.reduce((n, b) => n + b.energy.length, 0), 2, 'the other Pokémon keep the rest (a Fire Energy and a {M} Energy)');
  // Once during your turn: move it to the Bench and back up.
  choose(g, 'Play Switch');
  pickSlot(g, dreepy.id);
  assert.equal(g.state.p[0].active, dreepy);
  choose(g, 'Play Switch');
  pickSlot(g, cob.id);
  assert.equal(g.decision!.kind, 'main', 'not again this turn');
});

test('Cobalion ex, Metal Road: declining is not a use; it is not used on your opponent\'s turn', () => {
  const dk = deck('Cobalion ex', 'Beldum', 'Dreepy', 'Switch', "Boss's Orders");
  const g = scenario(dk, dk, [
    { active: 'Dreepy', bench: ['Cobalion ex', 'Beldum'], hand: ['Switch', 'Switch'], energy: { 1: [MET] } },
    { active: 'Dreepy' },
  ]);
  const cob = g.state.p[0].bench[0]!;
  const dreepy = g.state.p[0].active!;
  choose(g, 'Play Switch');
  pickSlot(g, cob.id);
  choose(g, 'No');
  assert.equal(cob.energy.length, 0);
  choose(g, 'Play Switch');
  pickSlot(g, dreepy.id);
  // ...so the next time it moves up it is offered again (a declined use does not count).
  g.state.p[0].hand.push(g.state.p[0].deck.splice(g.state.p[0].deck.findIndex((c) => nameOf(g, c) === 'Switch'), 1)[0]!);
  g.state.pending = null;
  advance(g.env, g.state);
  choose(g, 'Play Switch');
  pickSlot(g, cob.id);
  assert.equal(g.decision!.kind, 'yesno');
  // On the opponent's turn it is never offered.
  const h = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Cobalion ex', 'Beldum'], energy: { 1: [MET] } }, { active: 'Dreepy', hand: ["Boss's Orders"] }], { current: 1, turn: 4 });
  choose(h, "Play Boss's Orders");
  pickSlot(h, h.state.p[0].bench[0]!.id);
  assert.equal(h.state.p[0].active!.cards.length, 1);
  assert.equal(names(h, h.state.p[0].active!.cards)[0], 'Cobalion ex');
  assert.equal(h.decision!.kind, 'main');
  assert.equal(h.decision!.player, 1, 'no question for the player whose turn it is not');
});

test('Cobalion ex, Power Tackle: 200 damage, and during your next turn this Pokémon can\'t use attacks', () => {
  const dk = deck('Cobalion ex', 'Dragapult ex', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Cobalion ex', energy: { active: [MET, MET, MET] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Power Tackle');
  assert.equal(g.state.p[1].active!.damage, 200);
  choose(g, 'End turn'); // the opponent's turn
  assert.ok(!has(g, 'Attack: Power Tackle'), 'your next turn: no attacks');
});

// ------------------------------------------------------------------ Latios

test('Latios, Lustrous Assist: when your Mega Latias ex moves up, you may move any amount of Energy from your Benched Pokémon to your Active Pokémon', () => {
  const dk = deck('Latios', 'Mega Latias ex', 'Dreepy', 'Switch');
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Dreepy', bench: ['Latios', 'Mega Latias ex', 'Dreepy'], hand: ['Switch', 'Switch'], energy: { active: [PSY], 0: [WAT], 2: [FIR] } },
      { active: 'Dreepy' },
    ]);
  const g = mk();
  const [latios, latias, other] = g.state.p[0].bench;
  // Another Pokémon moving up does not count.
  choose(g, 'Play Switch');
  pickSlot(g, other!.id);
  assert.equal(g.decision!.kind, 'main', 'it is not Mega Latias ex');
  choose(g, 'Play Switch');
  pickSlot(g, latias!.id);
  assert.equal(g.decision!.kind, 'yesno', 'Mega Latias ex moved up');
  choose(g, 'Yes');
  assert.equal(g.decision!.kind, 'cards');
  assert.equal(g.decision!.min, 0, 'any amount');
  const pool = g.decision!.values as number[];
  assert.deepEqual(names(g, pool).sort(), [FIR, PSY, WAT].sort(), 'the Energy of every Pokémon now on the Bench: Latios, the Dreepy that left the Active Spot and the Dreepy that moved up before');
  void latios;
  g.submit([pool.findIndex((c) => nameOf(g, c) === PSY), pool.findIndex((c) => nameOf(g, c) === WAT)]);
  assert.deepEqual(names(g, g.state.p[0].active!.energy).sort(), [PSY, WAT].sort());
  assert.equal(g.state.p[0].bench.reduce((n, b) => n + b.energy.length, 0), 1, 'the Fire Energy that was not picked stays where it was');
});

// ------------------------------------------------------------------ Yanmega ex

test('Yanmega ex, Buzzing Boost: when it moves up you may attach up to 3 Basic {G} Energy from your deck to it; Surfer\'s draw comes first (ruling 2142)', () => {
  const dk = deck('Yanma', 'Yanmega ex', 'Dreepy', 'Surfer');
  const g = scenario(dk, dk, [
    { active: 'Dreepy', bench: ['Yanma', 'Dreepy'], evolve: { 0: ['Yanmega ex'] }, hand: ['Surfer', 'Dreepy'] },
    { active: 'Dreepy' },
  ]);
  const yan = g.state.p[0].bench[0]!;
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Play Surfer');
  pickSlot(g, yan.id);
  assert.equal(g.decision!.kind, 'yesno');
  assert.equal(g.state.p[0].hand.length, 5, 'Surfer drew first: up to 5 cards in hand');
  choose(g, 'Yes');
  assert.equal(g.decision!.kind, 'cards');
  assert.equal(g.decision!.max, 3, 'up to 3');
  assert.ok((g.decision!.values as number[]).every((c) => nameOf(g, c) === GRA), 'Basic {G} Energy only');
  g.submit([0, 1, 2]);
  assert.deepEqual(names(g, yan.energy), [GRA, GRA, GRA]);
  assert.equal(g.state.p[0].deck.length, deckBefore - 3 - 4, 'three Energy attached and the four cards Surfer drew left the deck');
});

test('Yanmega ex, Jet Cyclone: 210 damage, and move 3 Energy from this Pokémon to 1 of your Benched Pokémon', () => {
  const dk = deck('Yanma', 'Yanmega ex', 'Dreepy', 'Dragapult ex');
  const g = scenario(dk, dk, [
    { active: 'Yanma', evolve: { active: ['Yanmega ex'] }, bench: ['Dreepy'], energy: { active: [GRA, GRA, GRA, GRA, GRA] } },
    { active: 'Dragapult ex' },
  ]);
  const bench = g.state.p[0].bench[0]!;
  const yan = g.state.p[0].active!;
  choose(g, 'Attack: Jet Cyclone');
  assert.equal(g.state.p[1].active!.damage, 210);
  assert.equal(g.decision!.kind, 'cards', 'the only Benched Pokémon is the destination; which 3 Energy?');
  assert.equal(g.decision!.min, 3);
  assert.equal(g.decision!.max, 3);
  g.submit([0, 1, 2]);
  assert.equal(bench.energy.length, 3);
  assert.equal(yan.energy.length, 2);
  // Nothing to move to without a Benched Pokémon.
  const alone = scenario(dk, dk, [{ active: 'Yanma', evolve: { active: ['Yanmega ex'] }, energy: { active: [GRA, GRA, GRA, GRA] } }, { active: 'Dragapult ex' }]);
  choose(alone, 'Attack: Jet Cyclone');
  assert.equal(alone.state.p[0].active!.energy.length, 4);
});

// ------------------------------------------------------------------ Huntail

test('Huntail, Diver\'s Catch: when 1 of your {W} Pokémon is Knocked Out by damage from an attack you may put its Basic {W} Energy into your hand instead of the discard pile', () => {
  const dk = deck('Clamperl', 'Huntail', 'Lotad', 'Dreepy', "N's Darumaka");
  // Huntail on the Bench.
  const h = scenario(
    dk,
    dk,
    [
      { active: 'Lotad', bench: ['Clamperl', 'Dreepy'], evolve: { 0: ['Huntail'] }, energy: { active: [WAT, WAT, FIR] } },
      { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
    ],
    { current: 1, turn: 4, scripts: darumaka(deal(200)) },
  );
  choose(h, 'Attack: Rolling Tackle');
  assert.equal(h.decision!.kind, 'yesno', 'you may');
  assert.equal(h.state.p[1].prizes.length, 6);
  choose(h, 'Yes');
  assert.equal(count(h, h.state.p[0].hand, WAT), 2, 'both Basic {W} Energy cards are in the hand');
  assert.equal(count(h, h.state.p[0].hand, FIR), 0, 'the Fire Energy is not');
  assert.ok(count(h, h.state.p[0].discard, FIR) === 1 && count(h, h.state.p[0].discard, 'Lotad') === 1, 'it and the Lotad are in the discard pile');
  assert.equal(h.state.p[1].prizes.length, 5, 'a Knock Out: the Prize card is taken');
  // Declined.
  const n = scenario(
    dk,
    dk,
    [
      { active: 'Lotad', bench: ['Clamperl', 'Dreepy'], evolve: { 0: ['Huntail'] }, energy: { active: [WAT, WAT, FIR] } },
      { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
    ],
    { current: 1, turn: 4, scripts: darumaka(deal(200)) },
  );
  choose(n, 'Attack: Rolling Tackle');
  choose(n, 'No');
  assert.equal(count(n, n.state.p[0].hand, WAT), 0);
  assert.equal(count(n, n.state.p[0].discard, WAT), 2);
  // Without Huntail in play: no question. A Pokémon that is not {W}: no question.
  const none = scenario(dk, dk, [{ active: 'Lotad', bench: ['Dreepy'], energy: { active: [WAT] } }, { active: "N's Darumaka", energy: { active: [FIR, FIR] } }], { current: 1, turn: 4, scripts: darumaka(deal(200)) });
  choose(none, 'Attack: Rolling Tackle');
  assert.notEqual(none.decision?.kind, 'yesno');
  const dreepy = scenario(
    dk,
    dk,
    [
      { active: 'Dreepy', bench: ['Clamperl', 'Dreepy'], evolve: { 0: ['Huntail'] }, energy: { active: [WAT] } },
      { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
    ],
    { current: 1, turn: 4, scripts: darumaka(deal(200)) },
  );
  choose(dreepy, 'Attack: Rolling Tackle');
  assert.notEqual(dreepy.decision?.kind, 'yesno', 'a Dreepy is not a {W} Pokémon');
});

test('Huntail, Diver\'s Catch: it covers Huntail itself, but not a Knock Out that is not by damage from an attack', () => {
  const dk = deck('Clamperl', 'Huntail', 'Dreepy', "N's Darumaka");
  const self = scenario(
    dk,
    dk,
    [
      { active: 'Clamperl', evolve: { active: ['Huntail'] }, bench: ['Dreepy'], energy: { active: [WAT] } },
      { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
    ],
    { current: 1, turn: 4, scripts: darumaka(deal(200)) },
  );
  choose(self, 'Attack: Rolling Tackle');
  assert.equal(self.decision!.kind, 'yesno');
  // Poison at Checkup knocks it out: no question.
  const poisoned = scenario(dk, dk, [{ active: 'Clamperl', evolve: { active: ['Huntail'] }, bench: ['Dreepy'], energy: { active: [WAT] }, damage: { active: 110 }, cond: POISONED }, { active: 'Dreepy' }]);
  choose(poisoned, 'End turn');
  assert.notEqual(poisoned.decision?.kind, 'yesno');
  assert.equal(count(poisoned, poisoned.state.p[0].discard, WAT), 1, 'the Energy went to the discard pile');
});

// ------------------------------------------------------------------ Gengar

test('Gengar, Infinite Shadow: when it is Knocked Out by damage from an attack, the whole stack goes to your hand and the attached cards to the discard pile; the opponent still takes a Prize card (rulings 2308, 2307)', () => {
  const dk = deck('Gastly', 'Haunter', 'Gengar', 'Dreepy', "N's Darumaka");
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Gastly', evolve: { active: ['Haunter', 'Gengar'] }, bench: ['Dreepy'], energy: { active: [DAR] } },
      { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
    ],
    { current: 1, turn: 4, scripts: darumaka(deal(200)) },
  );
  choose(g, 'Attack: Rolling Tackle');
  const hand = names(g, g.state.p[0].hand);
  for (const n of ['Gastly', 'Haunter', 'Gengar']) assert.ok(hand.includes(n), `${n} (Ruling 2308: "this Pokémon" includes the underlying cards) is in the hand`);
  assert.deepEqual(names(g, g.state.p[0].discard), [DAR], 'the attached Energy was discarded');
  assert.equal(g.state.p[1].prizes.length, 5, 'Ruling 2307: it was still Knocked Out, so the opponent takes a Prize card');
});

test('Gengar, Infinite Shadow: a Knock Out that is not by damage from an attack puts it in the discard pile as usual', () => {
  const dk = deck('Gastly', 'Haunter', 'Gengar', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Gastly', evolve: { active: ['Haunter', 'Gengar'] }, bench: ['Dreepy'], damage: { active: 120 }, cond: POISONED }, { active: 'Dreepy' }]);
  choose(g, 'End turn');
  assert.ok(!names(g, g.state.p[0].hand).includes('Gengar'));
  assert.equal(count(g, g.state.p[0].discard, 'Gengar'), 1);
});

test('Gengar, Mind Jack: 10 damage, and 30 more for each of your opponent\'s Benched Pokémon', () => {
  const dk = deck('Gastly', 'Haunter', 'Gengar', 'Dragapult ex', 'Dreepy');
  const run = (bench: number): number => {
    const g = scenario(dk, dk, [{ active: 'Gastly', evolve: { active: ['Haunter', 'Gengar'] }, energy: { active: [DAR] } }, { active: 'Dragapult ex', bench: rep('Dreepy', bench) }]);
    choose(g, 'Attack: Mind Jack');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(0), 10);
  assert.equal(run(3), 100);
});

// ------------------------------------------------------------------ Misty's Magikarp

test("Misty's Magikarp, So Submerged: on the Bench it takes no damage and no effects from attacks; in the Active Spot it is hit as usual", () => {
  const dk = deck("Misty's Magikarp", 'Dreepy', 'Pikachu ex');
  const spread: Program = [...dealBench(30), { op: 'counters', n: 2, to: { each: 'oppBench' } }, ...deal(10)];
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ["Misty's Magikarp", 'Dreepy'] }, { active: 'Pikachu ex', energy: { active: [LIG] } }], { current: 1, turn: 4, scripts: pikachu(spread) });
  const [magikarp, dreepy] = g.state.p[0].bench;
  choose(g, 'Attack: Tail Whap');
  assert.equal(magikarp!.damage, 0, 'protected on the Bench');
  assert.equal(dreepy!.damage, 30 + 20, 'the other Benched Pokémon took the damage and the counters');
  // In the Active Spot there is no protection.
  const h = scenario(dk, dk, [{ active: "Misty's Magikarp", bench: ['Dreepy'] }, { active: 'Pikachu ex', energy: { active: [LIG] } }], { current: 1, turn: 4, scripts: pikachu(deal(10)) });
  choose(h, 'Attack: Tail Whap');
  assert.equal(h.state.p[0].active!.damage, 10 * 2, '10, doubled by Magikarp\'s Lightning Weakness');
});

test("Misty's Magikarp, So Submerged: an attack can't switch it into the Active Spot, and the damage to the new Active Pokémon doesn't happen (ruling 2155, Primeape's Drag Off)", () => {
  const dk = deck("Misty's Magikarp", 'Dreepy', 'Chikorita', 'Mankey', 'Primeape');
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Dreepy', bench: ["Misty's Magikarp", 'Chikorita'] },
      { active: 'Mankey', evolve: { active: ['Primeape'] }, energy: { active: [FIG] } },
    ], { current: 1, turn: 4 });
  const g = mk();
  const [magikarp] = g.state.p[0].bench;
  const dreepy = g.state.p[0].active!;
  choose(g, 'Attack: Drag Off');
  pickSlot(g, magikarp!.id);
  assert.equal(g.state.p[0].active, dreepy, 'Misty\'s Magikarp was not brought up');
  assert.equal(dreepy.damage, 0, 'and there was no new Active Pokémon to damage');
  assert.equal(magikarp!.damage, 0);
  // Another Benched Pokémon is switched in and damaged as usual.
  const h = mk();
  const [, chik2] = h.state.p[0].bench;
  choose(h, 'Attack: Drag Off');
  pickSlot(h, chik2!.id);
  assert.equal(h.state.p[0].active, chik2);
  assert.equal(chik2!.damage, 30, '30 to the new Active Pokémon');
});
