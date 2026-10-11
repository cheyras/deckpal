/**
 * Speed work must not change a single game: 40 seeded games across the meta lists (heuristic pilots, and the search pilot for every
 * fifth) hash their full event logs, and the hashes are pinned. Changing a rule or a card on purpose changes them: regenerate with
 *   DETERMINISM_PRINT=1 node --import tsx --test src/__tests__/determinism.test.ts
 * and paste the printed list over GOLDEN, in the same commit as the rule change.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createContext } from '../context.js';
import { Game } from '../game.js';
import { playOut } from '../play.js';
import { makePilot } from '../pilot/index.js';
import { fromIds } from './decks.js';
import { META_LISTS } from './meta/index.js';

const NAMES = Object.keys(META_LISTS);
const GAMES = 40;

function hashGame(i: number): string {
  const a = fromIds(NAMES[i % NAMES.length] as string, META_LISTS[NAMES[i % NAMES.length] as string] as [string, number][]);
  const bn = NAMES[(i * 3 + 1) % NAMES.length] as string;
  const b = fromIds(bn, META_LISTS[bn] as [string, number][]);
  const ctx = createContext(a, b, { first: (i % 2) as 0 | 1, maxTurns: 60, events: true });
  const seed = 9000 + i;
  const kind = i % 5 === 0 ? 'search' : i % 2 === 0 ? 'greedy' : 'policy';
  const g = playOut(new Game(ctx, null, seed), [makePilot(kind, seed * 2 + 1), makePilot(kind, seed * 2 + 2)]);
  const h = createHash('sha1');
  h.update(JSON.stringify(g.events));
  h.update(`|${g.state.winner}|${g.state.turn}|${g.state.winReason}`);
  return h.digest('hex').slice(0, 16);
}

const GOLDEN: string[] = [
  '3c00a3e45cebf680',
  '463875b18814e9fa',
  '99322547f6eea095',
  'aa539e53fdf96adf',
  'deb25e2787f1b1c5',
  '90773aa949cc2aa8',
  '49724523b0a3f0b4',
  '37b8f9b61a77393b',
  '203141ad9255dfd0',
  '48b4e069223edaae',
  'aab6bc5d36bb948c',
  '34e358e2e1763e8b',
  '8fcac70e06760e69',
  'e992aab78bd33ef7',
  'fa29011fcdd24b85',
  'aca4cb30e3874cc9',
  '92fe7b61b7cd8acd',
  'c1d04423693886d9',
  'c5057f3d9226b725',
  '3ed9aa059fe450f5',
  'f382dc2ae236ec1c',
  '9e27f98472bc1c93',
  '782aa5bb538e36b5',
  '0a5f8228cb758a67',
  'da630e08aa403d4b',
  'f910c321a34d7879',
  '44719b407cab5f99',
  '36953fd9be87043b',
  '5e263ab4459a32e7',
  'b81b3e7a4537fc92',
  '3d42ae1fedeb16a4',
  'c8605ee094b89589',
  'f036a4a9918ee00a',
  '6c38b132b3841ebf',
  '5d5f6753834b926f',
  'd26295ee4a2fce46',
  'af02615c7dfb97d6',
  '7a470169ab4ea133',
  '99746b85d4bef759',
  'b4e6fab87435e66f',
];

test('seeded meta games produce byte-identical event logs', () => {
  const got = Array.from({ length: GAMES }, (_, i) => hashGame(i));
  if (process.env.DETERMINISM_PRINT) {
    console.log(JSON.stringify(got, null, 2));
    return;
  }
  assert.deepEqual(got, GOLDEN);
});
