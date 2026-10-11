/**
 * Card tests, batch "std-c10": every card scripted in cards/scripts/std-c10.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { CONFUSED, POISONED } from '../types.js';
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
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function stack(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return sl.cards.map((c) => name(g, c));
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const benchDmg = (g: Game, p: 0 | 1, i: number): number => g.state.p[p].bench[i]!.damage;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Phantump: 'me04-038',
  Trevenant: 'me04-039',
  'Gourgeist ex': 'me04-041',
  Xerneas: 'me04-042',
  Sudowoodo: 'me04-043',
  Golbat: 'me04-050',
  Crobat: 'me04-051',
  Qwilfish: 'me04-052',
  'Krookodile ex': 'me04-055',
  Trubbish: 'me04-056',
  Garbodor: 'me04-057',
  Watchog: 'me04-071',
  'Adversity Policy': 'me04-074',
  Emma: 'me04-077',
  'Great Haul Net': 'me04-078',
  Philippe: 'me04-079',
  "Roxie's Performance": 'me04-081',
  'Magnetic Metal Energy': 'me04-085',
  'Transformation Tome': 'me04-083',
  'Dragapult ex': 'sv06-130',
  'Air Balloon': 'me01-166',
  'Mega Lopunny ex': 'me02-084',
  Keldeo: 'me04-019',
  Froakie: 'me04-020',
  Beldum: 'me04-059',
  'Registeel ex': 'me02.5-145',
};
/** A test deck: 4 copies of each named card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...cards: string[]) {
  return fromIds('c10', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const ALL = Object.keys(IDS);
const DK = deck(...ALL);
const DRA = 'Dragapult ex'; // 320 HP, Dragon, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70, Stage 2
const P = 'Psychic Energy';
const D = 'Darkness Energy';
const W = 'Water Energy';
const F = 'Fire Energy';
const FI = 'Fighting Energy';
const M = 'Metal Energy';
type Sides = [SideLayout, SideLayout];
const game = (sides: Sides, o: Parameters<typeof scenario>[3] = {}): Game => scenario(DK, DK, sides, o);

// ------------------------------------------------------------------ Phantump

test('Phantump, Spiteful Evolution: puts an Evolution card from the hand onto it, then 2 damage counters on it; the evolution clears conditions', () => {
  const g = game([{ active: 'Phantump', hand: ['Trevenant'], cond: POISONED | CONFUSED }, { active: DRA }]);
  choose(g, 'Use Spiteful Evolution');
  assert.deepEqual(stack(g, 0, 'active'), ['Phantump', 'Trevenant']);
  assert.equal(dmg(g, 0), 20, '2 damage counters on the Pokémon evolved this way');
  assert.equal(g.state.p[0].active!.cond, 0, 'evolving ends Special Conditions');
  assert.equal(g.state.p[0].hand.length, 0);
});

test('Phantump, Spiteful Evolution: needs a card that evolves from it in hand', () => {
  const g = game([{ active: 'Phantump', hand: ['Xerneas', 'Golbat'] }, { active: DRA }]);
  assert.ok(!has(g, 'Spiteful Evolution'));
});

test('Phantump, Spiteful Evolution: not during your first turn (each player\'s own: turn 1 for the first player, turn 2 for the second)', () => {
  const first = game([{ active: 'Phantump', hand: ['Trevenant'] }, { active: DRA }], { turn: 1 });
  assert.ok(!has(first, 'Spiteful Evolution'), 'first player, turn 1');
  const second = game([{ active: DRA }, { active: 'Phantump', hand: ['Trevenant'] }], { turn: 2, current: 1 });
  assert.ok(!has(second, 'Spiteful Evolution'), 'second player, turn 2');
  const later = game([{ active: DRA }, { active: 'Phantump', hand: ['Trevenant'] }], { turn: 4, current: 1 });
  assert.ok(has(later, 'Use Spiteful Evolution'), 'second player, turn 4');
});

test('Phantump, Spiteful Evolution: ruling 2349 -- deferred until turn 2', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2349/): unusable turn 1.
  const g = game([{ active: DRA, hand: ['Phantump', 'Trevenant'] }, { active: DRA }]);
  choose(g, 'Bench Phantump');
  assert.ok(!has(g, 'Evolve Phantump into Trevenant'), 'the ordinary evolve waits a turn');
  choose(g, 'Use Spiteful Evolution');
  assert.deepEqual(stack(g, 0, 0), ['Phantump', 'Trevenant']);
  assert.equal(benchDmg(g, 0, 0), 20);
});

test('Phantump, Spiteful Evolution: once during your turn', () => {
  const g = game([{ active: 'Phantump', bench: ['Phantump'], hand: ['Trevenant', 'Trevenant'] }, { active: DRA }]);
  choose(g, 'Use Spiteful Evolution');
  // The second Phantump has its own use; the first is now Trevenant (no Ability).
  assert.equal(labels(g).filter((l) => l.includes('Use Spiteful Evolution')).length, 1);
  choose(g, 'Use Spiteful Evolution');
  assert.deepEqual(stack(g, 0, 0), ['Phantump', 'Trevenant']);
  assert.ok(!has(g, 'Use Spiteful Evolution'));
});

// ------------------------------------------------------------------ Gourgeist ex

test('Gourgeist ex, Horrifying Rondo: 30, +50 for each Benched Pokémon with damage counters', () => {
  const mk = (damage: Partial<Record<0 | 1 | 2, number>>): Game =>
    game([{ active: 'Gourgeist ex', bench: ['Phantump', 'Phantump', 'Phantump'], energy: { active: [P] }, damage }, { active: DRA }]);
  const none = mk({});
  choose(none, 'Attack: Horrifying Rondo');
  assert.equal(dmg(none, 1), 30);
  const two = mk({ 0: 10, 2: 30 });
  choose(two, 'Attack: Horrifying Rondo');
  assert.equal(dmg(two, 1), 130, '30 + 2 x 50');
  // The Active Pokémon's own damage does not count.
  const active = game([{ active: 'Gourgeist ex', bench: ['Phantump'], energy: { active: [P] }, damage: { active: 50 } }, { active: DRA }]);
  choose(active, 'Attack: Horrifying Rondo');
  assert.equal(dmg(active, 1), 30);
});

test('Gourgeist ex, Ghostly Touch: 140, and a random card from the opponent\'s hand is discarded', () => {
  const g = game([{ active: 'Gourgeist ex', energy: { active: [P, P] } }, { active: DRA, hand: ['Xerneas', 'Golbat', 'Emma'] }]);
  const before = g.state.p[1].discard.length;
  choose(g, 'Attack: Ghostly Touch');
  assert.equal(dmg(g, 1), 140);
  assert.equal(g.state.p[1].discard.length, before + 1, 'one card discarded from their hand');
  assert.ok(['Xerneas', 'Golbat', 'Emma'].includes(name(g, g.state.p[1].discard[g.state.p[1].discard.length - 1]!)));
  // An empty hand is fine.
  const empty = game([{ active: 'Gourgeist ex', energy: { active: [P, P] } }, { active: DRA }]);
  choose(empty, 'Attack: Ghostly Touch');
  assert.equal(dmg(empty, 1), 140);
  assert.equal(empty.state.p[1].discard.length, 0);
});

// ------------------------------------------------------------------ Xerneas

test('Xerneas, Geo Storm: 30 for each {P} Energy attached to all of your Pokémon', () => {
  const g = game([
    { active: 'Xerneas', bench: ['Phantump', 'Trevenant'], energy: { active: [P, P, P], 0: [P, F], 1: [W, D] } },
    { active: DRA },
  ]);
  choose(g, 'Attack: Geo Storm');
  assert.equal(dmg(g, 1), 120, '4 Psychic Energy in play: 3 on Xerneas, 1 on a Benched Pokémon; Fire, Water and Darkness do not count');
});

// ------------------------------------------------------------------ Sudowoodo

test('Sudowoodo, Trials and Trip-ulations: up to 2 Transformation Tome from the deck to the hand, revealed; the deck is shuffled', () => {
  const g = game([{ active: 'Sudowoodo', energy: { active: [F] } }, { active: DRA }]);
  const handBefore = g.state.p[0].hand.length;
  choose(g, 'Attack: Trials and Trip-ulations');
  pick(g, ['Transformation Tome', 'Transformation Tome']);
  assert.deepEqual(names(g, g.state.p[0].hand).filter((n) => n === 'Transformation Tome'), ['Transformation Tome', 'Transformation Tome']);
  // After the attack the turn passes; the opponent plays on. Only the 2 Tomes were added to the hand.
  assert.equal(g.state.p[0].hand.length, handBefore + 2);
});

test('Sudowoodo, Trials and Trip-ulations: "up to" on an attack may take none, or only 1', () => {
  const g = game([{ active: 'Sudowoodo', energy: { active: [F] } }, { active: DRA }]);
  choose(g, 'Attack: Trials and Trip-ulations');
  pick(g, ['Transformation Tome']);
  assert.equal(g.state.p[0].hand.filter((c) => name(g, c) === 'Transformation Tome').length, 1);
});

test('Sudowoodo, Rock Hurl: 30, and Resistance does not reduce it', () => {
  // Phantump resists {F} by 30; without the clause this would do 0.
  const g = game([{ active: 'Sudowoodo', energy: { active: [FI] } }, { active: 'Phantump' }]);
  choose(g, 'Attack: Rock Hurl');
  assert.equal(dmg(g, 1), 30);
});

// ------------------------------------------------------------------ Golbat

test('Golbat, Covert Flight: 30, then during the opponent\'s next turn damage from Basic Pokémon is prevented (others\' is not)', () => {
  const mk = (attacker: string, energy: string[]): Game => {
    const g = game([{ active: 'Golbat', energy: { active: [D] } }, { active: attacker, energy: { active: energy } }]);
    choose(g, 'Attack: Covert Flight');
    assert.equal(dmg(g, 1), 30);
    return g;
  };
  const basic = mk('Beldum', [M]);
  choose(basic, 'Attack: Headbutt');
  assert.equal(dmg(basic, 0), 0, 'Beldum is a Basic Pokémon');
  const stage2 = mk(DRA, [W]);
  choose(stage2, 'Attack: Jet Headbutt');
  assert.equal(dmg(stage2, 0), 70, 'Dragapult ex is a Stage 2 Pokémon');
});

// ------------------------------------------------------------------ Crobat

test('Crobat, Poison Sound Wave: 80, and the Defending Pokémon is Confused and Poisoned', () => {
  const g = game([{ active: 'Crobat', energy: { active: [D] } }, { active: DRA }]);
  choose(g, 'Attack: Poison Sound Wave');
  const t = g.state.p[1].active!;
  assert.ok(t.cond & CONFUSED, 'Confused');
  assert.ok(t.cond & POISONED, 'Poisoned');
  assert.equal(t.damage, 90, '80, and 1 Poison damage counter at the Pokémon Checkup after the attack');
});

test('Crobat, Nighttime Maneuvers: from the Active Spot, search the deck for a card and put it on top of the deck', () => {
  const g = game([{ active: 'Crobat' }, { active: DRA }]);
  const deckSize = g.state.p[0].deck.length;
  choose(g, 'Use Nighttime Maneuvers');
  pick(g, ['Gourgeist ex']);
  const ps = g.state.p[0];
  assert.equal(ps.deck.length, deckSize, 'the card stays in the deck');
  assert.equal(name(g, ps.deck[ps.deck.length - 1]!), 'Gourgeist ex', 'on top of the deck');
  assert.ok(!has(g, 'Use Nighttime Maneuvers'), 'once during your turn');
});

test('Crobat, Nighttime Maneuvers: only while Crobat is in the Active Spot', () => {
  const g = game([{ active: 'Phantump', bench: ['Crobat'] }, { active: DRA }]);
  assert.ok(!has(g, 'Nighttime Maneuvers'));
});

// ------------------------------------------------------------------ Qwilfish

test('Qwilfish, Venoshock: 30, +50 if the opponent\'s Active Pokémon is Poisoned', () => {
  const plain = game([{ active: 'Qwilfish', energy: { active: [D] } }, { active: DRA }]);
  choose(plain, 'Attack: Venoshock');
  assert.equal(dmg(plain, 1), 30);
  const poisoned = game([{ active: 'Qwilfish', energy: { active: [D] } }, { active: DRA, cond: POISONED }]);
  choose(poisoned, 'Attack: Venoshock');
  assert.equal(dmg(poisoned, 1), 90, '80, and 1 Poison damage counter at the Pokémon Checkup after the attack');
});

test('Qwilfish, Poison Point: the Pokémon that damages it with an attack is Poisoned', () => {
  const g = game([{ active: 'Qwilfish', bench: ['Phantump'] }, { active: 'Phantump', energy: { active: [P] } }], { turn: 4, current: 1 });
  choose(g, 'Attack: Mumble');
  assert.equal(dmg(g, 0), 10);
  assert.ok(g.state.p[1].active!.cond & POISONED, 'the Attacking Pokémon is Poisoned');
});

test('Qwilfish, Poison Point: even if Qwilfish is Knocked Out by the attack', () => {
  const g = game([{ active: 'Qwilfish', bench: ['Phantump'], damage: { active: 85 } }, { active: 'Phantump', energy: { active: [P] } }], { turn: 4, current: 1 });
  choose(g, 'Attack: Mumble');
  assert.equal(g.state.p[0].discard.some((c) => name(g, c) === 'Qwilfish'), true, 'Qwilfish was Knocked Out');
  assert.ok(g.state.p[1].active!.cond & POISONED, 'the Attacking Pokémon is still Poisoned');
});

// ------------------------------------------------------------------ Krookodile ex

test('Krookodile ex, Corner: 80, and during the opponent\'s next turn the Defending Pokémon can\'t retreat', () => {
  const control = game([{ active: DRA }, { active: DRA, bench: ['Phantump'], energy: { active: [W] } }], { turn: 4, current: 1 });
  assert.ok(has(control, 'Retreat'), 'a Dragapult ex with an Energy and a Benched Pokémon can normally retreat');
  const g = game([{ active: 'Krookodile ex', energy: { active: [D, D] } }, { active: DRA, bench: ['Phantump'], energy: { active: [W] } }]);
  choose(g, 'Attack: Corner');
  assert.equal(dmg(g, 1), 80);
  assert.ok(!has(g, 'Retreat'), 'it is now the opponent\'s turn, and the Defending Pokémon can\'t retreat');
  assert.ok(has(g, 'Attack: Jet Headbutt'));
});

test('Krookodile ex, Strong Bite: 140, +140 with a Pokémon Tool attached to it', () => {
  const plain = game([{ active: 'Krookodile ex', energy: { active: [D, D, D] } }, { active: DRA }]);
  choose(plain, 'Attack: Strong Bite');
  assert.equal(dmg(plain, 1), 140);
  const tool = game([{ active: 'Krookodile ex', energy: { active: [D, D, D] }, tools: { active: ['Air Balloon'] } }, { active: DRA }]);
  choose(tool, 'Attack: Strong Bite');
  assert.equal(dmg(tool, 1), 280);
  // A Tool on the defender does not count.
  const theirs = game([{ active: 'Krookodile ex', energy: { active: [D, D, D] } }, { active: DRA, tools: { active: ['Air Balloon'] } }]);
  choose(theirs, 'Attack: Strong Bite');
  assert.equal(dmg(theirs, 1), 140);
});

// ------------------------------------------------------------------ Trubbish

test('Trubbish, Acid Spray: 10, and on heads an Energy is discarded from the opponent\'s Active Pokémon', () => {
  const mk = (coin: boolean): Game => {
    const g = game([{ active: 'Trubbish', energy: { active: [D] } }, { active: DRA, energy: { active: [W, W] } }]);
    g.state.forcedCoins = [coin];
    choose(g, 'Attack: Acid Spray');
    return g;
  };
  const heads = mk(true);
  choose(heads, 'Water Energy'); // which Energy to discard
  assert.equal(dmg(heads, 1), 10);
  assert.equal(heads.state.p[1].active!.energy.length, 1, 'one Energy discarded');
  assert.equal(heads.state.p[1].discard.filter((c) => name(heads, c) === 'Water Energy').length, 1);
  const tails = mk(false);
  assert.equal(dmg(tails, 1), 10);
  assert.equal(tails.state.p[1].active!.energy.length, 2, 'tails: nothing discarded');
});

// ------------------------------------------------------------------ Garbodor

test('Gloomy Garbage: an opponent\'s Active Pokémon with a Tool does 20 less damage; without a Tool it does full damage', () => {
  const mk = (tools: string[], mine: SideLayout = { active: 'Garbodor' }): Game => {
    const g = game([mine, { active: DRA, energy: { active: [W] }, tools: { active: tools } }], { turn: 4, current: 1 });
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  assert.equal(dmg(mk(['Air Balloon']), 0), 50, '70 - 20');
  assert.equal(dmg(mk([]), 0), 70, 'no Tool, no reduction');
});

test('Gloomy Garbage: it works from the Bench, and the effect of two Garbodor stacks (ruling 2344)', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2344/): multiple Garbodor each apply their reduction independently.
  const g = game([{ active: 'Phantump', bench: ['Garbodor'] }, { active: DRA, energy: { active: [W] }, tools: { active: ['Air Balloon'] } }], { turn: 4, current: 1 });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 50, 'one Garbodor on the Bench');
  const two = game([{ active: 'Garbodor', bench: ['Garbodor'], hand: [] }, { active: DRA, energy: { active: [W] }, tools: { active: ['Air Balloon'] } }], { turn: 4, current: 1 });
  choose(two, 'Attack: Jet Headbutt');
  assert.equal(dmg(two, 0), 30, '70 - 20 - 20');
});

test('Gloomy Garbage: the 20 comes off before Weakness (the Pokémon ex\'s Weakness x2 is applied to 50)', () => {
  // Garbodor is weak to {F}. Sudowoodo (Fighting) with a Tool: Rock Hurl 30 - 20 = 10, x2 = 20 (not 30 x 2 - 20 = 40).
  const g = game([{ active: 'Garbodor' }, { active: 'Sudowoodo', energy: { active: [FI] }, tools: { active: ['Air Balloon'] } }], { turn: 4, current: 1 });
  choose(g, 'Attack: Rock Hurl');
  assert.equal(dmg(g, 0), 20);
});

test('Gloomy Garbage: ruling 2346 -- damage that ignores effects on the Defending Pokémon is still reduced', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2346/): Garbodor's reduction applies to damage from any attacker, even Shred which ignores defender effects.
  const g = game(
    [{ active: DRA, bench: ['Garbodor'] }, { active: 'Mega Lopunny ex', energy: { active: [W, W] }, tools: { active: ['Air Balloon'] } }],
    { turn: 4, current: 1 },
  );
  choose(g, 'Attack: Spiky Hopper');
  assert.equal(dmg(g, 0), 140, '160 - 20, from a Garbodor on the Bench');
});

test('Gloomy Garbage: ruling 2345 -- it also reduces damage done to Benched Pokémon', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2345/): the 20-damage reduction applies when hitting Benched Pokémon too.
  const mk = (tools: string[]): Game => {
    const g = game(
      [{ active: 'Phantump', bench: ['Garbodor', 'Phantump'] }, { active: 'Keldeo', energy: { active: [W] }, tools: { active: tools } }],
      { turn: 4, current: 1 },
    );
    choose(g, 'Attack: Shoot Through');
    choose(g, 'Garbodor');
    return g;
  };
  const withTool = mk(['Air Balloon']);
  assert.equal(dmg(withTool, 0), 0, 'Active: 20 - 20');
  assert.equal(benchDmg(withTool, 0, 0), 0, 'Benched Garbodor: 20 - 20');
  const without = mk([]);
  assert.equal(dmg(without, 0), 20);
  assert.equal(benchDmg(without, 0, 0), 20);
});

test('Gloomy Garbage: only the opponent\'s Pokémon with a Tool are affected (the Garbodor player\'s own attacks are not)', () => {
  const g = game([{ active: 'Garbodor', energy: { active: [D, D, D] }, tools: { active: ['Air Balloon'] } }, { active: DRA }]);
  choose(g, 'Attack: Sludge Bomb');
  assert.equal(dmg(g, 1), 100);
});

// ------------------------------------------------------------------ Watchog

test('Watchog, Snap Inspection: flip 3 coins; for each heads, a card from the revealed hand goes into the opponent\'s deck', () => {
  const hand = ['Xerneas', 'Golbat', 'Emma', 'Trevenant'];
  const mk = (coins: boolean[], theirs: string[]): Game => {
    const g = game([{ active: 'Watchog', energy: { active: [W] } }, { active: DRA, hand: theirs }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Snap Inspection');
    return g;
  };
  const two = mk([true, true, false], hand);
  assert.equal(two.decision!.min, 2);
  assert.equal(two.decision!.max, 2);
  const deckBefore = two.state.p[1].deck.length;
  pick(two, ['Xerneas', 'Emma']);
  // The turn passes and the opponent draws one card.
  assert.equal(two.state.p[1].deck.length, deckBefore + 2 - 1);
  assert.equal(two.state.p[1].hand.length, 2 + 1);
  assert.ok(two.state.p[1].hand.some((c) => name(two, c) === 'Golbat') && two.state.p[1].hand.some((c) => name(two, c) === 'Trevenant'));
  // No heads: nothing is revealed or shuffled.
  const none = mk([false, false, false], hand);
  assert.equal(none.state.p[1].hand.length, 4 + 1);
  assert.deepEqual(none.state.p[1].revealed, []);
});

test('Watchog, Snap Inspection: ruling 2356 -- with fewer cards than heads, all of them are shuffled into the deck', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2356/): shuffle in every card possible; if fewer cards exist than heads, use all of them.
  const g = game([{ active: 'Watchog', energy: { active: [W] } }, { active: DRA, hand: ['Xerneas', 'Golbat'] }]);
  g.state.forcedCoins = [true, true, true];
  const deckBefore = g.state.p[1].deck.length;
  choose(g, 'Attack: Snap Inspection');
  if (g.decision?.kind === 'cards' && g.state.p[1].hand.length === 2) pick(g, ['Xerneas', 'Golbat']);
  assert.equal(g.state.p[1].deck.length, deckBefore + 2 - 1, 'both cards went into the deck; then the opponent drew 1');
  assert.equal(g.state.p[1].hand.length, 1, 'only the card drawn for the turn');
});

// ------------------------------------------------------------------ Adversity Policy

test('Adversity Policy: draw 3 when the Active Pokémon, weak to the attacker\'s type, is damaged by an attack', () => {
  // Gourgeist ex is weak to {D}; Qwilfish is a {D} Pokémon (30 damage, doubled by Weakness).
  const g = game([{ active: 'Gourgeist ex', tools: { active: ['Adversity Policy'] } }, { active: 'Qwilfish', energy: { active: [D] } }], { turn: 4, current: 1 });
  choose(g, 'Attack: Venoshock');
  assert.equal(dmg(g, 0), 60, '30 x 2');
  // 3 cards for the Tool, 1 for the start of the turn.
  assert.equal(g.state.p[0].hand.length, 4);
});

test('Adversity Policy: no cards when the attacker is not of the Pokémon\'s Weakness type', () => {
  const g = game([{ active: 'Gourgeist ex', tools: { active: ['Adversity Policy'] } }, { active: DRA, energy: { active: [W] } }], { turn: 4, current: 1 });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 70);
  assert.equal(g.state.p[0].hand.length, 1, 'only the card for the turn');
});

test('Adversity Policy: ruling 2360 -- it draws as much as it can', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2360/): draw all remaining cards from the deck; if it empties, the player loses.
  const g = game(
    [{ active: 'Phantump', bench: ['Phantump'], tools: { active: ['Adversity Policy'] }, emptyDeck: true }, { active: 'Qwilfish', energy: { active: [D] } }],
    { turn: 4, current: 1 },
  );
  const p0 = g.state.p[0];
  p0.deck.push(...p0.discard.splice(0, 2));
  choose(g, 'Attack: Venoshock');
  assert.equal(p0.hand.length, 2, 'the 2 cards left in the deck were drawn');
  assert.equal(g.state.winner, 1, 'an empty deck at the start of the turn loses the game');
});

test('Adversity Policy: the Tool\'s draw happens even when the attack Knocks the Pokémon Out', () => {
  const g = game(
    [{ active: 'Phantump', bench: ['Phantump'], tools: { active: ['Adversity Policy'] }, damage: { active: 30 } }, { active: 'Qwilfish', energy: { active: [D] } }],
    { turn: 4, current: 1 },
  );
  choose(g, 'Attack: Venoshock'); // 60 + 30 = 90 >= 70 HP
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === 'Phantump'), 'Phantump was Knocked Out');
  assert.ok(g.state.p[0].hand.length >= 3, 'the 3 cards were drawn');
});

// ------------------------------------------------------------------ Emma

test('Emma: the opponent reveals their hand and you draw a card for each Pokémon there', () => {
  const g = game([{ active: DRA, hand: ['Emma'] }, { active: DRA, hand: ['Xerneas', 'Golbat', F, 'Emma'] }]);
  choose(g, 'Play Emma');
  assert.equal(g.state.p[0].hand.length, 2, '2 Pokémon in their hand: Xerneas and Golbat');
  assert.equal(g.state.p[1].revealed.length, 4, 'their whole hand was revealed');
});

test('Emma: can\'t be played when the opponent has no cards in hand (it would do nothing)', () => {
  const g = game([{ active: DRA, hand: ['Emma'] }, { active: DRA }]);
  assert.ok(!has(g, 'Play Emma'));
});

test('Emma: with no Pokémon in their hand it reveals and draws nothing', () => {
  const g = game([{ active: DRA, hand: ['Emma'] }, { active: DRA, hand: [F, W] }]);
  choose(g, 'Play Emma');
  assert.equal(g.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Great Haul Net

const DISCARD = ['Keldeo', 'Froakie', 'Phantump', W, W, W, W, F];

test('Great Haul Net: choose the {W} Pokémon half -- up to 3 shuffled into the deck, the Energy stays', () => {
  const g = game([{ active: DRA, hand: ['Great Haul Net'], discard: DISCARD }, { active: DRA }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Play Great Haul Net');
  choose(g, '{W} Pokémon');
  pick(g, ['Keldeo', 'Froakie']);
  assert.equal(g.state.p[0].deck.length, deckBefore + 2);
  assert.deepEqual(names(g, g.state.p[0].discard).filter((n) => n !== 'Great Haul Net'), ['Fire Energy', 'Phantump', 'Water Energy', 'Water Energy', 'Water Energy', 'Water Energy']);
});

test('Great Haul Net: Phantump ({P}) is not a {W} Pokémon, and Fire Energy is not Basic {W} Energy', () => {
  const g = game([{ active: DRA, hand: ['Great Haul Net'], discard: DISCARD }, { active: DRA }]);
  choose(g, 'Play Great Haul Net');
  choose(g, 'Both');
  assert.ok(labels(g).every((l) => !l.includes('Phantump')), labels(g).join(' | '));
  pick(g, ['Keldeo']);
  assert.ok(labels(g).every((l) => !l.includes('Fire Energy')), labels(g).join(' | '));
});

test('Great Haul Net: choose the Basic {W} Energy half -- up to 3 into the deck', () => {
  const g = game([{ active: DRA, hand: ['Great Haul Net'], discard: DISCARD }, { active: DRA }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Play Great Haul Net');
  choose(g, 'Basic {W} Energy cards');
  pick(g, [W, W, W]);
  assert.equal(g.state.p[0].deck.length, deckBefore + 3);
  assert.equal(g.state.p[0].discard.filter((c) => name(g, c) === 'Water Energy').length, 1);
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === 'Keldeo'), 'the Pokémon stayed');
});

test('Great Haul Net: both halves in one play', () => {
  const g = game([{ active: DRA, hand: ['Great Haul Net'], discard: DISCARD }, { active: DRA }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Play Great Haul Net');
  choose(g, 'Both');
  pick(g, ['Keldeo', 'Froakie']);
  pick(g, [W, W]);
  assert.equal(g.state.p[0].deck.length, deckBefore + 4);
  assert.deepEqual(names(g, g.state.p[0].discard).filter((n) => n !== 'Great Haul Net'), ['Fire Energy', 'Phantump', 'Water Energy', 'Water Energy']);
});

test('Great Haul Net: not playable with no {W} Pokémon and no Basic {W} Energy in the discard pile', () => {
  const g = game([{ active: DRA, hand: ['Great Haul Net'], discard: ['Phantump', F, P] }, { active: DRA }]);
  assert.ok(!has(g, 'Play Great Haul Net'));
});

// ------------------------------------------------------------------ Philippe

test('Philippe: attach up to 2 Basic {M} Energy from the discard pile to 1 of your {M} Pokémon', () => {
  const g = game([{ active: 'Phantump', bench: ['Beldum'], hand: ['Philippe'], discard: [M, M, M, F] }, { active: DRA }]);
  choose(g, 'Play Philippe'); // Beldum is the only {M} Pokémon: no question
  pick(g, [M, M]);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), ['Metal Energy', 'Metal Energy']);
  assert.deepEqual(names(g, g.state.p[0].discard).filter((n) => n !== 'Philippe'), ['Fire Energy', 'Metal Energy']);
});

test('Philippe: only {M} Pokémon are choices, and fewer than 2 Energy is fine ("up to 2" on a Trainer is 1 or 2)', () => {
  const g = game([{ active: 'Registeel ex', bench: ['Phantump', 'Beldum'], hand: ['Philippe'], discard: [M, F] }, { active: DRA }]);
  choose(g, 'Play Philippe');
  assert.ok(labels(g).every((l) => !l.includes('Phantump')), labels(g).join(' | '));
  choose(g, 'Registeel ex');
  assert.deepEqual(names(g, g.state.p[0].active!.energy), ['Metal Energy']);
});

test('Philippe: not playable without a {M} Pokémon, or without Basic {M} Energy in the discard pile', () => {
  const noMetal = game([{ active: 'Phantump', hand: ['Philippe'], discard: [M, M] }, { active: DRA }]);
  assert.ok(!has(noMetal, 'Play Philippe'));
  const noEnergy = game([{ active: 'Beldum', hand: ['Philippe'], discard: [F, 'Registeel ex'] }, { active: DRA }]);
  assert.ok(!has(noEnergy, 'Play Philippe'));
});

// ------------------------------------------------------------------ Roxie's Performance

test('Roxie\'s Performance: during the opponent\'s next turn their Poisoned Pokémon can\'t retreat (a Pokémon Poisoned afterwards too)', () => {
  const mk = (cond: number): Game => {
    const g = game([{ active: DRA, hand: ["Roxie's Performance"] }, { active: 'Phantump', bench: ['Phantump'], energy: { active: [P, P] }, cond }]);
    choose(g, "Play Roxie's Performance");
    return g;
  };
  const poisoned = mk(POISONED);
  choose(poisoned, 'End turn');
  assert.ok(!has(poisoned, 'Retreat'), 'Poisoned: can\'t retreat');
  const healthy = mk(0);
  choose(healthy, 'End turn');
  assert.ok(has(healthy, 'Retreat'), 'not Poisoned: can retreat');
});

test('Roxie\'s Performance: ruling 2364 -- a Pokémon Poisoned after the Supporter was played is also stopped', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2364/): the retreat lock applies to Pokémon Poisoned after Roxie's is played as well.
  const g = game([{ active: DRA, hand: ["Roxie's Performance"] }, { active: 'Phantump', bench: ['Phantump'], energy: { active: [P, P] } }]);
  choose(g, "Play Roxie's Performance");
  g.state.p[1].active!.cond |= POISONED; // Poisoned later in the same turn, e.g. by an attack or Ability
  choose(g, 'End turn');
  assert.ok(!has(g, 'Retreat'));
});

// ------------------------------------------------------------------ Magnetic Metal Energy

test('Magnetic Metal Energy: provides {M} Energy', () => {
  const g = game([{ active: 'Beldum', energy: { active: ['Magnetic Metal Energy'] } }, { active: DRA }]);
  assert.ok(has(g, 'Attack: Headbutt'), 'Headbutt costs {M}');
  assert.ok(!has(g, 'Attack: Beam'), 'Beam costs {M}{C}');
  const off = game([{ active: 'Phantump', energy: { active: ['Magnetic Metal Energy'] } }, { active: DRA }]);
  assert.ok(!has(off, 'Attack: Mumble'), 'Mumble costs {P}: it provides {M} only');
});

test('Magnetic Metal Energy: the {M} Pokémon it is attached to has no Retreat Cost', () => {
  const g = game([{ active: 'Registeel ex', bench: ['Phantump'], energy: { active: ['Magnetic Metal Energy'] } }, { active: DRA }]);
  choose(g, 'Retreat');
  if (g.decision?.prompt?.startsWith('Discard 0')) g.submit([]); // a Retreat Cost of 0 still asks for the (empty) payment
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Phantump');
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), ['Magnetic Metal Energy'], 'nothing was discarded: Registeel ex\'s Retreat Cost is 3');
  // Control: with a Basic {M} Energy instead, 1 Energy can't pay a Retreat Cost of 3.
  const basic = game([{ active: 'Registeel ex', bench: ['Phantump'], energy: { active: [M] } }, { active: DRA }]);
  assert.ok(!has(basic, 'Retreat'));
});

test('Magnetic Metal Energy: a Pokémon that is not {M} keeps its Retreat Cost', () => {
  const g = game([{ active: 'Phantump', bench: ['Phantump'], energy: { active: ['Magnetic Metal Energy'] } }, { active: DRA }]);
  assert.ok(!has(g, 'Retreat'), 'Phantump\'s Retreat Cost is 2 and one Energy is attached');
});
