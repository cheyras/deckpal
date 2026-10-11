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
  'c2f026443b93fb02',
  '463875b18814e9fa',
  '99322547f6eea095',
  'e59a89d614a8202e',
  '65ab8b2e33148cc6',
  'afae1e45205561e1',
  '777af656e62b0008',
  '362f0070f2a708ec',
  'fa2b406497358926',
  '4d4073c2e4ae36c5',
  '1b3697f72d40c5b7',
  '827d322aaaaf8e72',
  '0bcd4aa7005cfd5a',
  '7aed64fc4af1ead3',
  'cac5d5190f4071ed',
  '63ae8a3db5899367',
  '7c52bdf25509f31d',
  'a7e532270ecb4894',
  'c964d1a2c6e354e1',
  '1025e99d4ba71acf',
  '2a6dfffb81254d2e',
  'c9ddac7b31fc92cc',
  '45a6cea4fc40beda',
  '69d900b2d66c445b',
  '493f59edecff1b97',
  '727943efb13a0360',
  '42d11d4e229aba04',
  '36953fd9be87043b',
  'a816a7c4a9c3d2cf',
  '23b237fb7456f4ed',
  '80fc072d55d7d57d',
  '83731cf82fa6e4ee',
  '5c233570bc1e3677',
  '6c38b132b3841ebf',
  'bf7e1be5497ef676',
  'f324f741f92b32df',
  'f577f238f1aaa1e1',
  '0dfc445ff42c0b44',
  'b3a5500868b55735',
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
