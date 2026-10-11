/**
 * Card tests, batch "std-c37": every card scripted in cards/scripts/std-c37.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { CONFUSED, PARALYZED, type Decision } from '../types.js';
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
function pick(g: Game, names: string[]): void {
  const ls = labels(g);
  const used = new Set<number>();
  const idx = names.map((n) => {
    const i = ls.findIndex((l, j) => !used.has(j) && l.includes(n));
    assert.ok(i >= 0, `no option "${n}" in: ${ls.join(' | ')}`);
    used.add(i);
    return i;
  });
  g.submit(idx);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 14]);
const IDS: Record<string, string> = {
  'Whimsicott ex': 'sv10.5w-005',
  Accelgor: 'sv10.5w-009',
  Virizion: 'sv10.5w-010',
  Emboar: 'sv10.5w-013',
  Litwick: 'sv10.5w-016',
  Chandelure: 'sv10.5w-018',
  Heatmor: 'sv10.5w-019',
  'Reshiram ex': 'sv10.5w-020',
  Samurott: 'sv10.5w-023',
  Basculin: 'sv10.5w-024',
  Ducklett: 'sv10.5w-025',
  Vanilluxe: 'sv10.5w-029',
  'Keldeo ex': 'sv10.5w-030',
  Galvantula: 'sv10.5w-034',
  Stunfisk: 'sv10.5w-035',
  Swoobat: 'sv10.5w-037',
  Sigilyph: 'sv10.5w-038',
  Cofagrigus: 'sv10.5w-040',
  Gothorita: 'sv10.5w-042',
  Gothitelle: 'sv10.5w-043',
  Boldore: 'sv10.5w-047',
  Gigalith: 'sv10.5w-048',
  // props
  'Dragapult ex': 'sv06-130', // Stage 2, 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
  Slowpoke: 'me05-029', // Basic 70 HP, retreat 2, Weakness {D}
  Lillipup: 'sv10.5w-074',
  Roggenrola: 'sv10.5w-046',
  Spectrier: 'me02.5-098', // Basic 120 HP, Weakness {D}, Resistance {F} -30
  Onix: 'me01-070', // Basic 120 HP, Weakness {G}
  Okidogi: 'me02.5-122', // Basic 140 HP, Weakness {P}
  'Antique Cover Fossil': 'sv07-129',
  Patrat: 'me04-070', // Watchful Eye
  "Boss's Orders": 'me01-114',
  'Air Balloon': 'sv10.5b-079',
  'Prism Energy': 'me02.5-216',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('c37', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex';
const SLO = 'Slowpoke';
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const F = 'Fighting Energy';
type Sides = [SideLayout, SideLayout];
const ALL = Object.keys(IDS);
const DK = deck(...ALL);
const mk = (sides: Sides, o = {}): Game => scenario(DK, DK, sides, o);
const OPP_TURN = { current: 1 as const, turn: 4 };
const energyNames = (g: Game, p: 0 | 1, where: 'active' | number): string[] => {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return namesOf(g, sl.energy);
};

// ------------------------------------------------------------------ Whimsicott ex

test('Whimsicott ex, Energy Gift: up to 3 Basic Energy cards from the deck onto your Pokémon in any way you like, then shuffle', () => {
  const g = mk([{ active: 'Whimsicott ex', bench: [SLO], energy: { active: [G] } }, { active: DRA }]);
  const fireBefore = g.state.p[0].deck.filter((c) => nameOf(g, c) === R).length;
  choose(g, 'Attack: Energy Gift');
  assert.equal(g.decision?.min, 0, '"up to" on an attack is 0 to n');
  choose(g, 'Fire Energy');
  choose(g, 'Slowpoke');
  choose(g, 'Water Energy');
  choose(g, 'Whimsicott');
  g.submit([]); // the third: none
  assert.deepEqual(energyNames(g, 0, 0), [R]);
  assert.deepEqual(energyNames(g, 0, 'active'), [G, W]);
  assert.equal(g.state.p[0].deck.filter((c) => nameOf(g, c) === R).length, fireBefore - 1);
});

test('Whimsicott ex, Energy Gift: three cards can all go onto one Pokémon', () => {
  const g = mk([{ active: 'Whimsicott ex', bench: [SLO], energy: { active: [G] } }, { active: DRA }]);
  for (let i = 0; i < 3; i++) {
    choose(g, i === 0 ? 'Attack: Energy Gift' : 'Psychic Energy');
    if (i === 0) choose(g, 'Psychic Energy');
    choose(g, 'Slowpoke');
  }
  assert.deepEqual(energyNames(g, 0, 0), [P, P, P]);
});

test('Whimsicott ex, Wondrous Cotton: your opponent reveals their hand; 50 damage for each Trainer card there', () => {
  const hit = (hand: string[]): Game => {
    const g = mk([{ active: 'Whimsicott ex', energy: { active: [G] } }, { active: DRA, hand }]);
    choose(g, 'Attack: Wondrous Cotton');
    return g;
  };
  const g = hit(["Boss's Orders", 'Air Balloon', G, SLO]);
  assert.equal(dmg(g, 1), 100, 'a Supporter and a Pokémon Tool are Trainer cards; Energy and Pokémon are not');
  assert.equal(g.state.p[1].revealed.length, 4, 'the hand was revealed');
  assert.equal(dmg(hit([G, SLO]), 1), 0);
  assert.equal(dmg(hit(["Boss's Orders"]), 1), 50);
});

// ------------------------------------------------------------------ Accelgor

test("Accelgor, Acid Spray: 50, and on heads discard an Energy from your opponent's Active Pokémon", () => {
  const run = (heads: boolean): Game => {
    const g = mk([{ active: 'Accelgor', energy: { active: [G] } }, { active: DRA, energy: { active: [R, W] } }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Acid Spray');
    if (heads) choose(g, 'Fire Energy');
    return g;
  };
  const h = run(true);
  assert.equal(dmg(h, 1), 50);
  assert.deepEqual(energyNames(h, 1, 'active'), [W]);
  assert.deepEqual(namesOf(h, h.state.p[1].discard), [R]);
  const t = run(false);
  assert.equal(dmg(t, 1), 50);
  assert.deepEqual(energyNames(t, 1, 'active'), [R, W]);
});

// ------------------------------------------------------------------ Virizion

test('Virizion, Giga Drain: 30, and heal from this Pokémon the same amount of damage done', () => {
  const g = mk([{ active: 'Virizion', energy: { active: [G] }, damage: { active: 50 } }, { active: DRA }]);
  choose(g, 'Attack: Giga Drain');
  assert.equal(dmg(g, 1), 30);
  assert.equal(dmg(g, 0), 20);
  // Only the damage that was done counts: Weakness doubles it.
  const w = mk([{ active: 'Virizion', energy: { active: [G] }, damage: { active: 70 } }, { active: 'Onix' }]);
  choose(w, 'Attack: Giga Drain');
  assert.equal(dmg(w, 1), 60);
  assert.equal(dmg(w, 0), 10);
  // It can't heal more than it has.
  const small = mk([{ active: 'Virizion', energy: { active: [G] }, damage: { active: 20 } }, { active: DRA }]);
  choose(small, 'Attack: Giga Drain');
  assert.equal(dmg(small, 0), 0);
});

test("Virizion, Emerald Blade: 130, and during your next turn this Pokémon can't use attacks", () => {
  const g = mk([{ active: 'Virizion', energy: { active: [G, G, W] } }, { active: DRA }]);
  choose(g, 'Attack: Emerald Blade');
  assert.equal(dmg(g, 1), 130);
  choose(g, 'End turn'); // the opponent's turn
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack:'), "it can't attack during my next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Emerald Blade'), 'the turn after, it can');
});

// ------------------------------------------------------------------ Emboar

test('Emboar, Inferno Fandango: as often as you like, attach a Basic {R} Energy card from your hand to 1 of your Pokémon', () => {
  const g = mk([{ active: 'Emboar', bench: [SLO], hand: [R, R, W] }, { active: DRA }]);
  choose(g, 'Use Inferno Fandango');
  choose(g, 'Fire Energy');
  assert.deepEqual(labels(g).sort(), ['Emboar (Active)', 'Slowpoke'].sort(), 'any of your Pokémon');
  choose(g, 'Slowpoke');
  assert.deepEqual(energyNames(g, 0, 0), [R]);
  assert.equal(g.state.p[0].energyAttached, false, "it isn't your attachment for the turn");
  choose(g, 'Use Inferno Fandango');
  choose(g, 'Emboar');
  assert.deepEqual(energyNames(g, 0, 'active'), [R]);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [W]);
  assert.ok(!has(g, 'Use Inferno Fandango'), 'no Basic {R} Energy card left in hand');
});

test('Emboar, Inferno Fandango: not usable with only a non-{R} Energy card in hand', () => {
  const g = mk([{ active: 'Emboar', hand: [W] }, { active: DRA }]);
  assert.ok(!has(g, 'Use Inferno Fandango'));
});

// ------------------------------------------------------------------ Litwick

test('Litwick, Brighten and Burn: look at the top card of your deck; you may discard it, otherwise it stays on top (Compendium #2189)', () => {
  const yes = mk([{ active: 'Litwick', energy: { active: [R] }, deckTop: [SLO, 'Lillipup'] }, { active: DRA }]);
  choose(yes, 'Attack: Brighten and Burn');
  pick(yes, [SLO]);
  assert.deepEqual(namesOf(yes, yes.state.p[0].discard), [SLO]);
  const keep = mk([{ active: 'Litwick', energy: { active: [R] }, deckTop: [SLO, 'Lillipup'] }, { active: DRA }]);
  choose(keep, 'Attack: Brighten and Burn');
  keep.submit([]);
  assert.equal(keep.state.p[0].discard.length, 0);
  assert.equal(nameOf(keep, keep.state.p[0].deck[keep.state.p[0].deck.length - 1]!), SLO, 'it stays on top');
});

// ------------------------------------------------------------------ Chandelure

test('Chandelure, Incendiary Pillar: 50, or 100 more with 10 or more Basic {R} Energy cards in your discard pile', () => {
  const hit = (discard: string[]): number => {
    const g = mk([{ active: 'Chandelure', energy: { active: [R] }, discard }, { active: DRA }]);
    choose(g, 'Attack: Incendiary Pillar');
    return dmg(g, 1);
  };
  assert.equal(hit(Array(9).fill(R)), 50);
  assert.equal(hit(Array(10).fill(R)), 150);
  assert.equal(hit([...Array(9).fill(R), ...Array(3).fill(W)]), 50, 'only Basic {R} Energy counts');
});

test('Chandelure, Burn It All Up: 180, and discard all Energy from this Pokémon', () => {
  const g = mk([{ active: 'Chandelure', energy: { active: [R, R, W] } }, { active: DRA }]);
  choose(g, 'Attack: Burn It All Up');
  assert.equal(dmg(g, 1), 180);
  assert.deepEqual(energyNames(g, 0, 'active'), []);
  assert.equal(g.state.p[0].discard.length, 3);
});

// ------------------------------------------------------------------ Heatmor

test('Heatmor, Licking Catch: up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards from the deck to your hand', () => {
  const g = mk([{ active: 'Heatmor', energy: { active: [R] } }, { active: DRA }]);
  choose(g, 'Attack: Licking Catch');
  assert.equal(g.decision?.min, 0);
  assert.equal(g.decision?.max, 3);
  assert.ok(has(g, 'Litwick') && has(g, 'Fire Energy'));
  assert.ok(!has(g, 'Water Energy') && !has(g, 'Samurott') && !has(g, 'Slowpoke'), 'only {R} Pokémon and Basic {R} Energy');
  pick(g, ['Litwick', 'Fire Energy', 'Fire Energy']);
  assert.deepEqual(namesOf(g, g.state.p[0].hand.slice(-3)), ['Fire Energy', 'Fire Energy', 'Litwick']);
});

// ------------------------------------------------------------------ Reshiram ex

test('Reshiram ex, Blazing Burst: 130, 50 more for each Prize card your opponent has taken; discard an Energy from this Pokémon', () => {
  const hit = (prizes: number): Game => {
    const g = mk([{ active: 'Reshiram ex', energy: { active: [R, R, W] } }, { active: DRA, prizes }]);
    // the opponent (player 2) holds the Prize cards the first player takes; "your opponent has taken" counts player 2's taken
    g.state.p[1].prizesTaken = 6 - prizes;
    choose(g, 'Attack: Blazing Burst');
    choose(g, 'Water Energy'); // "Discard an Energy from this Pokémon"
    return g;
  };
  assert.equal(dmg(hit(6), 1), 130);
  const g = hit(4);
  assert.equal(dmg(g, 1), 230, '2 Prize cards taken');
  assert.deepEqual(energyNames(g, 0, 'active'), [R, R], 'one Energy discarded from the attacker');
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [W]);
});

// ------------------------------------------------------------------ Samurott

test('Samurott, Energized Slash: 30, 50 more for each Energy attached to this Pokémon', () => {
  const hit = (e: string[]): number => {
    const g = mk([{ active: 'Samurott', energy: { active: e } }, { active: DRA }]);
    choose(g, 'Attack: Energized Slash');
    return dmg(g, 1);
  };
  assert.equal(hit([W]), 80);
  assert.equal(hit([W, R, R]), 180);
});

test("Samurott, Torrential Whirlpool: switch your Active with a Benched Pokémon; if you do, switch out your opponent's Active (they choose)", () => {
  const g = mk([{ active: 'Samurott', bench: [SLO] }, { active: DRA, bench: ['Lillipup', 'Onix'] }]);
  choose(g, 'Use Torrential Whirlpool');
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), SLO, 'my Active was switched');
  assert.equal(g.decision?.player, 1, 'the opponent chooses the new Active Pokémon');
  choose(g, 'Onix');
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), 'Onix');
  assert.deepEqual(namesOf(g, g.state.p[1].bench.map((b) => b.cards[0]!)), [DRA, 'Lillipup'].sort());
  assert.ok(!has(g, 'Use Torrential Whirlpool'), 'Samurott on the Bench has used it this turn');
});

test('Samurott, Torrential Whirlpool: not usable without a Benched Pokémon; each Samurott in play can use it (Compendium #2187)', () => {
  const none = mk([{ active: 'Samurott' }, { active: DRA, bench: ['Lillipup', 'Onix'] }]);
  assert.ok(!has(none, 'Use Torrential Whirlpool'));
  const two = mk([{ active: 'Samurott', bench: ['Samurott'] }, { active: DRA, bench: ['Lillipup'] }]);
  choose(two, 'Use Torrential Whirlpool');
  assert.ok(has(two, 'Use Torrential Whirlpool'), 'the other Samurott can use it too');
  choose(two, 'Use Torrential Whirlpool');
  assert.ok(!has(two, 'Use Torrential Whirlpool'));
});

test("Samurott, Torrential Whirlpool: with no Benched Pokémon on the opponent's side only mine switch", () => {
  const g = mk([{ active: 'Samurott', bench: [SLO] }, { active: DRA }]);
  choose(g, 'Use Torrential Whirlpool');
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), SLO);
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), DRA);
});

// ------------------------------------------------------------------ Basculin

test("Basculin, Bared Fangs: 50, but nothing if your opponent's Active Pokémon has no damage counters on it", () => {
  const hit = (damage: number): number => {
    const g = mk([{ active: 'Basculin', energy: { active: [W] } }, { active: DRA, damage: { active: damage } }]);
    choose(g, 'Attack: Bared Fangs');
    return dmg(g, 1);
  };
  assert.equal(hit(0), 0);
  assert.equal(hit(10), 60);
});

// ------------------------------------------------------------------ Ducklett

test("Ducklett, Firefighting: discard a {R} Energy from your opponent's Active Pokémon", () => {
  const g = mk([{ active: 'Ducklett', energy: { active: [W] } }, { active: DRA, energy: { active: [W, R, R] } }]);
  choose(g, 'Attack: Firefighting');
  choose(g, 'Fire Energy');
  assert.deepEqual(energyNames(g, 1, 'active'), [R, W]);
  assert.deepEqual(namesOf(g, g.state.p[1].discard), [R]);
  const none = mk([{ active: 'Ducklett', energy: { active: [W] } }, { active: DRA, energy: { active: [W] } }]);
  choose(none, 'Attack: Firefighting');
  assert.deepEqual(energyNames(none, 1, 'active'), [W], 'no {R} Energy: nothing is discarded');
});

test('Ducklett, Firefighting: Prism Energy counts as {R} on a Basic Pokémon, not on an Evolution (Compendium #2194)', () => {
  const basic = mk([{ active: 'Ducklett', energy: { active: [W] } }, { active: SLO, energy: { active: ['Prism Energy'] } }]);
  choose(basic, 'Attack: Firefighting');
  assert.deepEqual(energyNames(basic, 1, 'active'), [], 'discarded from a Basic Pokémon');
  const stage2 = mk([{ active: 'Ducklett', energy: { active: [W] } }, { active: DRA, energy: { active: ['Prism Energy'] } }]);
  choose(stage2, 'Attack: Firefighting');
  assert.deepEqual(energyNames(stage2, 1, 'active'), ['Prism Energy'], 'not {R} on a Stage 2 Pokémon');
});

// ------------------------------------------------------------------ Vanilluxe

test("Vanilluxe, Double Freeze: flip 2 coins, 90 damage for each heads; if either is heads, your opponent's Active Pokémon is Paralyzed", () => {
  const run = (coins: boolean[]): Game => {
    const g = mk([{ active: 'Vanilluxe', energy: { active: [W, W, W] } }, { active: DRA }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Double Freeze');
    return g;
  };
  const two = run([true, true]);
  assert.equal(dmg(two, 1), 180);
  assert.ok(two.state.p[1].active!.cond & PARALYZED);
  const one = run([false, true]);
  assert.equal(dmg(one, 1), 90);
  assert.ok(one.state.p[1].active!.cond & PARALYZED);
  const zero = run([false, false]);
  assert.equal(dmg(zero, 1), 0);
  assert.ok(!(zero.state.p[1].active!.cond & PARALYZED));
});

// ------------------------------------------------------------------ Keldeo ex

test('Keldeo ex, Gale Thrust: 30, or 90 more if this Pokémon moved from your Bench to the Active Spot this turn', () => {
  const stay = mk([{ active: 'Keldeo ex', energy: { active: [W, W] } }, { active: DRA }]);
  choose(stay, 'Attack: Gale Thrust');
  assert.equal(dmg(stay, 1), 30);
  const moved = mk([{ active: SLO, bench: ['Keldeo ex'], energy: { active: [P, P], 0: [W, W] } }, { active: DRA }]);
  choose(moved, 'Retreat');
  choose(moved, 'Attack: Gale Thrust');
  assert.equal(dmg(moved, 1), 120);
});

test("Keldeo ex, Gale Thrust: replacing a Knocked Out Active Pokémon on the opponent's turn is not \"this turn\" (Compendium #2195)", () => {
  const g = mk([{ active: SLO, bench: ['Keldeo ex'], damage: { active: 60 }, energy: { 0: [W, W] } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(g, 'Attack: Jet Headbutt'); // Dragapult Knocks Out Slowpoke; Keldeo ex is promoted during the opponent's turn
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Keldeo ex');
  choose(g, 'Attack: Gale Thrust');
  assert.equal(dmg(g, 1), 30);
});

test("Keldeo ex, Sonic Edge: 120, not affected by any effects on your opponent's Active Pokémon", () => {
  // Sigilyph, Reflect: "this Pokémon takes 40 less damage from attacks" during Keldeo's turn. Sigilyph has 120 HP.
  const mkGame = (): Game => {
    const g = mk(
      [{ active: 'Keldeo ex', energy: { active: [W, W, W] } }, { active: 'Sigilyph', bench: [SLO], energy: { active: [P] } }],
      OPP_TURN,
    );
    choose(g, 'Attack: Reflect');
    return g;
  };
  const edge = mkGame();
  choose(edge, 'Attack: Sonic Edge');
  assert.equal(edge.state.p[0].prizesTaken, 1, 'the full 120 damage Knocked Out Sigilyph');
  const thrust = mkGame();
  choose(thrust, 'Attack: Gale Thrust');
  assert.equal(dmg(thrust, 1), 0, 'by contrast Gale Thrust is cut by Reflect (30 - 40)');
});

// ------------------------------------------------------------------ Galvantula

test('Galvantula, Discharge: discard all {L} Energy from this Pokémon; 50 damage for each card discarded', () => {
  const g = mk([{ active: 'Galvantula', energy: { active: [L, W, L, L] } }, { active: DRA }]);
  choose(g, 'Attack: Discharge');
  assert.equal(dmg(g, 1), 150);
  assert.deepEqual(energyNames(g, 0, 'active'), [W]);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [L, L, L]);
});

// ------------------------------------------------------------------ Stunfisk

test('Stunfisk, Muddy Bolt: 20, or 20 more if this Pokémon has any {F} Energy attached', () => {
  const hit = (e: string[]): number => {
    const g = mk([{ active: 'Stunfisk', energy: { active: e } }, { active: DRA }]);
    choose(g, 'Attack: Muddy Bolt');
    return dmg(g, 1);
  };
  assert.equal(hit([W]), 20);
  assert.equal(hit([F]), 40);
  assert.equal(hit([W, F]), 40);
});

// ------------------------------------------------------------------ Swoobat

test('Swoobat, Happy Return: put 1 of your Benched Pokémon and all attached cards into your hand', () => {
  const g = mk([{ active: 'Swoobat', bench: [SLO, 'Lillipup'], energy: { active: [P], 0: [P, W] }, tools: { 0: ['Air Balloon'] } }, { active: DRA }]);
  choose(g, 'Attack: Happy Return');
  choose(g, 'Slowpoke');
  assert.deepEqual(namesOf(g, g.state.p[0].bench.map((b) => b.cards[0]!)), ['Lillipup']);
  const hand = namesOf(g, g.state.p[0].hand);
  for (const n of [SLO, P, W, 'Air Balloon']) assert.ok(hand.includes(n), `${n} is in the hand`);
  assert.equal(g.state.p[0].active!.energy.length, 1, 'Swoobat keeps its own Energy');
});

test('Swoobat, Happy Return: with no Benched Pokémon it does nothing', () => {
  const g = mk([{ active: 'Swoobat', energy: { active: [P] } }, { active: DRA }]);
  choose(g, 'Attack: Happy Return');
  assert.equal(g.state.turn, 4, 'the attack was used and the turn passed');
  assert.equal(g.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Sigilyph

test("Sigilyph, Reflect: during your opponent's next turn this Pokémon takes 40 less damage from attacks (after Weakness and Resistance)", () => {
  const g = mk([{ active: 'Sigilyph', energy: { active: [P] } }, { active: DRA, energy: { active: [R] } }]);
  choose(g, 'Attack: Reflect');
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 30, '70 - 40');
  choose(g, 'End turn');
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 100, 'the turn after, no reduction: 30 + 70');
});

test("Sigilyph, Telekinesis: 70 damage to 1 of your opponent's Pokémon, not affected by Weakness or Resistance", () => {
  const active = mk([{ active: 'Sigilyph', energy: { active: [P, P, P] } }, { active: 'Okidogi', bench: [SLO] }]);
  choose(active, 'Attack: Telekinesis');
  choose(active, 'Okidogi');
  assert.equal(dmg(active, 1), 70, "Okidogi's {P} Weakness is not applied");
  const bench = mk([{ active: 'Sigilyph', energy: { active: [P, P, P] } }, { active: DRA, bench: ['Onix'] }]);
  choose(bench, 'Attack: Telekinesis');
  choose(bench, 'Onix');
  assert.equal(bench.state.p[1].bench[0]!.damage, 70, 'a Benched Pokémon can be chosen');
  assert.equal(dmg(bench, 1), 0);
});

// ------------------------------------------------------------------ Cofagrigus

test("Cofagrigus, Extended Damagriiigus: move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon", () => {
  const g = mk([{ active: 'Cofagrigus', bench: [SLO, 'Lillipup'], damage: { 0: 50, 1: 20 }, energy: { active: [P, P] } }, { active: DRA, bench: ['Onix'] }]);
  choose(g, 'Attack: Extended Damagriiigus');
  choose(g, 'Slowpoke');
  choose(g, 'Onix');
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
  assert.equal(g.state.p[0].bench[1]!.damage, 20, 'the other Benched Pokémon is untouched');
  assert.equal(g.state.p[1].bench[0]!.damage, 50);
  assert.equal(dmg(g, 1), 0);
  // The Active Pokémon as the target, adding to damage already there.
  const a = mk([{ active: 'Cofagrigus', bench: [SLO], damage: { 0: 30 }, energy: { active: [P, P] } }, { active: DRA, damage: { active: 40 } }]);
  choose(a, 'Attack: Extended Damagriiigus');
  assert.equal(dmg(a, 1), 70);
});

test("Cofagrigus, Extended Damagriiigus: counters moved to a Pokémon that blocks effects just disappear (Compendium #2192)", () => {
  const g = mk([{ active: 'Cofagrigus', bench: [SLO], damage: { 0: 50 }, energy: { active: [P, P] } }, { active: 'Antique Cover Fossil' }]);
  choose(g, 'Attack: Extended Damagriiigus');
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'the Benched Pokémon removed its damage counters');
  assert.equal(dmg(g, 1), 0, "the Fossil received none");
});

test('Cofagrigus, Extended Damagriiigus: nothing moves while damage counters are locked in place', () => {
  const g = mk([{ active: 'Cofagrigus', bench: [SLO], damage: { 0: 50 }, energy: { active: [P, P] } }, { active: DRA, bench: ['Patrat'] }]);
  choose(g, 'Attack: Extended Damagriiigus');
  choose(g, 'Dragapult');
  assert.equal(g.state.p[0].bench[0]!.damage, 50, 'Watchful Eye keeps the counters where they are');
  assert.equal(dmg(g, 1), 0);
});

test("Cofagrigus, Perplex: 60, and your opponent's Active Pokémon is now Confused", () => {
  const g = mk([{ active: 'Cofagrigus', energy: { active: [P, P, P] } }, { active: DRA }]);
  choose(g, 'Attack: Perplex');
  assert.equal(dmg(g, 1), 60);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Gothorita

test("Gothorita, Fortunate Eye: look at the top 5 cards of your opponent's deck and put them back in any order", () => {
  const g = mk([{ active: 'Gothorita', energy: { active: [P] } }, { active: DRA, deckTop: [P, R, W, G, L, F] }]);
  choose(g, 'Attack: Fortunate Eye');
  assert.equal(g.decision?.kind, 'order');
  assert.equal(g.decision?.player, 0, 'the attacker orders them');
  assert.deepEqual((g.decision as { values: number[] }).values.map((c) => nameOf(g, c)), [P, R, W, G, L], 'the top 5, shown top first');
  g.submit([4, 3, 2, 1, 0]);
  assert.deepEqual(g.state.p[1].hand.slice(-1).map((c) => nameOf(g, c)), [L], 'the new top card was drawn by the opponent');
  const d = g.state.p[1].deck;
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => nameOf(g, d[d.length - i]!)), [G, W, R, P, F]);
});

// ------------------------------------------------------------------ Gothitelle

test('Gothitelle, Distorted Future: while Active, once during your turn, your opponent shuffles their hand into their deck and draws 3 cards', () => {
  const g = mk([{ active: 'Gothitelle', hand: [SLO] }, { active: DRA, hand: ["Boss's Orders", 'Air Balloon', SLO, SLO, G] }]);
  const deckBefore = g.state.p[1].deck.length;
  choose(g, 'Use Distorted Future');
  assert.equal(g.state.p[1].hand.length, 3);
  assert.equal(g.state.p[1].deck.length, deckBefore + 2, '5 cards shuffled in, 3 drawn');
  assert.equal(g.state.p[0].hand.length, 1, 'my hand is untouched');
  assert.ok(!has(g, 'Use Distorted Future'), 'once during your turn');
  const bench = mk([{ active: SLO, bench: ['Gothitelle'] }, { active: DRA, hand: [G] }]);
  assert.ok(!has(bench, 'Use Distorted Future'), 'only while in the Active Spot');
});

test('Gothitelle, Synchro Shot: 90, or 90 more with the same number of cards in hand as your opponent', () => {
  const hit = (mine: string[], theirs: string[]): number => {
    const g = mk([{ active: 'Gothitelle', energy: { active: [P, P] }, hand: mine }, { active: DRA, hand: theirs }]);
    choose(g, 'Attack: Synchro Shot');
    return dmg(g, 1);
  };
  assert.equal(hit([SLO, G], [G, W]), 180);
  assert.equal(hit([SLO, G], [G]), 90);
  assert.equal(hit([SLO], [G, W]), 90);
  assert.equal(hit([], []), 180);
});

// ------------------------------------------------------------------ Boldore

test("Boldore, Smack Down: 30, or 50 more if your opponent's Active Pokémon has {F} Resistance (Resistance is still applied: Compendium #597)", () => {
  const hit = (foe: string): number => {
    const g = mk([{ active: 'Boldore', energy: { active: [F] } }, { active: foe }]);
    choose(g, 'Attack: Smack Down');
    return dmg(g, 1);
  };
  assert.equal(hit(DRA), 30);
  assert.equal(hit('Spectrier'), 50, '30 + 50, then -30 for the Resistance');
  assert.equal(hit('Lillipup'), 30, 'no Resistance');
});

// ------------------------------------------------------------------ Gigalith

test('Gigalith, Vengeful Cannon: 20 damage for each damage counter on all of your Benched {F} Pokémon', () => {
  const g = mk([
    { active: 'Gigalith', bench: ['Roggenrola', 'Boldore', SLO], damage: { active: 50, 0: 30, 1: 20, 2: 40 }, energy: { active: [F] } },
    { active: DRA },
  ]);
  choose(g, 'Attack: Vengeful Cannon');
  assert.equal(dmg(g, 1), 100, '3 + 2 counters on the {F} Pokémon; the Active Gigalith and Slowpoke do not count');
  const none = mk([{ active: 'Gigalith', bench: [SLO], damage: { 0: 40 }, energy: { active: [F] } }, { active: DRA }]);
  choose(none, 'Attack: Vengeful Cannon');
  assert.equal(dmg(none, 1), 0);
});
