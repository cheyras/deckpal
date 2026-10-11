/**
 * Card tests, lane "charizard": every card in scripts/meta-charizard.ts does what its printed text
 * says (quotes are the text from frames-extra/charizard.ts), the preventCounters static the lane
 * added (`lane:charizard`), and the deck plays clean.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { RandomPilot } from '../pilot/random.js';
import { scenario } from '../scenario.js';
import { allSlots, slotCards, topCard } from '../state.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';
import { gauntletDeck } from './gauntlet.js';
import { LIST } from './meta/charizard.js';

const CZX = fromIds('Mega Charizard X ex / Oricorio ex', LIST);
const FRZ = gauntletDeck('Alakazam / Froslass / Munkidori (Frazilla)');
const R = 'Basic Fire Energy';

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
const name = (g: Game, iid: number): string => def(g.ctx, iid).name;
const names = (g: Game, iids: number[]): string[] => iids.map((c) => name(g, c)).sort();

test('Charmander, Agile: no Retreat Cost with no Energy attached; Retreat Cost 2 with Energy', () => {
  const g = scenario(CZX, FRZ, [{ active: 'Charmander', bench: ['Victini'] }, { active: 'Abra' }]);
  assert.ok(has(g, 'Retreat'), 'free retreat offered with 0 Energy');
  const e = scenario(CZX, FRZ, [{ active: 'Charmander', bench: ['Victini'], energy: { active: [R] } }, { active: 'Abra' }]);
  assert.ok(!has(e, 'Retreat'), 'one Energy is not enough for a Retreat Cost of 2');
});

test('Mega Charizard X ex, Inferno X: 90 damage for each {R} Energy discarded from among your Pokémon', () => {
  const g = scenario(CZX, FRZ, [
    { active: 'Charmander', evolve: { active: ['Charmeleon', 'Mega Charizard X ex'] }, bench: ['Oricorio ex'], energy: { active: [R, R], 0: [R] } },
    { active: 'Abra', bench: ['Snorunt'] },
  ]);
  choose(g, 'Attack: Inferno X');
  pick(g, [R, R, R]);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.equal(g.state.p[0].bench[0]!.energy.length, 0, 'the Benched Oricorio ex Energy counts too');
  assert.equal(g.state.p[0].discard.filter((c) => name(g, c) === R).length, 3);
  assert.ok(g.state.p[1].discard.some((c) => name(g, c) === 'Abra'), '270 damage Knocks Out Abra');
  const z = scenario(CZX, FRZ, [
    { active: 'Charmander', evolve: { active: ['Charmeleon', 'Mega Charizard X ex'] }, energy: { active: [R, R] } },
    { active: 'Snorunt' },
  ]);
  choose(z, 'Attack: Inferno X');
  z.submit([]);
  assert.equal(z.state.p[1].active!.damage, 0, 'discarding none does no damage');
  assert.equal(z.state.p[0].active!.energy.length, 2);
});

test('Oricorio ex, Excited Turbo: with a {R} Mega ex in play, attach Basic {R} from hand to a Benched {R}, as often as you like', () => {
  const g = scenario(CZX, FRZ, [
    { active: 'Charmander', evolve: { active: ['Charmeleon', 'Mega Charizard X ex'] }, bench: ['Oricorio ex', 'Victini'], hand: [R, R] },
    { active: 'Abra' },
  ]);
  choose(g, 'Excited Turbo');
  if (g.decision?.kind === 'cards') pick(g, [R]);
  choose(g, 'Victini');
  assert.equal(g.state.p[0].bench[1]!.energy.length, 1);
  assert.ok(has(g, 'Excited Turbo'), 'usable again the same turn');
  const no = scenario(CZX, FRZ, [{ active: 'Charmander', bench: ['Oricorio ex', 'Victini'], hand: [R] }, { active: 'Abra' }]);
  assert.ok(!has(no, 'Excited Turbo'), 'no {R} Mega Evolution Pokémon ex in play');
});

test('Vulpix, Take Down: 30 damage, and 10 to itself', () => {
  const g = scenario(CZX, FRZ, [{ active: 'Vulpix', energy: { active: [R] } }, { active: 'Snorunt' }]);
  choose(g, 'Attack: Take Down');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.equal(g.state.p[0].active!.damage, 10);
});

test("Ninetales, Nine-Tailed Transfer: all damage counters from 1 Benched Pokémon move to the opponent's Active", () => {
  const g = scenario(CZX, FRZ, [
    { active: 'Vulpix', evolve: { active: ['Ninetales'] }, bench: ['Victini'], damage: { 0: 50 }, energy: { active: [R] } },
    { active: 'Snorunt' },
  ]);
  choose(g, 'Attack: Nine-Tailed Transfer');
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
  assert.equal(g.state.p[1].active!.damage, 50);
});

test('Victini, Call for Family: up to 2 Basic Pokémon from the deck onto the Bench', () => {
  const g = scenario(CZX, FRZ, [{ active: 'Victini', energy: { active: [R] } }, { active: 'Abra' }]);
  choose(g, 'Attack: Call for Family');
  pick(g, ['Charmander', 'Vulpix']);
  assert.deepEqual(names(g, g.state.p[0].bench.map(topCard)), ['Charmander', 'Vulpix']);
});

test('Dawn: a Basic, a Stage 1 and a Stage 2 Pokémon from the deck into the hand', () => {
  const g = scenario(CZX, FRZ, [{ active: 'Victini', hand: ['Dawn'] }, { active: 'Abra' }]);
  choose(g, 'Play Dawn');
  for (const n of ['Charmander', 'Charmeleon', 'Mega Charizard X ex']) if (g.decision?.kind === 'cards') pick(g, [n]);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Charmander', 'Charmeleon', 'Mega Charizard X ex']);
});

test('Firebreather: up to 7 Basic {R} Energy from the deck into the hand', () => {
  const g = scenario(CZX, FRZ, [{ active: 'Victini', hand: ['Firebreather'] }, { active: 'Abra' }]);
  choose(g, 'Play Firebreather');
  pick(g, [R, R, R, R, R, R, R]);
  assert.equal(g.state.p[0].hand.filter((c) => name(g, c) === R).length, 7);
});

test('Energy Retrieval: up to 2 Basic Energy from the discard pile into the hand; not playable with none', () => {
  const g = scenario(CZX, FRZ, [{ active: 'Victini', hand: ['Energy Retrieval'], discard: [R, R, R] }, { active: 'Abra' }]);
  choose(g, 'Play Energy Retrieval');
  pick(g, [R, R]);
  assert.equal(g.state.p[0].hand.filter((c) => name(g, c) === R).length, 2);
  const none = scenario(CZX, FRZ, [{ active: 'Victini', hand: ['Energy Retrieval'] }, { active: 'Abra' }]);
  assert.ok(!has(none, 'Play Energy Retrieval'));
});

test('Blowtorch: discard a Basic {R} from hand to discard a Stadium in play (or a Tool / Special Energy)', () => {
  const g = scenario(CZX, FRZ, [{ active: 'Victini', hand: ['Blowtorch', R, 'Battle Cage'] }, { active: 'Abra' }]);
  assert.ok(!has(g, 'Play Blowtorch'), 'nothing to discard yet');
  choose(g, 'Play Battle Cage');
  choose(g, 'Play Blowtorch');
  assert.equal(g.state.stadium, null, 'the Stadium is discarded');
  assert.deepEqual(names(g, g.state.p[0].discard), ['Basic Fire Energy', 'Battle Cage', 'Blowtorch']);
  const noR = scenario(CZX, FRZ, [{ active: 'Victini', hand: ['Blowtorch', 'Battle Cage'] }, { active: 'Abra' }]);
  choose(noR, 'Play Battle Cage');
  assert.ok(!has(noR, 'Play Blowtorch'), 'no Basic {R} Energy to discard');
});

test("Battle Cage: the opponent's attack effects can't put damage counters on Benched Pokémon; the Active still gets them", () => {
  // Froslass's Freezing Shroud (Ability) puts counters on every Pokémon with an Ability; Oricorio ex has one.
  const g = scenario(FRZ, CZX, [
    { active: 'Snorunt', evolve: { active: ['Froslass'] } },
    { active: 'Oricorio ex', bench: ['Oricorio ex'], hand: [] },
  ]);
  // Put Battle Cage into play for the Charizard player.
  const cage = g.state.p[1].deck.find((c) => name(g, c) === 'Battle Cage')!;
  g.state.p[1].deck = g.state.p[1].deck.filter((c) => c !== cage);
  g.state.stadium = { card: cage, owner: 1 } as typeof g.state.stadium;
  choose(g, 'End turn');
  assert.equal(g.state.p[1].bench[0]!.damage, 0, 'the Benched Oricorio ex is protected');
  assert.equal(g.state.p[1].active!.damage, 10, 'the Active Oricorio ex is not');
});

test('lane charizard: the Mega Charizard X ex / Oricorio ex list has no approximated or unplayable cards', () => {
  const ctx = createContext(CZX, CZX);
  const bad = ctx.defs.filter((x) => x.coverage === 'approx' || x.coverage === 'none').map((x) => `${x.id} ${x.name} (${x.coverage})`);
  assert.deepEqual(bad, []);
  assert.equal(LIST.reduce((n, [, c]) => n + c, 0), 60);
});

test('lane charizard: 40 random games over the list never crash and keep every card in one zone', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = new Game(seed % 2 ? CZX : FRZ, seed % 2 ? FRZ : CZX, seed).start();
    const pilots = [new RandomPilot(seed * 7), new RandomPilot(seed * 13)] as const;
    let n = 0;
    while (!g.over && n < 5000) {
      const d = g.decision!;
      g.submit(pilots[d.player].choose(g, d));
      n++;
    }
    assert.ok(g.over, `seed ${seed}: game did not finish`);
    for (const p of [0, 1] as const) {
      const ps = g.state.p[p];
      const zones = [ps.deck, ps.hand, ps.discard, ps.prizes, ps.lost, ...allSlots(ps).map(slotCards), g.state.limbo.filter((c) => g.ctx.owner[c] === p)];
      if (g.state.stadium?.owner === p) zones.push([g.state.stadium.card]);
      const all = zones.flat();
      assert.equal(new Set(all).size, all.length, `seed ${seed}: a card is in two zones`);
      assert.equal(all.length, g.ctx.iids[p].length, `seed ${seed}: P${p + 1} lost or gained cards`);
    }
  }
});
