/**
 * Card tests, lane "blaziken" (Dragapult ex / Blaziken ex, meta/blaziken.ts):
 * every card in scripts/meta-blaziken.ts does what its printed text says in a
 * constructed position (quotes are the text from frames-extra/blaziken.ts).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { RandomPilot } from '../pilot/random.js';
import { scenario, type SideLayout } from '../scenario.js';
import { META_BLAZIKEN } from '../cards/scripts/meta-blaziken.js';
import { allSlots, slotCards, topCard } from '../state.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';
import { gauntletDeck } from './gauntlet.js';
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
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}

const DECK_NAME = 'Dragapult ex / Blaziken ex';
const BLZ = fromIds(DECK_NAME, META_LISTS[DECK_NAME]!);
const DRAG = gauntletDeck('Dragapult ex');
type Sides = [SideLayout, SideLayout];
const H = (s: Sides) => scenario(BLZ, BLZ, s);
const R = 'Fire Energy';
const BLAZIKEN = (): SideLayout => ({ active: 'Torchic', evolve: { active: ['Combusken', 'Blaziken ex'] } });

// ------------------------------------------------------------------ Pokémon

test('Torchic, Collect: draw a card', () => {
  const g = H([{ active: 'Torchic', energy: { active: [R] } }, { active: 'Fezandipiti ex' }]);
  const before = g.state.p[0].hand.length;
  choose(g, 'Attack: Collect');
  assert.equal(g.state.p[0].hand.length, before + 1);
});

test('Combusken, Double Kick: 40 damage for each heads of 2 coins (0, 1 and 2 heads)', () => {
  for (const [coins, dmg] of [[[false, false], 0], [[true, false], 40], [[true, true], 80]] as const) {
    const g = H([{ active: 'Torchic', evolve: { active: ['Combusken'] }, energy: { active: [R, R] } }, { active: 'Fezandipiti ex' }]);
    g.state.forcedCoins = [...coins];
    choose(g, 'Attack: Double Kick');
    assert.equal(g.state.p[1].active!.damage, dmg, `${coins}`);
  }
});

test('Blaziken ex, Seething Spirit: attach a Basic Energy from the discard pile to 1 of your Pokémon, once a turn', () => {
  const g = H([{ ...BLAZIKEN(), bench: ['Dreepy'], discard: [R, 'Psychic Energy'] }, { active: 'Fezandipiti ex' }]);
  choose(g, 'Seething Spirit');
  choose(g, 'Psychic Energy');
  choose(g, 'Dreepy');
  const bench = g.state.p[0].bench[0]!;
  assert.deepEqual(names(g, bench.energy), ['Psychic Energy']);
  assert.deepEqual(names(g, g.state.p[0].discard), [R]);
  assert.ok(!has(g, 'Seething Spirit'), 'used twice in a turn');
});

test('Blaziken ex, Seething Spirit: not usable with no Basic Energy in the discard pile', () => {
  const g = H([{ ...BLAZIKEN(), discard: ['Ultra Ball'] }, { active: 'Fezandipiti ex' }]);
  assert.ok(!has(g, 'Seething Spirit'));
});

test("Blaziken ex, Smolder-sault: 200 damage, and it can't attack during your next turn", () => {
  const g = H([{ ...BLAZIKEN(), energy: { active: [R, R] } }, { active: 'Fezandipiti ex' }]);
  choose(g, 'Attack: Smolder-sault');
  assert.equal(g.state.p[1].active!.damage, 200);
  choose(g, 'End turn');
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Blaziken ex');
  assert.ok(!has(g, 'Attack: Smolder-sault'), 'attacked the turn after Smolder-sault');
});

// ------------------------------------------------------------------ Trainers

test('Dawn: search for a Basic, a Stage 1 and a Stage 2 Pokémon, reveal them, put them into your hand, shuffle', () => {
  // The deck holds 1 Combusken: keep the line out of the Prizes.
  const g = H([{ active: 'Dreepy', hand: ['Dawn'], deckTop: ['Torchic', 'Combusken', 'Blaziken ex'] }, { active: 'Fezandipiti ex' }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Play Dawn');
  choose(g, 'Torchic');
  choose(g, 'Combusken');
  choose(g, 'Blaziken ex');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Blaziken ex', 'Combusken', 'Torchic']);
  assert.equal(g.state.p[0].deck.length, deckBefore - 3);
});

test('Dawn: each pick is one stage (the Basic pick offers no Stage 1 or Stage 2)', () => {
  const g = H([{ active: 'Dreepy', hand: ['Dawn'] }, { active: 'Fezandipiti ex' }]);
  choose(g, 'Play Dawn');
  assert.ok(has(g, 'Torchic') && has(g, 'Dreepy'));
  assert.ok(!has(g, 'Combusken') && !has(g, 'Drakloak') && !has(g, 'Blaziken ex') && !has(g, 'Dragapult ex'));
});

// ------------------------------------------------------------------ Coverage and play

test('lane blaziken: no card of the Dragapult ex / Blaziken ex list is approximated or unplayable', () => {
  const ctx = createContext(BLZ, DRAG);
  const bad = ctx.defs.filter((x) => x.coverage === 'approx' || x.coverage === 'none').map((x) => `${x.id} ${x.name}`);
  assert.deepEqual(bad, []);
  const mine = new Set(META_BLAZIKEN.map((s) => s.name));
  assert.equal(ctx.defs.filter((x) => mine.has(x.name)).length, mine.size);
});

test('lane blaziken: 40 random games, no crash, every card stays in exactly one zone', () => {
  const pairs = [[BLZ, DRAG], [DRAG, BLZ], [BLZ, BLZ]] as const;
  let games = 0;
  for (let seed = 1; games < 40; seed++) {
    const [a, b] = pairs[seed % pairs.length]!;
    const g = new Game(a, b, seed, { maxTurns: 40 }).start();
    const pilots = [new RandomPilot(seed * 7), new RandomPilot(seed * 13)] as const;
    for (let i = 0; i < 4000 && !g.over; i++) {
      const d = g.decision!;
      g.submit(pilots[d.player].choose(g, d));
    }
    for (const p of [0, 1] as const) {
      const ps = g.state.p[p];
      const all = [...ps.deck, ...ps.hand, ...ps.discard, ...ps.prizes, ...ps.lost, ...allSlots(ps).flatMap(slotCards), ...g.state.limbo.filter((c) => g.ctx.owner[c] === p)];
      if (g.state.stadium?.owner === p) all.push(g.state.stadium.card);
      assert.equal(new Set(all).size, all.length, `${a.name} v ${b.name} seed ${seed}: a card is in two zones`);
      assert.equal(all.length, g.ctx.iids[p].length, `${a.name} v ${b.name} seed ${seed}: a card went missing`);
    }
    games++;
  }
});
