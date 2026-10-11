/**
 * Card tests, batch "std-c02": every card scripted in cards/scripts/std-c02.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { CardFrame, Decision } from '../types.js';
import { ASLEEP, BURNED, CONFUSED, PARALYZED, POISONED } from '../types.js';
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
/** Pick options of a multi-select by card/slot name (each name once, in order). */
function pick(g: Game, ns: string[]): void {
  const ls = labels(g);
  const used = new Set<number>();
  const idx = ns.map((n) => {
    const i = ls.findIndex((l, j) => !used.has(j) && l.includes(n));
    assert.ok(i >= 0, `no option "${n}" in: ${ls.join(' | ')}`);
    used.add(i);
    return i;
  });
  g.submit(idx);
}
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([1]);
}
function endTurn(g: Game): void {
  choose(g, 'End turn');
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function benchNames(g: Game, p: 0 | 1): string[] {
  return g.state.p[p].bench.map((b) => name(g, topCard(b)));
}
function stack(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return sl.cards.map((c) => name(g, c));
}
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]) {
  return fromIds('c02', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting, Retreat 3
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass, no Resistance -- the target for non-Fighting, non-Grass attackers
const SLO = 'me05-029'; // Slowpoke: 70 HP, Psychic, Headbutt for {C}{C} 20
const DUN = 'sv08.5-079'; // Dunsparce: 60 HP

const F = 'Fire Energy';
const P = 'Psychic Energy';
const W = 'Water Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const FI = 'Fighting Energy';
const L = 'Lightning Energy';
const G = 'Grass Energy';

type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Garganacl

test("Garganacl, Powerful a-Salt: +30 for each of your {F} Pokémon's attacks, and it stacks (Compendium #2215)", () => {
  const dk = deck('me01-084', 'me01-093', TYR);
  const hit = (sides: Sides): number => {
    const g = scenario(dk, dk, sides);
    choose(g, 'Attack: Hammer In');
    return g.state.p[1].active!.damage;
  };
  // "Attacks used by your {F} Pokémon do 30 more damage to your opponent's Active Pokémon" -- Garganacl itself is {F}.
  assert.equal(hit([{ active: 'Garganacl', energy: { active: [FI, FI, FI] } }, { active: 'Tyranitar ex' }]), 160);
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2215/): "Yes, it does." -- two Garganacl are +60.
  assert.equal(hit([{ active: 'Garganacl', bench: ['Garganacl'], energy: { active: [FI, FI, FI] } }, { active: 'Tyranitar ex' }]), 190);
  // A Benched Garganacl still adds to the Active {F} Pokémon.
  // Not for a Pokémon of another type: Steelix ({M}) with a Garganacl on the Bench does its printed 40.
  const g = scenario(dk, dk, [{ active: 'Steelix', bench: ['Garganacl'], energy: { active: [M, M] }, prizes: 5 }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Welcoming Tail');
  assert.equal(g.state.p[1].active!.damage, 40, 'a {M} attacker gets no bonus');
});

// ------------------------------------------------------------------ Mega Absol ex

test('Mega Absol ex, Terminal Period: Knocks Out the Defending Pokémon at exactly 6 damage counters, not at 5 or 7', () => {
  const dk = deck('me01-086', TYR, URSA);
  const run = (counters: number): Game => {
    const g = scenario(dk, dk, [{ active: 'Mega Absol ex', energy: { active: [D, D] } }, { active: 'Tyranitar ex', bench: ['Bloodmoon Ursaluna ex'], damage: { active: counters * 10 } }]);
    choose(g, 'Attack: Terminal Period');
    return g;
  };
  const ko = run(6);
  assert.ok(names(ko, ko.state.p[1].discard).includes('Tyranitar ex'), 'exactly 6 counters: Knocked Out');
  assert.equal(ko.state.p[0].prizes.length, 4, 'Tyranitar ex is worth 2 Prize cards');
  for (const n of [5, 7, 0]) {
    const g = run(n);
    assert.equal(g.state.p[1].active!.damage, n * 10, `${n} counters: nothing happens`);
    assert.equal(name(g, topCard(g.state.p[1].active!)), 'Tyranitar ex');
  }
});

test("Mega Absol ex, Claw of Darkness: 200, your opponent reveals their hand, you discard a card you find there", () => {
  const dk = deck('me01-086', TYR, 'me01-114', 'me01-131', 'me01-126');
  const g = scenario(dk, dk, [{ active: 'Mega Absol ex', energy: { active: [D, D, D] } }, { active: 'Tyranitar ex', hand: ["Boss's Orders", 'Ultra Ball', 'Repel'] }]);
  choose(g, 'Attack: Claw of Darkness');
  assert.equal(g.state.p[1].active!.damage, 200);
  assert.equal(g.decision?.player, 0, 'the attacker picks');
  const hand = g.state.p[1].hand.slice();
  assert.ok(hand.length >= 3);
  assert.deepEqual([...g.state.p[1].revealed].sort(), hand.slice().sort(), 'the whole hand is revealed');
  assert.deepEqual(labels(g).sort(), names(g, hand), 'every card in that hand can be chosen');
  const discardBefore = g.state.p[1].discard.length;
  choose(g, 'Ultra Ball');
  // (the attack ended the turn, so the opponent has since drawn a card)
  assert.ok(!names(g, g.state.p[1].hand).includes('Ultra Ball'));
  assert.equal(g.state.p[1].discard.length, discardBefore + 1);
  assert.ok(names(g, g.state.p[1].discard).includes('Ultra Ball'), "the card goes to its owner's discard pile");
  assert.equal(g.state.p[1].revealed.length, hand.length - 1, 'the discarded card is no longer a revealed hand card; the card drawn since was never revealed');
});

// ------------------------------------------------------------------ Grafaiai

test("Grafaiai, Miraculous Paint: 90; heads lets you choose the Special Condition, tails gives none", () => {
  const dk = deck('me01-092', URSA);
  const run = (heads: boolean, cond?: string): Game => {
    const g = scenario(dk, dk, [{ active: 'Grafaiai', energy: { active: [D, D] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    g.state.forcedCoins = [heads, false, false]; // later coins: Asleep / Burned stay put at Checkup
    choose(g, 'Attack: Miraculous Paint');
    if (cond) choose(g, cond);
    return g;
  };
  // The Special Condition is read after the opponent's Checkup-free moment: the attack ends the turn, so Poison and Burn have just done their counters.
  const cases: [string, number, number][] = [['Asleep', ASLEEP, 90], ['Confused', CONFUSED, 90], ['Paralyzed', PARALYZED, 90], ['Poisoned', POISONED, 100], ['Burned', BURNED, 110]];
  for (const [label, bit, dmg] of cases) {
    const g = run(true, label);
    assert.equal(g.state.p[1].active!.damage, dmg, label);
    assert.equal(g.state.p[1].active!.cond, bit, label);
  }
  const t = run(false);
  assert.equal(t.state.p[1].active!.damage, 90, 'tails: the damage is still done');
  assert.equal(t.state.p[1].active!.cond, 0);
  assert.equal(t.state.p[1].active!.cond, 0, 'tails: no condition');
});

// ------------------------------------------------------------------ Steelix

test('Steelix, Welcoming Tail: 40, or 240 with exactly 6 Prize cards remaining (not 5)', () => {
  const dk = deck('me01-093', URSA);
  const hit = (prizes: number): number => {
    const g = scenario(dk, dk, [{ active: 'Steelix', energy: { active: [M, M] }, prizes }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Welcoming Tail');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit(6), 240);
  assert.equal(hit(5), 40);
  assert.equal(hit(1), 40);
});

// ------------------------------------------------------------------ Dialga

test('Dialga, Chrono Burst: 80; you may shuffle all its Energy into your deck for 80 more', () => {
  const dk = deck('me01-095', URSA);
  const run = (answer: 'yes' | 'no'): Game => {
    const g = scenario(dk, dk, [{ active: 'Dialga', energy: { active: [M, M, FI] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Chrono Burst');
    if (answer === 'yes') yes(g);
    else no(g);
    return g;
  };
  const before = scenario(dk, dk, [{ active: 'Dialga', energy: { active: [M, M, FI] } }, { active: 'Bloodmoon Ursaluna ex' }]).state.p[0].deck.length;
  const y = run('yes');
  assert.equal(y.state.p[1].active!.damage, 160);
  assert.equal(y.state.p[0].active!.energy.length, 0, 'every Energy left');
  assert.equal(y.state.p[0].deck.length, before + 3, 'all 3 are in the deck');
  const n = run('no');
  assert.equal(n.state.p[1].active!.damage, 80);
  assert.deepEqual(energyNames(n, 0, 'active'), [FI, M, M].sort(), 'declined: the Energy stays');
});

// ------------------------------------------------------------------ Tinkatuff

/** The catalog has no Tinkatink frame, so the Basic Tinkatuff evolves from is made here. */
const TINKATINK: CardFrame = {
  cardId: 'test-tinkatink', name: 'Tinkatink', category: 'Pokemon', hp: 60, stage: 'Basic', types: ['Psychic'], retreat: 1,
  attacks: [], abilities: [], weaknesses: [{ type: 'Fire', value: '×2' }], resistances: [],
};
function tinkDeck(): DeckInput {
  const base = deck('me01-097', TYR);
  return { ...base, cards: [...base.cards, { frame: TINKATINK, count: 4 }] };
}

test("Tinkatuff, Haphazard Hammer: when it evolves a Pokémon from your hand you may flip; heads discards an Energy from the Defending Pokémon", () => {
  const dk = tinkDeck();
  const run = (heads: boolean, accept: boolean): Game => {
    const g = scenario(dk, dk, [
      { active: 'Tyranitar ex', bench: ['Tinkatink'], hand: ['Tinkatuff'] },
      { active: 'Tyranitar ex', energy: { active: [D, D] } },
    ]);
    g.state.forcedCoins = [heads];
    choose(g, 'Evolve Tinkatink');
    if (accept) {
      yes(g);
      if (heads) choose(g, 'Darkness Energy'); // the Energy to discard
    } else no(g);
    return g;
  };
  const h = run(true, true);
  assert.deepEqual(stack(h, 0, 0), ['Tinkatink', 'Tinkatuff']);
  assert.equal(h.state.p[1].active!.energy.length, 1, 'heads: one Energy discarded');
  assert.ok(names(h, h.state.p[1].discard).includes('Darkness Energy'));
  assert.equal(run(false, true).state.p[1].active!.energy.length, 2, 'tails: nothing');
  assert.equal(run(true, false).state.p[1].active!.energy.length, 2, 'declined: nothing');
});

// ------------------------------------------------------------------ Tinkaton

test("Tinkaton, Windup Swing: 240 less 60 for each Energy on the Defending Pokémon, never below 0", () => {
  const dk = deck('me01-098', URSA);
  const hit = (energy: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Tinkaton', energy: { active: [M] } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: energy } }]);
    choose(g, 'Attack: Windup Swing');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit([]), 240);
  assert.equal(hit([W]), 180);
  assert.equal(hit([W, W]), 120);
  assert.equal(hit([W, W, W, W]), 0);
  assert.equal(hit([W, W, W, W, W]), 0, 'no negative damage');
});

// ------------------------------------------------------------------ Gholdengo

test("Gholdengo, All-You-Can-Grab: flip until tails; search for up to that many heads' worth of cards", () => {
  const dk = deck('me01-099', TYR, 'me01-114', 'me01-131');
  const run = (coins: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Gholdengo', energy: { active: [M] } }, { active: 'Tyranitar ex' }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: All-You-Can-Grab');
    return g;
  };
  const three = run([true, true, true, false]);
  const handBefore = three.state.p[0].hand.length;
  assert.equal(three.decision?.kind, 'cards');
  assert.equal(three.decision?.max, 3, '3 heads: up to 3');
  assert.equal(three.decision?.min, 0);
  pick(three, ["Boss's Orders", 'Ultra Ball', 'Tyranitar ex']);
  assert.equal(three.state.p[0].hand.length, handBefore + 3);
  assert.ok(names(three, three.state.p[0].hand).includes('Ultra Ball'));
  const none = run([false]);
  assert.equal(none.state.p[0].hand.length, handBefore, '0 heads: nothing found');
  assert.equal(none.decision?.kind, 'main', 'no question when there is nothing to find');
  const one = run([true, false]);
  assert.equal(one.decision?.max, 1);
  pick(one, ['Ultra Ball']);
  assert.equal(one.state.p[0].hand.length, handBefore + 1);
});

// ------------------------------------------------------------------ Miltank

test('Miltank, Bellyful of Milk: both heads heal all damage from 1 of your Pokémon; otherwise nothing', () => {
  const dk = deck('me01-106', TYR, DUN);
  const run = (coins: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Miltank', bench: ['Dunsparce'], energy: { active: [W, W] }, damage: { active: 30, 0: 50 } }, { active: 'Tyranitar ex' }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Bellyful of Milk');
    return g;
  };
  const both = run([true, true]);
  choose(both, 'Dunsparce');
  assert.equal(both.state.p[0].bench[0]!.damage, 0, 'the chosen Pokémon is fully healed');
  assert.equal(both.state.p[0].active!.damage, 30, 'only that one');
  for (const coins of [[true, false], [false, true], [false, false]]) {
    const g = run(coins);
    assert.equal(g.state.p[0].bench[0]!.damage, 50, `${coins}: no healing`);
    assert.equal(g.state.p[0].active!.damage, 30);
  }
});

// ------------------------------------------------------------------ Bewear

test('Bewear, Hyper Lariat: 100, or 200 if both coins are heads', () => {
  const dk = deck('me01-112', URSA);
  const hit = (coins: boolean[]): number => {
    const g = scenario(dk, dk, [{ active: 'Bewear', energy: { active: [W, W, W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Hyper Lariat');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit([true, true]), 200);
  assert.equal(hit([true, false]), 100);
  assert.equal(hit([false, true]), 100);
  assert.equal(hit([false, false]), 100);
});

// ------------------------------------------------------------------ Lt. Surge's Bargain

test("Lt. Surge's Bargain: the opponent decides; yes means each player takes a Prize card, no means you draw 4", () => {
  const dk = deck('me01-120', TYR);
  const start = (a: number, b: number): Game => {
    const g = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ["Lt. Surge's Bargain"], prizes: a }, { active: 'Tyranitar ex', prizes: b }]);
    choose(g, "Play Lt. Surge's Bargain");
    assert.equal(g.decision?.player, 1, 'the opponent is asked');
    return g;
  };
  const y = start(6, 6);
  const h0 = y.state.p[0].hand.length;
  const h1 = y.state.p[1].hand.length;
  choose(y, 'Yes');
  assert.equal(y.state.p[0].prizes.length, 5);
  assert.equal(y.state.p[1].prizes.length, 5);
  assert.equal(y.state.p[0].hand.length, h0 + 1);
  assert.equal(y.state.p[1].hand.length, h1 + 1);
  assert.equal(y.state.p[0].prizesTaken, 1);
  const n = start(6, 6);
  const d0 = n.state.p[0].hand.length;
  const d1 = n.state.p[1].hand.length;
  choose(n, 'No');
  assert.equal(n.state.p[0].hand.length, d0 + 4, 'you draw 4');
  assert.equal(n.state.p[1].hand.length, d1, 'the opponent draws none');
  assert.equal(n.state.p[0].prizes.length, 6);
  assert.equal(n.state.p[1].prizes.length, 6);
});

test("Lt. Surge's Bargain: taking a last Prize card wins the game; both doing so at once is a draw", () => {
  const dk = deck('me01-120', TYR);
  const run = (a: number, b: number): Game => {
    const g = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ["Lt. Surge's Bargain"], prizes: a }, { active: 'Tyranitar ex', prizes: b }]);
    choose(g, "Play Lt. Surge's Bargain");
    choose(g, 'Yes');
    return g;
  };
  const mine = run(1, 2);
  assert.equal(mine.state.phase, 'over');
  assert.equal(mine.state.winner, 0, 'your last Prize card');
  const theirs = run(2, 1);
  assert.equal(theirs.state.phase, 'over');
  assert.equal(theirs.state.winner, 1);
  const both = run(1, 1);
  assert.equal(both.state.phase, 'over');
  assert.equal(both.state.winner, null);
  assert.equal(both.state.draw, true);
});

// ------------------------------------------------------------------ Pokémon Center Lady

test('Pokémon Center Lady: heals 60 from 1 of your Pokémon, which recovers from all Special Conditions; not playable with nothing to fix', () => {
  const dk = deck('me01-123', TYR, DUN);
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex', bench: ['Dunsparce'], hand: ['Pokémon Center Lady'], damage: { active: 100, 0: 40 }, cond: POISONED | BURNED | CONFUSED }, { active: 'Tyranitar ex' }]);
  choose(g, 'Play Pokémon Center Lady');
  choose(g, 'Tyranitar ex');
  assert.equal(g.state.p[0].active!.damage, 40, '100 - 60');
  assert.equal(g.state.p[0].active!.cond, 0, 'every condition is gone');
  assert.equal(g.state.p[0].bench[0]!.damage, 40, 'the other Pokémon is untouched');
  // Only a Special Condition: playable, and the condition is cured.
  const c = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Pokémon Center Lady'], cond: PARALYZED }, { active: 'Tyranitar ex' }]);
  choose(c, 'Play Pokémon Center Lady');
  assert.equal(c.state.p[0].active!.cond, 0);
  assert.equal(c.state.p[0].active!.damage, 0);
  // Only damage on a Benched Pokémon: playable; the heal can be put on any of them.
  const b = scenario(dk, dk, [{ active: 'Tyranitar ex', bench: ['Dunsparce'], hand: ['Pokémon Center Lady'], damage: { 0: 20 } }, { active: 'Tyranitar ex' }]);
  choose(b, 'Play Pokémon Center Lady');
  choose(b, 'Dunsparce');
  assert.equal(b.state.p[0].bench[0]!.damage, 0, 'healed no further than 0');
  // No damage and no condition: the card would do nothing, so it can't be played.
  const n = scenario(dk, dk, [{ active: 'Tyranitar ex', bench: ['Dunsparce'], hand: ['Pokémon Center Lady'] }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(n, 'Play Pokémon Center Lady'), 'no effect, no play (TPCi 2014-11-13)');
});

// ------------------------------------------------------------------ Repel

test("Repel: switch out your opponent's Active Pokémon; your opponent chooses the new Active", () => {
  const dk = deck('me01-126', TYR, DUN, SLO);
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Repel'] }, { active: 'Tyranitar ex', bench: ['Dunsparce', 'Slowpoke'] }]);
  choose(g, 'Play Repel');
  assert.equal(g.decision?.player, 1, 'the opponent chooses');
  choose(g, 'Slowpoke');
  assert.equal(name(g, topCard(g.state.p[1].active!)), 'Slowpoke');
  assert.deepEqual(benchNames(g, 1).sort(), ['Dunsparce', 'Tyranitar ex']);
  const n = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Repel'] }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(n, 'Play Repel'), 'no Benched Pokémon to switch to: not playable');
});

// ------------------------------------------------------------------ Strange Timepiece

test('Strange Timepiece: devolve an evolved {P} Pokémon, putting its Evolution cards into your hand; it cannot evolve this turn', () => {
  const dk = deck('me01-128', 'me01-054', 'me01-055', 'me01-056', 'me01-058', 'me01-059', 'me01-060', TYR);
  // Stage 1: Kadabra back to Abra.
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex', bench: ['Abra'], evolve: { 0: ['Kadabra'] }, hand: ['Strange Timepiece', 'Alakazam'], damage: { 0: 20 }, energy: { 0: [P] } }, { active: 'Tyranitar ex' }]);
  assert.ok(has(g, 'Evolve Kadabra') || !has(g, 'Evolve'), 'sanity');
  choose(g, 'Play Strange Timepiece');
  assert.deepEqual(stack(g, 0, 0), ['Abra']);
  assert.ok(names(g, g.state.p[0].hand).includes('Kadabra'), 'Kadabra is in hand');
  assert.equal(g.state.p[0].bench[0]!.damage, 20, 'damage and Energy stay');
  assert.equal(g.state.p[0].bench[0]!.energy.length, 1);
  assert.ok(!has(g, 'Evolve Abra'), "That Pokémon can't evolve this turn");
  // Stage 2: asked how many; 1 leaves the Stage 1.
  const s2 = scenario(dk, dk, [{ active: 'Ralts', evolve: { active: ['Kirlia', 'Mega Gardevoir ex'] }, hand: ['Strange Timepiece'], cond: POISONED }, { active: 'Tyranitar ex' }]);
  choose(s2, 'Play Strange Timepiece');
  choose(s2, '1 Evolution card');
  assert.deepEqual(stack(s2, 0, 'active'), ['Ralts', 'Kirlia']);
  assert.deepEqual(names(s2, s2.state.p[0].hand), ['Mega Gardevoir ex']);
  assert.equal(s2.state.p[0].active!.cond, 0, 'devolving clears Special Conditions');
  const s3 = scenario(dk, dk, [{ active: 'Ralts', evolve: { active: ['Kirlia', 'Mega Gardevoir ex'] }, hand: ['Strange Timepiece'] }, { active: 'Tyranitar ex' }]);
  choose(s3, 'Play Strange Timepiece');
  choose(s3, '2 Evolution cards');
  assert.deepEqual(stack(s3, 0, 'active'), ['Ralts']);
  assert.deepEqual(names(s3, s3.state.p[0].hand), ['Kirlia', 'Mega Gardevoir ex']);
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2328/): devolving is not putting a Pokémon onto the Bench (Risky Ruins).
  const rr = scenario(dk, dk, [{ active: 'Tyranitar ex', bench: ['Abra'], evolve: { 0: ['Kadabra'] }, hand: ['Strange Timepiece'] }, { active: 'Tyranitar ex' }]);
  choose(rr, 'Play Strange Timepiece');
  assert.equal(rr.state.p[0].bench[0]!.damage, 0, 'no Bench trigger');
  // Not a {P} Pokémon, a Basic, or nothing evolved: not playable.
  const none = scenario(dk, dk, [{ active: 'Tyranitar ex', bench: ['Abra'], hand: ['Strange Timepiece'] }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(none, 'Play Strange Timepiece'), 'no evolved {P} Pokémon');
  const other = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Strange Timepiece'] }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(other, 'Play Strange Timepiece'), 'an evolved {D} Pokémon is not a {P} Pokémon');
});

// ------------------------------------------------------------------ Wally's Compassion

test("Wally's Compassion: heal all damage from 1 of your Mega Evolution Pokémon ex; if you healed any, its Energy go to your hand (Compendium #2234)", () => {
  const dk = deck('me01-132', 'me02-004', 'me01-086', URSA);
  const g = scenario(dk, dk, [{ active: 'Mega Heracross ex', bench: ['Mega Absol ex', 'Bloodmoon Ursaluna ex'], hand: ["Wally's Compassion"], energy: { active: [G, G, P] }, damage: { active: 130, 0: 50, 1: 80 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, "Play Wally's Compassion");
  // Bloodmoon Ursaluna ex is not a Mega Evolution Pokémon: only the two Megas are offered.
  assert.ok(!labels(g).some((l) => l.includes('Bloodmoon')), 'a non-Mega ex is not offered');
  choose(g, 'Mega Heracross ex');
  assert.equal(g.state.p[0].active!.damage, 0);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.deepEqual(names(g, g.state.p[0].hand).filter((n) => n.includes('Energy')), ['Grass Energy', 'Grass Energy', 'Psychic Energy']);
  assert.equal(g.state.p[0].bench[0]!.damage, 50, 'the other Mega is untouched');
  // Ruling #2234: no Energy attached is fine.
  const e = scenario(dk, dk, [{ active: 'Mega Absol ex', hand: ["Wally's Compassion"], damage: { active: 90 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(e, "Play Wally's Compassion");
  assert.equal(e.state.p[0].active!.damage, 0);
  // With no damage to heal there is nothing healed, so the Energy stay.
  const u = scenario(dk, dk, [{ active: 'Mega Absol ex', hand: ["Wally's Compassion"], energy: { active: [D, D] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(u, "Play Wally's Compassion");
  assert.equal(u.state.p[0].active!.energy.length, 2, 'no damage healed: Energy stay');
  // No Mega Evolution Pokémon ex in play: not playable.
  const n = scenario(dk, dk, [{ active: 'Bloodmoon Ursaluna ex', hand: ["Wally's Compassion"], damage: { active: 50 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(n, "Play Wally's Compassion"));
});

test("Wally's Compassion: a Mega Evolution Pokémon ex that can't be healed loses no damage, so its Energy stay", () => {
  const dk = deck('me01-132', 'me02-004', 'me01-086', URSA);
  const g = scenario(dk, dk, [{ active: 'Mega Heracross ex', bench: ['Mega Absol ex'], hand: ["Wally's Compassion"], energy: { active: [G, G, P] }, damage: { active: 130, 0: 50 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  g.state.effects.push({ static: { k: 'noHeal' }, slot: g.state.p[0].active!.id, player: 0, until: g.state.turn + 1, fromAttack: false, src: 0 }); // Life-Locked (Yveltal), as a timed effect
  choose(g, "Play Wally's Compassion");
  choose(g, 'Mega Heracross ex');
  assert.equal(g.state.p[0].active!.damage, 130, 'nothing was healed');
  assert.equal(g.state.p[0].active!.energy.length, 3, 'so the Energy stay');
  assert.ok(!names(g, g.state.p[0].hand).some((n) => n.includes('Energy')), 'and none went to the hand');
});

// ------------------------------------------------------------------ Ludicolo

test('Ludicolo, Excited Heal: with a {G} Mega Evolution Pokémon ex in play (even a Basic one, #2241), heal 60 from 1 of your Pokémon', () => {
  const dk = deck('me02-007', 'me02-004', 'me01-086', URSA);
  const g = scenario(dk, dk, [{ active: 'Mega Heracross ex', bench: ['Ludicolo'], damage: { active: 100, 0: 20 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2241/): "Yes, you can." -- Mega Heracross ex is a Basic.
  assert.ok(has(g, 'Excited Heal'), 'Mega Heracross ex is enough');
  choose(g, 'Excited Heal');
  choose(g, 'Mega Heracross ex');
  assert.equal(g.state.p[0].active!.damage, 40, '100 - 60');
  assert.equal(g.state.p[0].bench[0]!.damage, 20);
  assert.ok(!has(g, 'Excited Heal'), 'once during your turn');
  // A non-{G} Mega ex does not count; nor does a {G} non-Mega.
  const d = scenario(dk, dk, [{ active: 'Mega Absol ex', bench: ['Ludicolo'], damage: { active: 100 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(d, 'Excited Heal'), 'Mega Absol ex is {D}');
  const n = scenario(dk, dk, [{ active: 'Ludicolo', damage: { active: 100 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(n, 'Excited Heal'), 'Ludicolo alone is not a Mega Evolution Pokémon ex');
});

// ------------------------------------------------------------------ Lokix

test('Lokix, Jumping Shot: 150, then Lokix and all attached cards are shuffled into your deck; the replacement is not Confused (Compendium #2248)', () => {
  const dk = deck('me02-010', URSA, DUN);
  const g = scenario(dk, dk, [{ active: 'Lokix', bench: ['Dunsparce'], energy: { active: [G, G, G] }, cond: CONFUSED }, { active: 'Bloodmoon Ursaluna ex' }]);
  const before = g.state.p[0].deck.length;
  g.state.forcedCoins = [true]; // the Confusion flip: heads, the attack goes ahead
  choose(g, 'Attack: Jumping Shot');
  assert.equal(g.state.p[1].active!.damage, 150);
  if (g.decision?.kind === 'promote') choose(g, 'Dunsparce');
  assert.equal(g.state.p[0].deck.length, before + 4, 'Lokix and 3 Energy');
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Dunsparce');
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2248/): "No, it will not."
  assert.equal(g.state.p[0].active!.cond, 0, 'the new Active Pokémon is not Confused');
  assert.ok(![...g.state.p[0].discard, ...g.state.p[0].hand].some((c) => name(g, c) === 'Lokix'), 'Lokix went to the deck, not elsewhere');
  endTurn(g);
});
