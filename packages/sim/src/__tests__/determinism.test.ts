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
  'f1dd29ec77667ff2',
  '463875b18814e9fa',
  '99322547f6eea095',
  'aa539e53fdf96adf',
  'dcc5ac3125accd87',
  '24fd44ec8a0c335d',
  '9777cdd599022455',
  '37b8f9b61a77393b',
  'fa2b406497358926',
  '48b4e069223edaae',
  'fe96d463526eafb2',
  '34e358e2e1763e8b',
  '8fcac70e06760e69',
  'e992aab78bd33ef7',
  'fa29011fcdd24b85',
  'f613198e4cccf0d1',
  'dc075e4945d5fc83',
  'c1d04423693886d9',
  'e44dfb2903d18d05',
  '3ed9aa059fe450f5',
  '058931d5ab07bd6e',
  '9e27f98472bc1c93',
  '782aa5bb538e36b5',
  '0a5f8228cb758a67',
  'da630e08aa403d4b',
  'bc04439d23dde7ef',
  '6d80759a9b9eb3f9',
  '36953fd9be87043b',
  '5e263ab4459a32e7',
  'b81b3e7a4537fc92',
  'f170cfdcffd8e00a',
  'c8605ee094b89589',
  'd72fdc324ebca3fa',
  '99e37bfda6dcc2a2',
  '5d5f6753834b926f',
  '56e2c9ebaee926eb',
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
