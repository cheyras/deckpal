/**
 * The evolution parent of every Stage 1 / Stage 2 Pokémon in the frame snapshot. The catalog leaves `evolvesFrom` empty for part of
 * the 30th Celebration set, and `mayEvolve` (query.ts) names the parent: with none, nothing can evolve into the card. The gaps are
 * filled by cards/evolves-from.ts where a frame enters the engine; this file audits the whole snapshot and plays three of the cards.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, def } from '../context.js';
import { describeOptions } from '../describe.js';
import { EVOLVES_FROM, withEvolvesFrom } from '../cards/evolves-from.js';
import { EXTRA_FRAMES } from '../cards/frames-extra/index.js';
import { FRAMES } from '../cards/frames-all.js';
import { FRAMES as BASE_FRAMES } from '../cards/frames.js';
import { scriptById, scriptFor } from '../cards/registry.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { CardFrame, Decision } from '../types.js';
import { fromIds } from './decks.js';

const isEvolution = (f: CardFrame): boolean => f.category === 'Pokemon' && (f.stage === 'Stage1' || f.stage === 'Stage2');
const stageOf = (f: CardFrame): number => (f.stage === 'Stage2' ? 2 : f.stage === 'Stage1' ? 1 : 0);

test('every Stage 1 and Stage 2 Pokémon in the snapshot has an evolution parent the engine can use, and the parent is an earlier stage that exists', () => {
  const missing: string[] = [];
  const dangling: string[] = [];
  const byName = new Map<string, Set<number>>();
  const trainers = new Set(Object.values(FRAMES).filter((f) => f.category === 'Trainer').map((f) => f.name.trim()));
  for (const f of Object.values(FRAMES)) if (f.category === 'Pokemon') (byName.get(f.name.trim()) ?? byName.set(f.name.trim(), new Set()).get(f.name.trim())!).add(stageOf(f));
  for (const f of Object.values(FRAMES)) {
    if (!isEvolution(f)) continue;
    const parent = f.evolvesFrom ?? scriptById(f.cardId)?.fix?.evolvesFrom ?? null;
    if (!parent) {
      missing.push(`${f.cardId} ${f.name}`);
      continue;
    }
    // Stage 1 evolves from a Basic; Stage 2 from a Stage 1. (A fossil Trainer is a "Basic" by its own rule: Antique Root Fossil.)
    if (trainers.has(parent.trim())) continue;
    if (!byName.get(parent.trim())?.has(stageOf(f) - 1)) dangling.push(`${f.cardId} ${f.name} evolves from "${parent}", which is no stage ${stageOf(f) - 1} Pokémon in the snapshot`);
  }
  assert.deepEqual(missing, [], `Evolution Pokémon with no evolution parent: ${missing.join(', ')}`);
  assert.deepEqual(dangling, []);
});

test('the parent table only fills gaps: a catalog value wins, the input is not touched, and every entry names a frame that lacked one', () => {
  const raw = EXTRA_FRAMES['30th-084']!;
  assert.equal(raw.evolvesFrom, null, 'the snapshot keeps the catalog as it came');
  const filled = withEvolvesFrom(raw);
  assert.equal(filled.evolvesFrom, 'Palpitoad');
  assert.equal(raw.evolvesFrom, null, 'never mutates the input');
  const catalog = { ...raw, evolvesFrom: 'Something Else' };
  assert.equal(withEvolvesFrom(catalog), catalog, 'a catalog value wins and the same object comes back');
  const vanilla = FRAMES['sv06-128']!;
  assert.equal(withEvolvesFrom(vanilla), vanilla);
  // No stale entry: each names an Evolution Pokémon whose raw frame has no parent.
  for (const id of Object.keys(EVOLVES_FROM)) {
    const f = { ...BASE_FRAMES, ...EXTRA_FRAMES }[id];
    assert.ok(f && isEvolution(f) && !f.evolvesFrom, `${id} is an Evolution Pokémon with no catalog parent`);
  }
});

test('a raw catalog frame gets its parent where it enters the engine, and still finds its script', () => {
  const raw = EXTRA_FRAMES['30th-084']!;
  const ctx = createContext({ name: 'a', cards: [{ frame: raw, count: 1 }] }, { name: 'b', cards: [{ frame: raw, count: 1 }] });
  assert.equal(ctx.defs.find((d) => d.name === 'Seismitoad')!.evolvesFrom, 'Palpitoad');
  assert.equal(scriptFor(raw)?.id, '30th-084');
  assert.equal(scriptFor(FRAMES['30th-084']!)?.id, '30th-084');
});

// ------------------------------------------------------------------ evolving from the hand

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const deckOf = (...ids: string[]) => fromIds('evo', [...ids.map((id): [string, number] => [id, 4]), ['sv06-128', 4], ...ENERGY]);
function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const activeName = (g: Game): string => nameOf(g, g.state.p[0].active!.cards.at(-1) as number);

// [title, parent id, evolution id, parent name, evolution name]
const cases: [string, string, string, string, string][] = [
  ['Seismitoad (30th-084)', 'sv10.5b-020', '30th-084', 'Palpitoad', 'Seismitoad'],
  ['Lucario (30th-083)', 'me01-076', '30th-083', 'Riolu', 'Lucario'],
  ['Lycanroc (30th-085)', 'sv09-084', '30th-085', 'Rockruff', 'Lycanroc'],
  ['Lycanroc (30th-138)', 'sv09-084', '30th-138', 'Rockruff', 'Lycanroc'],
];
for (const [title, fromId, intoId, from, into] of cases) {
  test(`${title} evolves from ${from} in the hand, and only from it`, () => {
    const dk = deckOf(fromId, intoId);
    const mk = (active: string): Game => scenario(dk, dk, [{ active, hand: [into] } as SideLayout, { active: 'Dreepy' }]);
    const g = mk(from);
    const opt = labels(g).findIndex((l) => l.includes(`Evolve ${from} (Active) into ${into}`));
    assert.ok(opt >= 0, `no way to evolve ${from} into ${into}: ${labels(g).join(' | ')}`);
    g.submit([opt]);
    assert.equal(activeName(g), into);
    // Not from a Pokémon that is not its parent.
    const wrong = mk('Dreepy');
    assert.ok(!labels(wrong).some((l) => l.includes(`into ${into}`)), `${into} must not evolve Dreepy`);
  });
}
