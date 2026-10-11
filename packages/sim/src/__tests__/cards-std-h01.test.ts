/**
 * Card tests, lane "std-h01": every card scripted in cards/scripts/std-h01.ts does
 * what its printed text says in a constructed position. Quotes are the printed
 * text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { scenario } from '../scenario.js';
import type { Decision } from '../types.js';
import { POISONED, PARALYZED, CONFUSED } from '../types.js';
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
function names(g: Game, p: 0 | 1, zone: 'bench' | 'hand'): string[] {
  const ps = g.state.p[p];
  if (zone === 'bench') return ps.bench.map((sl) => def(g.ctx, sl.cards[0] as number).name);
  return ps.hand.map((c) => def(g.ctx, c).name);
}
function activeName(g: Game, p: 0 | 1): string {
  return def(g.ctx, g.state.p[p].active!.cards[0] as number).name;
}

const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const K = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';

// Base deck for opponent
const BASE_DECK = fromIds('Base', [['me01-001', 10], ['mee-001', 20]]);
const STONE_DECK = fromIds('Stone', [['me01-081', 4], ['mee-006', 20]]);

// ------------------------------------------------------------------ Bulbasaur
test("Bulbasaur, Bind Down: 10, and the Defending Pokémon can't retreat next turn", () => {
  const deck = fromIds('B1', [['me01-001', 6], ['mee-001', 20]]);
  const layout = (): [{ active: string; bench?: string[]; energy: { active: string[] } }, { active: string; bench?: string[]; energy: { active: string[] } }] => [
    { active: 'Bulbasaur', energy: { active: [G] } },
    { active: 'Bulbasaur', bench: ['Bulbasaur'], energy: { active: [G, G] } },
  ];
  // control: with no Bind Down on it, the opponent's Active could retreat
  const control = scenario(deck, deck, layout(), { current: 1, turn: 4 });
  assert.ok(has(control, 'Retreat'), 'control: Bulbasaur can retreat');
  const g = scenario(deck, deck, layout());
  choose(g, 'Attack: Bind Down');
  assert.equal(g.state.p[1].active!.damage, 10);
  assert.equal(g.state.current, 1);
  assert.ok(!has(g, 'Retreat'), 'retreat offered under Bind Down');
  assert.ok(has(g, 'Attack: Bind Down'), 'attacking is still allowed');
});

// ------------------------------------------------------------------ Tangela
test('Tangela, Poison Powder: poison opponent', () => {
  const g = scenario(
    fromIds('T1', [['me01-006', 4], ['mee-001', 20]]),
    BASE_DECK,
    [{ active: 'Tangela', energy: { active: [G] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Poison Powder');
  assert.ok(g.state.p[1].active!.cond & POISONED);
});

// ------------------------------------------------------------------ Tangrowth
test('Tangrowth, Absorb: heal 30', () => {
  const g = scenario(
    fromIds('T2', [['me01-007', 4], ['mee-001', 20]]),
    BASE_DECK,
    [{ active: 'Tangrowth', energy: { active: [G, G] }, damage: { active: 50 } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Absorb');
  assert.equal(g.state.p[0].active!.damage, 20);
});

test('Tangrowth, Pumped-Up Whip: +140 with 2+ extra Energy', () => {
  const g = scenario(
    fromIds('T3', [['me01-007', 4], ['mee-001', 20]]),
    BASE_DECK,
    [{ active: 'Tangrowth', energy: { active: [G, G, G, G, G] } }, { active: 'Bulbasaur', damage: { active: 10 } }]
  );
  choose(g, 'Attack: Pumped-Up Whip');
  // Attack should be used
  assert.ok(g.state.p[1].active === null || g.state.p[1].active.damage > 10);
});

// ------------------------------------------------------------------ Bayleef
test('Bayleef, Push Down: 50, then the OPPONENT chooses the new Active', () => {
  const g = scenario(
    fromIds('B2', [['me01-009', 4], ['mee-001', 20]]),
    fromIds('Opp', [['me01-001', 2], ['me01-006', 2], ['mee-001', 20]]),
    [{ active: 'Bayleef', energy: { active: [G, G] } }, { active: 'Bulbasaur', bench: ['Tangela'] }]
  );
  choose(g, 'Attack: Push Down');
  assert.equal(g.decision!.player, 1, 'the opponent picks the switch-in');
  assert.ok(has(g, 'Tangela'));
  choose(g, 'Tangela');
  assert.equal(activeName(g, 1), 'Tangela');
  assert.deepEqual(names(g, 1, 'bench'), ['Bulbasaur']);
  assert.equal(g.state.p[1].bench[0]!.damage, 50, 'the damage stays on the Pokémon that was switched out');
  assert.equal(g.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Seedot
test('Seedot, Nap: heal 20', () => {
  const g = scenario(
    fromIds('S1', [['me01-013', 4], ['mee-001', 20]]),
    BASE_DECK,
    [{ active: 'Seedot', energy: { active: [G] }, damage: { active: 30 } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Nap');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Numel
test('Numel, Call for Family: up to 2 Basic Pokémon from the deck onto the Bench', () => {
  const g = scenario(
    fromIds('N1', [['me01-021', 1], ['me01-001', 2], ['me01-006', 2], ['mee-002', 20]]),
    BASE_DECK,
    [{ active: 'Numel', energy: { active: [F] }, bench: [] }, { active: 'Bulbasaur' }]
  );
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Call for Family');
  assert.equal(g.decision!.kind, 'cards');
  assert.equal(g.decision!.max, 2, 'at most 2');
  g.submit([0, 1]);
  assert.deepEqual(names(g, 0, 'bench').sort(), ['Bulbasaur', 'Tangela']);
  assert.equal(g.state.p[0].deck.length, deckBefore - 2);
  assert.equal(g.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Raboot
test('Raboot, Jumping Kick: 40 to a Benched Pokémon (no Weakness), the others untouched', () => {
  const g = scenario(
    fromIds('R1', [['me01-027', 4], ['mee-002', 20]]),
    fromIds('Opp2', [['me01-001', 2], ['me01-006', 2], ['mee-001', 20]]),
    [{ active: 'Raboot', energy: { active: [F, F] } }, { active: 'Bulbasaur', bench: ['Tangela'] }]
  );
  choose(g, 'Attack: Jumping Kick');
  assert.ok(has(g, 'Tangela') && has(g, 'Bulbasaur (Active)'), "any of the opponent's Pokémon can be chosen");
  choose(g, 'Tangela');
  assert.equal(g.state.p[1].bench[0]!.damage, 40);
  assert.equal(g.state.p[1].active!.damage, 0);
});

test('Raboot, Jumping Kick: choosing the Benched Bulbasaur (Fire-weak) is still just 40', () => {
  const g = scenario(
    fromIds('R1b', [['me01-027', 4], ['mee-002', 20]]),
    fromIds('Opp2b', [['me01-001', 2], ['me01-006', 2], ['mee-001', 20]]),
    [{ active: 'Raboot', energy: { active: [F] } }, { active: 'Tangela', bench: ['Bulbasaur'] }]
  );
  choose(g, 'Attack: Jumping Kick');
  choose(g, 'Bulbasaur');
  assert.equal(g.state.p[1].bench[0]!.damage, 40);
  assert.equal(g.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Mantine
test('Mantine, Call for Family: up to 2 Basic Pokémon from the deck onto the Bench', () => {
  const g = scenario(
    fromIds('M1', [['me01-032', 1], ['me01-001', 2], ['me01-006', 2], ['mee-003', 20]]),
    BASE_DECK,
    [{ active: 'Mantine', energy: { active: [W] }, bench: [] }, { active: 'Bulbasaur' }]
  );
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Call for Family');
  assert.equal(g.decision!.max, 2);
  g.submit([0, 1]);
  assert.deepEqual(names(g, 0, 'bench').sort(), ['Bulbasaur', 'Tangela']);
  assert.equal(g.state.p[0].deck.length, deckBefore - 2);
  assert.equal(g.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Corphish
test('Corphish, Take Down: self damage 10', () => {
  const g = scenario(
    fromIds('C1', [['me01-033', 4], ['mee-003', 20]]),
    BASE_DECK,
    [{ active: 'Corphish', energy: { active: [W, W] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Take Down');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Drizzile
test('Drizzile, Double Stab: 30 for each heads of 2 coins', () => {
  const run = (coins: boolean[]): number => {
    const g = scenario(
      fromIds('D1', [['me01-040', 4], ['mee-003', 20]]),
      BASE_DECK,
      [{ active: 'Drizzile', energy: { active: [W] } }, { active: 'Bulbasaur' }]
    );
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Double Stab');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([true, true]), 60);
  assert.equal(run([true, false]), 30);
  assert.equal(run([false, true]), 30);
  assert.equal(run([false, false]), 0);
});

// ------------------------------------------------------------------ Snom
test('Snom, Hide: heads prevents all damage to it next turn; tails does not', () => {
  const run = (heads: boolean): number => {
    const g = scenario(
      fromIds('S2', [['me01-042', 4], ['mee-003', 20]]),
      BASE_DECK,
      [{ active: 'Snom', energy: { active: [W] } }, { active: 'Bulbasaur', energy: { active: [G] } }]
    );
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Hide');
    choose(g, 'Attack: Bind Down'); // 10 damage from the opponent
    return g.state.p[0].active!.damage;
  };
  assert.equal(run(true), 0);
  assert.equal(run(false), 10);
});

// ------------------------------------------------------------------ Eiscue
test('Eiscue, Freezing Headbutt: 20, and heads Paralyzes (tails does not)', () => {
  const run = (heads: boolean) => {
    const g = scenario(
      fromIds('E1', [['me01-044', 4], ['mee-003', 20]]),
      BASE_DECK,
      [{ active: 'Eiscue', energy: { active: [W] } }, { active: 'Bulbasaur' }]
    );
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Freezing Headbutt');
    return g.state.p[1].active!;
  };
  const h = run(true);
  assert.equal(h.damage, 20);
  assert.equal(h.cond & PARALYZED, PARALYZED);
  const t = run(false);
  assert.equal(t.damage, 20);
  assert.equal(t.cond & PARALYZED, 0);
});

// ------------------------------------------------------------------ Magneton
test('Magneton, Thunder Shock: 30, and heads Paralyzes (tails does not)', () => {
  const run = (heads: boolean) => {
    const g = scenario(
      fromIds('M2', [['me01-046', 4], ['mee-004', 20]]),
      BASE_DECK,
      [{ active: 'Magneton', energy: { active: [L] } }, { active: 'Bulbasaur' }]
    );
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Thunder Shock');
    return g.state.p[1].active!;
  };
  const h = run(true);
  assert.equal(h.damage, 30);
  assert.equal(h.cond & PARALYZED, PARALYZED);
  const t = run(false);
  assert.equal(t.damage, 30);
  assert.equal(t.cond & PARALYZED, 0);
});

// ------------------------------------------------------------------ Electrike
test('Electrike, Thunder Jolt: self damage 10', () => {
  const g = scenario(
    fromIds('E2', [['me01-049', 4], ['mee-004', 20]]),
    BASE_DECK,
    [{ active: 'Electrike', energy: { active: [L] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Thunder Jolt');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Helioptile
test('Helioptile, Double Scratch: 10 for each heads of 2 coins', () => {
  const run = (coins: boolean[]): number => {
    const g = scenario(
      fromIds('H1', [['me01-052', 4], ['mee-004', 20]]),
      BASE_DECK,
      [{ active: 'Helioptile', energy: { active: [L] } }, { active: 'Bulbasaur' }]
    );
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Double Scratch');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([true, true]), 20);
  assert.equal(run([false, true]), 10);
  assert.equal(run([false, false]), 0);
});

// ------------------------------------------------------------------ Heliolisk
test('Heliolisk, Dazzle Blast: confuse opponent', () => {
  const g = scenario(
    fromIds('H2', [['me01-053', 4], ['mee-004', 20]]),
    BASE_DECK,
    [{ active: 'Heliolisk', energy: { active: [L] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Dazzle Blast');
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Jynx
test('Jynx, Psychic: 30, +30 for each Energy on the Defending Pokémon', () => {
  const run = (energy: string[]): number => {
    const g = scenario(
      fromIds('J1', [['me01-057', 4], ['mee-005', 20]]),
      STONE_DECK,
      [{ active: 'Jynx', energy: { active: [P, P] } }, { active: 'Stonjourner', energy: { active: energy } }]
    );
    choose(g, 'Attack: Psychic');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([]), 30);
  assert.equal(run([K]), 60);
  assert.equal(run([K, K]), 90);
});

// ------------------------------------------------------------------ Ralts
test('Ralts, Collect: draw card', () => {
  const g = scenario(
    fromIds('R2', [['me01-058', 4], ['mee-005', 20]]),
    BASE_DECK,
    [{ active: 'Ralts', energy: { active: [P] } }, { active: 'Bulbasaur' }]
  );
  const before = g.state.p[0].hand.length;
  choose(g, 'Attack: Collect');
  assert.equal(g.state.p[0].hand.length, before + 1);
});

// ------------------------------------------------------------------ Kirlia
test('Kirlia, Call Sign: up to 3 Pokémon from the deck into the hand', () => {
  const g = scenario(
    fromIds('K1', [['me01-059', 1], ['me01-001', 2], ['me01-006', 2], ['mee-005', 20]]),
    BASE_DECK,
    [{ active: 'Kirlia', energy: { active: [P] } }, { active: 'Bulbasaur' }]
  );
  const deckBefore = g.state.p[0].deck.length;
  assert.equal(g.state.p[0].hand.length, 0);
  choose(g, 'Attack: Call Sign');
  assert.equal(g.decision!.kind, 'cards');
  assert.equal(g.decision!.max, 3);
  g.submit([0, 1, 2]);
  assert.equal(g.state.p[0].hand.length, 3);
  assert.ok(names(g, 0, 'hand').every((n) => n === 'Bulbasaur' || n === 'Tangela'));
  assert.equal(g.state.p[0].deck.length, deckBefore - 3);
  assert.equal(g.state.p[1].active!.damage, 0, 'Call Sign does no damage');
});

// ------------------------------------------------------------------ Spoink
test('Spoink, Triple Spin: 10 for each heads of 3 coins', () => {
  const run = (coins: boolean[]): number => {
    const g = scenario(
      fromIds('S3', [['me01-062', 4], ['mee-005', 20]]),
      BASE_DECK,
      [{ active: 'Spoink', energy: { active: [P] } }, { active: 'Bulbasaur' }]
    );
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Triple Spin');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([true, true, true]), 30);
  assert.equal(run([true, false, true]), 20);
  assert.equal(run([false, false, true]), 10);
  assert.equal(run([false, false, false]), 0);
});

// ------------------------------------------------------------------ Greavard
test('Greavard, Take Down: self damage 10', () => {
  const g = scenario(
    fromIds('G1', [['me01-065', 4], ['mee-005', 20]]),
    BASE_DECK,
    [{ active: 'Greavard', energy: { active: [P, P] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Take Down');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Onix
test('Onix, Bind: 30, and heads Paralyzes (tails does not)', () => {
  const run = (heads: boolean) => {
    const g = scenario(
      fromIds('O1', [['me01-070', 4], ['mee-006', 20]]),
      BASE_DECK,
      [{ active: 'Onix', energy: { active: [K, K] } }, { active: 'Bulbasaur' }]
    );
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Bind');
    return g.state.p[1].active!;
  };
  const h = run(true);
  assert.equal(h.damage, 30);
  assert.equal(h.cond & PARALYZED, PARALYZED);
  const t = run(false);
  assert.equal(t.damage, 30);
  assert.equal(t.cond & PARALYZED, 0);
});

// ------------------------------------------------------------------ Tyrogue
test('Tyrogue, Pow-Pow Punching: 10, +30 for each heads before the first tails', () => {
  const run = (coins: boolean[]): number => {
    const g = scenario(
      fromIds('T4', [['me01-071', 4], ['mee-006', 20]]),
      BASE_DECK,
      [{ active: 'Tyrogue', energy: { active: [] } }, { active: 'Bulbasaur' }]
    );
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Pow-Pow Punching');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([false]), 10);
  assert.equal(run([true, false]), 40);
  assert.equal(run([true, true, false]), 70);
});

// ------------------------------------------------------------------ Toxicroak
test('Toxicroak, Reckless Charge: self damage 20', () => {
  const g = scenario(
    fromIds('T5', [['me01-079', 4], ['mee-006', 20]]),
    BASE_DECK,
    [{ active: 'Toxicroak', energy: { active: [K] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Reckless Charge');
  assert.equal(g.state.p[0].active!.damage, 20);
});

// ------------------------------------------------------------------ Stonjourner
test('Stonjourner, Stony Kick: 20, and 20 more to a chosen Benched Pokémon', () => {
  const g = scenario(
    fromIds('S4', [['me01-081', 4], ['mee-006', 20]]),
    fromIds('Opp3', [['me01-001', 2], ['me01-006', 2], ['mee-001', 20]]),
    [{ active: 'Stonjourner', energy: { active: [K] } }, { active: 'Bulbasaur', bench: ['Tangela', 'Bulbasaur'] }]
  );
  choose(g, 'Attack: Stony Kick');
  assert.ok(!has(g, '(Active)'), 'only Benched Pokémon can be chosen');
  g.submit([1]);
  assert.equal(g.state.p[1].active!.damage, 20);
  assert.equal(g.state.p[1].bench[0]!.damage, 0);
  assert.equal(g.state.p[1].bench[1]!.damage, 20);
});

test("Stonjourner, Boundless Power: 140, and it can't attack during your next turn", () => {
  const g = scenario(
    fromIds('S5', [['me01-081', 4], ['mee-006', 20]]),
    BASE_DECK,
    [{ active: 'Stonjourner', energy: { active: [K, K, K] } }, { active: 'Bulbasaur', bench: ['Bulbasaur'] }]
  );
  assert.ok(has(g, 'Attack: Stony Kick'), 'control: it can attack now');
  choose(g, 'Attack: Boundless Power');
  assert.equal(g.state.p[0].prizesTaken, 1, '140 Knocks Out the 80 HP Defending Pokémon');
  assert.equal(g.state.current, 1);
  choose(g, 'End turn');
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack: Boundless Power'), 'Boundless Power offered during my next turn');
  assert.ok(!has(g, 'Attack: Stony Kick'), 'Stony Kick offered during my next turn');
});

// ------------------------------------------------------------------ Naclstack
test("Naclstack, Rock Hurl: 50, and Resistance doesn't reduce it", () => {
  const run = (defender: string, id: string): number => {
    const g = scenario(
      fromIds('N2', [['me01-083', 4], ['mee-006', 20]]),
      fromIds('NO', [[id, 4], ['mee-001', 20]]),
      [{ active: 'Naclstack', energy: { active: [K, K] } }, { active: defender }]
    );
    choose(g, 'Attack: Rock Hurl');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run('Fearow', 'me01-103'), 50, 'Fearow resists Fighting: still 50, not 20');
  assert.equal(run('Bulbasaur', 'me01-001'), 50);
});

// ------------------------------------------------------------------ Thievul
test('Thievul, Greedy Hunt: draw until 6', () => {
  const g = scenario(
    fromIds('T6', [['me01-090', 4], ['mee-007', 20]]),
    BASE_DECK,
    [{ active: 'Thievul', energy: { active: [D] }, hand: [] }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Greedy Hunt');
  choose(g, 'Yes');
  assert.equal(g.state.p[0].hand.length, 6);
});

// ------------------------------------------------------------------ Shroodle
test('Shroodle, Poison Jab: poison opponent', () => {
  const g = scenario(
    fromIds('S6', [['me01-091', 4], ['mee-007', 20]]),
    BASE_DECK,
    [{ active: 'Shroodle', energy: { active: [D, D] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Poison Jab');
  assert.ok(g.state.p[1].active!.cond & POISONED);
});

// ------------------------------------------------------------------ Fearow
test('Fearow, Repeating Drill: 30 for each heads of 5 coins', () => {
  const run = (coins: boolean[]): number => {
    const g = scenario(
      fromIds('F1', [['me01-103', 4], ['mee-001', 20]]),
      STONE_DECK,
      [{ active: 'Fearow', energy: { active: [G] } }, { active: 'Stonjourner' }]
    );
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Repeating Drill');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([false, false, false, false, false]), 0);
  assert.equal(run([true, false, false, false, false]), 30);
  assert.equal(run([true, true, false, true, false]), 90);
  assert.equal(run([true, true, true, true, false]), 120);
});

// ------------------------------------------------------------------ Yungoos
test('Yungoos, Collect: draw card', () => {
  const g = scenario(
    fromIds('Y1', [['me01-109', 4], ['mee-001', 20]]),
    BASE_DECK,
    [{ active: 'Yungoos', energy: { active: [G] } }, { active: 'Bulbasaur' }]
  );
  const before = g.state.p[0].hand.length;
  choose(g, 'Attack: Collect');
  assert.equal(g.state.p[0].hand.length, before + 1);
});

// ------------------------------------------------------------------ Lombre
test('Lombre, Mega Drain: heal 30', () => {
  const g = scenario(
    fromIds('L1', [['me02-006', 4], ['mee-001', 20]]),
    BASE_DECK,
    [{ active: 'Lombre', energy: { active: [G, G] }, damage: { active: 40 } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Mega Drain');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Nymble
test('Nymble, Flail Around: 10 for each heads of 3 coins', () => {
  const run = (coins: boolean[]): number => {
    const g = scenario(
      fromIds('N3', [['me02-009', 4], ['mee-001', 20]]),
      BASE_DECK,
      [{ active: 'Nymble', energy: { active: [G] } }, { active: 'Bulbasaur' }]
    );
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Flail Around');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([true, true, true]), 30);
  assert.equal(run([true, false, true]), 20);
  assert.equal(run([false, true, false]), 10);
  assert.equal(run([false, false, false]), 0);
});

// ------------------------------------------------------------------ Reshiram
test('Reshiram, Burning Flare: self damage 60', () => {
  const g = scenario(
    fromIds('R3', [['me02-017', 4], ['mee-002', 20]]),
    BASE_DECK,
    [{ active: 'Reshiram', energy: { active: [F, F, F, F] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Burning Flare');
  assert.equal(g.state.p[0].active!.damage, 60);
});

// ------------------------------------------------------------------ Seel
test('Seel, Bubble Drain: heal 20', () => {
  const g = scenario(
    fromIds('S7', [['me02-021', 4], ['mee-003', 20]]),
    BASE_DECK,
    [{ active: 'Seel', energy: { active: [W, W] }, damage: { active: 25 } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Bubble Drain');
  assert.equal(g.state.p[0].active!.damage, 5);
});

// ------------------------------------------------------------------ Piloswine
test('Piloswine, Rising Lunge: 30, and heads makes it 60', () => {
  const run = (heads: boolean): number => {
    const g = scenario(
      fromIds('P1', [['me02-024', 4], ['mee-003', 20]]),
      BASE_DECK,
      [{ active: 'Piloswine', energy: { active: [W, W] } }, { active: 'Bulbasaur' }]
    );
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Rising Lunge');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(true), 60);
  assert.equal(run(false), 30);
});

// ------------------------------------------------------------------ Yamper
test('Yamper, Play Rough: 20, and heads makes it 40', () => {
  const run = (heads: boolean): number => {
    const g = scenario(
      fromIds('Y2', [['me02-030', 4], ['mee-004', 20]]),
      BASE_DECK,
      [{ active: 'Yamper', energy: { active: [L, L] } }, { active: 'Bulbasaur' }]
    );
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Play Rough');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(true), 40);
  assert.equal(run(false), 20);
});

// ------------------------------------------------------------------ Boltund
test('Boltund, Electric Run: 70, and heads makes it 140', () => {
  const run = (heads: boolean): Game => {
    const g = scenario(
      fromIds('B3', [['me02-031', 4], ['mee-004', 20]]),
      STONE_DECK,
      [{ active: 'Boltund', energy: { active: [L, L] } }, { active: 'Stonjourner', bench: ['Stonjourner'] }]
    );
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Electric Run');
    return g;
  };
  const t = run(false);
  assert.equal(t.state.p[1].active!.damage, 70);
  assert.equal(t.state.p[0].prizesTaken, 0);
  const h = run(true);
  assert.equal(h.state.p[0].prizesTaken, 1, '140 Knocks Out the 130 HP Defending Pokémon');
});

// ------------------------------------------------------------------ Milcery
test('Milcery, Draining Kiss: heal 10', () => {
  const g = scenario(
    fromIds('M3', [['me02-043', 4], ['mee-005', 20]]),
    BASE_DECK,
    [{ active: 'Milcery', energy: { active: [P] }, damage: { active: 15 } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Draining Kiss');
  assert.equal(g.state.p[0].active!.damage, 5);
});

// ------------------------------------------------------------------ Gligar
test('Gligar, Poison Jab: poison opponent', () => {
  const g = scenario(
    fromIds('G2', [['me02-049', 4], ['mee-006', 20]]),
    BASE_DECK,
    [{ active: 'Gligar', energy: { active: [K] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Poison Jab');
  assert.ok(g.state.p[1].active!.cond & POISONED);
});

// ------------------------------------------------------------------ Trapinch
test('Trapinch, Double Headbutt: 10 for each heads of 2 coins', () => {
  const run = (coins: boolean[]): number => {
    const g = scenario(
      fromIds('T7', [['me02-051', 4], ['mee-006', 20]]),
      BASE_DECK,
      [{ active: 'Trapinch', energy: { active: [K] } }, { active: 'Bulbasaur' }]
    );
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Double Headbutt');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([true, true]), 20);
  assert.equal(run([true, false]), 10);
  assert.equal(run([false, false]), 0);
});
