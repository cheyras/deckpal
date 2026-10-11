/**
 * Card tests, lane "darkrai": the Mega Darkrai ex meta list (meta/darkrai.ts).
 * Every card the lane scripts does what its printed text says in a constructed
 * position; quotes are the printed text from frames-extra/darkrai.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { RandomPilot } from '../pilot/random.js';
import { maxHp } from '../query.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { FRAMES, scriptFor } from '../cards/registry.js';
import { allSlots, slotCards } from '../state.js';
import type { Decision } from '../types.js';
import { BURNED, CONFUSED, POISONED } from '../types.js';
import { fromIds } from './decks.js';
import { gauntletDeck } from './gauntlet.js';
import { LIST } from './meta/darkrai.js';
import { META_LISTS } from './meta/index.js';

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

const DK_NAME = 'Mega Darkrai ex';
const DRK = fromIds(DK_NAME, LIST);
const DRAGAPULT = gauntletDeck('Dragapult ex');
/** P1 plays Mega Darkrai ex, P2 Dragapult ex. */
const D = (sides: [SideLayout, SideLayout], o: ScenarioOptions = {}) => scenario(DRK, DRAGAPULT, sides, o);
const DK = 'Darkness Energy';
const DRAPULT: SideLayout = { active: 'Dreepy', evolve: { active: ['Drakloak', 'Dragapult ex'] } };

test('the Mega Darkrai ex list is 60 cards and registered in the meta gauntlet', () => {
  assert.equal(LIST.reduce((n, [, c]) => n + c, 0), 60);
  assert.equal(META_LISTS[DK_NAME], LIST);
});

// ------------------------------------------------------------------ Pokémon

test('Mega Darkrai ex, Dusk Raid: 110, +110 only when a Benched Pokémon has damage counters', () => {
  const g = D([{ active: 'Mega Darkrai ex', bench: ['Meowth ex'], energy: { active: [DK, DK] } }, DRAPULT]);
  choose(g, 'Attack: Dusk Raid');
  assert.equal(g.state.p[1].active!.damage, 110, 'no damaged Benched Pokémon');

  const h = D([{ active: 'Mega Darkrai ex', bench: ['Meowth ex', 'Latias ex'], energy: { active: [DK, DK] }, damage: { 1: 10 } }, DRAPULT]);
  choose(h, 'Attack: Dusk Raid');
  assert.equal(h.state.p[1].active!.damage, 220, 'one damage counter on a Benched Pokémon');

  // Damage on the Active itself does not count ("your Benched Pokémon").
  const k = D([{ active: 'Mega Darkrai ex', bench: ['Meowth ex'], energy: { active: [DK, DK] }, damage: { active: 50 } }, DRAPULT]);
  choose(k, 'Attack: Dusk Raid');
  assert.equal(k.state.p[1].active!.damage, 110);
});

test("Mega Darkrai ex, Abyss Eye: Knocks Out the opponent's Active only if it has a Special Condition", () => {
  const g = D([{ active: 'Mega Darkrai ex', energy: { active: [DK, DK, DK] } }, { ...DRAPULT, bench: ['Dreepy'] }]);
  choose(g, 'Attack: Abyss Eye');
  assert.equal(g.state.p[1].active!.damage, 0);
  assert.ok(!names(g, g.state.p[1].discard).includes('Dragapult ex'), 'no condition, no Knock Out');

  for (const cond of [POISONED, BURNED, CONFUSED]) {
    const h = D([{ active: 'Mega Darkrai ex', energy: { active: [DK, DK, DK] } }, { ...DRAPULT, bench: ['Dreepy'], cond }]);
    choose(h, 'Attack: Abyss Eye');
    assert.ok(names(h, h.state.p[1].discard).includes('Dragapult ex'), `cond ${cond}: Knocked Out`);
    assert.equal(h.state.p[0].prizes.length, 4, 'a Pokémon ex is worth 2 Prize cards');
  }
});

test("Volcanion ex, Scalding Steam: Burns the opponent's Active, only from the Active Spot; Scorching Cyclone 160 and moves an Energy to the Bench", () => {
  const g = D([{ active: 'Volcanion ex' }, DRAPULT]);
  choose(g, 'Scalding Steam');
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);
  assert.ok(!has(g, 'Scalding Steam'), 'once a turn');

  const b = D([{ active: 'Meowth ex', bench: ['Volcanion ex'] }, DRAPULT]);
  assert.ok(!has(b, 'Scalding Steam'), 'not from the Bench');

  // The Darkrai list runs no Fire Energy; a Fire test deck pays for Scorching Cyclone.
  const FIRE = fromIds('Volcanion test', [['sv09-031', 4], ['me03-062', 4], ['mee-002', 52]]);
  const c = scenario(FIRE, DRAGAPULT, [{ active: 'Volcanion ex', bench: ['Meowth ex'], energy: { active: ['Fire Energy', 'Fire Energy', 'Fire Energy'] } }, DRAPULT]);
  choose(c, 'Attack: Scorching Cyclone');
  assert.equal(c.state.p[1].active!.damage, 160);
  assert.equal(c.state.p[0].active!.energy.length, 2);
  assert.equal(c.state.p[0].bench[0]!.energy.length, 1, 'one Energy moved to the Benched Pokémon');
});

// ------------------------------------------------------------------ Trainers

test('Cyrano: up to 3 Pokémon ex from the deck to the hand, never a non-ex card', () => {
  const g = D([{ active: 'Meowth ex', hand: ['Cyrano'] }, DRAPULT]);
  choose(g, 'Play Cyrano');
  assert.ok(!has(g, 'Ultra Ball') && !has(g, 'Darkness Energy'), 'only Pokémon ex are offered');
  pick(g, ['Mega Darkrai ex', 'Pecharunt ex', 'Volcanion ex']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Mega Darkrai ex', 'Pecharunt ex', 'Volcanion ex']);
});

test('Mega Signal: a Mega Evolution Pokémon ex only (not Meowth ex)', () => {
  const g = D([{ active: 'Meowth ex', hand: ['Mega Signal'] }, DRAPULT]);
  choose(g, 'Play Mega Signal');
  assert.ok(!has(g, 'Meowth ex') && !has(g, 'Latias ex'), 'non-Mega Pokémon ex are not offered');
  pick(g, ['Mega Kangaskhan ex']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Mega Kangaskhan ex']);
});

test('Dark Bell: both Active non-Darkness Pokémon are Confused; a Darkness Active is not', () => {
  const g = D([{ active: 'Mega Darkrai ex', hand: ['Dark Bell'] }, DRAPULT]);
  choose(g, 'Play Dark Bell');
  assert.equal(g.state.p[0].active!.cond & CONFUSED, 0, 'Mega Darkrai ex is {D}');
  assert.equal(g.state.p[1].active!.cond & CONFUSED, CONFUSED);

  const h = D([{ active: 'Meowth ex', hand: ['Dark Bell'] }, DRAPULT]);
  choose(h, 'Play Dark Bell');
  assert.equal(h.state.p[0].active!.cond & CONFUSED, CONFUSED, 'Meowth ex is {C}');
  assert.equal(h.state.p[1].active!.cond & CONFUSED, CONFUSED);
});

test("Lively Stadium: every Basic Pokémon in play, both players', gets +30 HP; Evolution Pokémon do not", () => {
  const g = D([{ active: 'Mega Darkrai ex', bench: ['Meowth ex'], hand: ['Lively Stadium'] }, { ...DRAPULT, bench: ['Dreepy'] }]);
  const env = g.envForInternals;
  assert.equal(maxHp(env, g.state, g.state.p[0].active!), 280);
  choose(g, 'Play Lively Stadium');
  assert.equal(maxHp(env, g.state, g.state.p[0].active!), 310);
  assert.equal(maxHp(env, g.state, g.state.p[0].bench[0]!), 170 + 30);
  assert.equal(maxHp(env, g.state, g.state.p[1].bench[0]!), 70 + 30, "the opponent's Basic too");
  assert.equal(maxHp(env, g.state, g.state.p[1].active!), 320, 'Dragapult ex is a Stage 2');
});

test("Battle Cage: Phantom Dive's damage counters can't be placed on the Bench; its damage is still taken", () => {
  const P2 = { ...DRAPULT, energy: { active: ['Fire Energy', 'Psychic Energy'] } };
  const g = D([{ active: 'Mega Darkrai ex', bench: ['Meowth ex'], hand: ['Battle Cage'] }, P2]);
  choose(g, 'Play Battle Cage');
  choose(g, 'End turn');
  choose(g, 'Attack: Phantom Dive');
  assert.equal(g.state.p[0].active!.damage, 200, 'damage from attacks is still taken');
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'no damage counters on the Bench');

  const h = D([{ active: 'Mega Darkrai ex', bench: ['Meowth ex'] }, P2]);
  choose(h, 'End turn');
  choose(h, 'Attack: Phantom Dive');
  assert.equal(h.state.p[0].bench[0]!.damage, 60, 'without Battle Cage, 6 counters land');
});

// ------------------------------------------------------------------ The deck as a whole

test('lane darkrai: every card of the Mega Darkrai ex list is fully covered (no approximated or unscripted text)', () => {
  const ctx = createContext(DRK, DRK);
  const bad = ctx.defs.filter((x) => x.coverage !== 'full' && x.coverage !== 'vanilla').map((x) => `${x.id} ${x.name} (${x.coverage})`);
  assert.deepEqual(bad, []);
  for (const [id] of LIST) assert.ok(FRAMES[id], `frame ${id}`);
  for (const id of ['me05-048', 'sv09-031', 'sv08-170', 'me01-121', 'me05-075', 'sv08-180', 'me02-085']) {
    assert.equal(scriptFor(FRAMES[id]!)?.id, id, `${id} resolves to this lane's script`);
  }
});

test('lane darkrai: 40 random games of Mega Darkrai ex vs Dragapult ex never crash and keep every card in one zone', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = new Game(seed % 2 ? DRK : DRAGAPULT, seed % 2 ? DRAGAPULT : DRK, seed).start();
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
