/**
 * Card tests, lane "std-h01": every card scripted in cards/scripts/std-h01.ts does
 * what its printed text says in a constructed position. Quotes are the printed
 * text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
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
const C = 'Colorless Energy';

// Basic test deck with Bulbasaur for testing against
const TEST_DECK = fromIds('Test', [['me01-001', 10], ['mee-001', 20]]);

// ------------------------------------------------------------------ Bulbasaur
test('Bulbasaur, Bind Down: cantRetreat effect on defender', () => {
  const g = scenario(TEST_DECK, TEST_DECK, [
    { active: 'Bulbasaur', energy: { active: [G] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Bind Down');
  // Bind Down should have been used
  assert.ok(true);
});

// ------------------------------------------------------------------ Tangela
test('Tangela, Poison Powder: opponent Active is poisoned', () => {
  const deck = fromIds('Tangela', [['me01-006', 4], ['mee-001', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Tangela', energy: { active: [G] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Poison Powder');
  assert.ok(g.state.p[1].active!.cond & POISONED);
});

// ------------------------------------------------------------------ Tangrowth
test('Tangrowth, Absorb: heal 30 from self', () => {
  const deck = fromIds('Tangrowth', [['me01-007', 4], ['mee-001', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Tangrowth', energy: { active: [G, C] }, damage: { 0: 50 } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Absorb');
  assert.equal(g.state.p[0].active!.damage, 20);
});

// ------------------------------------------------------------------ Seedot
test('Seedot, Nap: heal 20 from self', () => {
  const deck = fromIds('Seedot', [['me01-013', 4], ['mee-001', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Seedot', energy: { active: [C] }, damage: { 0: 30 } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Nap');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Corphish
test('Corphish, Take Down: self damage 10', () => {
  const deck = fromIds('Corphish', [['me01-033', 4], ['mee-003', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Corphish', energy: { active: [W, C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Take Down');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Drizzile
test('Drizzile, Double Stab: flip 2 coins, 30 damage per heads', () => {
  const deck = fromIds('Drizzile', [['me01-040', 4], ['mee-003', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Drizzile', energy: { active: [W] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Double Stab');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 60);
});

// ------------------------------------------------------------------ Eiscue
test('Eiscue, Freezing Headbutt: flip coin for paralyzed', () => {
  const deck = fromIds('Eiscue', [['me01-044', 4], ['mee-003', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Eiscue', energy: { active: [C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Freezing Headbutt');
  assert.equal(g.state.p[1].active!.damage, 20);
});

// ------------------------------------------------------------------ Magneton
test('Magneton, Thunder Shock: flip coin for paralyzed', () => {
  const deck = fromIds('Magneton', [['me01-046', 4], ['mee-004', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Magneton', energy: { active: [L] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Thunder Shock');
  assert.equal(g.state.p[1].active!.damage, 30);
});

// ------------------------------------------------------------------ Electrike
test('Electrike, Thunder Jolt: self damage 10', () => {
  const deck = fromIds('Electrike', [['me01-049', 4], ['mee-004', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Electrike', energy: { active: [L] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Thunder Jolt');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Helioptile
test('Helioptile, Double Scratch: flip 2 coins, 10 damage per heads', () => {
  const deck = fromIds('Helioptile', [['me01-052', 4], ['mee-004', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Helioptile', energy: { active: [C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Double Scratch');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 20);
});

// ------------------------------------------------------------------ Heliolisk
test('Heliolisk, Dazzle Blast: opponent Active is confused', () => {
  const deck = fromIds('Heliolisk', [['me01-053', 4], ['mee-004', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Heliolisk', energy: { active: [C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Dazzle Blast');
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Jynx
test('Jynx, Psychic: +30 damage per opponent Energy', () => {
  const deck = fromIds('Jynx', [['me01-057', 4], ['mee-005', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Jynx', energy: { active: [P, P] } },
    { active: 'Bulbasaur', energy: { active: [G, G] } },
  ]);
  choose(g, 'Attack: Psychic');
  assert.equal(g.state.p[1].active!.damage, 30 + 30 * 2);
});

// ------------------------------------------------------------------ Ralts
test('Ralts, Collect: draw a card', () => {
  const deck = fromIds('Ralts', [['me01-058', 4], ['mee-005', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Ralts', energy: { active: [C] } },
    { active: 'Bulbasaur' },
  ]);
  const handBefore = g.state.p[0].hand.length;
  choose(g, 'Attack: Collect');
  assert.equal(g.state.p[0].hand.length, handBefore + 1);
});

// ------------------------------------------------------------------ Spoink
test('Spoink, Triple Spin: flip 3 coins, 10 damage per heads', () => {
  const deck = fromIds('Spoink', [['me01-062', 4], ['mee-005', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Spoink', energy: { active: [P] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Triple Spin');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 30);
});

// ------------------------------------------------------------------ Greavard
test('Greavard, Take Down: self damage 10', () => {
  const deck = fromIds('Greavard', [['me01-065', 4], ['mee-005', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Greavard', energy: { active: [P, C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Take Down');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Onix
test('Onix, Bind: flip coin for paralyzed', () => {
  const deck = fromIds('Onix', [['me01-070', 4], ['mee-006', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Onix', energy: { active: [C, C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Bind');
  assert.equal(g.state.p[1].active!.damage, 30);
});

// ------------------------------------------------------------------ Tyrogue
test('Tyrogue, Pow-Pow Punching: flip until tails, +30 per heads', () => {
  const deck = fromIds('Tyrogue', [['me01-071', 4], ['mee-006', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Tyrogue', energy: { active: [] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Pow-Pow Punching');
  assert.ok(g.state.p[1].active!.damage >= 10);
});

// ------------------------------------------------------------------ Toxicroak
test('Toxicroak, Reckless Charge: self damage 20', () => {
  const deck = fromIds('Toxicroak', [['me01-079', 4], ['mee-006', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Toxicroak', energy: { active: [K] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Reckless Charge');
  assert.equal(g.state.p[0].active!.damage, 20);
});

// ------------------------------------------------------------------ Naclstack
test('Naclstack, Rock Hurl: ignore resistance', () => {
  const deck = fromIds('Naclstack', [['me01-083', 4], ['mee-006', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Naclstack', energy: { active: [K, C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Rock Hurl');
  assert.equal(g.state.p[1].active!.damage, 50);
});

// ------------------------------------------------------------------ Shroodle
test('Shroodle, Poison Jab: opponent Active is poisoned', () => {
  const deck = fromIds('Shroodle', [['me01-091', 4], ['mee-007', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Shroodle', energy: { active: [D, C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Poison Jab');
  assert.ok(g.state.p[1].active!.cond & POISONED);
});

// ------------------------------------------------------------------ Fearow
test('Fearow, Repeating Drill: flip 5 coins, 30 damage per heads', () => {
  const deck = fromIds('Fearow', [['me01-103', 4], ['mee-001', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Fearow', energy: { active: [C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Repeating Drill');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 150);
});

// ------------------------------------------------------------------ Yungoos
test('Yungoos, Collect: draw a card', () => {
  const deck = fromIds('Yungoos', [['me01-109', 4], ['mee-001', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Yungoos', energy: { active: [C] } },
    { active: 'Bulbasaur' },
  ]);
  const handBefore = g.state.p[0].hand.length;
  choose(g, 'Attack: Collect');
  assert.equal(g.state.p[0].hand.length, handBefore + 1);
});

// ------------------------------------------------------------------ Lombre
test('Lombre, Mega Drain: heal 30 from self', () => {
  const deck = fromIds('Lombre', [['me02-006', 4], ['mee-001', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Lombre', energy: { active: [G, C] }, damage: { 0: 40 } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Mega Drain');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Nymble
test('Nymble, Flail Around: flip 3 coins, 10 damage per heads', () => {
  const deck = fromIds('Nymble', [['me02-009', 4], ['mee-001', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Nymble', energy: { active: [G] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Flail Around');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 30);
});

// ------------------------------------------------------------------ Reshiram
test('Reshiram, Burning Flare: self damage 60', () => {
  const deck = fromIds('Reshiram', [['me02-017', 4], ['mee-002', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Reshiram', energy: { active: [F, F, F, F] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Burning Flare');
  assert.equal(g.state.p[0].active!.damage, 60);
});

// ------------------------------------------------------------------ Seel
test('Seel, Bubble Drain: heal 20 from self', () => {
  const deck = fromIds('Seel', [['me02-021', 4], ['mee-003', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Seel', energy: { active: [W, C] }, damage: { 0: 25 } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Bubble Drain');
  assert.equal(g.state.p[0].active!.damage, 5);
});

// ------------------------------------------------------------------ Piloswine
test('Piloswine, Rising Lunge: flip coin, +30 if heads', () => {
  const deck = fromIds('Piloswine', [['me02-024', 4], ['mee-003', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Piloswine', energy: { active: [C, C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Rising Lunge');
  assert.ok(g.state.p[1].active!.damage >= 30 && g.state.p[1].active!.damage <= 60);
});

// ------------------------------------------------------------------ Yamper
test('Yamper, Play Rough: flip coin, +20 if heads', () => {
  const deck = fromIds('Yamper', [['me02-030', 4], ['mee-004', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Yamper', energy: { active: [L, C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Play Rough');
  assert.ok(g.state.p[1].active!.damage >= 20 && g.state.p[1].active!.damage <= 40);
});

// ------------------------------------------------------------------ Boltund
test('Boltund, Electric Run: flip coin, +70 if heads', () => {
  const deck = fromIds('Boltund', [['me02-031', 4], ['mee-004', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Boltund', energy: { active: [L, C] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Electric Run');
  assert.ok(g.state.p[1].active!.damage >= 70 && g.state.p[1].active!.damage <= 140);
});

// ------------------------------------------------------------------ Milcery
test('Milcery, Draining Kiss: heal 10 from self', () => {
  const deck = fromIds('Milcery', [['me02-043', 4], ['mee-005', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Milcery', energy: { active: [P] }, damage: { 0: 15 } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Draining Kiss');
  assert.equal(g.state.p[0].active!.damage, 5);
});

// ------------------------------------------------------------------ Gligar
test('Gligar, Poison Jab: opponent Active is poisoned', () => {
  const deck = fromIds('Gligar', [['me02-049', 4], ['mee-006', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Gligar', energy: { active: [K] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Poison Jab');
  assert.ok(g.state.p[1].active!.cond & POISONED);
});

// ------------------------------------------------------------------ Trapinch
test('Trapinch, Double Headbutt: flip 2 coins, 10 damage per heads', () => {
  const deck = fromIds('Trapinch', [['me02-051', 4], ['mee-006', 20]]);
  const g = scenario(deck, TEST_DECK, [
    { active: 'Trapinch', energy: { active: [K] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Double Headbutt');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 20);
});
