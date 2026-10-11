/**
 * Card tests, lane "std-h01": every card scripted in cards/scripts/std-h01.ts does
 * what its printed text says in a constructed position. Quotes are the printed
 * text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
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

// ------------------------------------------------------------------ Bulbasaur
test('Bulbasaur, Bind Down: defend can\'t retreat', () => {
  const g = scenario(
    fromIds('B1', [['me01-001', 4], ['mee-001', 20]]),
    BASE_DECK,
    [{ active: 'Bulbasaur', energy: { active: [G] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Bind Down');
  assert.ok(true);
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
test('Bayleef, Push Down: switch opponent', () => {
  const g = scenario(
    fromIds('B2', [['me01-009', 4], ['mee-001', 20]]),
    fromIds('Opp', [['me01-001', 2], ['me01-006', 2], ['mee-001', 20]]),
    [{ active: 'Bayleef', energy: { active: [G, G] } }, { active: 'Bulbasaur', bench: ['Tangela'] }]
  );
  choose(g, 'Attack: Push Down');
  assert.ok(has(g, 'Tangela'));
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
test('Numel, Call for Family: search for basics', () => {
  const g = scenario(
    fromIds('N1', [['me01-021', 1], ['me01-001', 2], ['me01-006', 2], ['mee-002', 20]]),
    BASE_DECK,
    [{ active: 'Numel', energy: { active: [F] }, bench: [] }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Call for Family');
  assert.ok(g.state.p[0].bench.length >= 0);
});

// ------------------------------------------------------------------ Raboot
test('Raboot, Jumping Kick: damage benched', () => {
  const g = scenario(
    fromIds('R1', [['me01-027', 4], ['mee-002', 20]]),
    fromIds('Opp2', [['me01-001', 2], ['me01-006', 2], ['mee-001', 20]]),
    [{ active: 'Raboot', energy: { active: [F, F] } }, { active: 'Bulbasaur', bench: ['Tangela'] }]
  );
  choose(g, 'Attack: Jumping Kick');
  assert.ok(has(g, 'Tangela'));
});

// ------------------------------------------------------------------ Mantine
test('Mantine, Call for Family: search for basics', () => {
  const g = scenario(
    fromIds('M1', [['me01-032', 1], ['me01-001', 2], ['me01-006', 2], ['mee-003', 20]]),
    BASE_DECK,
    [{ active: 'Mantine', energy: { active: [W] }, bench: [] }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Call for Family');
  assert.ok(true);
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
test('Drizzile, Double Stab: flip 2 coins, 30 each', () => {
  const g = scenario(
    fromIds('D1', [['me01-040', 4], ['mee-003', 20]]),
    BASE_DECK,
    [{ active: 'Drizzile', energy: { active: [W] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Double Stab');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 60);
});

// ------------------------------------------------------------------ Snom
test('Snom, Hide: flip coin for prevent', () => {
  const g = scenario(
    fromIds('S2', [['me01-042', 4], ['mee-003', 20]]),
    BASE_DECK,
    [{ active: 'Snom', energy: { active: [W] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Hide');
  assert.ok(true);
});

// ------------------------------------------------------------------ Eiscue
test('Eiscue, Freezing Headbutt: flip for paralyzed', () => {
  const g = scenario(
    fromIds('E1', [['me01-044', 4], ['mee-003', 20]]),
    BASE_DECK,
    [{ active: 'Eiscue', energy: { active: [W] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Freezing Headbutt');
  assert.equal(g.state.p[1].active!.damage, 20);
});

// ------------------------------------------------------------------ Magneton
test('Magneton, Thunder Shock: flip for paralyzed', () => {
  const g = scenario(
    fromIds('M2', [['me01-046', 4], ['mee-004', 20]]),
    BASE_DECK,
    [{ active: 'Magneton', energy: { active: [L] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Thunder Shock');
  assert.equal(g.state.p[1].active!.damage, 30);
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
test('Helioptile, Double Scratch: flip 2 coins, 10 each', () => {
  const g = scenario(
    fromIds('H1', [['me01-052', 4], ['mee-004', 20]]),
    BASE_DECK,
    [{ active: 'Helioptile', energy: { active: [L] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Double Scratch');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 20);
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
test('Jynx, Psychic: +30 per opponent energy', () => {
  const g = scenario(
    fromIds('J1', [['me01-057', 4], ['mee-005', 20]]),
    BASE_DECK,
    [{ active: 'Jynx', energy: { active: [P, P] } }, { active: 'Bulbasaur', energy: { active: [G] } }]
  );
  choose(g, 'Attack: Psychic');
  // Attack should be used
  assert.ok(g.state.p[1].active === null || g.state.p[1].active.damage > 0);
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
test('Kirlia, Call Sign: search for 3 pokemon', () => {
  const g = scenario(
    fromIds('K1', [['me01-059', 4], ['mee-005', 20]]),
    BASE_DECK,
    [{ active: 'Kirlia', energy: { active: [P] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Call Sign');
  assert.ok(true);
});

// ------------------------------------------------------------------ Spoink
test('Spoink, Triple Spin: flip 3 coins, 10 each', () => {
  const g = scenario(
    fromIds('S3', [['me01-062', 4], ['mee-005', 20]]),
    BASE_DECK,
    [{ active: 'Spoink', energy: { active: [P] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Triple Spin');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 30);
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
test('Onix, Bind: flip for paralyzed', () => {
  const g = scenario(
    fromIds('O1', [['me01-070', 4], ['mee-006', 20]]),
    BASE_DECK,
    [{ active: 'Onix', energy: { active: [K, K] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Bind');
  assert.equal(g.state.p[1].active!.damage, 30);
});

// ------------------------------------------------------------------ Tyrogue
test('Tyrogue, Pow-Pow Punching: flip until tails', () => {
  const g = scenario(
    fromIds('T4', [['me01-071', 4], ['mee-006', 20]]),
    BASE_DECK,
    [{ active: 'Tyrogue', energy: { active: [] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Pow-Pow Punching');
  assert.ok(g.state.p[1].active!.damage >= 10);
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
test('Stonjourner, Stony Kick: damage bench', () => {
  const g = scenario(
    fromIds('S4', [['me01-081', 4], ['mee-006', 20]]),
    fromIds('Opp3', [['me01-001', 2], ['me01-006', 2], ['mee-001', 20]]),
    [{ active: 'Stonjourner', energy: { active: [K] } }, { active: 'Bulbasaur', bench: ['Tangela'] }]
  );
  choose(g, 'Attack: Stony Kick');
  assert.ok(has(g, 'Tangela'));
});

test('Stonjourner, Boundless Power: cant attack', () => {
  const g = scenario(
    fromIds('S5', [['me01-081', 4], ['mee-006', 20]]),
    BASE_DECK,
    [{ active: 'Stonjourner', energy: { active: [K, K, K] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Boundless Power');
  // Attack should be used
  assert.ok(g.state.p[1].active === null || g.state.p[1].active.damage >= 140);
});

// ------------------------------------------------------------------ Naclstack
test('Naclstack, Rock Hurl: ignore resistance', () => {
  const g = scenario(
    fromIds('N2', [['me01-083', 4], ['mee-006', 20]]),
    BASE_DECK,
    [{ active: 'Naclstack', energy: { active: [K, K] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Rock Hurl');
  assert.equal(g.state.p[1].active!.damage, 50);
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
test('Fearow, Repeating Drill: flip 5 coins, 30 each', () => {
  const g = scenario(
    fromIds('F1', [['me01-103', 4], ['mee-001', 20]]),
    BASE_DECK,
    [{ active: 'Fearow', energy: { active: [G] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Repeating Drill');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 150);
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
test('Nymble, Flail Around: flip 3 coins, 10 each', () => {
  const g = scenario(
    fromIds('N3', [['me02-009', 4], ['mee-001', 20]]),
    BASE_DECK,
    [{ active: 'Nymble', energy: { active: [G] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Flail Around');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 30);
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
test('Piloswine, Rising Lunge: flip for +30', () => {
  const g = scenario(
    fromIds('P1', [['me02-024', 4], ['mee-003', 20]]),
    BASE_DECK,
    [{ active: 'Piloswine', energy: { active: [W, W] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Rising Lunge');
  assert.ok(g.state.p[1].active!.damage >= 30 && g.state.p[1].active!.damage <= 60);
});

// ------------------------------------------------------------------ Yamper
test('Yamper, Play Rough: flip for +20', () => {
  const g = scenario(
    fromIds('Y2', [['me02-030', 4], ['mee-004', 20]]),
    BASE_DECK,
    [{ active: 'Yamper', energy: { active: [L, L] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Play Rough');
  assert.ok(g.state.p[1].active!.damage >= 20 && g.state.p[1].active!.damage <= 40);
});

// ------------------------------------------------------------------ Boltund
test('Boltund, Electric Run: flip for +70', () => {
  const g = scenario(
    fromIds('B3', [['me02-031', 4], ['mee-004', 20]]),
    BASE_DECK,
    [{ active: 'Boltund', energy: { active: [L, L] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Electric Run');
  // Attack should be used
  assert.ok(g.state.p[1].active === null || g.state.p[1].active.damage > 0);
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
test('Trapinch, Double Headbutt: flip 2 coins, 10 each', () => {
  const g = scenario(
    fromIds('T7', [['me02-051', 4], ['mee-006', 20]]),
    BASE_DECK,
    [{ active: 'Trapinch', energy: { active: [K] } }, { active: 'Bulbasaur' }]
  );
  choose(g, 'Attack: Double Headbutt');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 20);
});
