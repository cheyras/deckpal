/**
 * Card tests, meta lane "excadrill": every card this lane scripted does what its printed text says
 * in a constructed position (quotes are the printed text from frames-extra/excadrill.ts), and the
 * Mega Excadrill ex list plays random games to the end without losing a card.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { RandomPilot } from '../pilot/random.js';
import { effectsPrevented, maxHp } from '../query.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { allSlots, slotCards } from '../state.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';
import { gauntletDeck } from './gauntlet.js';
import { LIST } from './meta/excadrill.js';

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
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => def(g.ctx, c).name).sort();
}

const EXC = fromIds('Mega Excadrill ex', LIST);
/** Scenarios place cards by name: the CRI Beldum (vanilla) becomes a 4th TEF Beldum so "Beldum" is always Iron Tackle's. */
const EXC_T = fromIds('Mega Excadrill ex (scenarios)', LIST.map(([id, n]): [string, number] => (id === 'me04-059' ? ['sv05-113', n] : [id, n])));
const X = (sides: [SideLayout, SideLayout], o: ScenarioOptions = {}) => scenario(EXC_T, EXC_T, sides, o);
const M = 'Metal Energy';
const MEGA: SideLayout = { active: 'Drilbur', evolve: { active: ['Mega Excadrill ex'] } };

// ------------------------------------------------------------------ Pokémon

test('Beldum, Iron Tackle: 50, and 10 damage to itself', () => {
  const g = X([{ active: 'Beldum', energy: { active: [M, M, M] } }, MEGA]);
  choose(g, 'Attack: Iron Tackle');
  assert.equal(g.state.p[1].active!.damage, 50);
  assert.equal(g.state.p[0].active!.damage, 10);
});

test('Metang, Metal Maker: attach any number of Basic {M} Energy from the top 4 in any way; the rest go to the bottom', () => {
  const g = X([{ active: 'Beldum', evolve: { active: ['Metang'] }, bench: ['Drilbur'], deckTop: [M, 'Piplup', M, M] }, MEGA]);
  const before = g.state.p[0].deck.length;
  choose(g, 'Use Metal Maker');
  assert.deepEqual(labels(g).length, 3, 'only the 3 Basic Metal Energy are offered');
  pick(g, [M, M]);
  choose(g, 'Metang');
  choose(g, 'Drilbur');
  const ps = g.state.p[0];
  assert.deepEqual(names(g, ps.active!.energy), [M]);
  assert.deepEqual(names(g, ps.bench[0]!.energy), [M]);
  assert.equal(ps.deck.length, before - 2);
  assert.deepEqual(names(g, ps.deck.slice(0, 2)), [M, 'Piplup'].sort(), 'the other 2 are on the bottom');
  assert.ok(!has(g, 'Use Metal Maker'), 'once during your turn');
});

test('Metang, Metal Maker: choosing none attaches nothing and still moves all 4 to the bottom', () => {
  const g = X([{ active: 'Beldum', evolve: { active: ['Metang'] }, deckTop: [M, 'Piplup', 'Drilbur', 'Kieran'] }, MEGA]);
  const top4 = g.state.p[0].deck.slice(-4);
  choose(g, 'Use Metal Maker');
  g.submit([]);
  const ps = g.state.p[0];
  assert.equal(ps.active!.energy.length, 0);
  assert.deepEqual(ps.deck.slice(0, 4).sort(), top4.slice().sort());
});

test('Drilbur, Call for Family: up to 2 Basic Pokémon onto the Bench', () => {
  const g = X([{ active: 'Drilbur', energy: { active: [M] } }, MEGA]);
  choose(g, 'Attack: Call for Family');
  pick(g, ['Beldum', 'Piplup']);
  assert.deepEqual(names(g, g.state.p[0].bench.map((b) => b.cards[0]!)), ['Beldum', 'Piplup']);
});

test('Piplup, Call for Support: a Supporter from the deck to the hand', () => {
  const g = X([{ active: 'Piplup', energy: { active: [M] } }, MEGA]);
  choose(g, 'Attack: Call for Support');
  assert.ok(labels(g).every((l) => !l.includes('Energy') && !l.includes('Poffin')), 'only Supporters are offered');
  choose(g, 'Kieran');
  assert.ok(names(g, g.state.p[0].hand).includes('Kieran'));
});

test("Empoleon ex, Emperor's Stance: effects of the opponent's attacks are prevented on it, not on others", () => {
  const g = X([{ active: 'Piplup', bench: ['Piplup'], evolve: { active: ['Empoleon ex'] } }, MEGA]);
  const env = g.envForInternals;
  assert.ok(effectsPrevented(env, g.state, g.state.p[0].active!, 1, 'attack'));
  assert.ok(!effectsPrevented(env, g.state, g.state.p[0].active!, 1, 'ability'), 'attacks only');
  assert.ok(!effectsPrevented(env, g.state, g.state.p[0].bench[0]!, 1, 'attack'));
});

test("Empoleon ex, Iron Feathers: 210, then 60 less damage during the opponent's next turn", () => {
  const g = X([{ active: 'Piplup', evolve: { active: ['Empoleon ex'] }, energy: { active: [M, M, M] } }, { ...MEGA, energy: { active: [M, M] } }]);
  choose(g, 'Attack: Iron Feathers');
  assert.equal(g.state.p[1].active!.damage, 210);
  choose(g, 'Attack: Undermine');
  assert.equal(g.state.p[0].active!.damage, 30, '90 − 60');
});

// ------------------------------------------------------------------ Trainers

test('Kieran: switch the Active Pokémon with a Benched one', () => {
  const g = X([{ active: 'Beldum', bench: ['Drilbur'], hand: ['Kieran'] }, MEGA]);
  choose(g, 'Play Kieran');
  choose(g, 'Switch your Active');
  if (g.decision?.kind === 'slots') choose(g, 'Drilbur');
  assert.equal(def(g.ctx, g.state.p[0].active!.cards[0]!).name, 'Drilbur');
  assert.equal(def(g.ctx, g.state.p[0].bench[0]!.cards[0]!).name, 'Beldum');
});

test("Kieran: +30 this turn against the opponent's Active Pokémon ex; not against a non-ex", () => {
  const g = X([{ active: 'Beldum', energy: { active: [M] }, hand: ['Kieran'] }, MEGA]);
  choose(g, 'Play Kieran');
  choose(g, '+30');
  choose(g, 'Attack: Dig Claws');
  assert.equal(g.state.p[1].active!.damage, 40);
  const n = X([{ active: 'Beldum', energy: { active: [M] }, hand: ['Kieran'] }, { active: 'Drilbur' }]);
  choose(n, 'Play Kieran');
  choose(n, '+30');
  choose(n, 'Attack: Dig Claws');
  assert.equal(n.state.p[1].active!.damage, 10);
});

test("Hero's Cape: +100 HP for the Pokémon it is attached to; an ACE SPEC", () => {
  const g = X([{ active: 'Beldum', bench: ['Drilbur'], hand: ["Hero's Cape"] }, MEGA]);
  choose(g, "Attach Hero's Cape to Beldum");
  const env = g.envForInternals;
  assert.equal(maxHp(env, g.state, g.state.p[0].active!), 170);
  assert.equal(maxHp(env, g.state, g.state.p[0].bench[0]!), 70);
  assert.ok(g.ctx.defs.find((d) => d.name === "Hero's Cape")?.aceSpec);
});

// ------------------------------------------------------------------ Coverage

test('lane excadrill: every card of the Mega Excadrill ex list is fully covered or vanilla (no approximations, no unscripted text)', () => {
  const ctx = createContext(EXC, EXC);
  const bad = ctx.defs.filter((d) => d.coverage !== 'full' && d.coverage !== 'vanilla').map((d) => `${d.id} ${d.name} (${d.coverage})`);
  assert.deepEqual(bad, []);
  assert.equal(LIST.reduce((a, [, n]) => a + n, 0), 60);
});

test('lane excadrill: 40 random games of the list never crash and keep every card in one zone', () => {
  const OPP = gauntletDeck('Genesect ex / Mega Skarmory ex (JKEpstein)');
  for (let seed = 1; seed <= 40; seed++) {
    const g = new Game(seed % 2 ? EXC : OPP, seed % 2 ? OPP : EXC, seed).start();
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

test('lane excadrill: a codeless log name still resolves to the base snapshot when only frames-extra adds another text', async () => {
  const { resolveFrame } = await import('../replay/cardCodes.js');
  assert.equal(resolveFrame('Metang').frame?.cardId, 'me04-060', 'the owner-deck Metang, not the meta lane one');
  assert.equal(resolveFrame('Metang', 'sv05-114').frame?.hp, 100, 'a code still picks the exact printing');
  assert.equal(resolveFrame('Riolu').frame, null, 'two texts in the base snapshot stay ambiguous');
});
