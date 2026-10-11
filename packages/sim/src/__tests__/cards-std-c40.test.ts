/**
 * Card tests, batch "std-c40": every card scripted in cards/scripts/std-c40.ts does what its printed text says in a
 * constructed position. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
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
const activeName = (g: Game, p: 0 | 1): string => nameOf(g, topCard(g.state.p[p].active!));
const benchNames = (g: Game, p: 0 | 1): string[] => g.state.p[p].bench.map((b) => nameOf(g, topCard(b)));

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const ZARUDE = 'Zarude';
const ZEB = 'Zebstrika';
const VICTINI = 'Victini';
const TORN = 'Tornadus';
const GOTHITELLE = 'Gothitelle';
const GOTHORITA = 'Gothorita';
const REUNICLUS = 'Reuniclus';
const DUOSION = 'Duosion';
const SOLOSIS = 'Solosis';
const BOOMERANG = 'Boomerang Energy';
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: a neutral target
const IDS: Record<string, string> = {
  [ZARUDE]: 'svp-199',
  [ZEB]: 'svp-201',
  [VICTINI]: 'svp-208',
  [TORN]: 'svp-210',
  [GOTHITELLE]: 'svp-211',
  [GOTHORITA]: 'sv10.5w-042',
  [REUNICLUS]: 'svp-212',
  [DUOSION]: 'sv05-071',
  [SOLOSIS]: 'sv05-070',
  [BOOMERANG]: 'sv06-166',
  [DRA]: 'sv06-130',
};
/** A test deck of the named cards (6 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('c40', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 6]), ...ENERGY]);
}
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Zarude

test('Zarude, Pluck Off: search for up to 3 Basic {G} Energy cards, reveal them, put them into your hand', () => {
  const dk = deck(ZARUDE, DRA);
  const g = scenario(dk, dk, [{ active: ZARUDE, energy: { active: [G] } }, { active: DRA }]);
  const handBefore = g.state.p[0].hand.length;
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Pluck Off');
  assert.ok(!has(g, 'Fire Energy'), 'only Basic {G} Energy is offered');
  assert.equal(g.decision?.min, 0, '"up to 3" on an attack is 0 to 3');
  assert.equal(g.decision?.max, 3);
  pick(g, [G, G, G]);
  const got = g.state.p[0].hand.slice(handBefore);
  assert.deepEqual(namesOf(g, got), [G, G, G]);
  assert.deepEqual(namesOf(g, g.state.p[0].revealed ?? []), [G, G, G], 'they are revealed');
  assert.equal(g.state.p[0].deck.length, deckBefore - 3);
});

test('Zarude, Pluck Off: up to 3 allows finding fewer, or none', () => {
  const dk = deck(ZARUDE, DRA);
  const g = scenario(dk, dk, [{ active: ZARUDE, energy: { active: [G] } }, { active: DRA }]);
  const handBefore = g.state.p[0].hand.length;
  choose(g, 'Attack: Pluck Off');
  pick(g, [G]);
  assert.equal(g.state.p[0].hand.length, handBefore + 1);
  const n = scenario(dk, dk, [{ active: ZARUDE, energy: { active: [G] } }, { active: DRA }]);
  const before = n.state.p[0].hand.length;
  choose(n, 'Attack: Pluck Off');
  n.submit([]);
  assert.equal(n.state.p[0].hand.length, before);
});

test("Zarude, Hammer Whip: 130 damage; during your next turn this Pokémon can't attack", () => {
  const dk = deck(ZARUDE, DRA);
  const g = scenario(dk, dk, [{ active: ZARUDE, energy: { active: [G, G, G] } }, { active: DRA }]);
  choose(g, 'Attack: Hammer Whip');
  assert.equal(dmg(g, 1), 130);
  choose(g, 'End turn');
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack:'), "Zarude can't attack during your next turn");
  // control: the same position with no Hammer Whip lets it attack
  const c = scenario(dk, dk, [{ active: ZARUDE, energy: { active: [G, G, G] } }, { active: DRA }]);
  assert.ok(has(c, 'Attack: Hammer Whip'));
});

// ------------------------------------------------------------------ Zebstrika

test('Zebstrika, Full Speed: discard your hand and draw 6 cards', () => {
  const dk = deck(ZEB, DRA);
  const g = scenario(dk, dk, [{ active: ZEB, energy: { active: [L] }, hand: [DRA, DRA, DRA] }, { active: DRA }]);
  const discardBefore = g.state.p[0].discard.length;
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Full Speed');
  assert.equal(g.state.p[0].hand.length, 6);
  assert.equal(g.state.p[0].discard.length, discardBefore + 3, 'the 3 cards in hand were discarded');
  assert.equal(g.state.p[0].deck.length, deckBefore - 6);
  assert.ok(namesOf(g, g.state.p[0].discard).filter((n) => n === DRA).length >= 3);
});

test('Zebstrika, Full Speed: with an empty hand it just draws 6', () => {
  const dk = deck(ZEB, DRA);
  const g = scenario(dk, dk, [{ active: ZEB, energy: { active: [L] } }, { active: DRA }]);
  const discardBefore = g.state.p[0].discard.length;
  choose(g, 'Attack: Full Speed');
  assert.equal(g.state.p[0].hand.length, 6);
  assert.equal(g.state.p[0].discard.length, discardBefore);
});

// ------------------------------------------------------------------ Victini

test('Victini, V-Force: 120 damage with 5 Benched Pokémon; with 4 or fewer this attack does nothing', () => {
  const dk = deck(VICTINI, DRA, SOLOSIS);
  const hit = (bench: number): number => {
    const g = scenario(dk, dk, [{ active: VICTINI, energy: { active: [R, R] }, bench: Array<string>(bench).fill(SOLOSIS) }, { active: DRA }]);
    choose(g, 'Attack: V-Force');
    return dmg(g, 1);
  };
  assert.equal(hit(5), 120);
  assert.equal(hit(4), 0, '4 Benched Pokémon: nothing');
  assert.equal(hit(1), 0);
  assert.equal(hit(0), 0);
});

// ------------------------------------------------------------------ Tornadus

test('Tornadus, Wrapped in Wind: attach a Basic Energy card from your hand to this Pokémon', () => {
  const dk = deck(TORN, DRA, SOLOSIS, BOOMERANG);
  const g = scenario(dk, dk, [{ active: TORN, energy: { active: [R] }, hand: [W, L, DRA, BOOMERANG] }, { active: DRA }]);
  choose(g, 'Attack: Wrapped in Wind');
  assert.deepEqual(labels(g).sort(), [L, W], 'only the Basic Energy cards are offered');
  choose(g, W);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), [R, W].sort());
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [BOOMERANG, DRA, L].sort());
});

test('Tornadus, Wrapped in Wind: with no Basic Energy in hand nothing is attached', () => {
  const dk = deck(TORN, DRA);
  const g = scenario(dk, dk, [{ active: TORN, energy: { active: [R] }, hand: [DRA] }, { active: DRA }]);
  choose(g, 'Attack: Wrapped in Wind');
  assert.equal(g.state.p[0].active!.energy.length, 1);
});

test('Tornadus, Hurricane: 100 damage, then move a Basic Energy from this Pokémon to 1 of your Benched Pokémon', () => {
  const dk = deck(TORN, DRA, SOLOSIS, DUOSION);
  const g = scenario(dk, dk, [{ active: TORN, energy: { active: [R, W, L] }, bench: [SOLOSIS, DUOSION] }, { active: DRA }]);
  choose(g, 'Attack: Hurricane');
  assert.equal(dmg(g, 1), 100);
  choose(g, W);
  choose(g, DUOSION);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), [L, R].sort());
  assert.deepEqual(namesOf(g, g.state.p[0].bench[1]!.energy), [W]);
  assert.deepEqual(g.state.p[0].bench[0]!.energy, []);
});

test('Tornadus, Hurricane: with no Benched Pokémon no Energy is moved (Compendium #487, older Hurricane)', () => {
  const dk = deck(TORN, DRA);
  const g = scenario(dk, dk, [{ active: TORN, energy: { active: [R, W, L] } }, { active: DRA }]);
  choose(g, 'Attack: Hurricane');
  assert.equal(dmg(g, 1), 100);
  assert.equal(g.state.p[0].active!.energy.length, 3);
});

test('Tornadus, Hurricane: only Special Energy attached means no Basic Energy to move (Compendium #488, older Hurricane)', () => {
  const dk = deck(TORN, DRA, SOLOSIS, BOOMERANG);
  const g = scenario(dk, dk, [{ active: TORN, energy: { active: [BOOMERANG, BOOMERANG, BOOMERANG] }, bench: [SOLOSIS] }, { active: DRA }]);
  choose(g, 'Attack: Hurricane');
  assert.equal(dmg(g, 1), 100);
  assert.equal(g.state.p[0].active!.energy.length, 3);
  assert.equal(g.state.p[0].bench[0]!.energy.length, 0);
});

test('Tornadus, Hurricane: a Basic Energy is moved even when a Special Energy is also attached; only the Basic one is offered', () => {
  const dk = deck(TORN, DRA, SOLOSIS, BOOMERANG);
  const g = scenario(dk, dk, [{ active: TORN, energy: { active: [BOOMERANG, W, BOOMERANG] }, bench: [SOLOSIS] }, { active: DRA }]);
  choose(g, 'Attack: Hurricane');
  assert.deepEqual(namesOf(g, g.state.p[0].bench[0]!.energy), [W]);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), [BOOMERANG, BOOMERANG]);
});

// ------------------------------------------------------------------ Gothitelle

test('Gothitelle, Distorted Future: your opponent shuffles their hand into their deck and draws 3 cards', () => {
  const dk = deck(GOTHITELLE, DRA);
  const g = scenario(dk, dk, [{ active: GOTHITELLE }, { active: DRA, hand: [DRA, DRA, DRA, DRA, DRA] }]);
  const total = g.state.p[1].hand.length + g.state.p[1].deck.length;
  assert.equal(g.state.p[1].hand.length, 5);
  choose(g, 'Use Distorted Future');
  // "you may": accept
  if (g.decision?.kind === 'yesno') g.submit([0]);
  assert.equal(g.state.p[1].hand.length, 3);
  assert.equal(g.state.p[1].hand.length + g.state.p[1].deck.length, total, 'nothing was lost');
  assert.ok(!has(g, 'Use Distorted Future'), 'once during your turn');
});

test('Gothitelle, Distorted Future: an opponent with no cards in hand draws 3', () => {
  const dk = deck(GOTHITELLE, DRA);
  const g = scenario(dk, dk, [{ active: GOTHITELLE }, { active: DRA }]);
  assert.equal(g.state.p[1].hand.length, 0);
  choose(g, 'Use Distorted Future');
  if (g.decision?.kind === 'yesno') g.submit([0]);
  assert.equal(g.state.p[1].hand.length, 3);
});

test('Gothitelle, Distorted Future: only while this Pokémon is in the Active Spot', () => {
  const dk = deck(GOTHITELLE, DRA);
  const g = scenario(dk, dk, [{ active: DRA, bench: [GOTHITELLE] }, { active: DRA }]);
  assert.ok(!has(g, 'Use Distorted Future'));
  const a = scenario(dk, dk, [{ active: GOTHITELLE }, { active: DRA }]);
  assert.ok(has(a, 'Use Distorted Future'));
});

test('Gothitelle, Synchro Shot: 90 more damage if you have the same number of cards in hand as your opponent', () => {
  const dk = deck(GOTHITELLE, DRA);
  const hit = (mine: string[], theirs: string[]): number => {
    const g = scenario(dk, dk, [{ active: GOTHITELLE, energy: { active: [P, P] }, hand: mine }, { active: DRA, hand: theirs }]);
    choose(g, 'Attack: Synchro Shot');
    return dmg(g, 1);
  };
  assert.equal(hit([DRA, DRA], [DRA, DRA]), 180, '2 and 2');
  assert.equal(hit([], []), 180, '0 and 0');
  assert.equal(hit([DRA, DRA], [DRA, DRA, DRA]), 90, '2 and 3');
  assert.equal(hit([DRA, DRA, DRA], [DRA]), 90, '3 and 1');
});

// ------------------------------------------------------------------ Reuniclus

test("Reuniclus, Cellular Ascension: each Benched Pokémon evolves with a card from the deck that evolves from it", () => {
  const dk = deck(REUNICLUS, GOTHITELLE, DUOSION, DRA, SOLOSIS, GOTHORITA);
  const g = scenario(dk, dk, [{ active: REUNICLUS, energy: { active: [P] }, bench: [SOLOSIS, DUOSION, GOTHORITA, DRA] }, { active: DRA }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Cellular Ascension');
  // Each Pokémon in turn offers the cards that evolve from it.
  for (let k = 0; k < 8 && g.decision?.kind === 'cards' && g.decision.prompt?.startsWith('Evolve'); k++) {
    const p = g.decision.prompt as string;
    if (p.includes('Solosis')) choose(g, DUOSION);
    else if (p.includes('Duosion')) choose(g, REUNICLUS);
    else if (p.includes('Gothorita')) choose(g, GOTHITELLE);
    else assert.fail(`unexpected evolution prompt ${p}`);
  }
  assert.deepEqual(benchNames(g, 0), [DUOSION, REUNICLUS, GOTHITELLE, DRA]);
  assert.equal(activeName(g, 0), REUNICLUS, 'the Active Pokémon is not on the Bench and is left alone');
  assert.equal(g.state.p[0].deck.length, deckBefore - 3);
});

test('Reuniclus, Cellular Ascension: a Benched Pokémon with no evolution in the deck stays as it is', () => {
  const dk = deck(REUNICLUS, DRA, DUOSION, GOTHORITA);
  const g = scenario(dk, dk, [{ active: REUNICLUS, energy: { active: [P] }, bench: [DUOSION, GOTHORITA] }, { active: DRA }]);
  choose(g, 'Attack: Cellular Ascension');
  assert.equal(g.decision?.kind, 'cards');
  choose(g, REUNICLUS); // Duosion has a Reuniclus in the deck; Gothorita has no Gothitelle there
  assert.deepEqual(benchNames(g, 0), [REUNICLUS, GOTHORITA]);
});

test('Reuniclus, Cellular Ascension: on your first turn Pokémon cannot evolve, so nothing happens', () => {
  const dk = deck(REUNICLUS, DRA, DUOSION, GOTHORITA);
  const g = scenario(dk, dk, [{ active: REUNICLUS, energy: { active: [P] }, bench: [DUOSION] }, { active: DRA }], { turn: 2, first: 1 });
  choose(g, 'Attack: Cellular Ascension');
  assert.deepEqual(benchNames(g, 0), [DUOSION]);
});

test('Reuniclus, Evo-Lariat: 40 more damage for each of your Evolution Pokémon in play', () => {
  const dk = deck(REUNICLUS, DRA, SOLOSIS, DUOSION, GOTHORITA);
  const hit = (bench: string[]): number => {
    const g = scenario(dk, dk, [{ active: REUNICLUS, energy: { active: [P] }, bench }, { active: DRA }]);
    choose(g, 'Attack: Evo-Lariat');
    return dmg(g, 1);
  };
  assert.equal(hit([]), 80, 'Reuniclus itself is an Evolution Pokémon: 40 + 40');
  assert.equal(hit([SOLOSIS]), 80, 'a Basic Pokémon does not count');
  assert.equal(hit([DUOSION]), 120);
  assert.equal(hit([DUOSION, GOTHORITA, SOLOSIS]), 160);
});

test("Reuniclus, Evo-Lariat: the opponent's Evolution Pokémon do not count", () => {
  const dk = deck(REUNICLUS, DRA, DUOSION);
  const g = scenario(dk, dk, [{ active: REUNICLUS, energy: { active: [P] } }, { active: DRA, bench: [DUOSION] }]);
  choose(g, 'Attack: Evo-Lariat');
  assert.equal(dmg(g, 1), 80);
});
