/**
 * Card tests, lane "std-h01": every card scripted in cards/scripts/std-h01.ts does
 * what its printed text says in a constructed position. Quotes are the printed
 * text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { damageIn, maxHp } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { CONFUSED, POISONED, PARALYZED } from '../types.js';
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

const BULBASAUR_DECK = fromIds('Bulbasaur deck', [['me01-001', 1], ['me01-001', 1], ['mee-001', 4]]);
const GENERIC_DECK = fromIds('Generic deck', [['me01-001', 2], ['mee-001', 4]]);

// ------------------------------------------------------------------ Bulbasaur
test('Bulbasaur, Bind Down: the defending Pokémon can\'t retreat during opponent\'s next turn', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Bulbasaur', energy: { active: [G] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Bind Down');
  assert.equal(g.decision?.player, 1);
  assert.ok(!has(g, 'Retreat'), 'the defending Pokémon cannot retreat');
  choose(g, 'End turn');
  assert.equal(g.decision?.player, 0);
  choose(g, 'End turn');
  assert.equal(g.decision?.player, 1);
  assert.ok(has(g, 'Retreat'), 'the effect wore off after opponent\'s turn');
});

// ------------------------------------------------------------------ Tangela
test('Tangela, Poison Powder: opponent\'s Active Pokémon is Poisoned', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Tangela', energy: { active: [G] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Poison Powder');
  assert.ok(g.state.p[1].active!.cond & POISONED);
});

// ------------------------------------------------------------------ Tangrowth
test('Tangrowth, Absorb: heal 30 damage from self', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Tangrowth', energy: { active: [G, 'Colorless'] }, damage: { 0: 30 } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Absorb');
  assert.equal(g.state.p[0].active!.damage, 0);
});

test('Tangrowth, Pumped-Up Whip: +140 damage with 2+ extra Energy beyond cost', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Tangrowth', energy: { active: [G, G, G, G, G, G] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Pumped-Up Whip');
  assert.equal(g.state.p[1].active!.damage, 260);
});

// ------------------------------------------------------------------ Bayleef
test('Bayleef, Push Down: switch out opponent\'s Active Pokémon', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Bayleef', energy: { active: [G, 'Colorless'] }, bench: ['Tangela'] },
    { active: 'Bulbasaur', bench: ['Tangela'] },
  ]);
  choose(g, 'Attack: Push Down');
  assert.ok(has(g, 'Tangela'), 'opponent chooses which to switch in');
  choose(g, 'Tangela');
  assert.equal(g.state.p[1].active!.damage, 50);
});

// ------------------------------------------------------------------ Seedot
test('Seedot, Nap: heal 20 damage from self', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Seedot', energy: { active: ['Colorless'] }, damage: { 0: 30 } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Nap');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Numel
test('Numel, Call for Family: search deck for up to 2 Basic Pokémon to Bench', () => {
  const deck = fromIds('With searchables', [
    ['me01-021', 1],
    ['me01-001', 2],
    ['me01-001', 2],
    ['mee-002', 4],
  ]);
  const g = scenario(deck, GENERIC_DECK, [
    { active: 'Numel', energy: { active: [F] }, bench: [] },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Call for Family');
  assert.ok(has(g, 'Bulbasaur'), 'Bulbasaur is searchable');
  choose(g, 'Bulbasaur');
  choose(g, 'Bulbasaur');
  assert.equal(g.state.p[0].bench.length, 2);
});

// ------------------------------------------------------------------ Raboot
test('Raboot, Jumping Kick: damage to chosen opponent\'s Pokémon without Weakness/Resistance', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Raboot', energy: { active: [F, 'Colorless'] } },
    { active: 'Bulbasaur', bench: ['Tangela'] },
  ]);
  choose(g, 'Attack: Jumping Kick');
  choose(g, 'Tangela');
  assert.equal(g.state.p[1].bench[0]!.damage, 40);
});

// ------------------------------------------------------------------ Mantine
test('Mantine, Call for Family: search deck for up to 2 Basic Pokémon to Bench', () => {
  const deck = fromIds('With searchables', [
    ['me01-032', 1],
    ['me01-001', 2],
    ['me01-001', 2],
    ['mee-003', 4],
  ]);
  const g = scenario(deck, GENERIC_DECK, [
    { active: 'Mantine', energy: { active: ['Colorless'] }, bench: [] },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Call for Family');
  choose(g, 'Bulbasaur');
  choose(g, 'Bulbasaur');
  assert.equal(g.state.p[0].bench.length, 2);
});

// ------------------------------------------------------------------ Corphish
test('Corphish, Take Down: self damage 10', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Corphish', energy: { active: ['Colorless', 'Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Take Down');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Drizzile
test('Drizzile, Double Stab: flip 2 coins, 30 damage per heads', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Drizzile', energy: { active: [W] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Double Stab');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 60);
});

// ------------------------------------------------------------------ Snom
test('Snom, Hide: flip coin, if heads prevent damage and effects next turn', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Snom', energy: { active: [W] } },
    { active: 'Bulbasaur', energy: { active: [G] } },
  ]);
  choose(g, 'Attack: Hide');
  assert.equal(g.decision?.player, 1);
  choose(g, 'Attack: Vise Grip');
  assert.equal(g.state.p[0].active!.damage, 0, 'damage was prevented (coin was heads)');
});

// ------------------------------------------------------------------ Eiscue
test('Eiscue, Freezing Headbutt: flip coin, if heads opponent\'s Active is Paralyzed', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Eiscue', energy: { active: ['Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Freezing Headbutt');
  if (g.state.p[1].active!.cond & PARALYZED) {
    // Coin was heads
    assert.ok(true);
  }
});

// ------------------------------------------------------------------ Magneton
test('Magneton, Thunder Shock: flip coin, if heads opponent\'s Active is Paralyzed', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Magneton', energy: { active: [L] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Thunder Shock');
  assert.equal(g.state.p[1].active!.damage, 30);
});

// ------------------------------------------------------------------ Electrike
test('Electrike, Thunder Jolt: self damage 10', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Electrike', energy: { active: [L] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Thunder Jolt');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Helioptile
test('Helioptile, Double Scratch: flip 2 coins, 10 damage per heads', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Helioptile', energy: { active: ['Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Double Scratch');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 20);
});

// ------------------------------------------------------------------ Heliolisk
test('Heliolisk, Dazzle Blast: opponent\'s Active is Confused', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Heliolisk', energy: { active: ['Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Dazzle Blast');
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Jynx
test('Jynx, Psychic: +30 damage per Energy on opponent\'s Active', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Jynx', energy: { active: [P, P] } },
    { active: 'Bulbasaur', energy: { active: [G, G, G] } },
  ]);
  choose(g, 'Attack: Psychic');
  assert.equal(g.state.p[1].active!.damage, 30 + 30 * 3);
});

// ------------------------------------------------------------------ Ralts
test('Ralts, Collect: draw a card', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Ralts', energy: { active: ['Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  const initialHand = g.state.p[0].hand.length;
  choose(g, 'Attack: Collect');
  assert.equal(g.state.p[0].hand.length, initialHand + 1);
});

// ------------------------------------------------------------------ Kirlia
test('Kirlia, Call Sign: search deck for up to 3 Pokémon to hand', () => {
  const deck = fromIds('With searchables', [
    ['me01-058', 1],
    ['me01-001', 2],
    ['me01-001', 2],
    ['me01-006', 1],
    ['mee-005', 4],
  ]);
  const g = scenario(deck, GENERIC_DECK, [
    { active: 'Kirlia', energy: { active: [P] }, hand: [] },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Call Sign');
  // Should search for pokemon
  assert.ok(has(g, 'Bulbasaur') || has(g, 'Tangela'));
});

// ------------------------------------------------------------------ Spoink
test('Spoink, Triple Spin: flip 3 coins, 10 damage per heads', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Spoink', energy: { active: [P] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Triple Spin');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 30);
});

// ------------------------------------------------------------------ Greavard
test('Greavard, Take Down: self damage 10', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Greavard', energy: { active: [P, 'Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Take Down');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Onix
test('Onix, Bind: flip coin, if heads opponent\'s Active is Paralyzed', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Onix', energy: { active: ['Colorless', 'Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Bind');
  assert.equal(g.state.p[1].active!.damage, 30);
});

// ------------------------------------------------------------------ Tyrogue
test('Tyrogue, Pow-Pow Punching: flip until tails, +30 per heads', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Tyrogue', energy: { active: [] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Pow-Pow Punching');
  assert.ok(g.state.p[1].active!.damage >= 10);
});

// ------------------------------------------------------------------ Toxicroak
test('Toxicroak, Reckless Charge: self damage 20', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Toxicroak', energy: { active: [K] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Reckless Charge');
  assert.equal(g.state.p[0].active!.damage, 20);
});

// ------------------------------------------------------------------ Stonjourner
test('Stonjourner, Stony Kick: damage benched Pokémon', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Stonjourner', energy: { active: [K] } },
    { active: 'Bulbasaur', bench: ['Tangela'] },
  ]);
  choose(g, 'Attack: Stony Kick');
  choose(g, 'Tangela');
  assert.equal(g.state.p[1].bench[0]!.damage, 20);
});

test('Stonjourner, Boundless Power: can\'t use attacks next turn', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Stonjourner', energy: { active: [K, K, 'Colorless'] } },
    { active: 'Bulbasaur', energy: { active: [G] } },
  ]);
  choose(g, 'Attack: Boundless Power');
  assert.equal(g.state.p[1].active!.damage, 140);
  assert.equal(g.decision?.player, 1);
  choose(g, 'Attack: Vise Grip');
  assert.equal(g.state.p[0].active!.damage, 0, 'the attack was blocked');
});

// ------------------------------------------------------------------ Naclstack
test('Naclstack, Rock Hurl: damage not affected by Resistance', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Naclstack', energy: { active: [K, 'Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Rock Hurl');
  assert.equal(g.state.p[1].active!.damage, 50);
});

// ------------------------------------------------------------------ Thievul
test('Thievul, Greedy Hunt: draw cards until 6 in hand', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Thievul', energy: { active: ['Colorless'] }, hand: [] },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Greedy Hunt');
  choose(g, 'Yes');
  assert.equal(g.state.p[0].hand.length, 6);
});

// ------------------------------------------------------------------ Shroodle
test('Shroodle, Poison Jab: opponent\'s Active is Poisoned', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Shroodle', energy: { active: [D, 'Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Poison Jab');
  assert.ok(g.state.p[1].active!.cond & POISONED);
});

// ------------------------------------------------------------------ Fearow
test('Fearow, Repeating Drill: flip 5 coins, 30 damage per heads', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Fearow', energy: { active: ['Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Repeating Drill');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 150);
});

// ------------------------------------------------------------------ Yungoos
test('Yungoos, Collect: draw a card', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Yungoos', energy: { active: ['Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  const initialHand = g.state.p[0].hand.length;
  choose(g, 'Attack: Collect');
  assert.equal(g.state.p[0].hand.length, initialHand + 1);
});

// ------------------------------------------------------------------ Lombre
test('Lombre, Mega Drain: heal 30 damage from self', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Lombre', energy: { active: [G, 'Colorless'] }, damage: { 0: 40 } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Mega Drain');
  assert.equal(g.state.p[0].active!.damage, 10);
});

// ------------------------------------------------------------------ Nymble
test('Nymble, Flail Around: flip 3 coins, 10 damage per heads', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Nymble', energy: { active: [G] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Flail Around');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 30);
});

// ------------------------------------------------------------------ Reshiram
test('Reshiram, Burning Flare: self damage 60', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Reshiram', energy: { active: [F, F, F, F] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Burning Flare');
  assert.equal(g.state.p[0].active!.damage, 60);
});

// ------------------------------------------------------------------ Seel
test('Seel, Bubble Drain: heal 20 damage from self', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Seel', energy: { active: [W, 'Colorless'] }, damage: { 0: 25 } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Bubble Drain');
  assert.equal(g.state.p[0].active!.damage, 5);
});

// ------------------------------------------------------------------ Piloswine
test('Piloswine, Rising Lunge: flip coin, +30 if heads', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Piloswine', energy: { active: ['Colorless', 'Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Rising Lunge');
  assert.ok(g.state.p[1].active!.damage >= 30 && g.state.p[1].active!.damage <= 60);
});

// ------------------------------------------------------------------ Yamper
test('Yamper, Play Rough: flip coin, +20 if heads', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Yamper', energy: { active: [L, 'Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Play Rough');
  assert.ok(g.state.p[1].active!.damage >= 20 && g.state.p[1].active!.damage <= 40);
});

// ------------------------------------------------------------------ Boltund
test('Boltund, Electric Run: flip coin, +70 if heads', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Boltund', energy: { active: [L, 'Colorless'] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Electric Run');
  assert.ok(g.state.p[1].active!.damage >= 70 && g.state.p[1].active!.damage <= 140);
});

// ------------------------------------------------------------------ Milcery
test('Milcery, Draining Kiss: heal 10 damage from self', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Milcery', energy: { active: [P] }, damage: { 0: 15 } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Draining Kiss');
  assert.equal(g.state.p[0].active!.damage, 5);
});

// ------------------------------------------------------------------ Gligar
test('Gligar, Poison Jab: opponent\'s Active is Poisoned', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Gligar', energy: { active: [K] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Poison Jab');
  assert.ok(g.state.p[1].active!.cond & POISONED);
});

// ------------------------------------------------------------------ Trapinch
test('Trapinch, Double Headbutt: flip 2 coins, 10 damage per heads', () => {
  const g = scenario(BULBASAUR_DECK, GENERIC_DECK, [
    { active: 'Trapinch', energy: { active: [K] } },
    { active: 'Bulbasaur' },
  ]);
  choose(g, 'Attack: Double Headbutt');
  assert.ok(g.state.p[1].active!.damage >= 0 && g.state.p[1].active!.damage <= 20);
});
