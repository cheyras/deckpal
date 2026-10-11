/**
 * Card tests, batch "std-seed3": every card scripted in cards/scripts/std-seed3.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { Decision } from '../types.js';
import { ASLEEP, BURNED } from '../types.js';
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
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}
/** Put a Stadium (by card name, taken from `owner`'s deck) into play. */
function putStadium(g: Game, owner: 0 | 1, stadium: string): void {
  const deck = g.state.p[owner].deck;
  const i = deck.findIndex((c) => name(g, c) === stadium);
  assert.ok(i >= 0, `no ${stadium} in P${owner + 1}'s deck`);
  const [card] = deck.splice(i, 1);
  g.state.stadium = { card: card as number, owner };
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]) {
  return fromIds('seed3', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const DRA = 'sv06-130'; // Dragapult ex: 320 HP, Stage 2, Tera, no Weakness or Resistance -- a neutral target
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Stage 2, weak to Grass
const REG = 'me02.5-145'; // Registeel ex: 230 HP, Basic, resists Grass
const ALC = 'me02-044'; // Alcremie: 90 HP, Stage 1
const SLO = 'me05-029'; // Slowpoke: 70 HP
const REL = 'sv08-013'; // Rellor: 40 HP
const SHU = 'me05-033'; // Shuppet: 50 HP, Hide 'n' Sneak
const BALLOON = 'me01-166'; // Air Balloon (Tool)
const BOSS = 'me01-114'; // Boss's Orders (Supporter)
const BALL = 'me01-131'; // Ultra Ball (Item)
const CAGE = 'me02-085'; // Battle Cage (Stadium)
const TOWER = 'me04-080'; // Prism Tower (Stadium)
type Sides = [SideLayout, SideLayout];

const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';

// ------------------------------------------------------------------ Wigglytuff

test('Wigglytuff, Round: 40 for each of your Pokémon in play that has the Round attack (itself, Active or Benched; not the opponent\'s)', () => {
  const dk = deck('me02-077', 'sv10.5b-019', 'sv10.5b-020', SLO, DRA);
  const three = scenario(dk, dk, [
    { active: 'Wigglytuff', bench: ['Tympole', 'Palpitoad', 'Slowpoke'], energy: { active: [F, F] } },
    { active: 'Dragapult ex', bench: ['Tympole'] },
  ]);
  choose(three, 'Attack: Round');
  assert.equal(three.state.p[1].active!.damage, 120, 'Wigglytuff + Tympole + Palpitoad; Slowpoke has no Round; the opponent\'s Tympole does not count');
  const alone = scenario(dk, dk, [{ active: 'Wigglytuff', bench: ['Slowpoke'], energy: { active: [F, F] } }, { active: 'Dragapult ex' }]);
  choose(alone, 'Attack: Round');
  assert.equal(alone.state.p[1].active!.damage, 40);
  const benched = scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Wigglytuff', 'Tympole'], energy: { active: [F, F] } }, { active: 'Dragapult ex' }]);
  assert.ok(!has(benched, 'Attack: Round'), 'control: Slowpoke has no Round of its own');
});

// ------------------------------------------------------------------ Centiskorch

test("Centiskorch, Coiling Crush: 50, then for each heads of 2 coins you discard an Energy of your choice from the Defending Pokémon", () => {
  const dk = deck('me01-030', DRA);
  const layout = (): Sides => [{ active: 'Centiskorch', energy: { active: [F, F] } }, { active: 'Dragapult ex', energy: { active: [F, W, P] } }];
  const both = scenario(dk, dk, layout());
  both.state.forcedCoins = [true, true];
  choose(both, 'Attack: Coiling Crush');
  assert.equal(both.state.p[1].active!.damage, 50);
  choose(both, 'Water Energy');
  choose(both, 'Psychic Energy');
  assert.deepEqual(energyNames(both, 1, 'active'), [F]);
  assert.deepEqual(names(both, both.state.p[1].discard), [P, W], 'the discarded Energy goes to the opponent\'s discard pile');
  const one = scenario(dk, dk, layout());
  one.state.forcedCoins = [false, true];
  choose(one, 'Attack: Coiling Crush');
  choose(one, 'Fire Energy');
  assert.deepEqual(energyNames(one, 1, 'active'), [P, W]);
  const none = scenario(dk, dk, layout());
  none.state.forcedCoins = [false, false];
  choose(none, 'Attack: Coiling Crush');
  assert.equal(none.state.p[1].active!.damage, 50);
  assert.deepEqual(energyNames(none, 1, 'active'), [F, P, W]);
  assert.equal(none.decision?.player, 1, 'no Energy to choose: the turn passed');
});

// ------------------------------------------------------------------ Mega Gardevoir ex

test('Mega Gardevoir ex, Overflowing Wishes: each Benched Pokémon gets a Basic {P} Energy from the deck (only Basic {P}, the Active none), then the deck is shuffled', () => {
  const dk = deck('me01-060', SLO, REL);
  const g = scenario(dk, dk, [
    { active: 'Mega Gardevoir ex', bench: ['Slowpoke', 'Rellor', 'Slowpoke'], energy: { active: [P], 1: [F] } },
    { active: 'Slowpoke' },
  ]);
  const before = g.state.p[0].deck.slice();
  choose(g, 'Attack: Overflowing Wishes');
  assert.deepEqual(energyNames(g, 0, 0), [P]);
  assert.deepEqual(energyNames(g, 0, 1), [F, P]);
  assert.deepEqual(energyNames(g, 0, 2), [P]);
  assert.deepEqual(energyNames(g, 0, 'active'), [P], 'the Active Pokémon is not a Benched Pokémon');
  assert.equal(g.state.p[0].deck.length, before.length - 3);
  assert.notDeepEqual(
    g.state.p[0].deck,
    before.filter((c) => g.state.p[0].deck.includes(c)),
    'the deck was not shuffled',
  );
});

test('Mega Gardevoir ex, Overflowing Wishes: with fewer Basic {P} Energy in the deck than Benched Pokémon, only that many get one; no Bench, nothing happens', () => {
  const small = fromIds('seed3-small', [
    ['me01-060', 4],
    [SLO, 4],
    ['mee-005', 2],
    ['mee-002', 20],
  ]);
  const g = scenario(small, small, [{ active: 'Mega Gardevoir ex', bench: ['Slowpoke', 'Slowpoke'], energy: { active: [P] } }, { active: 'Slowpoke' }]);
  assert.equal(g.state.p[0].deck.filter((c) => name(g, c) === P).length, 1);
  choose(g, 'Attack: Overflowing Wishes');
  assert.equal(g.state.p[0].deck.filter((c) => name(g, c) === P).length, 0, 'the last Basic {P} Energy was taken');
  assert.equal(g.state.p[0].bench[0]!.energy.length + g.state.p[0].bench[1]!.energy.length, 1, 'only one Benched Pokémon could get one');
  const dk = deck('me01-060', SLO);
  const alone = scenario(dk, dk, [{ active: 'Mega Gardevoir ex', energy: { active: [P] } }, { active: 'Slowpoke' }]);
  const n = alone.state.p[0].deck.length;
  choose(alone, 'Attack: Overflowing Wishes');
  assert.equal(alone.state.p[0].deck.length, n);
  assert.deepEqual(energyNames(alone, 0, 'active'), [P]);
});

test('Mega Gardevoir ex, Mega Symphonia: 50 for each {P} Energy attached to all of your Pokémon (Active and Benched), no other type', () => {
  const dk = deck('me01-060', SLO, REL, DRA);
  const g = scenario(dk, dk, [
    { active: 'Mega Gardevoir ex', bench: ['Slowpoke', 'Rellor'], energy: { active: [P, P], 0: [P], 1: [F, W] } },
    { active: 'Dragapult ex', energy: { active: [P, P, P] } },
  ]);
  choose(g, 'Attack: Mega Symphonia');
  assert.equal(g.state.p[1].active!.damage, 150, "3 of your {P} Energy; the opponent's {P} Energy and your {F}{W} don't count");
});

// ------------------------------------------------------------------ Marshadow

test("Marshadow, Shadowy Side Kick: 60; if that Knocks Out the Defending Pokémon, prevent all damage from and effects of attacks done to Marshadow during the opponent's next turn", () => {
  const dk = deck('me01-080', ALC, REL);
  const ko = scenario(dk, dk, [
    { active: 'Marshadow', energy: { active: [FI, FI] } },
    { active: 'Alcremie', damage: { active: 30 }, bench: ['Rellor'], energy: { 0: [G] } },
  ]);
  choose(ko, 'Attack: Shadowy Side Kick');
  assert.deepEqual(names(ko, ko.state.p[1].discard).filter((n) => n === 'Alcremie'), ['Alcremie'], 'Alcremie (30 + 60 = its 90 HP) was Knocked Out');
  assert.equal(name(ko, ko.state.p[1].active!.cards[0]!), 'Rellor', 'the only Benched Pokémon was promoted');
  choose(ko, 'Attack: Rollout');
  assert.equal(ko.state.p[0].active!.damage, 0, "the opponent's attack did nothing to Marshadow");
  // Control: nothing was Knocked Out, so Marshadow is not protected.
  const live = scenario(dk, dk, [
    { active: 'Marshadow', energy: { active: [FI, FI] } },
    { active: 'Alcremie', bench: ['Rellor'], energy: { active: [P] } },
  ]);
  choose(live, 'Attack: Shadowy Side Kick');
  assert.equal(live.state.p[1].active!.damage, 60);
  choose(live, 'Attack: Sweet Circle');
  assert.equal(live.state.p[0].active!.damage, 80, "Alcremie's Sweet Circle (20 for each of its 2 Pokémon, doubled by Marshadow's Psychic Weakness) lands");
});

// ------------------------------------------------------------------ Mega Mawile ex

test('Mega Mawile ex, Gobble Down: 80 for each Prize card you have taken', () => {
  const dk = deck('me01-094', DRA);
  const none = scenario(dk, dk, [{ active: 'Mega Mawile ex', energy: { active: [M, M] } }, { active: 'Dragapult ex' }]);
  choose(none, 'Attack: Gobble Down');
  assert.equal(none.state.p[1].active!.damage, 0);
  const three = scenario(dk, dk, [{ active: 'Mega Mawile ex', energy: { active: [M, M] }, prizes: 3 }, { active: 'Dragapult ex' }]);
  choose(three, 'Attack: Gobble Down');
  assert.equal(three.state.p[1].active!.damage, 240);
});

test("Mega Mawile ex, Huge Bite: 260, but if the opponent's Active Pokémon already has any damage counters on it the base damage is 30 (not 260 + 30)", () => {
  const dk = deck('me01-094', DRA);
  const layout = (damage: number): Sides => [
    { active: 'Mega Mawile ex', energy: { active: [M, M, M] } },
    { active: 'Dragapult ex', damage: { active: damage } },
  ];
  const clean = scenario(dk, dk, layout(0));
  choose(clean, 'Attack: Huge Bite');
  assert.equal(clean.state.p[1].active!.damage, 260);
  const hurt = scenario(dk, dk, layout(10));
  choose(hurt, 'Attack: Huge Bite');
  assert.equal(hurt.state.p[1].active!.damage, 10 + 30);
});

// ------------------------------------------------------------------ Gloom

test("Gloom, Disperse Drool: 20 to the Defending Pokémon and 20 to each Benched Pokémon of both players, no Weakness on the Bench; a Benched Tera Pokémon takes none (TPCi 2025-11-13, #2250)", () => {
  const dk = deck('me02-002', DRA, REL, SLO, TYR);
  const g = scenario(dk, dk, [
    { active: 'Gloom', bench: ['Rellor', 'Dragapult ex'], energy: { active: [G] } },
    { active: 'Dragapult ex', bench: ['Slowpoke', 'Rellor', 'Dragapult ex'] },
  ]);
  choose(g, 'Attack: Disperse Drool');
  assert.equal(g.state.p[1].active!.damage, 20);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [20, 20, 0], "Slowpoke and Rellor take 20 (Rellor's Fire Weakness and Grass don't matter on the Bench); the Tera Dragapult ex takes none");
  assert.deepEqual(g.state.p[0].bench.map((b) => b.damage), [20, 0], 'your own Benched Pokémon take it too, except your Tera Pokémon (even from your own attack)');
  assert.equal(g.state.p[0].active!.damage, 0, 'Gloom itself takes none');
  const weak = scenario(dk, dk, [{ active: 'Gloom', energy: { active: [G] } }, { active: 'Tyranitar ex' }]);
  choose(weak, 'Attack: Disperse Drool');
  assert.equal(weak.state.p[1].active!.damage, 40, "the Defending Pokémon's Grass Weakness still applies to the 20");
});

// ------------------------------------------------------------------ Genesect

test("Genesect, Bug's Cannon: 20 for each {G} Energy on it to 1 of the opponent's Pokémon of your choice; Weakness applies only to the Active", () => {
  const dk = deck('me02-008', DRA, TYR);
  const layout = (): Sides => [{ active: 'Genesect', energy: { active: [G, G, F] } }, { active: 'Dragapult ex', bench: ['Tyranitar ex'] }];
  const bench = scenario(dk, dk, layout());
  choose(bench, "Attack: Bug's Cannon");
  assert.ok(has(bench, 'Tyranitar ex') && has(bench, 'Dragapult ex'), 'every opposing Pokémon is a choice');
  choose(bench, 'Tyranitar ex');
  assert.equal(bench.state.p[1].bench[0]!.damage, 40, '2 {G} Energy; Benched: no Weakness');
  assert.equal(bench.state.p[1].active!.damage, 0);
  const active = scenario(dk, dk, [{ active: 'Genesect', energy: { active: [G, G, F] } }, { active: 'Tyranitar ex' }]);
  choose(active, "Attack: Bug's Cannon");
  assert.equal(active.state.p[1].active!.damage, 80, "the Active takes Weakness: 40 x 2 against Tyranitar ex's Grass Weakness");
  const more = scenario(dk, dk, [{ active: 'Genesect', energy: { active: [G, G, G, F] } }, { active: 'Dragapult ex' }]);
  choose(more, "Attack: Bug's Cannon");
  assert.equal(more.state.p[1].active!.damage, 60);
});

// ------------------------------------------------------------------ Ceruledge

test("Ceruledge, Infernal Slash: discard 4 Basic {R} Energy cards from your hand and do 220; with fewer than 4 the attack does nothing and not even those are discarded (TPCi 2025-11-13, #2252)", () => {
  const dk = deck('me02-020', DRA);
  const layout = (hand: string[]): Sides => [{ active: 'Ceruledge', energy: { active: [F] }, hand }, { active: 'Dragapult ex' }];
  const four = scenario(dk, dk, layout([F, F, F, F, W]));
  choose(four, 'Attack: Infernal Slash');
  assert.equal(four.state.p[1].active!.damage, 220);
  assert.deepEqual(names(four, four.state.p[0].hand), [W]);
  assert.deepEqual(names(four, four.state.p[0].discard), [F, F, F, F]);
  const three = scenario(dk, dk, layout([F, F, F, W]));
  choose(three, 'Attack: Infernal Slash');
  assert.equal(three.state.p[1].active!.damage, 0);
  assert.deepEqual(names(three, three.state.p[0].hand), [F, F, F, W], 'the three Fire Energy cards stay in hand');
  assert.equal(three.state.p[0].discard.length, 0);
  const five = scenario(dk, dk, layout([F, F, F, F, F]));
  choose(five, 'Attack: Infernal Slash');
  assert.equal(labels(five).length, 5, 'with 5 you choose which 4');
  pick(five, [F, F, F, F]);
  assert.equal(five.state.p[1].active!.damage, 220);
  assert.equal(five.state.p[0].hand.length, 1);
});

// ------------------------------------------------------------------ Mamoswine

test('Mamoswine, Wreck: 120, or 240 with a Stadium in play, and then that Stadium is discarded (to its owner)', () => {
  const dk = deck('me02-025', DRA, TOWER);
  const layout = (): Sides => [{ active: 'Mamoswine', energy: { active: [W, W, W] } }, { active: 'Dragapult ex' }];
  const bare = scenario(dk, dk, layout());
  choose(bare, 'Attack: Wreck');
  assert.equal(bare.state.p[1].active!.damage, 120);
  const mine = scenario(dk, dk, layout());
  putStadium(mine, 0, 'Prism Tower');
  choose(mine, 'Attack: Wreck');
  assert.equal(mine.state.p[1].active!.damage, 240);
  assert.equal(mine.state.stadium, null);
  assert.deepEqual(names(mine, mine.state.p[0].discard), ['Prism Tower']);
  const theirs = scenario(dk, dk, layout());
  putStadium(theirs, 1, 'Prism Tower');
  choose(theirs, 'Attack: Wreck');
  assert.equal(theirs.state.p[1].active!.damage, 240);
  assert.equal(theirs.state.stadium, null);
  assert.deepEqual(names(theirs, theirs.state.p[1].discard), ['Prism Tower'], "the opponent's Stadium goes to the opponent's discard pile");
});

test('Mamoswine, Blizzard Edge: 200, then you discard 2 Energy of your choice from it', () => {
  const dk = deck('me02-025', DRA);
  const g = scenario(dk, dk, [{ active: 'Mamoswine', energy: { active: [W, F, F, P, P, L] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Blizzard Edge');
  assert.equal(g.state.p[1].active!.damage, 200);
  pick(g, [F, L]);
  assert.deepEqual(energyNames(g, 0, 'active'), [F, P, P, W]);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, L]);
});

// ------------------------------------------------------------------ Zacian

test('Zacian, Limit Break: 50, or 140 if your opponent has 3 or fewer Prize cards remaining', () => {
  const dk = deck('me02-045', DRA);
  const run = (oppPrizes: number): number => {
    const g = scenario(dk, dk, [{ active: 'Zacian', energy: { active: [P, P] } }, { active: 'Dragapult ex', prizes: oppPrizes }]);
    choose(g, 'Attack: Limit Break');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(4), 50);
  assert.equal(run(3), 140);
  assert.equal(run(1), 140);
});

// ------------------------------------------------------------------ Honchkrow

test("Honchkrow, Sniping Feathers: discard 2 Energy of your choice from it, and 120 to 1 of the opponent's Pokémon of your choice (Active or Benched)", () => {
  const dk = deck('me02-058', DRA, TYR);
  const layout = (): Sides => [{ active: 'Honchkrow', energy: { active: [D, D, F, W] } }, { active: 'Dragapult ex', bench: ['Tyranitar ex'] }];
  const bench = scenario(dk, dk, layout());
  choose(bench, 'Attack: Sniping Feathers');
  pick(bench, [F, W]);
  assert.deepEqual(energyNames(bench, 0, 'active'), [D, D]);
  choose(bench, 'Tyranitar ex');
  assert.equal(bench.state.p[1].bench[0]!.damage, 120);
  assert.equal(bench.state.p[1].active!.damage, 0);
  const active = scenario(dk, dk, layout());
  choose(active, 'Attack: Sniping Feathers');
  pick(active, [F, W]);
  choose(active, 'Dragapult ex');
  assert.equal(active.state.p[1].active!.damage, 120);
  assert.equal(active.state.p[1].bench[0]!.damage, 0);
});

// ------------------------------------------------------------------ Camerupt

test("Camerupt, Roasting Burn: 110 if the Defending Pokémon is Burned, otherwise nothing", () => {
  const dk = deck('me02.5-028', DRA);
  const burned = scenario(dk, dk, [{ active: 'Camerupt', energy: { active: [F] } }, { active: 'Dragapult ex', cond: BURNED }]);
  burned.state.forcedCoins = [false]; // Pokémon Checkup: the Burn flip is tails, so it stays Burned and takes 2 more counters
  choose(burned, 'Attack: Roasting Burn');
  assert.equal(burned.state.p[1].active!.damage, 110 + 20);
  const clean = scenario(dk, dk, [{ active: 'Camerupt', energy: { active: [F] } }, { active: 'Dragapult ex' }]);
  choose(clean, 'Attack: Roasting Burn');
  assert.equal(clean.state.p[1].active!.damage, 0);
  assert.equal(clean.state.p[1].active!.cond, 0, 'the attack does not Burn anything itself');
});

test('Camerupt, Power Stomp: 170, then you discard 2 Energy of your choice from it', () => {
  const dk = deck('me02.5-028', DRA);
  const g = scenario(dk, dk, [{ active: 'Camerupt', energy: { active: [F, F, F, F, W] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Power Stomp');
  assert.equal(g.state.p[1].active!.damage, 170);
  pick(g, [W, F]);
  assert.deepEqual(energyNames(g, 0, 'active'), [F, F, F]);
});

// ------------------------------------------------------------------ Cinderace ex

test("Cinderace ex, Flare Strike: 280, and during your next turn this Pokémon can't use Flare Strike (but can use Garnet Volley), then it can again", () => {
  const dk = deck('me02.5-038', DRA, TYR);
  const g = scenario(dk, dk, [{ active: 'Cinderace ex', energy: { active: [F, FI, D] } }, { active: 'Dragapult ex', bench: ['Tyranitar ex'] }]);
  assert.ok(has(g, 'Attack: Flare Strike') && has(g, 'Attack: Garnet Volley'), 'control: both attacks are available at first');
  choose(g, 'Attack: Flare Strike');
  assert.equal(g.state.p[1].active!.damage, 280);
  assert.equal(g.decision?.player, 1);
  choose(g, 'End turn');
  assert.equal(g.decision?.player, 0);
  assert.ok(!has(g, 'Attack: Flare Strike'), "Flare Strike was offered during the next turn");
  assert.ok(has(g, 'Attack: Garnet Volley'));
  choose(g, 'Attack: Garnet Volley');
  choose(g, 'Tyranitar ex');
  assert.equal(g.state.p[1].bench[0]!.damage, 180, 'Garnet Volley: 180 to 1 of the opponent\'s Pokémon (Benched: no Weakness)');
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Flare Strike'), 'the turn after that, Flare Strike is available again');
});

// ------------------------------------------------------------------ N's Vanilluxe

test("N's Vanilluxe, Snow Coating: doubles the damage counters on each of the opponent's Pokémon -- N more counters, not 2N more (TPCi 2026-01-22, #2293); yours are untouched", () => {
  const dk = deck('me02.5-051', DRA, TYR, SLO);
  const g = scenario(dk, dk, [
    { active: "N's Vanilluxe", bench: ['Slowpoke'], energy: { active: [W, W] }, damage: { active: 30, 0: 20 } },
    { active: 'Dragapult ex', bench: ['Tyranitar ex', 'Slowpoke'], damage: { active: 20, 0: 50 } },
  ]);
  choose(g, 'Attack: Snow Coating');
  assert.equal(g.state.p[1].active!.damage, 40, '2 counters become 4');
  assert.equal(g.state.p[1].bench[0]!.damage, 100, '5 counters become 10');
  assert.equal(g.state.p[1].bench[1]!.damage, 0, 'no counters stays at none');
  assert.equal(g.state.p[0].active!.damage, 30);
  assert.equal(g.state.p[0].bench[0]!.damage, 20);
});

test("N's Vanilluxe, Snow Coating: Battle Cage protects Benched Pokémon from the new counters (TPCi 2026-01-22, #2294), and so does Hide 'n' Sneak; the Active is still doubled", () => {
  const dk = deck('me02.5-051', DRA, TYR, SHU, CAGE);
  const g = scenario(dk, dk, [
    { active: "N's Vanilluxe", energy: { active: [W, W] } },
    { active: 'Dragapult ex', bench: ['Tyranitar ex', 'Shuppet'], damage: { active: 20, 0: 50, 1: 30 } },
  ]);
  putStadium(g, 0, 'Battle Cage');
  choose(g, 'Attack: Snow Coating');
  assert.equal(g.state.p[1].active!.damage, 40, 'the Active Pokémon is not on the Bench');
  assert.equal(g.state.p[1].bench[0]!.damage, 50, 'Battle Cage');
  assert.equal(g.state.p[1].bench[1]!.damage, 30);
  const noCage = scenario(dk, dk, [
    { active: "N's Vanilluxe", energy: { active: [W, W] } },
    { active: 'Dragapult ex', bench: ['Tyranitar ex', 'Shuppet'], damage: { 0: 50, 1: 30 } },
  ]);
  choose(noCage, 'Attack: Snow Coating');
  assert.equal(noCage.state.p[1].bench[0]!.damage, 100);
  assert.equal(noCage.state.p[1].bench[1]!.damage, 30, "Hide 'n' Sneak prevents the effects of the attack on Shuppet");
});

test("N's Vanilluxe, Blizzard: 120, and 10 damage to each of the opponent's Benched Pokémon -- Battle Cage doesn't stop damage (TPCi 2026-01-22, #2289)", () => {
  const dk = deck('me02.5-051', DRA, TYR, SLO, CAGE);
  const g = scenario(dk, dk, [
    { active: "N's Vanilluxe", bench: ['Slowpoke'], energy: { active: [W, W, W] } },
    { active: 'Dragapult ex', bench: ['Tyranitar ex', 'Slowpoke', 'Dragapult ex'] },
  ]);
  putStadium(g, 1, 'Battle Cage');
  choose(g, 'Attack: Blizzard');
  assert.equal(g.state.p[1].active!.damage, 120);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [10, 10, 0], 'the Tera Pokémon takes none');
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'your own Bench is not hit');
});

// ------------------------------------------------------------------ Clefable

test("Clefable, Metronome: choose 1 of the Defending Pokémon's attacks and use it as this attack, with no Energy cost paid", () => {
  const dk = deck('me02.5-075', REG, ALC);
  const layout = (): Sides => [
    { active: 'Clefable', bench: ['Clefable', 'Clefable'], energy: { active: [P, P] }, discard: [M, M, M, F] },
    { active: 'Registeel ex' },
  ];
  const steel = scenario(dk, dk, layout());
  choose(steel, 'Attack: Metronome');
  assert.deepEqual(labels(steel).sort(), ['Protecting Steel', 'Regi Charge'], "the choice is the Defending Pokémon's attacks");
  choose(steel, 'Protecting Steel');
  assert.equal(steel.state.p[1].active!.damage, 140, "Registeel ex's 140, though Clefable has no {M} Energy");
  const clefable = steel.state.p[0].active!;
  assert.ok(
    steel.state.effects.some((e) => e.static.k === 'damageIn' && e.slot === clefable.id),
    "Protecting Steel's effect lands on the Pokémon that used it: Clefable",
  );
  const charge = scenario(dk, dk, layout());
  choose(charge, 'Attack: Metronome');
  choose(charge, 'Regi Charge');
  pick(charge, [M, M]);
  assert.deepEqual(energyNames(charge, 0, 'active'), [M, M, P, P], 'Regi Charge attaches to Clefable, the attacker');
  const one = scenario(dk, dk, [layout()[0], { active: 'Alcremie' }]);
  choose(one, 'Attack: Metronome');
  assert.equal(one.state.p[1].active!.damage, 60, "Alcremie's only attack, Sweet Circle, counts the user's 3 Pokémon (20 each)");
});

// ------------------------------------------------------------------ Medicham

test("Medicham, Seventh Kick: 150 only with exactly 7 cards in your hand; with 6 or 8 the attack does nothing", () => {
  const dk = deck('me02.5-104', DRA);
  const run = (n: number): number => {
    const g = scenario(dk, dk, [{ active: 'Medicham', energy: { active: [FI] }, hand: new Array<string>(n).fill(W) }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Seventh Kick');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(7), 150);
  assert.equal(run(6), 0);
  assert.equal(run(8), 0);
  assert.equal(run(0), 0);
});

// ------------------------------------------------------------------ Regirock ex

test('Regirock ex, Regi Charge: attaches up to 2 Basic {F} Energy from the discard pile to it, no other Energy, and none is fine (TPCi 2026-02-19, #2304)', () => {
  const dk = deck('me02.5-107', DRA);
  const layout = (): Sides => [{ active: 'Regirock ex', energy: { active: [FI] }, discard: [FI, FI, FI, F] }, { active: 'Dragapult ex' }];
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: Regi Charge');
  assert.ok(labels(g).every((l) => l === 'Fighting Energy'), `only Basic {F} Energy: ${labels(g).join(' | ')}`);
  pick(g, [FI, FI]);
  assert.deepEqual(energyNames(g, 0, 'active'), [FI, FI, FI]);
  assert.deepEqual(names(g, g.state.p[0].discard), [FI, F]);
  const none = scenario(dk, dk, layout());
  choose(none, 'Attack: Regi Charge');
  none.submit([]);
  assert.deepEqual(energyNames(none, 0, 'active'), [FI], "you don't have to attach any");
  assert.equal(none.state.p[0].discard.length, 4);
});

test('Regirock ex, Giant Rock: 140, or 280 if the Defending Pokémon is a Stage 2 Pokémon', () => {
  const dk = deck('me02.5-107', DRA, REG, 'me04-015');
  const run = (target: string): number => {
    const g = scenario(dk, dk, [{ active: 'Regirock ex', energy: { active: [FI, FI, FI, FI] } }, { active: target }]);
    choose(g, 'Attack: Giant Rock');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run('Dragapult ex'), 280);
  assert.equal(run('Registeel ex'), 140, 'a Basic');
  assert.equal(run('Mega Pyroar ex'), 140, 'a Stage 1');
});

// ------------------------------------------------------------------ Noibat

test('Noibat, Knickknack Carrying: finds a Pokémon Tool (only a Tool), reveals it, puts it into your hand', () => {
  const dk = deck('me02.5-156', BALLOON, BOSS, BALL, SLO);
  const g = scenario(dk, dk, [{ active: 'Noibat', energy: { active: [P] } }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Knickknack Carrying');
  assert.deepEqual([...new Set(labels(g))], ['Air Balloon'], 'only Pokémon Tools may be taken');
  choose(g, 'Air Balloon');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Air Balloon']);
  assert.ok(g.state.p[0].revealed.includes(g.state.p[0].hand[0]!), 'the card was not revealed');
});

// ------------------------------------------------------------------ Dartrix

test("Dartrix, Feather Shot: discards all its Energy, then 90 to 1 of the opponent's Pokémon of your choice (Weakness only on the Active)", () => {
  const dk = deck('me03-011', TYR, REG);
  const layout = (): Sides => [{ active: 'Dartrix', energy: { active: [G, F, W] } }, { active: 'Tyranitar ex', bench: ['Registeel ex'] }];
  const active = scenario(dk, dk, layout());
  choose(active, 'Attack: Feather Shot');
  assert.equal(active.state.p[0].active!.energy.length, 0);
  assert.deepEqual(names(active, active.state.p[0].discard), [F, G, W]);
  choose(active, 'Tyranitar ex');
  assert.equal(active.state.p[1].active!.damage, 180, "the Active takes Weakness: Tyranitar ex's Grass Weakness doubles 90");
  const bench = scenario(dk, dk, layout());
  choose(bench, 'Attack: Feather Shot');
  choose(bench, 'Registeel ex');
  assert.equal(bench.state.p[1].bench[0]!.damage, 90, 'Benched: no Weakness or Resistance (Registeel ex resists Grass)');
  assert.equal(bench.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Snorlax

test('Snorlax, Gormandizer: flip until tails, then up to that many Basic Energy from the deck onto it, then shuffle (0 heads: nothing)', () => {
  const dk = deck('me03-063', DRA);
  const layout = (): Sides => [{ active: 'Snorlax', energy: { active: [W] } }, { active: 'Dragapult ex' }];
  const two = scenario(dk, dk, layout());
  const before = two.state.p[0].deck.slice();
  two.state.forcedCoins = [true, true, false];
  choose(two, 'Attack: Gormandizer');
  pick(two, [F, G]);
  assert.deepEqual(energyNames(two, 0, 'active'), [F, G, W]);
  assert.equal(two.state.p[0].deck.length, before.length - 2);
  assert.notDeepEqual(two.state.p[0].deck, before.filter((c) => two.state.p[0].deck.includes(c)), 'the deck was not shuffled');
  const one = scenario(dk, dk, layout());
  one.state.forcedCoins = [true, false];
  choose(one, 'Attack: Gormandizer');
  assert.ok(labels(one).every((l) => l.endsWith('Energy')), 'only Basic Energy can be found');
  assert.throws(() => pick(one, [F, G]), 'a second card is more than the 1 heads');
  pick(one, [L]);
  assert.deepEqual(energyNames(one, 0, 'active'), [L, W]);
  const zero = scenario(dk, dk, layout());
  zero.state.forcedCoins = [false];
  choose(zero, 'Attack: Gormandizer');
  assert.deepEqual(energyNames(zero, 0, 'active'), [W]);
  assert.equal(zero.decision?.player, 1);
  const free = scenario(dk, dk, layout());
  free.state.forcedCoins = [true, false];
  choose(free, 'Attack: Gormandizer');
  free.submit([]);
  assert.deepEqual(energyNames(free, 0, 'active'), [W], "an attack's \"up to\" includes none");
});

test('Snorlax, Collapse: 160, and Snorlax is now Asleep', () => {
  const dk = deck('me03-063', DRA);
  const g = scenario(dk, dk, [{ active: 'Snorlax', energy: { active: [W, W, W, W] } }, { active: 'Dragapult ex' }]);
  g.state.forcedCoins = [false]; // the Asleep check at Pokémon Checkup: tails, it stays Asleep
  choose(g, 'Attack: Collapse');
  assert.equal(g.state.p[1].active!.damage, 160);
  assert.ok(g.state.p[0].active!.cond & ASLEEP);
  assert.equal(g.state.p[1].active!.cond & ASLEEP, 0, 'the Defending Pokémon is fine');
});

// ------------------------------------------------------------------ Mega Pyroar ex

test("Mega Pyroar ex, Ferocious Bellow: 80, and during the opponent's next turn the Defending Pokémon's attacks do 50 less damage", () => {
  const dk = deck('me04-015', DRA);
  const layout = (): Sides => [{ active: 'Mega Pyroar ex', energy: { active: [F, F] } }, { active: 'Dragapult ex', energy: { active: [P, P] } }];
  const control = scenario(dk, dk, layout(), { current: 1 });
  choose(control, 'Attack: Jet Headbutt');
  assert.equal(control.state.p[0].active!.damage, 70, 'control: Jet Headbutt does 70');
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: Ferocious Bellow');
  assert.equal(g.state.p[1].active!.damage, 80);
  assert.equal(g.decision?.player, 1);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[0].active!.damage, 20, '70 less 50');
});

test('Mega Pyroar ex, Fiery Big Bang: 290 less 10 for each damage counter on it', () => {
  const dk = deck('me04-015', DRA);
  const run = (damage: number): number => {
    const g = scenario(dk, dk, [{ active: 'Mega Pyroar ex', energy: { active: [F, F, F] }, damage: { active: damage } }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Fiery Big Bang');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(0), 290);
  assert.equal(run(40), 250);
  assert.equal(run(330), 0, 'never negative (it has 340 HP)');
});

// ------------------------------------------------------------------ Mega Floette ex

test("Mega Floette ex, Gentle Light: heals 30 from each Pokémon of both players (to a floor of 0), except one protected from the effects of attacks", () => {
  const dk = deck('me04-035', DRA, SLO, SHU);
  const g = scenario(dk, dk, [
    { active: 'Mega Floette ex', bench: ['Slowpoke'], energy: { active: [P] }, damage: { active: 50, 0: 20 } },
    { active: 'Dragapult ex', bench: ['Slowpoke', 'Shuppet'], damage: { active: 40, 0: 10, 1: 30 } },
  ]);
  choose(g, 'Attack: Gentle Light');
  assert.equal(g.state.p[0].active!.damage, 20);
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
  assert.equal(g.state.p[1].active!.damage, 10);
  assert.equal(g.state.p[1].bench[0]!.damage, 0);
  assert.equal(g.state.p[1].bench[1]!.damage, 30, "Hide 'n' Sneak: the attack's effect can't heal Shuppet");
});

test('Mega Floette ex, Eternity Bloom: 200, then up to 4 Basic {P} Energy from the deck onto your Benched Pokémon in any way you like (never the Active)', () => {
  const dk = deck('me04-035', DRA, SLO, REL);
  const layout = (): Sides => [{ active: 'Mega Floette ex', bench: ['Slowpoke', 'Rellor'], energy: { active: [P, P, P] } }, { active: 'Dragapult ex' }];
  const g = scenario(dk, dk, layout());
  const before = g.state.p[0].deck.slice();
  choose(g, 'Attack: Eternity Bloom');
  assert.equal(g.state.p[1].active!.damage, 200);
  assert.ok(labels(g).every((l) => l === 'Psychic Energy'), `only Basic {P} Energy: ${labels(g).join(' | ')}`);
  choose(g, 'Psychic Energy');
  assert.ok(!has(g, 'Mega Floette ex'), "the Active Pokémon isn't a Benched Pokémon");
  choose(g, 'Slowpoke');
  choose(g, 'Psychic Energy');
  choose(g, 'Rellor');
  g.submit([]); // the third pick: none
  g.submit([]); // the fourth pick: none
  assert.deepEqual(energyNames(g, 0, 0), [P]);
  assert.deepEqual(energyNames(g, 0, 1), [P]);
  assert.deepEqual(energyNames(g, 0, 'active'), [P, P, P]);
  assert.equal(g.state.p[0].deck.length, before.length - 2);
  assert.equal(g.decision?.player, 1);
  const all4 = scenario(dk, dk, layout());
  choose(all4, 'Attack: Eternity Bloom');
  for (let i = 0; i < 4; i++) {
    choose(all4, 'Psychic Energy');
    choose(all4, 'Slowpoke');
  }
  assert.deepEqual(energyNames(all4, 0, 0), [P, P, P, P], 'up to 4, all on the same Benched Pokémon if you like');
  assert.equal(all4.decision?.player, 1, 'a fifth card is not offered');
});

test('Mega Floette ex, Eternity Bloom: with no Benched Pokémon it is just 200 damage', () => {
  const dk = deck('me04-035', DRA);
  const g = scenario(dk, dk, [{ active: 'Mega Floette ex', energy: { active: [P, P, P] } }, { active: 'Dragapult ex' }]);
  const n = g.state.p[0].deck.length;
  choose(g, 'Attack: Eternity Bloom');
  assert.equal(g.state.p[1].active!.damage, 200);
  assert.equal(g.state.p[0].deck.length, n);
  assert.equal(g.decision?.player, 1, 'no search was offered');
});

// ------------------------------------------------------------------ Donphan

test("Donphan, No Reprieve: 20, and during your next turn its attacks do 120 more damage to the opponent's Active Pokémon", () => {
  const dk = deck('me04-045', TYR);
  const layout = (): Sides => [{ active: 'Donphan', energy: { active: [FI, FI, FI, FI] } }, { active: 'Tyranitar ex' }];
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: No Reprieve');
  assert.equal(g.state.p[1].active!.damage, 20);
  choose(g, 'End turn');
  choose(g, 'Attack: Smashing Headbutt');
  assert.equal(g.state.p[1].active!.damage, 20 + 180 + 120, 'Smashing Headbutt: 180, plus 120');
  const plain = scenario(dk, dk, layout());
  choose(plain, 'Attack: Smashing Headbutt');
  assert.equal(plain.state.p[1].active!.damage, 180, 'without No Reprieve first');
});

test('Donphan, Smashing Headbutt: 180, then you discard 2 Energy of your choice from it', () => {
  const dk = deck('me04-045', TYR);
  const g = scenario(dk, dk, [{ active: 'Donphan', energy: { active: [FI, F, W, W, L] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Smashing Headbutt');
  pick(g, [F, L]);
  assert.deepEqual(energyNames(g, 0, 'active'), [FI, W, W]);
});

// ------------------------------------------------------------------ Mega Gallade ex

test('Mega Gallade ex, Gale Slash: 50, or 200 if it has no damage counters on it', () => {
  const dk = deck('me04-048', DRA);
  const run = (damage: number): number => {
    const g = scenario(dk, dk, [{ active: 'Mega Gallade ex', energy: { active: [FI] }, damage: { active: damage } }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Gale Slash');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(0), 200);
  assert.equal(run(10), 50);
});
