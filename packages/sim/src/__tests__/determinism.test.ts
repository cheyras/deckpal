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
  '927617cb42db63fd',
  '463875b18814e9fa',
  '99322547f6eea095',
  'e59a89d614a8202e',
  'dcc5ac3125accd87',
  '2f90d2f7ea2e3f49',
  'c82574b3758c75ea',
  '362f0070f2a708ec',
  '5f96e7d1650b9674',
  '4d4073c2e4ae36c5',
  '8c079ebf1138549a',
  '827d322aaaaf8e72',
  '4f71f3a1e6422dc3',
  '7aed64fc4af1ead3',
  'd8b7ee5c00fef24b',
  'b0db49060faf5500',
  '883a0c5227b7c6b9',
  'a7e532270ecb4894',
  '182187b3c1d1e5fc',
  '1025e99d4ba71acf',
  '941a9c36f7c7535d',
  'c9ddac7b31fc92cc',
  '28a6c448ac2a386c',
  '69d900b2d66c445b',
  'afd8a0e8fa77731d',
  'b1867c26aff16574',
  'a35c219c66fba168',
  '36953fd9be87043b',
  '5e263ab4459a32e7',
  '23b237fb7456f4ed',
  'e6019260cc2efaed',
  '83731cf82fa6e4ee',
  '4624d3363edd2f86',
  '6c38b132b3841ebf',
  '64495ccdee1cadf4',
  '523a3a49c9a397ed',
  'f577f238f1aaa1e1',
  '0dfc445ff42c0b44',
  '53cd171bfffdda62',
  '081abfd8b1ab79bf',
];

test('seeded meta games produce byte-identical event logs', () => {
  const got = Array.from({ length: GAMES }, (_, i) => hashGame(i));
  if (process.env.DETERMINISM_PRINT) {
    console.log(JSON.stringify(got, null, 2));
    return;
  }
  assert.deepEqual(got, GOLDEN);
});
