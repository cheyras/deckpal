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
  'ffa23bd9350201c0',
  '463875b18814e9fa',
  '99322547f6eea095',
  'aa539e53fdf96adf',
  'dcc5ac3125accd87',
  'cf4bd8674362d1d4',
  '9777cdd599022455',
  'aeea45828c74b302',
  'fa2b406497358926',
  '59bff6fd7dccf425',
  'd580f4fcb7622cf8',
  '34e358e2e1763e8b',
  '089cc930aa4f2de3',
  'e992aab78bd33ef7',
  '185ccabccfb80336',
  'f613198e4cccf0d1',
  'dc075e4945d5fc83',
  'c1d04423693886d9',
  '5e46bef910990cde',
  '3ed9aa059fe450f5',
  '058931d5ab07bd6e',
  '9e27f98472bc1c93',
  '782aa5bb538e36b5',
  'e7eed1854dba6454',
  '435885a9a359a7c6',
  '0b539a6fdda08276',
  'a04f6d9e361139b2',
  '36953fd9be87043b',
  '992d81905c5eb756',
  'b81b3e7a4537fc92',
  'e881e76ff867e560',
  'c8605ee094b89589',
  '98d4827514d954b8',
  '99e37bfda6dcc2a2',
  '5d5f6753834b926f',
  '1188d40bf5813ab0',
  '21df4f4eb88747f8',
  '7a470169ab4ea133',
  '4d1701c8edc02037',
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
