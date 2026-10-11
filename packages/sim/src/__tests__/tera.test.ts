/**
 * Tera Pokémon come from the printing table (cards/tera.ts), not only from a script's `fix.tera`: the catalog frames carry no
 * Tera marker, so before the table an unscripted Tera Pokémon, or a scripted one whose script left the flag out, played as a
 * plain Pokémon (and took Bench damage it is immune to).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAMES } from '../cards/frames-all.js';
import { buildDef } from '../cards/frame.js';
import { TERA_PRINTINGS } from '../cards/tera.js';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario } from '../scenario.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';

function choose(g: Game, text: string): void {
  const ls = describeOptions(g.ctx, g.state, g.decision as Decision);
  const i = ls.findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${ls.join(' | ')}`);
  g.submit([i]);
}

test('every Tera printing in the catalog builds a Tera definition, scripted or not', () => {
  const listed = [...TERA_PRINTINGS].filter((id) => FRAMES[id]);
  assert.ok(listed.length >= 30, `the table reaches the catalog (${listed.length} printings)`);
  for (const id of listed) assert.ok(buildDef(0, FRAMES[id]!, null, 't').tera, `${id} ${FRAMES[id]!.name} is a Tera Pokémon`);
  // A Pokémon ex that is not in the table is not Tera.
  const plain = Object.values(FRAMES).find((f) => f.suffix === 'ex' && !TERA_PRINTINGS.has(f.cardId))!;
  assert.ok(!buildDef(0, plain, null, 't').tera, `${plain.cardId} ${plain.name} is not Tera`);
});

test('a Benched Tera Pokémon whose script never set fix.tera takes no damage from attacks (Terapagos ex)', () => {
  assert.ok(TERA_PRINTINGS.has('me02.5-179'));
  const dk = fromIds('tera', [['me03-021', 4], ['me02.5-179', 4], ['me03-022', 4], ['mee-003', 30]]);
  const g = scenario(dk, dk, [
    { active: 'Mega Starmie ex', energy: { active: ['Water Energy'] } },
    { active: 'Lapras ex', bench: ['Terapagos ex'] },
  ]);
  assert.ok(def(g.ctx, g.state.p[1].bench[0]!.cards[0]!).tera);
  choose(g, 'Attack: Jetting Blow'); // "This attack also does 50 damage to 1 of your opponent's Benched Pokémon."
  choose(g, 'Terapagos ex');
  assert.equal(g.state.p[1].bench[0]!.damage, 0, 'a Tera Pokémon on the Bench takes no damage from attacks');
});
