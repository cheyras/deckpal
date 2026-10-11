/**
 * Engine features added with the std-engine5 batch, each tested on its own (the cards that use them are in
 * cards-std-engine5.test.ts):
 *  1. evolution timing and targets (`evolveTiming`, `evolveInto`)   2. prevention of attack effects by attacker (`preventDamage` + `andEffects` + `attacker`)
 *  3. damage prevention by amount (`ifAtMost`, `ifAtLeast`)         4. Bench-to-Active triggers (`movedToActive`, `allyMovedToActive`)
 *  5. Knock Out to the hand (`koToHand`)                             6. a switch from an attack checks the Benched Pokémon brought up
 *  7. the real Bench size in the search helpers (`BENCH_SPACE`, Area Zero Underdepths)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript, Program, StaticEffect } from '../dsl.js';
import { advance, legalActions, submit } from '../flow.js';
import type { Game } from '../game.js';
import { POISONED } from '../types.js';
import { effectsPrevented, damagePrevented, statics } from '../query.js';
import { scenario } from '../scenario.js';
import { cloneState, findSlot } from '../state.js';
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
/** Answer a slot decision with the Pokémon whose slot id this is. */
function pickSlot(g: Game, id: number): void {
  const i = (g.decision!.values as number[]).indexOf(id);
  assert.ok(i >= 0, `slot ${id} is not offered: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
/** The legal actions were listed when the position was built: list them again after changing it by hand. */
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const names = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Shinx: 'me03-026',
  Luxio: 'me03-027',
  Luxray: 'me03-028',
  Eevee: 'sv08-143',
  'Vaporeon ex': 'sv08.5-023',
  'Espeon ex': 'sv08.5-034',
  'Pikachu ex': 'sv08.5-028', // Tera ex, 190 HP; Tail Whap {C} 30
  Dreepy: 'sv06-128', // 70 HP, no Weakness
  Drakloak: 'sv06-129',
  Chikorita: 'me01-008', // Grass, 70 HP, Fire-weak
  Metapod: 'sv09-002', // Grass, 90 HP, Fire-weak
  "N's Darumaka": 'me02.5-032', // Fire, 80 HP; Rolling Tackle {C}{C} 20
  Lotad: 'sv09-035', // Water, 60 HP; Water Gun {W} 20
  Switch: 'me01-130',
  "Boss's Orders": 'me01-114',
  "Hero's Cape": 'sv05-152',
  'Maximum Belt': 'sv05-154',
  'Area Zero Underdepths': 'sv07-131',
  'Precious Trolley': 'sv08-185',
  'Boomerang Energy': 'sv06-166',
};
function deck(...cards: string[]) {
  return fromIds('engine5', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);
const FIR = 'Fire Energy';
const WAT = 'Water Energy';
const LIG = 'Lightning Energy';
const PSY = 'Psychic Energy';
/** Put the Stadium card from this player's deck into play, as if that player had played it. */
function stadium(g: Game, name: string, owner: 0 | 1 = 0): number {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in P${owner + 1}'s deck`);
  const card = dk.splice(i, 1)[0] as number;
  g.state.stadium = { card, owner };
  return card;
}
/** A timed effect on a Pokémon (a stand-in for the Ability or attack that would have set it); it lasts through the next turn. */
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = false): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack, src: 0 });
}
function injectPlayer(g: Game, player: 0 | 1, st: StaticEffect): void {
  g.state.effects.push({ static: st, slot: -1, player, until: g.state.turn + 1, fromAttack: false, src: 0 });
}
function canEvolve(g: Game, into: string, slotId: number, p: 0 | 1 = 0): boolean {
  return legalActions(g.env, g.state, p).some((a) => a.t === 'evolve' && a.slot === slotId && nameOf(g, a.card) === into);
}

// ------------------------------------------------------------------ 1. Evolution timing and targets

test('evolveTiming: firstTurn lifts the ban on evolving in the owner\'s first turn (the second player\'s too), and nothing else', () => {
  const dk = deck('Shinx', 'Luxio', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Shinx', hand: ['Luxio'] }, { active: 'Dreepy' }], { turn: 1, current: 0, first: 0 });
  const id = g.state.p[0].active!.id;
  assert.ok(!canEvolve(g, 'Luxio', id), 'the first player may not evolve in turn 1');
  inject(g, id, { k: 'evolveTiming', justPlayed: true }); // the wrong half
  assert.ok(!canEvolve(g, 'Luxio', id), 'the turn it was played is not the first turn');
  inject(g, id, { k: 'evolveTiming', firstTurn: true });
  assert.ok(canEvolve(g, 'Luxio', id));
  refresh(g);
  choose(g, 'into Luxio');
  assert.equal(nameOf(g, g.state.p[0].active!.cards.at(-1)!), 'Luxio');
  // The second player's first turn is turn 2.
  const h = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Shinx', hand: ['Luxio'] }], { turn: 2, current: 1, first: 0 });
  const hid = h.state.p[1].active!.id;
  assert.ok(!canEvolve(h, 'Luxio', hid, 1));
  inject(h, hid, { k: 'evolveTiming', firstTurn: true });
  assert.ok(canEvolve(h, 'Luxio', hid, 1));
});

test('evolveTiming: justPlayed lifts the ban on evolving a Pokémon the turn it was played or evolved, but not in the first turn', () => {
  const dk = deck('Shinx', 'Luxio', 'Luxray', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Shinx', hand: ['Luxio'] }, { active: 'Dreepy' }]);
  const sl = g.state.p[0].active!;
  assert.ok(canEvolve(g, 'Luxio', sl.id), 'an ordinary evolution, in turn 3');
  sl.enteredTurn = g.state.turn; // played this turn
  assert.ok(!canEvolve(g, 'Luxio', sl.id));
  inject(g, sl.id, { k: 'evolveTiming', firstTurn: true }); // the wrong half
  assert.ok(!canEvolve(g, 'Luxio', sl.id));
  inject(g, sl.id, { k: 'evolveTiming', justPlayed: true });
  assert.ok(canEvolve(g, 'Luxio', sl.id));
  // ...and a Pokémon that evolved this turn can evolve again (ruling 2229).
  const h = scenario(dk, dk, [{ active: 'Shinx', evolve: { active: ['Luxio'] }, hand: ['Luxray'] }, { active: 'Dreepy' }]);
  const lx = h.state.p[0].active!;
  lx.evolvedTurn = h.state.turn;
  assert.ok(!canEvolve(h, 'Luxray', lx.id));
  inject(h, lx.id, { k: 'evolveTiming', justPlayed: true });
  assert.ok(canEvolve(h, 'Luxray', lx.id));
  // The first turn needs `firstTurn`: `justPlayed` alone does not lift it.
  const f = scenario(dk, dk, [{ active: 'Shinx', hand: ['Luxio'] }, { active: 'Dreepy' }], { turn: 1, current: 0, first: 0 });
  inject(f, f.state.p[0].active!.id, { k: 'evolveTiming', justPlayed: true });
  assert.ok(!canEvolve(f, 'Luxio', f.state.p[0].active!.id));
});

test('evolveTiming: `into` limits it to Evolution cards that match', () => {
  const dk = deck('Eevee', 'Vaporeon ex', 'Espeon ex', 'Dreepy');
  // On the Bench: an Active Eevee would have its own Ability (Boosted Evolution).
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Eevee'], hand: ['Vaporeon ex', 'Espeon ex'] }, { active: 'Dreepy' }]);
  const sl = g.state.p[0].bench[0]!;
  sl.enteredTurn = g.state.turn;
  inject(g, sl.id, { k: 'evolveTiming', justPlayed: true, into: { type: 'Water' } });
  assert.ok(canEvolve(g, 'Vaporeon ex', sl.id), 'a {W} Pokémon');
  assert.ok(!canEvolve(g, 'Espeon ex', sl.id), 'not a {P} Pokémon');
});

test('evolveTiming does not lift a play lock on evolving', () => {
  const dk = deck('Shinx', 'Luxio', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Shinx', hand: ['Luxio'] }, { active: 'Dreepy' }]);
  const sl = g.state.p[0].active!;
  sl.enteredTurn = g.state.turn;
  inject(g, sl.id, { k: 'evolveTiming', justPlayed: true });
  assert.ok(canEvolve(g, 'Luxio', sl.id));
  injectPlayer(g, 0, { k: 'playLock', what: 'evolve' });
  assert.ok(!canEvolve(g, 'Luxio', sl.id));
});

test('evolveInto: the Pokémon can evolve into a matching card that evolves from another name; the timing rules still apply', () => {
  const dk = deck('Eevee', 'Vaporeon ex', 'Espeon ex', 'Dreepy', 'Drakloak');
  const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Vaporeon ex', 'Espeon ex', 'Drakloak'] }, { active: 'Dreepy' }]);
  const sl = g.state.p[0].active!;
  assert.ok(canEvolve(g, 'Drakloak', sl.id), 'its own evolution');
  assert.ok(!canEvolve(g, 'Vaporeon ex', sl.id), 'an Eevee evolution: not without the effect');
  inject(g, sl.id, { k: 'evolveInto', evolvesFrom: 'Eevee', filter: { type: 'Water' } });
  assert.ok(canEvolve(g, 'Vaporeon ex', sl.id));
  assert.ok(!canEvolve(g, 'Espeon ex', sl.id), 'only the cards that match the filter');
  assert.ok(canEvolve(g, 'Drakloak', sl.id), 'its own evolution stays');
  sl.enteredTurn = g.state.turn;
  assert.ok(!canEvolve(g, 'Vaporeon ex', sl.id), 'the turn it was played: the usual timing still applies');
  // The evolution is real: the card is played onto it.
  sl.enteredTurn = 0;
  refresh(g);
  choose(g, 'into Vaporeon ex');
  assert.deepEqual(g.state.p[0].active!.cards.map((c) => nameOf(g, c)), ['Dreepy', 'Vaporeon ex']);
});

// ------------------------------------------------------------------ 2. Prevention of attack effects, by attacker

/** An attack that does 30 damage and every kind of effect to the Defending Pokémon. */
const HARASS: Program = [
  { op: 'damage', amount: 30, to: 'defender' },
  { op: 'counters', n: 2, to: 'defender' },
  { op: 'condition', cond: 'poisoned', to: 'defender' },
  { op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' },
];
const HARASSERS: CardScript[] = [
  { id: 'sv08.5-028', name: 'Pikachu ex', attacks: { 'Tail Whap': { program: HARASS } } },
  { id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { program: HARASS } } },
];

test('preventDamage with andEffects and an attacker filter: prevents damage AND effects only from attackers that match', () => {
  const dk = deck('Pikachu ex', "N's Darumaka", 'Dreepy', 'Chikorita');
  const run = (attacker: 'Pikachu ex' | "N's Darumaka") => {
    const g = scenario(
      dk,
      dk,
      [
        { active: 'Dreepy' },
        { active: attacker, energy: { active: attacker === 'Pikachu ex' ? [LIG] : [FIR, FIR] } },
      ],
      { current: 1, turn: 4, scripts: HARASSERS },
    );
    inject(g, g.state.p[0].active!.id, { k: 'preventDamage', andEffects: true, attacker: { ex: true } });
    return g;
  };
  const g = run('Pikachu ex');
  const target = g.state.p[0].active!;
  assert.ok(effectsPrevented(g.env, g.state, target, 1, 'attack', statics(g.env, g.state), g.state.p[1].active!), 'effects from an ex are prevented');
  choose(g, 'Attack: Tail Whap');
  assert.equal(target.damage, 0, 'no damage from the ex');
  assert.equal(target.cond, 0, 'no Special Condition');
  assert.equal(g.state.effects.filter((e) => e.static.k === 'cantRetreat').length, 0, 'no lasting effect');

  const h = run("N's Darumaka");
  const t2 = h.state.p[0].active!;
  assert.ok(!effectsPrevented(h.env, h.state, t2, 1, 'attack', statics(h.env, h.state), h.state.p[1].active!), 'not from a Pokémon that is not an ex');
  choose(h, 'Attack: Rolling Tackle');
  assert.equal(t2.damage, 30 + 20 + 10, '30 damage, 2 damage counters and the Poison counter at Checkup');
  assert.equal(t2.cond & POISONED, POISONED, 'Poisoned');
  assert.equal(h.state.effects.filter((e) => e.static.k === 'cantRetreat').length, 1, 'the lasting effect');
});

test('preventDamage with andEffects and no attacker still prevents effects from every attacker', () => {
  const dk = deck('Pikachu ex', "N's Darumaka", 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Dreepy' }, { active: "N's Darumaka", energy: { active: [FIR, FIR] } }], { current: 1, turn: 4, scripts: HARASSERS });
  inject(g, g.state.p[0].active!.id, { k: 'preventDamage', andEffects: true });
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.p[0].active!.damage, 0);
  assert.equal(g.state.p[0].active!.cond, 0);
});

// ------------------------------------------------------------------ 3. Damage prevention by amount

/** An attack of Fire type that does this much damage before Weakness. */
const hit = (amount: number): CardScript[] => [{ id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { damage: amount } } }];
const THUNDER = (amount: number): CardScript[] => [{ id: 'sv08.5-028', name: 'Pikachu ex', attacks: { 'Tail Whap': { damage: amount } } }];

test('preventDamage ifAtMost: damage of that amount or less is prevented, measured after Weakness (ruling 2197)', () => {
  const dk = deck("N's Darumaka", 'Metapod', 'Dreepy');
  const hitMetapod = (base: number): number => {
    const g = scenario(dk, dk, [{ active: 'Metapod' }, { active: "N's Darumaka", energy: { active: [FIR, FIR] } }], { current: 1, turn: 4, scripts: hit(base) });
    inject(g, g.state.p[0].active!.id, { k: 'preventDamage', ifAtMost: 60 });
    choose(g, 'Attack: Rolling Tackle');
    return g.state.p[0].active!.damage;
  };
  assert.equal(hitMetapod(20), 0, '20 before Weakness: prevented');
  assert.equal(hitMetapod(30), 0, '30 doubled by Weakness is 60: prevented');
  assert.equal(hitMetapod(40), 80, '40 doubled by Weakness is 80: not prevented');
});

test('preventDamage ifAtLeast: damage of that amount or more is prevented, measured after Weakness', () => {
  const dk = deck('Pikachu ex', 'Dreepy', 'Chikorita');
  // Pikachu ex's Tail Whap is {L} damage; Dreepy has no Weakness, so the amount is the printed one.
  const hitDreepy = (base: number): number => {
    const g = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Pikachu ex', energy: { active: [LIG] } }], { current: 1, turn: 4, scripts: THUNDER(base) });
    inject(g, g.state.p[0].active!.id, { k: 'preventDamage', ifAtLeast: 60 });
    choose(g, 'Attack: Tail Whap');
    return g.state.p[0].active ? g.state.p[0].active.damage : -1;
  };
  assert.equal(hitDreepy(50), 50, '50: not prevented');
  assert.equal(hitDreepy(60), 0, '60: prevented');
  assert.equal(hitDreepy(10), 10);
});

test('preventDamage thresholds do not stop damage counters or effects, and need an attacker of the other player', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const counters: CardScript[] = [{ id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { program: [{ op: 'counters', n: 5, to: 'defender' }, { op: 'condition', cond: 'poisoned', to: 'defender' }] } } }];
  const g = scenario(dk, dk, [{ active: 'Dreepy' }, { active: "N's Darumaka", energy: { active: [FIR, FIR] } }], { current: 1, turn: 4, scripts: counters });
  inject(g, g.state.p[0].active!.id, { k: 'preventDamage', ifAtMost: 100 });
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.p[0].active!.damage, 50 + 10, '5 damage counters placed, and the Poison counter at Checkup');
  // Own attacks are not prevented.
  const own = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Dreepy' }]);
  inject(own, own.state.p[0].active!.id, { k: 'preventDamage', ifAtMost: 100 });
  assert.ok(!damagePrevented(own.env, own.state, own.state.p[0].active!, 0, statics(own.env, own.state), undefined, 30));
  assert.ok(damagePrevented(own.env, own.state, own.state.p[0].active!, 1, statics(own.env, own.state), undefined, 30));
  assert.ok(!damagePrevented(own.env, own.state, own.state.p[0].active!, 1, statics(own.env, own.state), undefined, 0), 'nothing to prevent');
});

// ------------------------------------------------------------------ 4. Bench-to-Active triggers

/** Tools whose triggers stand in for Abilities: the Tool's trigger fires for the Pokémon it is attached to. */
const WATCHERS: CardScript[] = [
  { id: 'sv05-152', name: "Hero's Cape", triggers: [{ on: 'movedToActive', program: [{ op: 'draw', n: 1 }] }] },
  {
    id: 'sv05-154',
    name: 'Maximum Belt',
    triggers: [{ on: 'allyMovedToActive', when: { slotIs: { ref: { v: '__target' }, filter: { ex: true } } }, program: [{ op: 'draw', n: 1 }] }],
  },
];

test('movedToActive fires for the Pokémon that moves up (Switch); allyMovedToActive for the others, with the mover in __target', () => {
  const dk = deck('Dreepy', 'Pikachu ex', 'Switch', "Hero's Cape", 'Maximum Belt');
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Dreepy', bench: ['Dreepy', 'Pikachu ex', 'Dreepy'], hand: ['Switch', 'Switch', 'Switch'], tools: { 0: ["Hero's Cape"], 2: ['Maximum Belt'] } },
      { active: 'Dreepy' },
    ],
    { scripts: WATCHERS },
  );
  const [cape, ex, belt] = g.state.p[0].bench;
  const hand = (): number => g.state.p[0].hand.length;
  assert.equal(hand(), 3);
  choose(g, 'Play Switch'); // the Dreepy with the Cape comes up
  pickSlot(g, cape!.id);
  assert.equal(hand(), 2 + 1, 'two Switch cards left, and the Cape drew a card');
  assert.equal(g.state.p[0].active, cape);
  choose(g, 'Play Switch'); // Pikachu ex comes up: the Belt's Dreepy sees an ex move up
  pickSlot(g, ex!.id);
  assert.equal(hand(), 3 - 1 + 1, 'the Belt drew a card; the Cape (not the one that moved) did not');
  choose(g, 'Play Switch'); // the Belt's Dreepy comes up itself: it is not an ex, and ally triggers also see Pikachu's: no draw
  pickSlot(g, belt!.id);
  assert.equal(hand(), 3 - 1, 'no draw: neither watcher saw an ex move up');
});

test('movedToActive fires on a retreat, on a promotion after a Knock Out, and on an opponent\'s gust', () => {
  const dk = deck('Dreepy', 'Pikachu ex', "Boss's Orders", "Hero's Cape", "N's Darumaka");
  // A retreat.
  const r = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'], energy: { active: [PSY, PSY] }, tools: { 0: ["Hero's Cape"] } }, { active: 'Dreepy' }], { scripts: WATCHERS });
  const h0 = r.state.p[0].hand.length;
  choose(r, 'Retreat');
  r.submit([0]); // the Energy to discard
  assert.equal(r.state.p[0].hand.length, h0 + 1, 'the Dreepy with the Cape drew a card');
  // A promotion: P2's Active is Knocked Out and P2 promotes the one with the Cape (not P2's own turn: this trigger has no once-per-turn limit).
  const p = scenario(
    dk,
    dk,
    [
      { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
      { active: 'Dreepy', bench: ['Dreepy', 'Dreepy'], tools: { 1: ["Hero's Cape"] }, damage: { active: 60 } },
    ],
    { scripts: [...WATCHERS, ...hit(20)] },
  );
  const h1 = p.state.p[1].hand.length;
  choose(p, 'Attack: Rolling Tackle');
  assert.equal(p.decision!.kind, 'promote');
  pickSlot(p, p.state.p[1].bench[1]!.id);
  assert.equal(p.state.p[1].hand.length, h1 + 2, 'the promoted Dreepy drew a card, and P2 drew for the turn that followed');
  // The opponent's Boss's Orders brings it up.
  const b = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'], tools: { 0: ["Hero's Cape"] } }, { active: 'Dreepy', hand: ["Boss's Orders"] }], { current: 1, turn: 4, scripts: WATCHERS });
  const h2 = b.state.p[0].hand.length;
  choose(b, "Play Boss's Orders");
  assert.equal(b.state.p[0].hand.length, h2 + 1, 'the Cape drew a card on the opponent\'s turn');
});

// ------------------------------------------------------------------ 5. Knock Out to the hand

/** A Tool that stands in for an Ability on a Pokémon: it covers this Pokémon (scope self) or all your {W} Pokémon. */
const knockers = (...effects: Extract<StaticEffect, { k: 'koToHand' }>[]): CardScript[] => [
  { id: 'sv05-152', name: "Hero's Cape", statics: effects.map((effect) => ({ effect, scope: 'myPokemon' as const, filter: { type: 'Water' as const } })) },
];

test('koToHand "pokemon": the whole stack goes to the hand, the attached cards to the discard pile, and the Prize cards are still taken', () => {
  const dk = deck('Dreepy', 'Drakloak', "N's Darumaka", "Hero's Cape");
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Dreepy', evolve: { active: ['Drakloak'] }, energy: { active: [PSY, FIR] }, tools: { active: ["Hero's Cape"] } },
      { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
    ],
    { current: 1, turn: 4, scripts: hit(200) },
  );
  const sl = g.state.p[0].active!;
  inject(g, sl.id, { k: 'koToHand', cards: 'pokemon' });
  const handBefore = g.state.p[0].hand.length;
  choose(g, 'Attack: Rolling Tackle');
  assert.deepEqual(names(g, g.state.p[0].hand.slice(handBefore)), ['Dreepy', 'Drakloak'].sort(), 'Dreepy and Drakloak went to the hand');
  assert.deepEqual(names(g, g.state.p[0].discard), [FIR, PSY, "Hero's Cape"].sort(), 'the attached cards were discarded');
  assert.equal(g.state.p[1].prizes.length, 5, 'a Knock Out all the same');
  // Known to the opponent: the cards are face up in the hand.
  assert.equal(g.state.p[0].revealed.length, 2);
});

test('koToHand does not apply to a Knock Out that is not by damage from an attack (Poison)', () => {
  const dk = deck('Dreepy', "N's Darumaka");
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'], damage: { active: 60 }, cond: POISONED }, { active: "N's Darumaka" }]);
  inject(g, g.state.p[0].active!.id, { k: 'koToHand', cards: 'pokemon' });
  const handBefore = g.state.p[0].hand.length;
  choose(g, 'End turn');
  assert.equal(g.state.p[0].hand.length, handBefore, 'nothing went to the hand');
  assert.equal(names(g, g.state.p[0].discard).filter((n) => n === 'Dreepy').length, 1);
});

test('koToHand "energy" with a filter and `optional`: the owner is asked, and only the matching Energy goes to the hand', () => {
  const dk = deck('Lotad', 'Dreepy', "N's Darumaka", "Hero's Cape");
  const mk = (): Game =>
    scenario(
      dk,
      dk,
      [
        { active: 'Lotad', bench: ['Dreepy'], energy: { active: [WAT, WAT, FIR] }, tools: { 0: ["Hero's Cape"] } },
        { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
      ],
      { current: 1, turn: 4, scripts: [...knockers({ k: 'koToHand', cards: 'energy', filter: { energyType: 'Water' }, optional: true }), ...hit(200)] },
    );
  const yes = mk();
  choose(yes, 'Attack: Rolling Tackle');
  assert.equal(yes.decision!.kind, 'yesno');
  assert.equal(yes.decision!.player, 0, 'the owner of the Knocked Out Pokémon decides');
  assert.ok(yes.decision!.prompt.includes(WAT), yes.decision!.prompt);
  assert.equal(yes.state.p[1].prizes.length, 6, 'nothing yet: the question comes before the Prize cards');
  // A search clone answers the same question the same way (the pending decision and the Slot field are cloned).
  const clone = cloneState(yes.state);
  submit(yes.env, clone, [0]);
  assert.equal(names(yes, clone.p[0].hand).filter((n) => n === WAT).length, 2, 'the clone ran on');
  assert.equal(names(yes, yes.state.p[0].hand).filter((n) => n === WAT).length, 0, 'and the original did not move');
  choose(yes, 'Yes');
  // (The only Benched Pokémon is promoted by itself, and the turn passes: the hand also holds the card drawn for it.)
  assert.equal(names(yes, yes.state.p[0].hand).filter((n) => n === WAT).length, 2, 'both Water Energy cards are in the hand');
  assert.equal(names(yes, yes.state.p[0].hand).filter((n) => n === FIR).length, 0);
  assert.deepEqual(names(yes, yes.state.p[0].discard).filter((n) => n === FIR).length, 1, 'the Fire Energy was discarded');
  assert.equal(yes.state.p[1].prizes.length, 5);

  const no = mk();
  choose(no, 'Attack: Rolling Tackle');
  choose(no, 'No');
  assert.equal(names(no, no.state.p[0].hand).filter((n) => n === WAT).length, 0, 'all of it was discarded');
  assert.equal(names(no, no.state.p[0].discard).filter((n) => n === WAT).length, 2);
});

test('koToHand "energy": a Pokémon that does not match the scope is not asked about', () => {
  const dk = deck('Lotad', 'Dreepy', "N's Darumaka", "Hero's Cape");
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Dreepy', bench: ['Lotad'], energy: { active: [WAT] }, tools: { 0: ["Hero's Cape"] } },
      { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
    ],
    { current: 1, turn: 4, scripts: [...knockers({ k: 'koToHand', cards: 'energy', filter: { energyType: 'Water' }, optional: true }), ...hit(200)] },
  );
  choose(g, 'Attack: Rolling Tackle');
  assert.notEqual(g.decision!.kind, 'yesno', 'a Dreepy is not a {W} Pokémon: no question');
});

// ------------------------------------------------------------------ 6. A switch from an attack checks the Benched Pokémon

/** "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon." */
const DRAG: CardScript[] = [
  {
    id: 'me02.5-032',
    name: "N's Darumaka",
    attacks: { 'Rolling Tackle': { program: [{ op: 'switch', who: 'opp', chooser: 'self' }, { op: 'damage', amount: 30, to: 'oppActive' }] } },
  },
];

test('an attack that switches in a Benched Pokémon protected from its effects fails, and there is no new Active Pokémon to damage (ruling 2155)', () => {
  const dk = deck('Dreepy', 'Chikorita', "N's Darumaka");
  const mk = (): Game => {
    const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: 'Dreepy', bench: ['Chikorita', 'Dreepy'] }], { scripts: DRAG });
    return g;
  };
  const g = mk();
  const [protectedOne, other] = g.state.p[1].bench;
  const oldActive = g.state.p[1].active!;
  inject(g, protectedOne!.id, { k: 'preventEffects', from: ['attack'] });
  choose(g, 'Attack: Rolling Tackle');
  pickSlot(g, protectedOne!.id);
  assert.equal(g.state.p[1].active, oldActive, 'the switch did not happen');
  assert.equal(oldActive.damage, 0, 'and the old Active Pokémon was not damaged either');
  assert.equal(protectedOne!.damage, 0);

  const h = mk();
  const [prot2, other2] = h.state.p[1].bench;
  inject(h, prot2!.id, { k: 'preventEffects', from: ['attack'] });
  choose(h, 'Attack: Rolling Tackle');
  pickSlot(h, other2!.id);
  assert.equal(h.state.p[1].active, other2, 'an unprotected Benched Pokémon can be switched in');
  assert.equal(other2!.damage, 30);
  void other;
});

test('when the Pokémon\'s own player chooses the new Active Pokémon, the one they pick is not protected from it', () => {
  const dk = deck('Dreepy', 'Chikorita', "N's Darumaka");
  const choosesThemselves: CardScript[] = [
    { id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { program: [{ op: 'switch', who: 'opp', chooser: 'opp' }] } } },
  ];
  const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: 'Dreepy', bench: ['Chikorita', 'Dreepy'] }], { scripts: choosesThemselves });
  const protectedOne = g.state.p[1].bench[0]!;
  inject(g, protectedOne.id, { k: 'preventEffects', from: ['attack'] });
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.decision!.player, 1, 'the opponent chooses');
  pickSlot(g, protectedOne.id);
  assert.equal(g.state.p[1].active, protectedOne);
});

test('a protected Benched Pokémon can still be switched in by a Supporter (only the effects of attacks and Abilities are prevented)', () => {
  const dk = deck('Dreepy', 'Chikorita', "Boss's Orders");
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Chikorita'] }, { active: 'Dreepy', hand: ["Boss's Orders"] }], { current: 1, turn: 4 });
  const prot = g.state.p[0].bench[0]!;
  inject(g, prot.id, { k: 'preventEffects', from: ['attack', 'ability'] });
  choose(g, "Play Boss's Orders");
  if (g.decision!.kind === 'slots') pickSlot(g, prot.id);
  assert.equal(g.state.p[0].active, prot);
});

// ------------------------------------------------------------------ 7. The real Bench size in the search helpers

test('searchToBench / BENCH_SPACE use the real Bench limit: Precious Trolley fills the Bench past 5 under Area Zero Underdepths', () => {
  const dk = deck('Pikachu ex', 'Dreepy', 'Precious Trolley', 'Area Zero Underdepths');
  const mk = (withStadium: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Pikachu ex', bench: rep('Dreepy', 4), hand: ['Precious Trolley'] }, { active: 'Dreepy' }]);
    if (withStadium) stadium(g, 'Area Zero Underdepths', 1);
    refresh(g);
    return g;
  };
  const plain = mk(false);
  choose(plain, 'Play Precious Trolley');
  assert.equal(plain.decision!.max, 1, '4 on the Bench of 5: room for one');
  const g = mk(true);
  choose(g, 'Play Precious Trolley');
  assert.equal(g.decision!.max, 4, '4 on the Bench of 8: room for four');
  g.submit([0, 1, 2, 3]);
  assert.equal(g.state.p[0].bench.length, 8, 'the Bench is filled past 5');
});
