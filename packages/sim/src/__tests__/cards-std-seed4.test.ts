/**
 * Card tests, batch "std-seed4": every card scripted in cards/scripts/std-seed4.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
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
function endTurn(g: Game): void {
  choose(g, 'End turn');
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
function benchNames(g: Game, p: 0 | 1): string[] {
  return g.state.p[p].bench.map((b) => name(g, topCard(b)));
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]) {
  return fromIds('seed4', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting, Retreat 3 -- a target with no Resistance and no Weakness to anything but Fighting
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass, Retreat 3 -- the target for Fighting attackers
const REG = 'me02.5-145'; // Registeel ex: 230 HP, Metal
const SLO = 'me05-029'; // Slowpoke: 70 HP, Psychic, Headbutt for {C}{C} 20
const REL = 'sv08-013'; // Rellor: 40 HP, Grass
const DUN = 'sv08.5-079'; // Dunsparce: 60 HP, Retreat 0
const BOSS = 'me01-114'; // Boss's Orders (Supporter)
const BALL = 'me01-131'; // Ultra Ball (Item)
const BALLOON = 'me01-166'; // Air Balloon (Tool: Retreat Cost -2)
const TELE = 'me03-088'; // Telepathic Psychic Energy (Special Energy)
type Sides = [SideLayout, SideLayout];

const F = 'Fire Energy';
const P = 'Psychic Energy';
const W = 'Water Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const FI = 'Fighting Energy';
const L = 'Lightning Energy';
const G = 'Grass Energy';
const SPECIAL = 'Telepathic Psychic Energy';

// ------------------------------------------------------------------ Marshadow

test("Marshadow, Shadowy Knot: 30 for each {C} in the Defending Pokémon's Retreat Cost, as modified (Air Balloon) -- zero cost, zero damage", () => {
  const dk = deck('me05-040', URSA, DUN, BALLOON);
  const hit = (defender: SideLayout): number => {
    const g = scenario(dk, dk, [{ active: 'Marshadow', energy: { active: [P] } }, defender]);
    choose(g, 'Attack: Shadowy Knot');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit({ active: 'Bloodmoon Ursaluna ex' }), 90, 'Retreat Cost 3');
  // Compendium #1620 (Leafeon VMAX, Grass Knot): the damage follows the Retreat Cost as it is now, not the printed one.
  assert.equal(hit({ active: 'Bloodmoon Ursaluna ex', tools: { active: ['Air Balloon'] } }), 30, 'Retreat Cost 3 - 2 = 1');
  assert.equal(hit({ active: 'Dunsparce' }), 0, 'Retreat Cost 0');
});

// ------------------------------------------------------------------ Trumbeak

test("Trumbeak, Fly: heads is 30 and prevents all damage and effects of attacks next turn; tails does nothing at all", () => {
  const dk = deck('me05-067', SLO, 'sv06-109');
  const run = (heads: boolean, oppAttack: string): Game => {
    const g = scenario(dk, dk, [{ active: 'Trumbeak', energy: { active: [P] } }, { active: oppAttack === 'Headbutt' ? 'Slowpoke' : 'Glimmora', energy: { active: [P, P] } }]);
    g.state.forcedCoins = [heads, true];
    choose(g, 'Attack: Fly');
    assert.equal(g.state.p[1].active!.damage, heads ? 30 : 0, heads ? '30 damage on heads' : 'tails: the attack does nothing');
    choose(g, `Attack: ${oppAttack}`);
    return g;
  };
  assert.equal(run(true, 'Headbutt').state.p[0].active!.damage, 0, 'heads: no damage from the attack');
  assert.equal(run(false, 'Headbutt').state.p[0].active!.damage, 20, 'tails: no protection');
  // "damage from and effects of": Glimmora's Stun Poison (heads) does nothing to a protected Trumbeak.
  assert.equal(run(true, 'Stun Poison').state.p[0].active!.cond, 0, 'heads: the effects are prevented too');
  assert.equal(run(false, 'Stun Poison').state.p[0].active!.cond & (PARALYZED | POISONED), PARALYZED | POISONED, 'tails: Paralyzed and Poisoned');
});

// ------------------------------------------------------------------ Scyther

test("Scyther, Slashing Strike: 60, then this Pokémon can't use Slashing Strike during your next turn only (Cut Up is still allowed)", () => {
  const dk = deck('sv05-001', URSA);
  const g = scenario(dk, dk, [{ active: 'Scyther', energy: { active: [G, G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(has(g, 'Attack: Slashing Strike'));
  choose(g, 'Attack: Slashing Strike');
  assert.equal(g.state.p[1].active!.damage, 60);
  endTurn(g); // the opponent's turn
  assert.equal(g.decision?.player, 0);
  assert.ok(has(g, 'Attack: Cut Up'), 'Cut Up is a different attack');
  assert.ok(!has(g, 'Attack: Slashing Strike'), 'Slashing Strike offered on my next turn');
  endTurn(g);
  endTurn(g); // the opponent's turn again
  assert.ok(has(g, 'Attack: Slashing Strike'), 'the restriction lasted one turn only');
});

// ------------------------------------------------------------------ Dhelmise

test('Dhelmise, Steel Anchor: 80, or 160 with any {M} Pokémon on your Bench (not the opponent\'s, not a non-Metal one)', () => {
  const dk = deck('sv05-019', URSA, REG, REL);
  const run = (mine: string[], theirs: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Dhelmise', bench: mine, energy: { active: [G, G, G] } }, { active: 'Bloodmoon Ursaluna ex', bench: theirs }]);
    choose(g, 'Attack: Steel Anchor');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(['Registeel ex'], []), 160);
  assert.equal(run(['Rellor', 'Registeel ex'], []), 160, 'one {M} Pokémon among others is enough');
  assert.equal(run(['Rellor'], []), 80);
  assert.equal(run([], []), 80);
  assert.equal(run([], ['Registeel ex']), 80, "the opponent's Bench doesn't count");
});

// ------------------------------------------------------------------ Victini

test('Victini, Flippity Flap: your hand is shuffled into your deck, then you draw 6', () => {
  const dk = deck('sv05-030', URSA, BOSS, BALL);
  const g = scenario(dk, dk, [{ active: 'Victini', energy: { active: [F] }, hand: ["Boss's Orders", 'Ultra Ball', 'Fire Energy'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Flippity Flap');
  assert.equal(g.state.p[0].hand.length, 6, 'drew 6 after putting the 3 back');
  assert.equal(g.state.p[0].deck.length, deckBefore + 3 - 6);
  assert.equal(g.state.p[0].discard.length, 0, 'nothing was discarded');
  // An empty hand just draws 6.
  const h = scenario(dk, dk, [{ active: 'Victini', energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(h, 'Attack: Flippity Flap');
  assert.equal(h.state.p[0].hand.length, 6);
});

test('Victini, Singe Off: 30, and a Special Energy (not a Basic one) is discarded from the Defending Pokémon', () => {
  const dk = deck('sv05-030', URSA, SLO, TELE);
  const g = scenario(dk, dk, [{ active: 'Victini', energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: [F, SPECIAL, W] } }]);
  choose(g, 'Attack: Singe Off');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.deepEqual(energyNames(g, 1, 'active'), [F, W]);
  assert.deepEqual(names(g, g.state.p[1].discard), [SPECIAL], "to the Defending Pokémon's owner's discard pile");
  const basic = scenario(dk, dk, [{ active: 'Victini', energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: [F, W] } }]);
  choose(basic, 'Attack: Singe Off');
  assert.deepEqual(energyNames(basic, 1, 'active'), [F, W], 'only a Special Energy may be discarded');
  assert.equal(basic.state.p[1].discard.length, 0);
  // A Special Energy on the Bench is not on the Defending Pokémon.
  const bench = scenario(dk, dk, [{ active: 'Victini', energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'], energy: { 0: [SPECIAL] } }]);
  choose(bench, 'Attack: Singe Off');
  assert.deepEqual(energyNames(bench, 1, 0), [SPECIAL]);
});

// ------------------------------------------------------------------ Frosmoth

test("Frosmoth, Freezing Chill: 100, and the Defending Pokémon can't attack during the opponent's next turn only", () => {
  const dk = deck('sv05-046', URSA);
  const layout = (): Sides => [{ active: 'Frosmoth', energy: { active: [W, W] } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: [P, P, P, P, P] } }];
  const control = scenario(dk, dk, layout(), { current: 1 });
  assert.ok(has(control, 'Attack: Blood Moon'), 'control: Ursaluna should be able to attack');
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: Freezing Chill');
  assert.equal(g.state.p[1].active!.damage, 100);
  assert.equal(g.decision?.player, 1);
  assert.ok(!has(g, 'Attack:'), 'an attack was offered under Freezing Chill');
  endTurn(g);
  endTurn(g);
  assert.equal(g.decision?.player, 1);
  assert.ok(has(g, 'Attack: Blood Moon'), 'the lock outlived the opponent\'s next turn');
});

// ------------------------------------------------------------------ Reuniclus

const SUMMON_TOP = ['Tyranitar ex', 'Slowpoke', 'Fire Energy', "Boss's Orders", 'Rellor', 'Fire Energy', 'Ultra Ball', 'Slowpoke', 'Dunsparce'];
const reuniclus = (bench: string[]): Game => {
  const dk = deck('sv05-072', TYR, SLO, REL, DUN, BOSS, BALL);
  return scenario(dk, dk, [{ active: 'Reuniclus', bench, energy: { active: [P] }, deckTop: SUMMON_TOP }, { active: 'Slowpoke' }]);
};

test('Reuniclus, Summoning Gate: any number of the top 8 cards\' Pokémon go onto the Bench -- of any Stage -- and the rest are shuffled back', () => {
  const g = reuniclus([]);
  const top8 = g.state.p[0].deck.slice(-8);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Summoning Gate');
  // Only Pokémon among the top 8 are offered (the 9th card, Dunsparce, is not looked at). Ruling #1959: non-Basic Pokémon are allowed.
  assert.deepEqual(labels(g).sort(), ['Rellor', 'Slowpoke', 'Slowpoke', 'Tyranitar ex']);
  pick(g, ['Tyranitar ex', 'Rellor', 'Slowpoke']);
  assert.deepEqual(benchNames(g, 0), ['Tyranitar ex', 'Rellor', 'Slowpoke']);
  assert.equal(g.state.p[0].deck.length, deckBefore - 3);
  assert.equal(g.state.p[0].bench[0]!.cards.length, 1, 'put onto the Bench as a lone card, not evolved from anything');
  const benched = g.state.p[0].bench.map(topCard);
  const rest = top8.filter((c) => !benched.includes(c));
  assert.equal(rest.length, 5);
  assert.ok(rest.every((c) => g.state.p[0].deck.includes(c)), 'the other 5 cards were shuffled back into the deck');
  assert.ok(g.state.p[0].deck.some((c) => name(g, c) === 'Dunsparce'));
});

test('Reuniclus, Summoning Gate: you may take none -- and only as many as the Bench has room for (Compendium #1962)', () => {
  const none = reuniclus([]);
  choose(none, 'Attack: Summoning Gate');
  none.submit([]);
  assert.deepEqual(benchNames(none, 0), []);
  // Ruling (TPCi Rules Team 2024-03-21, #1962): Put found Pokémon onto Bench up to capacity.
  const three = reuniclus(['Slowpoke', 'Slowpoke', 'Rellor']);
  choose(three, 'Attack: Summoning Gate');
  assert.equal(three.decision?.max, 2, 'two spaces left on the Bench');
  pick(three, ['Tyranitar ex', 'Rellor']);
  assert.equal(three.state.p[0].bench.length, 5);
});

test('Reuniclus, Summoning Gate: with a full Bench the attack does nothing -- you do not even look at the cards, so the deck is not shuffled (Compendium #1962)', () => {
  const g = reuniclus(['Slowpoke', 'Slowpoke', 'Rellor', 'Rellor', 'Dunsparce']);
  const before = g.state.p[0].deck.slice();
  choose(g, 'Attack: Summoning Gate');
  assert.equal(g.decision?.player, 1, 'no question: the turn passed');
  assert.deepEqual(g.state.p[0].deck.slice(0, before.length - 1), before.slice(0, before.length - 1), 'the deck was not shuffled');
});

test("Reuniclus, Brain Shake: 100, and the Defending Pokémon is Confused", () => {
  const dk = deck('sv05-072', URSA);
  const g = scenario(dk, dk, [{ active: 'Reuniclus', energy: { active: [P, P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Brain Shake');
  assert.equal(g.state.p[1].active!.damage, 100);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Raging Bolt ex

test('Raging Bolt ex, Burst Roar: your whole hand is discarded, then you draw 6', () => {
  const dk = deck('sv05-123', URSA, BOSS, BALL);
  const g = scenario(dk, dk, [{ active: 'Raging Bolt ex', energy: { active: [L] }, hand: ["Boss's Orders", 'Ultra Ball'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Burst Roar');
  assert.deepEqual(names(g, g.state.p[0].discard), ["Boss's Orders", 'Ultra Ball']);
  assert.equal(g.state.p[0].hand.length, 6);
});

test('Raging Bolt ex, Bellowing Thunder: you may discard any amount of Basic Energy from any of your Pokémon, 70 for each (Special Energy is not offered)', () => {
  const dk = deck('sv05-123', URSA, SLO, TELE);
  const layout = (): Sides => [
    { active: 'Raging Bolt ex', bench: ['Slowpoke'], energy: { active: [L, FI, F], 0: [W, SPECIAL] } },
    { active: 'Bloodmoon Ursaluna ex' },
  ];
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: Bellowing Thunder');
  assert.deepEqual(labels(g).sort(), ['Fighting Energy on Raging Bolt ex', 'Fire Energy on Raging Bolt ex', 'Lightning Energy on Raging Bolt ex', 'Water Energy on Slowpoke']);
  pick(g, ['Fire Energy', 'Water Energy', 'Fighting Energy']);
  assert.equal(g.state.p[1].active!.damage, 210, '3 cards x 70');
  assert.deepEqual(energyNames(g, 0, 'active'), [L], 'the three picked cards were discarded, wherever they were attached');
  assert.deepEqual(energyNames(g, 0, 0), [SPECIAL]);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, FI, W].sort());
  const zero = scenario(dk, dk, layout());
  choose(zero, 'Attack: Bellowing Thunder');
  zero.submit([]);
  assert.equal(zero.state.p[1].active!.damage, 0, 'discarding none is allowed: 0 damage');
  assert.equal(zero.state.p[0].discard.length, 0);
});

test('Raging Bolt ex, Bellowing Thunder: the damage is done first and the Energy discarded afterwards (TPCi 2026-07-16, #2423: Ancient Bulwark)', () => {
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2423/): Damage happens before Energy is discarded.
  // Bastiodon (Bench) prevents damage from attackers with 2 or less Energy: Raging Bolt ex has 3 when it hits, 0 once they are discarded.
  const dk = deck('sv05-123', REG, 'me05-062', 'me05-061', 'me05-072');
  const opp = (): SideLayout => ({ active: 'Registeel ex', bench: ['Antique Armor Fossil'], evolve: { 0: ['Shieldon', 'Bastiodon'] } });
  const g = scenario(dk, dk, [{ active: 'Raging Bolt ex', energy: { active: [L, FI, F] } }, opp()]);
  choose(g, 'Attack: Bellowing Thunder');
  pick(g, ['Lightning Energy', 'Fighting Energy', 'Fire Energy']);
  assert.equal(g.state.p[1].active!.damage, 210, 'the damage went through');
  assert.equal(g.state.p[0].active!.energy.length, 0);
  // Control: with only 2 Energy attached when it hits, Ancient Bulwark does stop it -- the Bastiodon is really protecting.
  const c = scenario(dk, dk, [{ active: 'Raging Bolt ex', energy: { active: [L, FI] } }, opp()]);
  choose(c, 'Attack: Bellowing Thunder');
  pick(c, ['Lightning Energy', 'Fighting Energy']);
  assert.equal(c.state.p[1].active!.damage, 0, 'prevented by Ancient Bulwark');
  assert.equal(c.state.p[0].active!.energy.length, 0, 'the Energy was still discarded');
});

// ------------------------------------------------------------------ Unfezant

test("Unfezant, Opposing Winds: 70, and you may put 2 Energy of your choice from the Defending Pokémon into their hand", () => {
  const dk = deck('sv05-135', URSA);
  const layout = (e: string[]): Sides => [{ active: 'Unfezant', energy: { active: [P, P] } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: e } }];
  const g = scenario(dk, dk, layout([F, W, W]));
  const attached = g.state.p[1].active!.energy.slice();
  choose(g, 'Attack: Opposing Winds');
  assert.equal(g.state.p[1].active!.damage, 70);
  yes(g);
  pick(g, [F, W]);
  assert.deepEqual(energyNames(g, 1, 'active'), [W]);
  const moved = attached.filter((c) => !g.state.p[1].active!.energy.includes(c));
  assert.deepEqual(names(g, moved), [F, W].sort());
  assert.ok(moved.every((c) => g.state.p[1].hand.includes(c)), 'into their hand, not the discard pile');
  assert.equal(g.state.p[1].discard.length, 0);
  // "You may": declining leaves the Energy.
  const n = scenario(dk, dk, layout([F, W, W]));
  choose(n, 'Attack: Opposing Winds');
  no(n);
  assert.deepEqual(energyNames(n, 1, 'active'), [F, W, W].sort());
  // Identical Energy need no choice; fewer than 2 attached: as many as there are.
  const same = scenario(dk, dk, layout([W, W, W]));
  choose(same, 'Attack: Opposing Winds');
  yes(same);
  assert.deepEqual(energyNames(same, 1, 'active'), [W]);
  const one = scenario(dk, dk, layout([F]));
  choose(one, 'Attack: Opposing Winds');
  yes(one);
  assert.deepEqual(energyNames(one, 1, 'active'), []);
  // No Energy attached: the question isn't even asked.
  const zero = scenario(dk, dk, layout([]));
  choose(zero, 'Attack: Opposing Winds');
  assert.equal(zero.decision?.player, 1);
  assert.equal(zero.state.p[1].active!.damage, 70);
});

test("Unfezant, Boundless Power: 180, and this Pokémon can't attack during your next turn only", () => {
  const dk = deck('sv05-135', URSA);
  const g = scenario(dk, dk, [{ active: 'Unfezant', energy: { active: [P, P, P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Boundless Power');
  assert.equal(g.state.p[1].active!.damage, 180);
  endTurn(g);
  assert.equal(g.decision?.player, 0);
  assert.ok(!has(g, 'Attack:'), 'Unfezant attacked on my next turn');
  endTurn(g);
  endTurn(g);
  assert.ok(has(g, 'Attack: Opposing Winds') && has(g, 'Attack: Boundless Power'), 'the turn after, it can attack again');
});

// ------------------------------------------------------------------ Leafeon

test('Leafeon, Leaflet Blessings: a Basic {G} Energy from your hand to a Benched Pokémon of your choice, which is healed of all damage', () => {
  const dk = deck('sv06-011', SLO, REL, URSA);
  const layout = (hand: string[], bench: string[]): Sides => [
    { active: 'Leafeon', bench, energy: { active: [G] }, hand, damage: { active: 20, 0: 50, 1: 10 } },
    { active: 'Bloodmoon Ursaluna ex' },
  ];
  const g = scenario(dk, dk, layout([G, G, F], ['Slowpoke', 'Rellor']));
  choose(g, 'Attack: Leaflet Blessings');
  assert.deepEqual(labels(g), [G, G], 'only Basic Grass Energy cards are offered');
  choose(g, G);
  choose(g, 'Slowpoke');
  assert.deepEqual(energyNames(g, 0, 0), [G]);
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'all damage healed from that Pokémon');
  assert.equal(g.state.p[0].bench[1]!.damage, 10, 'the other Benched Pokémon is untouched');
  assert.equal(g.state.p[0].active!.damage, 20, 'and so is Leafeon');
  assert.deepEqual(names(g, g.state.p[0].hand), [F, G].sort(), 'one Grass Energy attached, the rest of the hand stays');
  // No Basic {G} Energy in hand, or no Benched Pokémon: nothing is attached and nothing is healed.
  const noG = scenario(dk, dk, layout([F], ['Slowpoke']));
  choose(noG, 'Attack: Leaflet Blessings');
  assert.equal(noG.decision?.player, 1);
  assert.equal(noG.state.p[0].bench[0]!.damage, 50);
  const noBench = scenario(dk, dk, layout([G], []));
  choose(noBench, 'Attack: Leaflet Blessings');
  assert.equal(noBench.decision?.player, 1);
  assert.deepEqual(names(noBench, noBench.state.p[0].hand), [G]);
});

// ------------------------------------------------------------------ Iron Leaves

test('Iron Leaves, Recovery Net: up to 2 Pokémon (no other cards) from your discard pile into your hand', () => {
  const dk = deck('sv06-019', URSA, SLO, REL, BOSS);
  const layout = (): Sides => [{ active: 'Iron Leaves', energy: { active: [G] }, discard: ['Slowpoke', 'Rellor', "Boss's Orders", 'Slowpoke', 'Fire Energy'] }, { active: 'Bloodmoon Ursaluna ex' }];
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: Recovery Net');
  assert.deepEqual(labels(g).sort(), ['Rellor', 'Slowpoke', 'Slowpoke']);
  pick(g, ['Rellor', 'Slowpoke']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Rellor', 'Slowpoke']);
  assert.deepEqual(names(g, g.state.p[0].discard), ["Boss's Orders", 'Fire Energy', 'Slowpoke']);
  const none = scenario(dk, dk, layout());
  choose(none, 'Attack: Recovery Net');
  none.submit([]); // "up to 2" on an attack is 0 to 2
  assert.equal(none.state.p[0].hand.length, 0);
});

test("Iron Leaves, Avenging Edge: 100, or 160 if one of your Pokémon was Knocked Out by damage from an attack during your opponent's last turn", () => {
  const dk = deck('sv06-019', URSA, REL);
  const plain = scenario(dk, dk, [{ active: 'Iron Leaves', energy: { active: [G, G, G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(plain, 'Attack: Avenging Edge');
  assert.equal(plain.state.p[1].active!.damage, 100);
  // The opponent's Ursaluna (Blood Moon, 240) Knocks Out my Rellor (40 HP); Iron Leaves steps up and avenges it.
  const g = scenario(dk, dk, [{ active: 'Rellor', bench: ['Iron Leaves'], energy: { 0: [G, G, G] } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: [P, P, P, P, P] } }], { current: 1, turn: 4 });
  choose(g, 'Attack: Blood Moon');
  while (g.decision && g.decision.player === 0 && g.state.current === 1) choose(g, 'Iron Leaves');
  while (g.decision && g.state.current === 0 && !has(g, 'Attack: Avenging Edge')) g.submit([0]);
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Iron Leaves');
  assert.equal(g.state.p[1].prizesTaken, 1);
  choose(g, 'Attack: Avenging Edge');
  assert.equal(g.state.p[1].active!.damage, 160, '100 + 60');
});

// ------------------------------------------------------------------ Teal Mask Ogerpon

test('Teal Mask Ogerpon, Mountain Stroll: up to 2 Basic Energy cards from the deck, revealed, into your hand (no Special Energy), then shuffle', () => {
  const dk = deck('sv06-024', URSA, TELE);
  const g = scenario(dk, dk, [{ active: 'Teal Mask Ogerpon', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Mountain Stroll');
  assert.ok(!labels(g).includes(SPECIAL), 'a Special Energy was offered');
  assert.ok(labels(g).every((l) => l.endsWith(' Energy')));
  const deckBefore = g.state.p[0].deck.length;
  pick(g, [F, W]);
  assert.deepEqual(names(g, g.state.p[0].hand), [F, W].sort());
  assert.deepEqual(names(g, g.state.p[0].hand.filter((c) => g.state.p[0].revealed.includes(c))), [F, W].sort(), 'revealed');
  assert.equal(g.state.p[0].deck.length, deckBefore - 2);
  const one = scenario(dk, dk, [{ active: 'Teal Mask Ogerpon', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(one, 'Attack: Mountain Stroll');
  pick(one, [M]);
  assert.deepEqual(names(one, one.state.p[0].hand), [M], '"up to 2" can be 1');
});

test("Teal Mask Ogerpon, Ogre Comeback: 20 more damage for each of the opponent's Benched Pokémon", () => {
  const dk = deck('sv06-024', URSA, SLO, REL);
  const run = (mine: string[], theirs: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Teal Mask Ogerpon', bench: mine, energy: { active: [G, G] } }, { active: 'Bloodmoon Ursaluna ex', bench: theirs }]);
    choose(g, 'Attack: Ogre Comeback');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([], []), 20);
  assert.equal(run([], ['Slowpoke', 'Rellor', 'Slowpoke']), 80);
  assert.equal(run(['Slowpoke', 'Slowpoke'], ['Rellor']), 40, 'my own Bench is not counted');
});

// ------------------------------------------------------------------ Phione

test('Phione, Beckon: a Supporter card (only a Supporter) from your discard pile into your hand', () => {
  const dk = deck('sv06-055', URSA, BOSS, BALL, SLO);
  const g = scenario(dk, dk, [{ active: 'Phione', energy: { active: [W] }, discard: ["Boss's Orders", "Boss's Orders", 'Ultra Ball', 'Slowpoke'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Beckon');
  assert.equal(g.decision?.kind, 'cards');
  assert.deepEqual(labels(g), ["Boss's Orders", "Boss's Orders"]);
  choose(g, "Boss's Orders");
  assert.deepEqual(names(g, g.state.p[0].hand), ["Boss's Orders"]);
  assert.deepEqual(names(g, g.state.p[0].discard), ["Boss's Orders", 'Slowpoke', 'Ultra Ball']);
  const none = scenario(dk, dk, [{ active: 'Phione', energy: { active: [W] }, discard: ['Ultra Ball'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(none, 'Attack: Beckon');
  assert.equal(none.decision?.player, 1, 'no Supporter in the discard pile: nothing happens');
});

test("Phione, Energy Press: 20 for each Energy attached to the Defending Pokémon (not this Pokémon's)", () => {
  const dk = deck('sv06-055', URSA);
  const run = (e: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Phione', energy: { active: [W, W] } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: e } }]);
    choose(g, 'Attack: Energy Press');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([F, F, W]), 60);
  assert.equal(run([]), 0);
});

// ------------------------------------------------------------------ Gurdurr

test('Gurdurr, Superpower: 50; you may do 30 more, and if you do, it also does 30 damage to itself', () => {
  const dk = deck('sv06-104', TYR);
  const layout = (): Sides => [{ active: 'Gurdurr', energy: { active: [FI, FI, FI] } }, { active: 'Tyranitar ex' }];
  const more = scenario(dk, dk, layout());
  choose(more, 'Attack: Superpower');
  yes(more);
  assert.equal(more.state.p[1].active!.damage, 80);
  assert.equal(more.state.p[0].active!.damage, 30, "30 to itself (its own Weakness doesn't apply to its own attack)");
  const base = scenario(dk, dk, layout());
  choose(base, 'Attack: Superpower');
  no(base);
  assert.equal(base.state.p[1].active!.damage, 50);
  assert.equal(base.state.p[0].active!.damage, 0, 'no recoil unless you took the 30 more');
});

// ------------------------------------------------------------------ Hawlucha, Tapu Koko

test('Hawlucha, Prize Count: 50, or 140 if you have MORE Prize cards remaining than your opponent (not equal, not fewer)', () => {
  const dk = deck('sv06-107', TYR);
  const run = (mine: number, theirs: number): number => {
    const g = scenario(dk, dk, [{ active: 'Hawlucha', energy: { active: [FI, FI] }, prizes: mine }, { active: 'Tyranitar ex', prizes: theirs }]);
    choose(g, 'Attack: Prize Count');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(4, 3), 140);
  assert.equal(run(6, 1), 140);
  assert.equal(run(3, 3), 50, 'equal');
  assert.equal(run(2, 4), 50, 'fewer');
});

test('Tapu Koko, Prize Count: 90, or 180 if you have more Prize cards remaining than your opponent', () => {
  const dk = deck('sv08-065', URSA);
  const run = (mine: number, theirs: number): number => {
    const g = scenario(dk, dk, [{ active: 'Tapu Koko', energy: { active: [L, L, L] }, prizes: mine }, { active: 'Bloodmoon Ursaluna ex', prizes: theirs }]);
    choose(g, 'Attack: Prize Count');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(5, 4), 180);
  assert.equal(run(4, 4), 90);
  assert.equal(run(3, 5), 90);
});

test('Tapu Koko, Summon Lightning: up to 2 {L} Pokémon from the deck (no other Pokémon, no Energy), revealed, into your hand', () => {
  const dk = deck('sv08-065', 'sv08-060', SLO, URSA);
  const g = scenario(dk, dk, [{ active: 'Tapu Koko', energy: { active: [L] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Summon Lightning');
  assert.ok(labels(g).length > 0 && labels(g).every((l) => l === 'Tapu Koko' || l === 'Magnezone'), `only {L} Pokémon: ${labels(g)}`);
  pick(g, ['Magnezone', 'Tapu Koko']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Magnezone', 'Tapu Koko']);
  assert.equal(g.state.p[0].revealed.length, 2);
});

// ------------------------------------------------------------------ Glimmora

test('Glimmora, Stun Poison: heads makes the Defending Pokémon Paralyzed AND Poisoned; tails does nothing', () => {
  const dk = deck('sv06-109', TYR);
  const run = (heads: boolean): number => {
    const g = scenario(dk, dk, [{ active: 'Glimmora', energy: { active: [FI] } }, { active: 'Tyranitar ex' }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Stun Poison');
    return g.state.p[1].active!.cond;
  };
  assert.equal(run(true) & (PARALYZED | POISONED), PARALYZED | POISONED);
  assert.equal(run(false), 0);
});

test('Glimmora, Venoshock: 30, or 130 if the Defending Pokémon is Poisoned (Poison puts 1 counter on it at Checkup)', () => {
  const dk = deck('sv06-109', TYR);
  const run = (cond: number): number => {
    const g = scenario(dk, dk, [{ active: 'Glimmora', energy: { active: [FI] } }, { active: 'Tyranitar ex', cond }]);
    choose(g, 'Attack: Venoshock');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(POISONED), 130 + 10, '30 + 100, then the Poison Checkup');
  assert.equal(run(0), 30);
  assert.equal(run(CONFUSED), 30, 'another Special Condition is not Poison');
});

// ------------------------------------------------------------------ Scolipede

test('Scolipede, Dastardly Jab: damage counters are placed until the Defending Pokémon has 10 HP left (never healing)', () => {
  const dk = deck('sv06-117', URSA);
  const run = (damage: number): number => {
    const g = scenario(dk, dk, [{ active: 'Scolipede', energy: { active: [D, D] } }, { active: 'Bloodmoon Ursaluna ex', damage: { active: damage } }]);
    choose(g, 'Attack: Dastardly Jab');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(0), 250, '260 HP: 10 left');
  assert.equal(run(100), 250);
  assert.equal(run(240), 250);
  assert.equal(run(250), 250, 'already at 10 HP: nothing is added or removed');
});

// ------------------------------------------------------------------ Varoom

test('Varoom, Metal Coating: a Basic {M} Energy card (no other Energy) from your discard pile is attached to this Pokémon', () => {
  const dk = deck('sv06-124', URSA, TELE);
  const g = scenario(dk, dk, [{ active: 'Varoom', energy: { active: [M] }, discard: [M, F, SPECIAL, M] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Metal Coating');
  assert.ok(labels(g).every((l) => l === M), `only Basic Metal Energy: ${labels(g)}`);
  choose(g, M);
  assert.deepEqual(energyNames(g, 0, 'active'), [M, M]);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, M, SPECIAL].sort());
  const none = scenario(dk, dk, [{ active: 'Varoom', energy: { active: [M] }, discard: [F, SPECIAL] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(none, 'Attack: Metal Coating');
  assert.equal(none.decision?.player, 1);
  assert.deepEqual(energyNames(none, 0, 'active'), [M]);
});

// ------------------------------------------------------------------ Sylveon

test("Sylveon, Mystical Return: heads -- you choose 1 of the opponent's Benched Pokémon and it, with everything attached, is shuffled into their deck", () => {
  const dk = deck('sv06.5-022', URSA, SLO, REL, BALLOON);
  const layout = (): Sides => [
    { active: 'Sylveon', energy: { active: [P] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke', 'Rellor'], energy: { 0: [F] }, tools: { 0: ['Air Balloon'] } },
  ];
  const g = scenario(dk, dk, layout());
  g.state.forcedCoins = [true];
  const deckBefore = g.state.p[1].deck.length;
  choose(g, 'Attack: Mystical Return');
  choose(g, 'Slowpoke');
  assert.deepEqual(benchNames(g, 1), ['Rellor']);
  assert.equal(g.state.p[1].deck.length, deckBefore + 3 - 1, 'Pokémon, Energy and Tool all went into their deck (and they drew 1 for their turn)');
  assert.equal(g.state.p[1].discard.length, 0);
  assert.equal(g.state.p[1].hand.length, 1, 'only their draw for the turn');
  const tails = scenario(dk, dk, layout());
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Mystical Return');
  assert.deepEqual(benchNames(tails, 1), ['Slowpoke', 'Rellor']);
  // Nothing on the Bench: nothing to choose.
  const bare = scenario(dk, dk, [{ active: 'Sylveon', energy: { active: [P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  bare.state.forcedCoins = [true];
  choose(bare, 'Attack: Mystical Return');
  assert.equal(bare.decision?.player, 1);
});

test("Sylveon, Mystical Return: a Benched Pokémon with Hide 'n' Sneak is not affected", () => {
  const dk = deck('sv06.5-022', URSA, 'me05-033');
  const g = scenario(dk, dk, [{ active: 'Sylveon', energy: { active: [P] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Shuppet'] }]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Mystical Return');
  assert.deepEqual(benchNames(g, 1), ['Shuppet'], 'the effect was prevented');
});

test('Sylveon, Disarming Voice: 90, and the Defending Pokémon is Confused', () => {
  const dk = deck('sv06.5-022', URSA);
  const g = scenario(dk, dk, [{ active: 'Sylveon', energy: { active: [P, P, P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Disarming Voice');
  assert.equal(g.state.p[1].active!.damage, 90);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Haxorus

test('Haxorus, Bring Down the Axe: a Defending Pokémon with any Special Energy attached is Knocked Out; with only Basic Energy it is not', () => {
  const dk = deck('sv06.5-046', URSA, SLO, TELE);
  const special = scenario(dk, dk, [{ active: 'Haxorus', energy: { active: [FI] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'], energy: { active: [F, SPECIAL] } }]);
  choose(special, 'Attack: Bring Down the Axe');
  assert.equal(special.state.p[0].prizesTaken, 2, 'Bloodmoon Ursaluna ex was Knocked Out: 2 Prize cards');
  choose(special, 'Slowpoke'); // promote
  assert.equal(name(special, topCard(special.state.p[1].active!)), 'Slowpoke');
  const basic = scenario(dk, dk, [{ active: 'Haxorus', energy: { active: [FI] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'], energy: { active: [F, F] } }]);
  choose(basic, 'Attack: Bring Down the Axe');
  assert.equal(basic.state.p[0].prizesTaken, 0);
  assert.equal(name(basic, topCard(basic.state.p[1].active!)), 'Bloodmoon Ursaluna ex');
  // The Special Energy has to be on the Defending Pokémon, not on its Bench.
  const bench = scenario(dk, dk, [{ active: 'Haxorus', energy: { active: [FI] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'], energy: { active: [F], 0: [SPECIAL] } }]);
  choose(bench, 'Attack: Bring Down the Axe');
  assert.equal(bench.state.p[0].prizesTaken, 0);
});

test('Haxorus, Dragon Pulse: 230, then the top 3 cards of your deck are discarded', () => {
  const dk = deck('sv06.5-046', URSA);
  const g = scenario(dk, dk, [{ active: 'Haxorus', energy: { active: [FI, M] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  const top3 = g.state.p[0].deck.slice(-3);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Dragon Pulse');
  assert.equal(g.state.p[1].active!.damage, 230);
  assert.equal(g.state.p[0].deck.length, deckBefore - 3);
  assert.deepEqual(g.state.p[0].discard.slice().sort(), top3.slice().sort());
});

// ------------------------------------------------------------------ Furfrou, Oricorio

test('Furfrou, Energy Assist: 30, and a Basic Energy card (not a Special one) from your discard pile to the Benched Pokémon of your choice', () => {
  const dk = deck('sv06.5-051', TYR, SLO, REL, TELE);
  const layout = (discard: string[], bench: string[]): Sides => [{ active: 'Furfrou', energy: { active: [P] }, discard, bench }, { active: 'Tyranitar ex' }];
  const g = scenario(dk, dk, layout([F, SPECIAL, W], ['Slowpoke', 'Rellor']));
  choose(g, 'Attack: Energy Assist');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.deepEqual(labels(g).sort(), [F, W]);
  choose(g, W);
  choose(g, 'Rellor');
  assert.deepEqual(energyNames(g, 0, 1), [W]);
  assert.deepEqual(energyNames(g, 0, 0), []);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, SPECIAL].sort());
  // Nothing to attach, or nowhere to attach it: just the 30.
  const noBasic = scenario(dk, dk, layout([SPECIAL], ['Slowpoke']));
  choose(noBasic, 'Attack: Energy Assist');
  assert.equal(noBasic.decision?.player, 1);
  assert.deepEqual(energyNames(noBasic, 0, 0), []);
  const noBench = scenario(dk, dk, layout([F], []));
  choose(noBench, 'Attack: Energy Assist');
  assert.equal(noBench.decision?.player, 1);
  assert.deepEqual(names(noBench, noBench.state.p[0].discard), [F]);
});

test('Oricorio, Energy Assist: up to 2 Basic Energy cards from your discard pile, all to 1 Benched Pokémon (0 is allowed)', () => {
  const dk = deck('sv08-026', URSA, SLO, REL, TELE);
  const layout = (): Sides => [{ active: 'Oricorio', energy: { active: [F] }, discard: [F, F, W, SPECIAL], bench: ['Slowpoke', 'Rellor'] }, { active: 'Bloodmoon Ursaluna ex' }];
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: Energy Assist');
  assert.ok(!labels(g).includes(SPECIAL));
  pick(g, [F, W]);
  choose(g, 'Rellor');
  assert.deepEqual(energyNames(g, 0, 1), [F, W].sort());
  assert.deepEqual(names(g, g.state.p[0].discard), [F, SPECIAL].sort());
  const none = scenario(dk, dk, layout());
  choose(none, 'Attack: Energy Assist');
  none.submit([]);
  assert.equal(none.decision?.player, 1, '"up to 2" on an attack can be none, and then no Pokémon is asked for');
  assert.equal(none.state.p[0].discard.length, 4);
});

test('Oricorio, Fireworks: 30, then you discard an Energy of your choice from this Pokémon', () => {
  const dk = deck('sv08-026', URSA);
  const g = scenario(dk, dk, [{ active: 'Oricorio', energy: { active: [F, W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Fireworks');
  assert.equal(g.state.p[1].active!.damage, 30);
  choose(g, W);
  assert.deepEqual(energyNames(g, 0, 'active'), [F]);
  assert.deepEqual(names(g, g.state.p[0].discard), [W]);
});

// ------------------------------------------------------------------ Mienshao

test("Mienshao, Gale Roundhouse: 30, or 90 if your opponent has 5 or fewer cards in their hand", () => {
  const dk = deck('sv07-084', TYR, SLO, REL, BOSS, BALL);
  const six = ['Slowpoke', 'Rellor', "Boss's Orders", 'Ultra Ball', 'Fire Energy', 'Water Energy'];
  const run = (hand: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Mienshao', energy: { active: [FI] } }, { active: 'Tyranitar ex', hand }]);
    choose(g, 'Attack: Gale Roundhouse');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(six.slice(0, 5)), 90);
  assert.equal(run([]), 90);
  assert.equal(run(six), 30);
});

// ------------------------------------------------------------------ Raging Bolt

test("Raging Bolt, Thunderburst Storm: 30 for each Energy attached to it, to 1 of the opponent's Pokémon of your choice (no Weakness or Resistance on the Bench)", () => {
  const dk = deck('sv07-111', URSA, REG);
  const layout = (): Sides => [{ active: 'Raging Bolt', energy: { active: [L, FI, F] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Registeel ex'] }];
  const bench = scenario(dk, dk, layout());
  choose(bench, 'Attack: Thunderburst Storm');
  choose(bench, 'Registeel ex');
  assert.equal(bench.state.p[1].bench[0]!.damage, 90);
  assert.equal(bench.state.p[1].active!.damage, 0);
  const active = scenario(dk, dk, layout());
  choose(active, 'Attack: Thunderburst Storm');
  choose(active, 'Bloodmoon Ursaluna ex');
  assert.equal(active.state.p[1].active!.damage, 90);
  assert.equal(active.state.p[1].bench[0]!.damage, 0);
});

// ------------------------------------------------------------------ Iron Bundle

test("Iron Bundle, Gusting Collision: 200 minus 50 for each {C} in the Defending Pokémon's Retreat Cost (as modified), never below 0", () => {
  const dk = deck('sv08-055', URSA, REG, 'me05-062', BALLOON);
  const hit = (defender: SideLayout): number => {
    const g = scenario(dk, dk, [{ active: 'Iron Bundle', energy: { active: [W, W, W] } }, defender]);
    choose(g, 'Attack: Gusting Collision');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit({ active: 'Bloodmoon Ursaluna ex' }), 50, 'Retreat Cost 3');
  assert.equal(hit({ active: 'Bloodmoon Ursaluna ex', tools: { active: ['Air Balloon'] } }), 150, 'Retreat Cost 3 - 2 = 1');
  assert.equal(hit({ active: 'Bastiodon' }), 0, 'Retreat Cost 4: 200 - 200');
});

// ------------------------------------------------------------------ Magnezone

test("Magnezone, Mighty Magnetism: 80, the Defending Pokémon is Confused, and it can't retreat during the opponent's next turn", () => {
  const dk = deck('sv08-060', URSA, SLO);
  const layout = (): Sides => [{ active: 'Magnezone', energy: { active: [L, L, L] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'], energy: { active: [P, P, P] } }];
  const control = scenario(dk, dk, layout(), { current: 1 });
  assert.ok(has(control, 'Retreat'), 'control: Ursaluna should be able to retreat');
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: Mighty Magnetism');
  assert.equal(g.state.p[1].active!.damage, 80);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
  assert.equal(g.decision?.player, 1);
  assert.ok(!has(g, 'Retreat'), 'retreat was offered');
});

test("Magnezone, Zap Cannon: 180, and this Pokémon can't use Zap Cannon during your next turn only", () => {
  const dk = deck('sv08-060', URSA);
  const g = scenario(dk, dk, [{ active: 'Magnezone', energy: { active: [L, L, L, L] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Zap Cannon');
  assert.equal(g.state.p[1].active!.damage, 180);
  endTurn(g);
  assert.ok(has(g, 'Attack: Mighty Magnetism'), 'a different attack is still allowed');
  assert.ok(!has(g, 'Attack: Zap Cannon'), 'Zap Cannon offered on my next turn');
  endTurn(g);
  endTurn(g);
  assert.ok(has(g, 'Attack: Zap Cannon'), 'one turn only');
});
