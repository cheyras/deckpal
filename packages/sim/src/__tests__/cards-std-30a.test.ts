/**
 * Card tests, batch "std-30a": every card scripted in cards/scripts/std-30a.ts does what its printed text says in a
 * constructed position. Quotes are the printed text from the frames. Illumise (30th-004, Weakness ×3) is not scripted.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { maxHp } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { ASLEEP, PARALYZED, POISONED, type Decision } from '../types.js';
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

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy. */
function deck(...ids: string[]) {
  return fromIds('30a', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
type Sides = [SideLayout, SideLayout];
/** Both players use the same deck; the position is built from names, so a deck holds one card of each name that matters. */
const run = (ids: string[], sides: Sides, opts: Parameters<typeof scenario>[3] = {}): Game => scenario(deck(...ids), deck(...ids), sides, opts);

/** Each player has their own deck (so that both can hold a different "Pikachu"). */
const run2 = (a: string[], b: string[], sides: Sides, opts: Parameters<typeof scenario>[3] = {}): Game => scenario(deck(...a), deck(...b), sides, opts);

const DRA = 'sv06-130'; // Dragapult ex: 320 HP Tera, no Weakness or Resistance: a neutral target in the Active Spot
const SNORLAX = 'sv06-136'; // 160 HP Basic, Colorless, weak Fighting (my Pokémon here are never Fighting)
const TAUROS = 'sv08-101'; // Paldean Tauros: 130 HP Fighting, Smash Kick {F}{C} 40
const ZAPDOS = 'sv06-065';
const PIKACHU_EX = 'me02.5-057';
const BOSS = 'me01-114';
const BOOMERANG = 'sv06-166'; // Special Energy
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const F = 'Fighting Energy';
const OPP_TURN = { current: 1 as const, turn: 4 };

// ------------------------------------------------------------------ Alolan Exeggutor

test('Alolan Exeggutor, Scale Up: +250 HP only with 6 or more Grass Energy attached (5, or 6 with a non-Grass one, is not enough)', () => {
  const hp = (energy: string[]): number => {
    const g = run(['30th-002'], [{ active: 'Alolan Exeggutor', energy: { active: energy } }, { active: 'Alolan Exeggutor' }]);
    return maxHp(g.envForInternals, g.state, g.state.p[0].active!);
  };
  assert.equal(hp([G, G, G, G, G]), 150);
  assert.equal(hp([G, G, G, G, G, W]), 150, 'a Water Energy is not a Grass Energy');
  assert.equal(hp([G, G, G, G, G, G]), 400);
});

test('Alolan Exeggutor, Mega Drain: 150, and heal 50 damage from this Pokémon', () => {
  const g = run(['30th-002', DRA], [{ active: 'Alolan Exeggutor', energy: { active: [G, G, G, G] }, damage: { active: 80 } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Mega Drain');
  assert.equal(dmg(g, 1), 150);
  assert.equal(dmg(g, 0), 30);
});

// ------------------------------------------------------------------ Tropius

test("Tropius, Rally Back: 30, and 90 more if one of your Pokémon was Knocked Out by damage from an attack during your opponent's last turn", () => {
  const hit = (ko: number | null): number => {
    const g = run(['30th-005', DRA], [{ active: 'Tropius', energy: { active: [G, G] } }, { active: 'Dragapult ex' }]);
    if (ko !== null) g.state.p[0].attackKoTurn = g.state.turn - ko;
    choose(g, 'Attack: Rally Back');
    return dmg(g, 1);
  };
  assert.equal(hit(null), 30);
  assert.equal(hit(1), 120);
  assert.equal(hit(2), 30, 'two turns ago is not the opponent\'s last turn');
});

// ------------------------------------------------------------------ Vivillon

test('Vivillon, Guiding Dance: flip a coin; on heads search the deck for a Pokémon, reveal it and put it in your hand', () => {
  const heads = run(['30th-008', SNORLAX], [{ active: 'Vivillon' }, { active: 'Vivillon' }]);
  heads.state.forcedCoins = [true];
  const before = heads.state.p[0].hand.length;
  choose(heads, 'Use Guiding Dance');
  assert.equal(heads.decision?.kind, 'cards');
  pick(heads, ['Snorlax']);
  assert.equal(heads.state.p[0].hand.length, before + 1);
  assert.ok(namesOf(heads, heads.state.p[0].hand).includes('Snorlax'));

  const tails = run(['30th-008', SNORLAX], [{ active: 'Vivillon' }, { active: 'Vivillon' }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Use Guiding Dance');
  assert.equal(tails.state.p[0].hand.length, before, 'tails: nothing is found');
  assert.equal(has(tails, 'Use Guiding Dance'), false, 'once during your turn');
});

test('Vivillon, Guiding Dance: with no cards in the deck the Ability cannot be used', () => {
  const g = run(['30th-008'], [{ active: 'Vivillon', emptyDeck: true }, { active: 'Vivillon' }]);
  assert.equal(has(g, 'Use Guiding Dance'), false);
});

test("Vivillon, Poison Powder: 60, and the opponent's Active Pokémon is now Poisoned", () => {
  const g = run(['30th-008', DRA], [{ active: 'Vivillon', energy: { active: [G, G] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Poison Powder');
  assert.equal(dmg(g, 1), 60 + 10, 'the attack ends the turn: 60, and one damage counter from Poison at Pokémon Checkup');
  assert.ok((g.state.p[1].active!.cond & POISONED) !== 0);
});

// ------------------------------------------------------------------ Moltres / Articuno

test('Moltres, Fiery Flapping: with Articuno and Zapdos in play, attach a Basic Fire Energy card from your hand to this Pokémon (once during your turn)', () => {
  const ids = ['30th-011', '30th-018', ZAPDOS];
  const g = run(ids, [{ active: 'Articuno', bench: ['Moltres', 'Zapdos'], hand: [R, R, W] }, { active: 'Articuno' }]);
  choose(g, 'Use Fiery Flapping');
  choose(g, R); // two identical cards: the first use asks which
  const moltres = g.state.p[0].bench[0]!;
  assert.deepEqual(namesOf(g, moltres.energy), ['Fire Energy']);
  assert.equal(has(g, 'Use Fiery Flapping'), false, 'once during your turn');
});

test('Moltres, Fiery Flapping: not without Zapdos, not without Articuno, not without a Basic Fire Energy card in hand', () => {
  const ids = ['30th-011', '30th-018', ZAPDOS];
  const noZapdos = run(ids, [{ active: 'Articuno', bench: ['Moltres'], hand: [R] }, { active: 'Articuno' }]);
  assert.equal(has(noZapdos, 'Use Fiery Flapping'), false);
  const noArticuno = run(ids, [{ active: 'Zapdos', bench: ['Moltres'], hand: [R] }, { active: 'Articuno' }]);
  assert.equal(has(noArticuno, 'Use Fiery Flapping'), false);
  const noFire = run(ids, [{ active: 'Articuno', bench: ['Moltres', 'Zapdos'], hand: [W, L] }, { active: 'Articuno' }]);
  assert.equal(has(noFire, 'Use Fiery Flapping'), false);
});

test('Moltres, Fire Spin: 130, then discard 2 Energy from this Pokémon', () => {
  const g = run(['30th-011', DRA], [{ active: 'Moltres', energy: { active: [R, R, R, W] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Fire Spin');
  assert.equal(dmg(g, 1), 130);
  pick(g, ['Fire Energy', 'Water Energy']);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), ['Fire Energy', 'Fire Energy']);
});

test('Articuno, Frosty Flapping: with Moltres and Zapdos in play, attach a Basic Water Energy card from your hand to this Pokémon', () => {
  const ids = ['30th-011', '30th-018', ZAPDOS];
  const g = run(ids, [{ active: 'Moltres', bench: ['Articuno', 'Zapdos'], hand: [W, R] }, { active: 'Moltres' }]);
  choose(g, 'Use Frosty Flapping'); // one Basic Water Energy card in hand: no choice to make
  assert.deepEqual(namesOf(g, g.state.p[0].bench[0]!.energy), ['Water Energy']);
  assert.equal(has(g, 'Use Frosty Flapping'), false);
  const no = run(ids, [{ active: 'Moltres', bench: ['Articuno'], hand: [W] }, { active: 'Moltres' }]);
  assert.equal(has(no, 'Use Frosty Flapping'), false, 'no Zapdos');
});

test("Articuno, Hail: 30 damage to each of the opponent's Pokémon, with no Weakness on the Bench", () => {
  const g = run(['30th-018', '30th-021', SNORLAX], [{ active: 'Articuno', energy: { active: [W, W, W] } }, { active: 'Snorlax', bench: ['Greninja ex', 'Snorlax'] }]);
  choose(g, 'Attack: Hail');
  assert.equal(dmg(g, 1), 30);
  assert.deepEqual(
    g.state.p[1].bench.map((b) => b.damage),
    [30, 30],
    'Greninja ex is weak to Lightning, not Water; the Bench has no Weakness anyway',
  );
});

// ------------------------------------------------------------------ Ho-Oh

test('Ho-Oh, Sacred Breath: discard all Energy from this Pokémon, then heal all damage from 1 of your Benched Pokémon', () => {
  const g = run(['30th-012', SNORLAX, DRA], [{ active: 'Ho-Oh', bench: ['Snorlax', 'Dragapult ex'], energy: { active: [R, R, W] }, damage: { 0: 80, 1: 70 } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Sacred Breath');
  choose(g, 'Snorlax');
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
  assert.equal(g.state.p[0].bench[1]!.damage, 70, 'only the chosen Pokémon is healed');
  assert.equal(dmg(g, 1), 0, 'no damage');
});

test('Ho-Oh, Sacred Breath: with no Benched Pokémon the Energy is still discarded', () => {
  const g = run(['30th-012'], [{ active: 'Ho-Oh', energy: { active: [R, R] } }, { active: 'Ho-Oh' }]);
  choose(g, 'Attack: Sacred Breath');
  assert.equal(g.state.p[0].active!.energy.length, 0);
});

// ------------------------------------------------------------------ Reshiram

test('Reshiram, Laser Flame: 80, and 80 more if this Pokémon has any Lightning Energy attached', () => {
  const hit = (energy: string[]): number => {
    const g = run(['30th-014', DRA], [{ active: 'Reshiram', energy: { active: energy } }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Laser Flame');
    return dmg(g, 1);
  };
  assert.equal(hit([R, R, R]), 80);
  assert.equal(hit([R, R, L]), 160);
  assert.equal(hit([R, R, W]), 80, 'Water is not Lightning');
});

// ------------------------------------------------------------------ Lapras

test('Lapras, Ferry Across: search your deck for a Supporter card, reveal it, and put it into your hand', () => {
  const g = run(['30th-017', BOSS], [{ active: 'Lapras', energy: { active: [W] } }, { active: 'Lapras' }]);
  choose(g, 'Attack: Ferry Across');
  assert.equal(g.decision?.kind, 'cards');
  assert.ok(labels(g).every((l) => l.includes("Boss's Orders")), 'only Supporter cards are offered');
  pick(g, ["Boss's Orders"]);
  assert.deepEqual(namesOf(g, g.state.p[0].hand).filter((n) => n === "Boss's Orders"), ["Boss's Orders"]);
});

test("Lapras, Ice Beam: 80, and on heads the opponent's Active Pokémon is Paralyzed (not on tails)", () => {
  const hit = (coin: boolean): Game => {
    const g = run(['30th-017', DRA], [{ active: 'Lapras', energy: { active: [W, W, W] } }, { active: 'Dragapult ex' }]);
    g.state.forcedCoins = [coin];
    choose(g, 'Attack: Ice Beam');
    return g;
  };
  const h = hit(true);
  assert.equal(dmg(h, 1), 80);
  assert.ok((h.state.p[1].active!.cond & PARALYZED) !== 0);
  const t = hit(false);
  assert.equal(dmg(t, 1), 80);
  assert.equal(t.state.p[1].active!.cond & PARALYZED, 0);
});

// ------------------------------------------------------------------ Kyogre

test('Kyogre, Hydro Pump: 60, and 30 more for each Water Energy attached to this Pokémon', () => {
  const hit = (energy: string[]): number => {
    const g = run(['30th-019', DRA], [{ active: 'Kyogre', energy: { active: energy } }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Hydro Pump');
    return dmg(g, 1);
  };
  assert.equal(hit([R, R, R, R]), 60);
  assert.equal(hit([W, R, R, R]), 90);
  assert.equal(hit([W, W, R, L]), 120);
  assert.equal(hit([W, W, W, W]), 180);
});

// ------------------------------------------------------------------ Palkia

test("Palkia, Wormhole: 100, switch this Pokémon with 1 of your Benched Pokémon, and if you do, switch out the opponent's Active (they choose)", () => {
  const g = run(['30th-020', SNORLAX, DRA], [{ active: 'Palkia', bench: ['Snorlax'], energy: { active: [W, W, W] } }, { active: 'Dragapult ex', bench: ['Snorlax', 'Palkia'] }]);
  choose(g, 'Attack: Wormhole');
  const opp = g.state.p[1];
  assert.equal(g.state.p[0].active ? nameOf(g, g.state.p[0].active.cards[g.state.p[0].active.cards.length - 1]!) : '', 'Snorlax');
  choose(g, 'Palkia'); // the opponent chooses their new Active
  assert.equal(nameOf(g, opp.active!.cards[opp.active!.cards.length - 1]!), 'Palkia');
  const dra = opp.bench.find((b) => nameOf(g, b.cards[b.cards.length - 1]!) === 'Dragapult ex')!;
  assert.equal(dra.damage, 100, 'the 100 was done before the switch');
});

test('Palkia, Wormhole: with no Benched Pokémon of yours nothing is switched, not even the opponent\'s Active', () => {
  const g = run(['30th-020', SNORLAX, DRA], [{ active: 'Palkia', energy: { active: [W, W, W] } }, { active: 'Dragapult ex', bench: ['Snorlax'] }]);
  choose(g, 'Attack: Wormhole');
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Palkia');
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), 'Dragapult ex');
  assert.equal(dmg(g, 1), 100);
});

// ------------------------------------------------------------------ Greninja ex

test("Greninja ex, Stealthy Slash: 30 damage to 1 of the opponent's Pokémon for each damage counter on it (Active or Benched, no Weakness on the Bench)", () => {
  const ids = ['30th-021', DRA, SNORLAX];
  const bench = run(ids, [{ active: 'Greninja ex', energy: { active: [W] } }, { active: 'Dragapult ex', bench: ['Snorlax'], damage: { 0: 30 } }]);
  choose(bench, 'Attack: Stealthy Slash');
  choose(bench, 'Snorlax');
  assert.equal(bench.state.p[1].bench[0]!.damage, 30 + 90, '3 counters: 90 more');
  assert.equal(dmg(bench, 1), 0);

  const active = run(ids, [{ active: 'Greninja ex', energy: { active: [W] } }, { active: 'Dragapult ex', damage: { active: 50 } }]);
  choose(active, 'Attack: Stealthy Slash');
  choose(active, 'Dragapult ex');
  assert.equal(dmg(active, 1), 50 + 150, '5 counters: 150 more');

  const none = run(ids, [{ active: 'Greninja ex', energy: { active: [W] } }, { active: 'Dragapult ex', bench: ['Snorlax'] }]);
  choose(none, 'Attack: Stealthy Slash');
  choose(none, 'Dragapult ex');
  assert.equal(dmg(none, 1), 0, 'no counters, no damage');
});

// ------------------------------------------------------------------ Wishiwashi

test("Wishiwashi, Counterattack Grouping: when it is Active and damaged by an opponent's attack (even Knocked Out), 3 damage counters on the Attacking Pokémon", () => {
  const ids = ['30th-022', TAUROS, SNORLAX];
  const g = run(ids, [{ active: 'Wishiwashi', bench: ['Snorlax'] }, { active: 'Paldean Tauros', energy: { active: [F, F] } }], OPP_TURN);
  choose(g, 'Attack: Smash Kick');
  assert.equal(g.state.p[0].prizesTaken, 0);
  assert.equal(g.state.p[1].prizesTaken, 1, 'Wishiwashi (30 HP) was Knocked Out');
  assert.equal(dmg(g, 1), 30, 'three damage counters on Tauros');
});

test('Wishiwashi, Counterattack Grouping: not when the damaged Active Pokémon is not a Wishiwashi; works from the Bench for an Active Wishiwashi, each copy placing its own counters', () => {
  const ids = ['30th-022', TAUROS, SNORLAX];
  const other = run(ids, [{ active: 'Snorlax', bench: ['Wishiwashi'] }, { active: 'Paldean Tauros', energy: { active: [F, F] } }], OPP_TURN);
  choose(other, 'Attack: Smash Kick');
  assert.equal(dmg(other, 1), 0);

  const two = run(ids, [{ active: 'Wishiwashi', bench: ['Wishiwashi', 'Snorlax'] }, { active: 'Paldean Tauros', energy: { active: [F, F] } }], OPP_TURN);
  choose(two, 'Attack: Smash Kick');
  choose(two, 'Snorlax');
  assert.equal(dmg(two, 1), 60, 'two Wishiwashi: 3 counters each');
});

test('Wishiwashi, Surprise Attack: flip a coin; on tails this attack does nothing', () => {
  const hit = (coin: boolean): number => {
    const g = run(['30th-022', DRA], [{ active: 'Wishiwashi', energy: { active: [W] } }, { active: 'Dragapult ex' }]);
    g.state.forcedCoins = [coin];
    choose(g, 'Attack: Surprise Attack');
    return dmg(g, 1);
  };
  assert.equal(hit(true), 30);
  assert.equal(hit(false), 0);
});

// ------------------------------------------------------------------ Pikachu 30th-025 / 026

test("Pikachu (Spark), Spark: 20, and also 20 damage to 1 of the opponent's Benched Pokémon (no Weakness on the Bench)", () => {
  const g = run(['30th-025', '30th-021', SNORLAX], [{ active: 'Pikachu', energy: { active: [L, L] } }, { active: 'Snorlax', bench: ['Greninja ex', 'Snorlax'] }]);
  choose(g, 'Attack: Spark');
  choose(g, 'Greninja ex');
  assert.equal(dmg(g, 1), 20);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [20, 0], 'Greninja ex is weak to Lightning but the Bench has no Weakness');
});

test('Pikachu (Spark), Spark: with no Benched Pokémon only the Active is damaged', () => {
  const g = run(['30th-025', DRA], [{ active: 'Pikachu', energy: { active: [L, L] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Spark');
  assert.equal(dmg(g, 1), 20);
});

test('Pikachu (Peer At), Peer At: your opponent reveals their hand', () => {
  const g = run(['30th-026', SNORLAX], [{ active: 'Pikachu', energy: { active: [L] } }, { active: 'Snorlax', hand: ['Snorlax', 'Lightning Energy'] }]);
  assert.equal(g.state.p[1].revealed.length, 0);
  choose(g, 'Attack: Peer At');
  assert.deepEqual(namesOf(g, g.state.p[1].revealed), ['Lightning Energy', 'Snorlax']);
});

// ------------------------------------------------------------------ Pikachu 30th-028 / 033

test("Pikachu (Lonely Gaze): as long as it is Active, attacks used by the opponent's Active Pokémon do 20 less damage, before Weakness ((40 - 20) x 2 = 40, not 40 x 2 - 20 = 60)", () => {
  const A = ['30th-028', SNORLAX];
  const B = [TAUROS];
  const gaze = run2(A, B, [{ active: 'Pikachu', bench: ['Snorlax'] }, { active: 'Paldean Tauros', energy: { active: [F, F] } }], OPP_TURN);
  choose(gaze, 'Attack: Smash Kick');
  assert.equal(dmg(gaze, 0), 40, 'Pikachu is weak to Fighting');
  const benched = run2(A, B, [{ active: 'Snorlax', bench: ['Pikachu'] }, { active: 'Paldean Tauros', energy: { active: [F, F] } }], OPP_TURN);
  choose(benched, 'Attack: Smash Kick');
  assert.equal(dmg(benched, 0), 80, 'on the Bench it does nothing: 40 x 2 on Snorlax (weak Fighting)');
});

test("Pikachu (Lonely Gaze): damage from the opponent's Active Pokémon's attack to a Benched Pokémon is reduced by 20 too, only while it is Active", () => {
  const A = ['30th-028', SNORLAX, DRA];
  const B = ['30th-038'];
  const hit = (sideA: SideLayout): number => {
    const g = run2(A, B, [sideA, { active: 'Pikachu', energy: { active: [L] } }], OPP_TURN);
    choose(g, 'Attack: Targeted Spark');
    choose(g, 'Snorlax');
    return g.state.p[0].bench.find((b) => nameOf(g, b.cards[0]!) === 'Snorlax')!.damage;
  };
  assert.equal(hit({ active: 'Pikachu', bench: ['Snorlax'] }), 0, '20 - 20');
  assert.equal(hit({ active: 'Dragapult ex', bench: ['Snorlax', 'Pikachu'] }), 20, 'Pikachu on the Bench: no reduction');
});

test("Pikachu (Keep Hidden): on the Bench, all damage from and effects of the opponent's attacks done to it are prevented (a Benched Snorlax is hit; the Active Pikachu is hit too)", () => {
  const A = ['30th-033', SNORLAX];
  const B = ['30th-038'];
  const hit = (target: string, sideA: SideLayout): Game => {
    const g = run2(A, B, [sideA, { active: 'Pikachu', energy: { active: [L] } }], OPP_TURN);
    choose(g, 'Attack: Targeted Spark');
    choose(g, target);
    return g;
  };
  const hidden = hit('Pikachu', { active: 'Snorlax', bench: ['Pikachu', 'Snorlax'] });
  assert.equal(hidden.state.p[0].bench[0]!.damage, 0);
  const snorlax = hit('Snorlax', { active: 'Pikachu', bench: ['Snorlax'] });
  assert.equal(snorlax.state.p[0].bench[0]!.damage, 20);
  const active = hit('Pikachu', { active: 'Pikachu', bench: ['Snorlax'] });
  assert.equal(dmg(active, 0), 20, 'in the Active Spot there is no protection');
});

// ------------------------------------------------------------------ Pikachu 30th-034

test('Pikachu (Pika Chain), Pika Chain: 40 damage for each of your Pikachu and Pikachu ex in play (not the opponent\'s, not other Pokémon)', () => {
  const ids = ['30th-034', PIKACHU_EX, SNORLAX, DRA];
  const hit = (mine: SideLayout, theirs: SideLayout): number => {
    const g = run(ids, [mine, theirs]);
    choose(g, 'Attack: Pika Chain');
    return dmg(g, 1);
  };
  assert.equal(hit({ active: 'Pikachu', energy: { active: [L, L, L] } }, { active: 'Dragapult ex' }), 40);
  assert.equal(
    hit({ active: 'Pikachu', bench: ['Pikachu ex', 'Snorlax'], energy: { active: [L, L, L] } }, { active: 'Dragapult ex', bench: ['Pikachu', 'Pikachu ex'] }),
    80,
    'Pikachu + Pikachu ex = 2; Snorlax and the opponent\'s Pikachu do not count',
  );
});

// ------------------------------------------------------------------ Pikachu 30th-037

test('Pikachu (Energized Tail), Energized Tail: search your deck for an Energy card (Basic or Special), reveal it, and put it into your hand', () => {
  const g = run(['30th-037', BOOMERANG], [{ active: 'Pikachu', energy: { active: [L] } }, { active: 'Pikachu' }]);
  choose(g, 'Attack: Energized Tail');
  assert.equal(g.decision?.kind, 'cards');
  assert.ok(labels(g).every((l) => l.includes('Energy')), 'only Energy cards');
  pick(g, ['Boomerang Energy']);
  assert.ok(namesOf(g, g.state.p[0].hand).includes('Boomerang Energy'));
});

// ------------------------------------------------------------------ Pikachu 30th-038

test("Pikachu (Targeted Spark), Targeted Spark: 20 damage to 1 of the opponent's Pokémon; Weakness applies to the Active Pokémon only", () => {
  const ids = ['30th-038', '30th-021'];
  const active = run(ids, [{ active: 'Pikachu', energy: { active: [L] } }, { active: 'Greninja ex', bench: ['Pikachu'] }]);
  choose(active, 'Attack: Targeted Spark');
  choose(active, 'Greninja ex');
  assert.equal(dmg(active, 1), 40, 'Greninja ex is weak to Lightning: 20 x 2');
  const bench = run(ids, [{ active: 'Pikachu', energy: { active: [L] } }, { active: 'Pikachu', bench: ['Greninja ex'] }]);
  choose(bench, 'Attack: Targeted Spark');
  choose(bench, 'Greninja ex');
  assert.equal(bench.state.p[1].bench[0]!.damage, 20, 'no Weakness on the Bench');
  assert.equal(dmg(bench, 1), 0);
});

// ------------------------------------------------------------------ Pikachu 30th-040

test("Pikachu (Overwriting Bolt), Overwriting Bolt: 10, and until the end of your next turn the Defending Pokémon's Weakness is Lightning (x2), even with none printed", () => {
  const g = run(['30th-040', DRA], [{ active: 'Pikachu', energy: { active: [L] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Overwriting Bolt');
  assert.equal(dmg(g, 1), 10, 'Dragapult ex has no Weakness: no x2 yet');
  choose(g, 'End turn'); // the opponent's turn
  choose(g, 'Attack: Overwriting Bolt');
  assert.equal(dmg(g, 1), 10 + 20, 'now weak to Lightning: 10 x 2');
});

// ------------------------------------------------------------------ Pikachu 30th-042

test('Pikachu (Charge-Up Dash), Charge-Up Dash: flip until tails, search for that many Basic Lightning Energy and attach them to this Pokémon', () => {
  const ids = ['30th-042', BOOMERANG];
  const flip = (coins: boolean[]): Game => {
    const g = run(ids, [{ active: 'Pikachu', energy: { active: [R] } }, { active: 'Pikachu' }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Charge-Up Dash');
    return g;
  };
  const two = flip([true, true, false]);
  assert.equal(two.decision?.kind, 'cards');
  assert.ok(labels(two).every((l) => l.includes('Lightning Energy')), 'Basic Lightning Energy only');
  pick(two, ['Lightning Energy', 'Lightning Energy']);
  assert.deepEqual(namesOf(two, two.state.p[0].active!.energy), ['Fire Energy', 'Lightning Energy', 'Lightning Energy']);
  const none = flip([false]);
  assert.deepEqual(namesOf(none, none.state.p[0].active!.energy), ['Fire Energy']);
});

// ------------------------------------------------------------------ Pikachu 30th-043

test('Pikachu (Tropical Vibes), Tropical Vibes: this Pokémon is now Asleep, then draw cards until you have 6 cards in your hand', () => {
  const few = run(['30th-043'], [{ active: 'Pikachu', energy: { active: [L, L] }, hand: [L, L] }, { active: 'Pikachu' }]);
  few.state.forcedCoins = [false]; // stays Asleep at Pokémon Checkup
  choose(few, 'Attack: Tropical Vibes');
  assert.equal(few.state.p[0].hand.length, 6);
  assert.ok((few.state.p[0].active!.cond & ASLEEP) !== 0);
  const many = run(['30th-043'], [{ active: 'Pikachu', energy: { active: [L, L] }, hand: [L, L, L, L, L, L, L] }, { active: 'Pikachu' }]);
  many.state.forcedCoins = [false];
  choose(many, 'Attack: Tropical Vibes');
  assert.equal(many.state.p[0].hand.length, 7, 'with 6 or more cards nothing is drawn');
  assert.ok((many.state.p[0].active!.cond & ASLEEP) !== 0);
});
