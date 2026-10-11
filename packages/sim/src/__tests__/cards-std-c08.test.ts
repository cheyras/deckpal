/**
 * Card tests, batch "std-c08": every card scripted in cards/scripts/std-c08.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { maxHp } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { CONFUSED, PARALYZED, POISONED } from '../types.js';
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
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function countOf(g: Game, iids: number[], n: string): number {
  return iids.filter((c) => name(g, c) === n).length;
}
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}
function dmg(g: Game, p: 0 | 1): number {
  return g.state.p[p].active!.damage;
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]) {
  return fromIds('c08', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}

const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass, no Resistance -- the default target
const DRA = 'sv06-128'; // Dreepy: 70 HP; Bite {F}{P} 40
const DRAGAPULT = 'sv06-130'; // Dragapult ex: a Tera Pokémon, 320 HP, no Weakness
const GENGAR = 'sv05-104'; // Gengar ex: 310 HP, weak Fighting
const ABSOL = 'me01-086'; // Mega Absol ex: 280 HP, weak Grass

const F = 'Fire Energy';
const P = 'Psychic Energy';
const W = 'Water Energy';
const D = 'Darkness Energy';
const FI = 'Fighting Energy';
const L = 'Lightning Energy';
const M = 'Metal Energy';
const TELE = 'Telepathic Psychic Energy';

// ------------------------------------------------------------------ Luxray

test('Luxray, Incessant Onslaught: 70 damage for each Prize card you have taken', () => {
  const dk = deck('me03-028', TYR);
  const hit = (prizes: number): number => {
    const g = scenario(dk, dk, [{ active: 'Luxray', energy: { active: [L, L] }, prizes }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Incessant Onslaught');
    return dmg(g, 1);
  };
  assert.equal(hit(6), 0, 'no Prize taken: 0');
  assert.equal(hit(5), 70);
  assert.equal(hit(3), 210);
});

test('Luxray, Strong Volt: 200, then discard 2 Energy from itself', () => {
  const dk = deck('me03-028', TYR);
  const g = scenario(dk, dk, [{ active: 'Luxray', energy: { active: [L, L, L, F] } }, { active: 'Tyranitar ex' }]);
  const before = g.state.p[0].discard.length;
  choose(g, 'Attack: Strong Volt');
  assert.equal(g.decision?.kind, 'cards', 'the attacker chooses the 2 Energy');
  pick(g, [F, L]);
  assert.equal(dmg(g, 1), 200);
  assert.deepEqual(energyNames(g, 0, 'active'), [L, L]);
  assert.equal(g.state.p[0].discard.length, before + 2);
});

// ------------------------------------------------------------------ Dedenne

test("Dedenne, Tail Generator: up to as many Basic {L} Energy from the discard pile as Energy on all of the opponent's Pokémon, onto your {L} Pokémon in any way", () => {
  const dk = deck('me03-029', 'me03-026', 'me03-030', TYR);
  const mk = (oppEnergy: { active: string[]; bench: string[] }): Game =>
    scenario(dk, dk, [
      { active: 'Dedenne', bench: ['Shinx', 'Clefairy'], energy: { active: [L] }, discard: [L, L, L, W] },
      { active: 'Tyranitar ex', bench: ['Tyranitar ex'], energy: { active: oppEnergy.active, 0: oppEnergy.bench } },
    ]);
  // 2 + 1 = 3 Energy on the opponent's Pokémon: up to 3 of the 3 Basic {L} Energy in the discard pile (not the Water).
  const g = mk({ active: [D, D], bench: [W] });
  choose(g, 'Attack: Tail Generator');
  assert.equal(g.decision?.kind, 'cards');
  assert.deepEqual(names(g, g.decision!.values as number[]), [L, L, L], 'only Basic {L} Energy can be chosen');
  assert.equal(g.decision?.min, 0);
  assert.equal(g.decision?.max, 3);
  pick(g, [L, L, L]);
  // each card goes to one of the {L} Pokémon (Dedenne, Shinx), never the Clefairy
  const targets = [g.state.p[0].active!.id, g.state.p[0].bench[0]!.id];
  assert.equal(g.decision?.kind, 'slots');
  assert.deepEqual([...(g.decision!.values as number[])].sort(), targets.slice().sort());
  g.submit([labels(g).findIndex((l) => l.includes('Shinx'))]);
  g.submit([labels(g).findIndex((l) => l.includes('Shinx'))]);
  g.submit([labels(g).findIndex((l) => l.includes('Dedenne'))]);
  assert.deepEqual(energyNames(g, 0, 'active'), [L, L]);
  assert.deepEqual(energyNames(g, 0, 0), [L, L]);
  assert.deepEqual(energyNames(g, 0, 1), []);
  assert.deepEqual(names(g, g.state.p[0].discard).filter((n) => n.includes('Energy')), [W]);

  // The amount is the opponent's Energy: 2 attached means at most 2 chosen, and none is allowed.
  const h = mk({ active: [D], bench: [W] });
  choose(h, 'Attack: Tail Generator');
  assert.equal(h.decision?.max, 2);
  h.submit([]);
  assert.deepEqual(energyNames(h, 0, 'active'), [L], 'chose none: nothing attached');
  // With no Energy on the opponent's Pokémon nothing can be chosen.
  const z = mk({ active: [], bench: [] });
  choose(z, 'Attack: Tail Generator');
  assert.deepEqual(energyNames(z, 0, 'active'), [L]);
});

test('Dedenne, Thunder Shock: 30, and heads Paralyzes the Defending Pokémon', () => {
  const dk = deck('me03-029', TYR);
  const run = (heads: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Dedenne', energy: { active: [L, L] } }, { active: 'Tyranitar ex' }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Thunder Shock');
    return g;
  };
  const h = run(true);
  assert.equal(dmg(h, 1), 30);
  assert.equal(h.state.p[1].active!.cond, PARALYZED);
  const t = run(false);
  assert.equal(dmg(t, 1), 30);
  assert.equal(t.state.p[1].active!.cond, 0);
});

// ------------------------------------------------------------------ Mega Clefable ex

test('Mega Clefable ex, Shooting Moons: 120, and 40 more for each Energy card (up to 4) you discard from your hand', () => {
  const dk = deck('me03-031', TYR);
  const run = (discard: string[], hand: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Mega Clefable ex', energy: { active: [P, P] }, hand }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Shooting Moons');
    pick(g, discard);
    return g;
  };
  const hand = [F, W, D, L, M, 'Tyranitar ex'];
  const probe = scenario(dk, dk, [{ active: 'Mega Clefable ex', energy: { active: [P, P] }, hand }, { active: 'Tyranitar ex' }]);
  choose(probe, 'Attack: Shooting Moons');
  assert.equal(probe.decision?.max, 4, 'up to 4');
  assert.equal(probe.decision?.min, 0, 'or none');
  assert.ok(!labels(probe).some((l) => l.includes('Tyranitar')), 'only Energy cards can be discarded');
  assert.equal(run([], hand).state.p[1].active!.damage, 120);
  const two = run([F, W], hand);
  assert.equal(dmg(two, 1), 200);
  assert.ok(names(two, two.state.p[0].discard).includes(F) && names(two, two.state.p[0].discard).includes(W));
  assert.equal(dmg(run([F, W, D, L], hand), 1), 280, '4 cards: 120 + 160');
});

test("Mega Clefable ex, Luminous Wing: the effects of an opponent's Pokémon's Abilities do nothing to it (rulings 2309, 2369)", () => {
  const dk = deck('sv06.5-019', 'me05-033', 'sv08.5-035', 'me03-031', TYR);
  const mk = (target: string): Game =>
    scenario(dk, dk, [
      { active: 'Shuppet', bench: ['Duskull'], evolve: { 0: ['Dusclops'] } },
      { active: target, bench: ['Tyranitar ex'] },
    ]);
  // Dusclops, Cursed Blast puts 5 damage counters on an opposing Pokémon: not on Mega Clefable ex.
  const g = mk('Mega Clefable ex');
  choose(g, 'Cursed Blast');
  if (g.decision?.kind === 'slots') choose(g, 'Mega Clefable ex');
  assert.equal(dmg(g, 1), 0, 'Luminous Wing: the Ability put no counters on it');
  // The same Ability does work on a Pokémon without it.
  const h = mk('Tyranitar ex');
  choose(h, 'Cursed Blast');
  if (h.decision?.kind === 'slots') choose(h, 'Tyranitar ex');
  assert.equal(dmg(h, 1), 50);
});

// ------------------------------------------------------------------ Mawile

test('Mawile, Double Eater: 60 damage for each Energy card (up to 2) you discard from your hand; none is allowed (ruling 2313)', () => {
  const dk = deck('me03-032', TYR);
  const run = (discard: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Mawile', energy: { active: [P, P] }, hand: [F, W, D, 'Tyranitar ex'] }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Double Eater');
    assert.equal(g.decision?.max, 2, 'up to 2');
    assert.equal(g.decision?.min, 0);
    assert.ok(!labels(g).some((l) => l.includes('Tyranitar')), 'only Energy cards');
    g.submit(discard.length ? discard.map((n) => labels(g).findIndex((l) => l.includes(n))) : []);
    return g;
  };
  const two = run([F, W]);
  assert.equal(dmg(two, 1), 120);
  assert.equal(countOf(two, two.state.p[0].discard, F), 1);
  assert.equal(countOf(two, two.state.p[0].discard, W), 1);
  assert.equal(dmg(run([F]), 1), 60);
  // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2313/): you can attack and do zero damage, still counting as an attack.
  const none = run([]);
  assert.equal(dmg(none, 1), 0);
  assert.equal(none.state.current, 1, 'it was an attack: the turn is over');
});

// ------------------------------------------------------------------ Aromatisse

test('Aromatisse, Scent Collection: search for 1 to 2 Basic {P} Energy, reveal them, put them in your hand; not usable with none in the deck', () => {
  const dk = deck('me03-036', TYR);
  const g = scenario(dk, dk, [{ active: 'Aromatisse' }, { active: 'Tyranitar ex' }]);
  const handBefore = g.state.p[0].hand.length;
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Use Scent Collection');
  assert.equal(g.decision?.min, 1, 'an Ability\'s "up to 2" is 1 to 2 (TPCi 2026-02-19)');
  assert.equal(g.decision?.max, 2);
  assert.ok(names(g, g.decision!.values as number[]).every((n) => n === P), 'only Basic {P} Energy');
  g.submit([0, 1]);
  assert.equal(g.state.p[0].hand.length, handBefore + 2);
  assert.equal(countOf(g, g.state.p[0].hand, P), 2);
  assert.equal(g.state.p[0].deck.length, deckBefore - 2);
  assert.ok(!has(g, 'Use Scent Collection'), 'once during your turn');
  // no Basic {P} Energy left in the deck: the Ability would do nothing
  const e = scenario(dk, dk, [{ active: 'Aromatisse', emptyDeck: true }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(e, 'Scent Collection'));
});

test('Aromatisse, Draining Kiss: 50, and heals 30 from itself', () => {
  const dk = deck('me03-036', TYR);
  const g = scenario(dk, dk, [{ active: 'Aromatisse', energy: { active: [P, P] }, damage: { active: 80 } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Draining Kiss');
  assert.equal(dmg(g, 1), 50);
  assert.equal(dmg(g, 0), 50);
});

// ------------------------------------------------------------------ Hippopotas

test("Hippopotas, Sand Attack: 10, then the Defending Pokémon's attack happens only on heads, and the flip comes before Confusion (ruling 2317)", () => {
  const dk = deck('me03-039', DRA);
  const mk = (coins: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Hippopotas', energy: { active: [FI] } }, { active: 'Dreepy', energy: { active: [P] } }]);
    choose(g, 'Attack: Sand Attack');
    assert.equal(dmg(g, 1), 10);
    g.state.forcedCoins = coins;
    return g;
  };
  const heads = mk([true]);
  choose(heads, 'Attack: Petty Grudge');
  assert.equal(dmg(heads, 0), 10, 'heads: it attacks');
  const tails = mk([false]);
  choose(tails, 'Attack: Petty Grudge');
  assert.equal(dmg(tails, 0), 0, "tails: that attack doesn't happen");
  // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2317/): Sand Attack's coin comes first, then the Confusion coin. A Confused attacker: the first coin is Sand Attack's, the second Confusion's.
  const conf = (coins: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Hippopotas', energy: { active: [FI] } }, { active: 'Dreepy', energy: { active: [P] }, cond: CONFUSED }]);
    choose(g, 'Attack: Sand Attack');
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Petty Grudge');
    return g;
  };
  const sandTails = conf([false, false]);
  assert.equal(sandTails.state.forcedCoins.length, 1, "tails on Sand Attack's flip: the attack never happens, so Confusion is never flipped");
  assert.equal(dmg(sandTails, 0), 0);
  const confTails = conf([true, false]);
  assert.equal(confTails.state.forcedCoins.length, 0, "heads on Sand Attack's flip, then Confusion's flip");
  assert.equal(dmg(confTails, 1), 40, 'tails on Confusion: the attacker hurts itself for 3 damage counters, on top of the 10 from Sand Attack');
  const bothHeads = conf([true, true]);
  assert.equal(dmg(bothHeads, 0), 10);
  // It lasts only the opponent's next turn.
  choose(heads, 'End turn');
  assert.equal(heads.state.effects.some((e) => e.static.k === 'attackCoinFlip'), false);
});

// ------------------------------------------------------------------ Barbaracle

test('Barbaracle, Stone Arms: attach a Basic {F} Energy card from your hand to 1 of your {F} Pokémon (and your own attachment is still free)', () => {
  const dk = deck('me03-043', 'me03-042', 'me03-026', TYR);
  const g = scenario(dk, dk, [{ active: 'Barbaracle', bench: ['Binacle', 'Shinx'], hand: [FI, W] }, { active: 'Tyranitar ex' }]);
  choose(g, 'Use Stone Arms');
  // the only Basic {F} Energy card in hand is attached without a question; the Water Energy is not a candidate
  assert.equal(g.decision?.kind, 'slots');
  assert.equal(labels(g).length, 2, 'only the two {F} Pokémon');
  assert.ok(!labels(g).some((l) => l.includes('Shinx')), 'not the {L} Pokémon');
  choose(g, 'Binacle');
  assert.deepEqual(energyNames(g, 0, 0), [FI]);
  assert.ok(!names(g, g.state.p[0].hand).includes(FI));
  assert.ok(!has(g, 'Use Stone Arms'), 'once during your turn');
  assert.ok(has(g, 'Attach'), 'the Ability is not the turn\'s Energy attachment');
  // no Basic {F} Energy in hand: nothing to use it with
  const e = scenario(dk, dk, [{ active: 'Barbaracle', bench: ['Binacle'], hand: [W] }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(e, 'Stone Arms'));
});

// ------------------------------------------------------------------ Tyrantrum

test('Tyrantrum, Tyrannically Gutsy: +150 HP while it has any Special Energy attached', () => {
  const dk = deck('me03-045', 'me03-088', TYR);
  const hp = (energy: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Tyrantrum', energy: { active: energy } }, { active: 'Tyranitar ex' }]);
    return maxHp(g.envForInternals, g.state, g.state.p[0].active!);
  };
  assert.equal(hp([]), 180);
  assert.equal(hp([FI, FI]), 180, 'Basic Energy: no bonus');
  assert.equal(hp([FI, TELE]), 330);
});

test("Tyrantrum, Wreak Havoc: 160; flip until tails, and for each heads discard the top card of your opponent's deck", () => {
  const dk = deck('me03-045', TYR);
  const run = (coins: boolean[]): { milled: number; g: Game } => {
    const g = scenario(dk, dk, [{ active: 'Tyrantrum', energy: { active: [FI, FI] } }, { active: 'Tyranitar ex' }]);
    const before = g.state.p[1].deck.slice();
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Wreak Havoc');
    assert.equal(dmg(g, 1), 160);
    return { milled: before.length - g.state.p[1].deck.length, g };
  };
  const [a, b, c] = [run([false]), run([true, false]), run([true, true, true, false])];
  // (the opponent draws a card for their turn, so the deck is one lower than the milled count)
  assert.equal(a.milled, 1 + 0);
  assert.equal(b.milled, 1 + 1);
  assert.equal(c.milled, 1 + 3);
  const top = scenario(dk, dk, [{ active: 'Tyrantrum', energy: { active: [FI, FI] } }, { active: 'Tyranitar ex', deckTop: ['Fire Energy', 'Water Energy'] }]);
  top.state.forcedCoins = [true, true, false];
  choose(top, 'Attack: Wreak Havoc');
  const disc = names(top, top.state.p[1].discard);
  assert.ok(disc.includes('Fire Energy') && disc.includes('Water Energy'), 'the TOP cards of the deck are the ones discarded');
});

// ------------------------------------------------------------------ Hawlucha

test("Hawlucha, Vengeful Kick: 30, or 90 if your Benched Pokémon have any damage counters", () => {
  const dk = deck('me03-046', 'me03-026', TYR);
  const hit = (side: Partial<SideLayout>): number => {
    const g = scenario(dk, dk, [{ active: 'Hawlucha', energy: { active: [FI] }, ...side }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Vengeful Kick');
    return dmg(g, 1);
  };
  assert.equal(hit({ bench: ['Shinx'] }), 30);
  assert.equal(hit({ bench: ['Shinx'], damage: { 0: 10 } }), 90);
  assert.equal(hit({}), 30, 'no Bench');
  assert.equal(hit({ bench: ['Shinx'], damage: { active: 20 } }), 30, 'damage on the Active Pokémon does not count');
});

// ------------------------------------------------------------------ Mega Zygarde ex

test("Mega Zygarde ex, Gaia Wave: 200, then during the opponent's next turn it takes 30 less damage from attacks (after Weakness), and only that turn", () => {
  const dk = deck('me03-047', DRAGAPULT, TYR);
  const mk = (): Game =>
    scenario(dk, dk, [{ active: 'Mega Zygarde ex', energy: { active: [FI, FI, FI] } }, { active: 'Dragapult ex', energy: { active: [P] } }]);
  // control: with no Gaia Wave in effect, Jet Headbutt does its 70
  const c = scenario(dk, dk, [{ active: 'Mega Zygarde ex' }, { active: 'Dragapult ex', energy: { active: [P] } }], { current: 1 });
  choose(c, 'Attack: Jet Headbutt');
  assert.equal(dmg(c, 0), 70);
  const g = mk();
  choose(g, 'Attack: Gaia Wave');
  assert.equal(dmg(g, 1), 200);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 40, '70 less 30');
  assert.equal(g.state.current, 0);
  assert.equal(g.state.effects.some((e) => e.static.k === 'damageIn'), false, 'the effect ended with the opponent turn');
});

test("Mega Zygarde ex, Nullifying Zero: a coin for every one of the opponent's Pokémon; heads is 150 to it, no Weakness on the Bench; Tera Pokémon are still flipped for (ruling 2316)", () => {
  const dk = deck('me03-047', TYR, GENGAR, DRAGAPULT, ABSOL);
  const run = (coins: boolean[], bench: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Mega Zygarde ex', energy: { active: [FI, FI, FI, FI, FI] } }, { active: 'Tyranitar ex', bench }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Nullifying Zero');
    return g;
  };
  // Active, then the Bench in order: heads, heads (Gengar ex, weak to Fighting), heads (Dragapult ex, Tera), tails.
  const g = run([true, true, true, false], ['Gengar ex', 'Dragapult ex', 'Mega Absol ex']);
  assert.equal(g.state.forcedCoins.length, 0, 'four Pokémon, four coins -- the Tera Pokémon too');
  assert.equal(dmg(g, 1), 150, 'the Active Pokémon (no Weakness to Fighting)');
  const b = g.state.p[1].bench;
  assert.equal(b[0]!.damage, 150, 'Gengar ex is weak to Fighting, but not on the Bench: 150, not 300');
  assert.equal(b[1]!.damage, 0, "a Tera Pokémon can't be damaged on the Bench, though its coin was flipped");
  assert.equal(b[2]!.damage, 0, 'tails: nothing');
  // Tails for the Active Pokémon and heads for the Bench.
  const h = run([false, false, true], ['Gengar ex', 'Mega Absol ex']);
  assert.equal(dmg(h, 1), 0);
  assert.equal(h.state.p[1].bench[0]!.damage, 0);
  assert.equal(h.state.p[1].bench[1]!.damage, 150);
  // With no Bench there is one coin.
  const only = run([true], []);
  assert.equal(only.state.forcedCoins.length, 0);
  assert.equal(dmg(only, 1), 150);
});

// ------------------------------------------------------------------ Haunter

test("Haunter, Haunt: 3 damage counters on the opponent's Active Pokémon, with no Weakness", () => {
  const dk = deck('me03-049', 'sv06.5-019', TYR);
  const g = scenario(dk, dk, [{ active: 'Haunter', energy: { active: [D] } }, { active: 'Dusclops' }]);
  choose(g, 'Attack: Haunt');
  assert.equal(dmg(g, 1), 30, 'Dusclops is weak to Darkness; counters are not damage, so no doubling');
});

// ------------------------------------------------------------------ Drapion

test('Drapion, Hazardous Tail: 100, 70 damage to itself, and the Defending Pokémon is Paralyzed and Poisoned', () => {
  const dk = deck('me03-052', TYR);
  const g = scenario(dk, dk, [{ active: 'Drapion', energy: { active: [D, D, D] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Hazardous Tail');
  assert.equal(dmg(g, 1), 110, '100 and 10 for Poison at Checkup');
  assert.equal(g.state.p[1].active!.cond, PARALYZED | POISONED);
  assert.equal(dmg(g, 0), 70);
  // Wrack Down is vanilla (no entry needed): nothing to check.
});

// ------------------------------------------------------------------ Yveltal ex

test("Yveltal ex, Soul Destroyer: Knock Out each of the opponent's Pokémon with 50 HP or less remaining (Active, Bench, Tera too)", () => {
  const dk = deck('me03-053', TYR, 'me03-029', DRAGAPULT);
  const g = scenario(dk, dk, [
    { active: 'Yveltal ex', energy: { active: [D, D, D] } },
    { active: 'Tyranitar ex', damage: { active: 290 }, bench: ['Dedenne', 'Dedenne', 'Dragapult ex', 'Dragapult ex'] },
  ]);
  const b = g.state.p[1].bench;
  b[0]!.damage = 20; // 70 HP: 50 remaining -> Knocked Out
  b[1]!.damage = 10; // 60 remaining -> safe
  b[2]!.damage = 270; // 320 HP, Tera: 50 remaining -> Knocked Out even on the Bench
  b[3]!.damage = 260; // 60 remaining -> safe
  choose(g, 'Attack: Soul Destroyer');
  assert.equal(g.state.p[0].prizes.length, 6 - 5, 'Tyranitar ex 2 + Dedenne 1 + Dragapult ex 2');
  const left = g.state.p[1].bench.map((s) => `${name(g, topCard(s))}:${s.damage}`).concat(g.state.p[1].active ? [`active:${name(g, topCard(g.state.p[1].active))}:${g.state.p[1].active.damage}`] : []);
  assert.equal(g.state.p[1].bench.length + (g.state.p[1].active ? 1 : 0), 2, `survivors: ${left.join(', ')}`);
  assert.deepEqual(names(g, g.state.p[1].discard.filter((c) => def(g.ctx, c).kind === 'pokemon')), ['Dedenne', 'Dragapult ex', 'Tyranitar ex']);
});

test("Yveltal ex, Soul Destroyer: a Pokémon with 51 HP remaining survives; Dark Strike: 210, then it can't use Dark Strike during your next turn", () => {
  const dk = deck('me03-053', TYR, 'me03-029');
  const g = scenario(dk, dk, [{ active: 'Yveltal ex', energy: { active: [D, D, D] } }, { active: 'Tyranitar ex', damage: { active: 10 }, bench: ['Dedenne'] }]);
  g.state.p[1].bench[0]!.damage = 19; // 51 remaining
  choose(g, 'Attack: Soul Destroyer');
  assert.equal(dmg(g, 1), 10);
  assert.equal(g.state.p[1].bench[0]!.damage, 19);
  assert.equal(g.state.p[0].prizes.length, 6);

  const h = scenario(dk, dk, [{ active: 'Yveltal ex', energy: { active: [D, D, D] } }, { active: 'Tyranitar ex' }]);
  choose(h, 'Attack: Dark Strike');
  assert.equal(dmg(h, 1), 210);
  choose(h, 'End turn'); // the opponent's turn
  assert.equal(h.state.current, 0, 'back to the attacker');
  assert.ok(!has(h, 'Attack: Dark Strike'), "can't use Dark Strike during your next turn");
  assert.ok(has(h, 'Attack: Soul Destroyer'), 'its other attack is free');
});

// ------------------------------------------------------------------ Chien-Pao

test('Chien-Pao, Strafe: 20, and you may switch it with a Benched Pokémon', () => {
  const dk = deck('me03-054', 'me03-026', TYR);
  const mk = (bench: string[]): Game => scenario(dk, dk, [{ active: 'Chien-Pao', bench, energy: { active: [D] } }, { active: 'Tyranitar ex' }]);
  const y = mk(['Shinx']);
  choose(y, 'Attack: Strafe');
  assert.equal(dmg(y, 1), 20);
  yes(y);
  assert.equal(name(y, topCard(y.state.p[0].active!)), 'Shinx');
  assert.deepEqual(y.state.p[0].bench.map((s) => name(y, topCard(s))), ['Chien-Pao']);
  const n = mk(['Shinx']);
  choose(n, 'Attack: Strafe');
  no(n);
  assert.equal(name(n, topCard(n.state.p[0].active!)), 'Chien-Pao');
  // no Benched Pokémon: no question
  const e = mk([]);
  choose(e, 'Attack: Strafe');
  assert.equal(dmg(e, 1), 20);
  assert.equal(e.state.current, 1);
});

test("Chien-Pao, Rising Blade: 80, or 160 if the opponent's Active Pokémon is a Pokémon ex", () => {
  const dk = deck('me03-054', TYR, 'me03-058');
  const hit = (foe: string): number => {
    const g = scenario(dk, dk, [{ active: 'Chien-Pao', energy: { active: [D, D, D] } }, { active: foe }]);
    choose(g, 'Attack: Rising Blade');
    return dmg(g, 1);
  };
  assert.equal(hit('Tyranitar ex'), 160);
  assert.equal(hit('Aegislash'), 80);
});

// ------------------------------------------------------------------ Doublade

test('Doublade, Weaponized Swords: reveal any number of Honedge, Doublade and Aegislash from your hand; 60 for each (ruling 2320: exact names)', () => {
  const dk = deck('me03-057', 'me03-058', TYR, ABSOL);
  const mk = (): Game =>
    scenario(dk, dk, [{ active: 'Doublade', energy: { active: [M, M] }, hand: ['Doublade', 'Aegislash', 'Aegislash', 'Tyranitar ex', 'Mega Absol ex'] }, { active: 'Tyranitar ex' }]);
  const g = mk();
  choose(g, 'Attack: Weaponized Swords');
  // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2320/): only cards with exact name matches can be revealed.
  assert.deepEqual(names(g, g.decision!.values as number[]), ['Aegislash', 'Aegislash', 'Doublade']);
  assert.equal(g.decision?.min, 0, 'any number, including none');
  g.submit([0, 1, 2]);
  assert.equal(dmg(g, 1), 180);
  const two = mk();
  choose(two, 'Attack: Weaponized Swords');
  pick(two, ['Doublade', 'Aegislash']);
  assert.equal(dmg(two, 1), 120);
  const none = mk();
  choose(none, 'Attack: Weaponized Swords');
  none.submit([]);
  assert.equal(dmg(none, 1), 0);
  assert.equal(countOf(none, none.state.p[0].hand, 'Aegislash'), 2, 'revealed cards stay in hand');
});

// ------------------------------------------------------------------ Raticate

test("Raticate, Scrape Off: before damage, discard all Pokémon Tools from the opponent's Active Pokémon; 20", () => {
  const dk = deck('me03-061', TYR, 'sv10.5b-079');
  const g = scenario(dk, dk, [{ active: 'Raticate', energy: { active: [M] } }, { active: 'Tyranitar ex', tools: { active: ['Air Balloon'] } }]);
  choose(g, 'Attack: Scrape Off');
  assert.equal(g.state.p[1].active!.tools.length, 0);
  assert.ok(names(g, g.state.p[1].discard).includes('Air Balloon'), "the Tool goes to its owner's discard pile");
  assert.equal(dmg(g, 1), 20);
});

test('Raticate, Retaliatory Incisors: 40 for each damage counter on all of your Benched Rattata', () => {
  const dk = deck('me03-061', 'me03-060', 'me03-026', TYR);
  const g = scenario(dk, dk, [
    { active: 'Raticate', energy: { active: [M] }, bench: ['Rattata', 'Rattata', 'Shinx'], damage: { 0: 20, 1: 30, 2: 40, active: 50 } },
    { active: 'Tyranitar ex' },
  ]);
  choose(g, 'Attack: Retaliatory Incisors');
  assert.equal(dmg(g, 1), 200, '2 + 3 counters on the Benched Rattata; the Shinx and the Active Raticate do not count');
  const z = scenario(dk, dk, [{ active: 'Raticate', energy: { active: [M] }, bench: ['Rattata'] }, { active: 'Tyranitar ex' }]);
  choose(z, 'Attack: Retaliatory Incisors');
  assert.equal(dmg(z, 1), 0);
});

// ------------------------------------------------------------------ Fletchling

test('Fletchling, Chirp: search for up to 2 Pokémon with {F} Resistance, reveal them, put them in your hand, shuffle', () => {
  const dk = deck('me03-066', 'me01-055', 'sv06-095', 'me05-029', 'me03-026', TYR);
  const g = scenario(dk, dk, [{ active: 'Fletchling', energy: { active: [W] } }, { active: 'Tyranitar ex' }]);
  const handBefore = g.state.p[0].hand.length;
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Chirp');
  assert.equal(g.decision?.min, 0, 'on an attack, up to 2 includes none');
  assert.equal(g.decision?.max, 2);
  const offered = new Set(names(g, g.decision!.values as number[]));
  assert.deepEqual([...offered].sort(), ['Fletchling', 'Kadabra', 'Munkidori', 'Slowpoke'], 'Fletchling itself and the {P} Pokémon with {F} Resistance');
  assert.ok(!offered.has('Shinx') && !offered.has('Tyranitar ex'), 'a Pokémon with no {F} Resistance is not offered');
  pick(g, ['Kadabra', 'Munkidori']);
  // the attack ended the turn: the opponent is up, our hand is as we left it
  assert.equal(g.state.p[0].hand.length, handBefore + 2);
  assert.ok(names(g, g.state.p[0].hand).includes('Kadabra') && names(g, g.state.p[0].hand).includes('Munkidori'));
  assert.equal(g.state.p[0].deck.length, deckBefore - 2);
  // choosing none is allowed
  const h = scenario(dk, dk, [{ active: 'Fletchling', energy: { active: [W] } }, { active: 'Tyranitar ex' }]);
  choose(h, 'Attack: Chirp');
  h.submit([]);
  assert.equal(h.state.p[0].hand.length, handBefore);
  // no such Pokémon in the deck: nothing to find
  const e = scenario(deck('me03-066', TYR), deck('me03-066', TYR), [{ active: 'Fletchling', energy: { active: [W] }, emptyDeck: true }, { active: 'Tyranitar ex' }]);
  choose(e, 'Attack: Chirp');
  assert.equal(e.state.p[0].hand.length, handBefore);
});

// ------------------------------------------------------------------ Furfrou

test("Furfrou, Hand Trim: discard random cards from the opponent's hand until they have 5", () => {
  const dk = deck('me03-067', TYR);
  const run = (extra: number): { before: number; discarded: number } => {
    const hand = Array.from({ length: extra }, () => 'Fire Energy');
    const g = scenario(dk, dk, [{ active: 'Furfrou', energy: { active: [M] } }, { active: 'Tyranitar ex', hand }]);
    const before = g.state.p[1].hand.length;
    const dBefore = g.state.p[1].discard.length;
    choose(g, 'Attack: Hand Trim');
    return { before, discarded: g.state.p[1].discard.length - dBefore };
  };
  for (const extra of [0, 3, 6]) {
    const r = run(extra);
    assert.equal(r.discarded, Math.max(0, r.before - 5), `hand of ${r.before}`);
  }
  assert.ok(run(6).before > 5, 'the test exercises a hand over 5');
  const small = scenario(dk, dk, [{ active: 'Furfrou', energy: { active: [M] } }, { active: 'Tyranitar ex' }]);
  small.state.p[1].discard.push(...small.state.p[1].hand.splice(0, small.state.p[1].hand.length - 4));
  const dBefore = small.state.p[1].discard.length;
  choose(small, 'Attack: Hand Trim');
  assert.equal(small.state.p[1].discard.length, dBefore, 'a hand of 4 or 5 loses nothing');
});

// ------------------------------------------------------------------ Antique Jaw Fossil

test("Antique Jaw Fossil, Intimidating Jaw: while Active, attacks used by the opponent's Active Pokémon do 30 less damage", () => {
  const dk = deck('me03-068', 'me03-026', DRA, TYR);
  const hit = (side: SideLayout): number => {
    const g = scenario(dk, dk, [side, { active: 'Dreepy', energy: { active: [F, P] } }], { current: 1 });
    choose(g, 'Attack: Bite');
    return dmg(g, 0);
  };
  assert.equal(hit({ active: 'Antique Jaw Fossil', bench: ['Shinx'] }), 10, '40 less 30');
  assert.equal(hit({ active: 'Shinx', bench: ['Antique Jaw Fossil'] }), 40, 'on the Bench it does nothing');
  assert.equal(hit({ active: 'Shinx' }), 40);
});

test('Antique Jaw Fossil: played from hand onto the Bench as a 60-HP Basic {C} Pokémon, and may be discarded from play', () => {
  const dk = deck('me03-068', 'me03-026', TYR);
  const g = scenario(dk, dk, [{ active: 'Shinx', hand: ['Antique Jaw Fossil'] }, { active: 'Tyranitar ex' }]);
  choose(g, 'Antique Jaw Fossil');
  assert.equal(g.state.p[0].bench.length, 1);
  assert.equal(maxHp(g.envForInternals, g.state, g.state.p[0].bench[0]!), 60);
  assert.ok(has(g, 'Discard from play (Antique Jaw Fossil)'), 'it can be discarded from play');
});

// ------------------------------------------------------------------ Energy Swatter

test("Energy Swatter: the opponent reveals their hand; you choose an Energy card there and put it on the bottom of their deck", () => {
  const dk = deck('me03-073', TYR);
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Energy Swatter'] }, { active: 'Tyranitar ex', hand: [W, F, 'Tyranitar ex'] }]);
  const hand = g.state.p[1].hand.slice();
  const deckBefore = g.state.p[1].deck.length;
  choose(g, 'Play Energy Swatter');
  assert.deepEqual([...g.state.p[1].revealed].sort(), hand.slice().sort(), 'the whole hand is revealed');
  assert.equal(g.decision?.player, 0, 'you choose');
  assert.ok(labels(g).every((l) => l.includes('Energy')), 'only the Energy cards can be chosen');
  choose(g, 'Water Energy');
  assert.ok(!names(g, g.state.p[1].hand).includes(W));
  assert.equal(g.state.p[1].deck.length, deckBefore + 1);
  assert.equal(name(g, g.state.p[1].deck[0]!), W, 'on the bottom of their deck');
});

test('Energy Swatter: a hand with no Energy still gets revealed and nothing moves; an empty hand makes the card unplayable', () => {
  const dk = deck('me03-073', TYR);
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Energy Swatter'] }, { active: 'Tyranitar ex', hand: ['Tyranitar ex'] }]);
  g.state.p[1].deck.push(...g.state.p[1].hand.splice(0, g.state.p[1].hand.length - 1)); // keep only the Tyranitar
  assert.ok(has(g, 'Play Energy Swatter'));
  const deckBefore = g.state.p[1].deck.length;
  choose(g, 'Play Energy Swatter');
  assert.equal(g.state.p[1].deck.length, deckBefore);
  assert.equal(g.state.p[1].hand.length, 1);
  assert.equal(g.state.p[1].revealed.length, 1);
  const e = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Energy Swatter'] }, { active: 'Tyranitar ex' }]);
  e.state.p[1].discard.push(...e.state.p[1].hand.splice(0));
  advance(e.envForInternals, e.state);
  assert.ok(!has(e, 'Play Energy Swatter'), "an empty hand: nothing to reveal, so the card can't be played");
});
