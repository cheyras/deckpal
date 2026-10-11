/**
 * Printed Weakness/Resistance (cards/printed-wr.ts): the catalog lacks them for 157 Black Bolt, White Flare and promo
 * printings, so the table fills them in wherever a frame enters the engine -- the snapshot, the frames the app passes at
 * runtime, and script lookup.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { FRAMES } from '../cards/frames-all.js';
import { PRINTED_WR, withPrintedWR } from '../cards/printed-wr.js';
import { scriptFor } from '../cards/registry.js';
import { textKey } from '../cards/frame.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario } from '../scenario.js';
import type { CardFrame, Decision } from '../types.js';
import { fromIds } from './decks.js';

const SCOLIPEDE = 'sv10.5b-056'; // Darkness, 160 HP, Weakness Fighting x2 (printed; the catalog frame has none)
const EXCADRILL = 'sv10.5b-046'; // Fighting; Piercing Drill {F}{F}: 60
const ENERGY: [string, number][] = [['mee-006', 10]]; // Fighting Energy

/** What the app would pass: the catalog frame as it stands, with no Weakness or Resistance. */
const bare = (id: string): CardFrame => ({ ...FRAMES[id]!, weaknesses: [], resistances: [] });

function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
/** Excadrill (P1, {F}{F}) hits the other side's Active Pokémon with Piercing Drill; returns the damage it took. */
function drillOn(defender: CardFrame): number {
  const dk = fromIds('wr', [...ENERGY, [EXCADRILL, 4]]);
  dk.cards.push({ frame: defender, count: 4 });
  const g = scenario(dk, dk, [{ active: defender.name }, { active: 'Excadrill ex', energy: { active: ['Fighting Energy', 'Fighting Energy'] } }], { current: 1, turn: 4 });
  const i = labels(g).findIndex((l) => l.includes('Attack: Piercing Drill'));
  assert.ok(i >= 0, `no Piercing Drill in: ${labels(g).join(' | ')}`);
  g.submit([i]);
  return g.state.p[0].active!.damage;
}

test('a patched printing has its printed Weakness in a game: the right type doubles the damage', () => {
  assert.deepEqual(FRAMES[SCOLIPEDE]!.weaknesses, [{ type: 'Fighting', value: '×2' }], 'the snapshot carries it');
  assert.equal(drillOn(FRAMES[SCOLIPEDE]!), 120, 'Fighting 60, doubled');
  // Frames the app supplies at runtime come without it; the engine fills it in when it builds the decks.
  assert.equal(drillOn(bare(SCOLIPEDE)), 120, 'a runtime frame with no Weakness gets it too');
});

test('the printed Resistance is applied too (Tranquill resists Fighting -30)', () => {
  const tranquill = 'sv10.5b-072';
  assert.deepEqual(PRINTED_WR[tranquill]!.resistances, [{ type: 'Fighting', value: '-30' }]);
  const dk = fromIds('wr', [...ENERGY, [EXCADRILL, 4]]);
  dk.cards.push({ frame: bare(tranquill), count: 4 });
  const g = scenario(dk, dk, [{ active: 'Tranquill' }, { active: 'Excadrill ex', energy: { active: ['Fighting Energy', 'Fighting Energy'] } }], { current: 1, turn: 4 });
  const defn = def(g.ctx, g.state.p[0].active!.cards[0]!);
  assert.deepEqual(defn.resistance, { type: 'Fighting', amount: 30 });
  g.submit([labels(g).findIndex((l) => l.includes('Attack: Piercing Drill'))]);
  assert.equal(g.state.p[0].active!.damage, 30, '60 - 30');
});

test('an unpatched frame is untouched', () => {
  // A frame that carries its own Weakness keeps it, even when the table has the id.
  const own: CardFrame = { ...FRAMES[SCOLIPEDE]!, weaknesses: [{ type: 'Water', value: '×2' }], resistances: [] };
  assert.equal(withPrintedWR(own), own, 'returned as is');
  assert.deepEqual(own.weaknesses, [{ type: 'Water', value: '×2' }]);
  // A frame with only a Resistance is also left alone: the catalog has data for it.
  const onlyRes: CardFrame = { ...bare(SCOLIPEDE), resistances: [{ type: 'Grass', value: '-30' }] };
  assert.equal(withPrintedWR(onlyRes), onlyRes);
  // An id the table does not list is returned as is, with no Weakness invented.
  const unlisted = { ...FRAMES['sv06-130']!, weaknesses: [], resistances: [] }; // Dragapult ex: no Weakness, printed that way
  assert.equal(withPrintedWR(unlisted), unlisted);
  assert.equal(drillOn(FRAMES['sv06-130']!), 60, 'no Weakness, no Resistance');
  // The input is never mutated.
  const raw = bare(SCOLIPEDE);
  const filled = withPrintedWR(raw);
  assert.notEqual(filled, raw);
  assert.deepEqual(raw.weaknesses, []);
  assert.deepEqual(filled.weaknesses, [{ type: 'Fighting', value: '×2' }]);
  assert.notEqual(filled.weaknesses, PRINTED_WR[SCOLIPEDE]!.weaknesses, 'a copy, not the shared table row');
});

test('a promo printing now shares the main-set printing\'s script', () => {
  // Glaceon svp-171 and sv06-054 have identical game text; the promo frame used to lack the Weakness, so it had its own key.
  const promo = FRAMES['svp-171']!;
  const main = FRAMES['sv06-054']!;
  assert.equal(textKey(promo), textKey(main));
  const s = scriptFor(promo);
  assert.ok(s, 'the promo has a script');
  assert.equal(s, scriptFor(main), 'the same script');
  assert.equal(scriptFor(bare('svp-171')), s, 'and so does the catalog frame the app passes');
});
