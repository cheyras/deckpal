import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveMove } from '../rekeySet.js';

/**
 * The address algebra behind `rekey:set` — pure, so it is the one part of a
 * command that MOVES PRODUCTION BYTES that can be proved without a database or a
 * bucket. What it has to get right is narrow and unforgiving: which rows are in
 * scope, and what their new address is. A row wrongly included is an image moved
 * out from under the page; a row wrongly excluded is a card that keeps serving a
 * placeholder.
 *
 * The live run is the other half of the proof (240 assets, both tiers, both
 * manifest checks clean — DECISIONS.md 2026-08-10); this is the half that keeps
 * running after the incident is forgotten.
 */

const rename = { from: 'swsh9.5tg', to: 'swsh9tg' };

test('card art: re-derives path and cache key under the new set id', () => {
  const mv = deriveMove(
    {
      cache_key: 'card:swsh9.5tg-TG01:low',
      kind: 'card',
      relative_path: 'images/en/swsh/swsh9.5tg/TG01.low.webp',
    },
    rename,
  );
  assert.deepEqual(mv, {
    oldKey: 'card:swsh9.5tg-TG01:low',
    oldPath: 'images/en/swsh/swsh9.5tg/TG01.low.webp',
    newKey: 'card:swsh9tg-TG01:low',
    newPath: 'images/en/swsh/swsh9tg/TG01.low.webp',
  });
});

test('card art: high quality moves too', () => {
  const mv = deriveMove(
    {
      cache_key: 'card:swsh9.5tg-TG30:high',
      kind: 'card',
      relative_path: 'images/en/swsh/swsh9.5tg/TG30.high.webp',
    },
    rename,
  );
  assert.equal(mv?.newPath, 'images/en/swsh/swsh9tg/TG30.high.webp');
  assert.equal(mv?.newKey, 'card:swsh9tg-TG30:high');
});

test('set imagery moves with the set', () => {
  const mv = deriveMove(
    { cache_key: 'set:swsh9.5tg:logo', kind: 'set-logo', relative_path: 'sets/swsh9.5tg/logo.webp' },
    rename,
  );
  assert.deepEqual(mv, {
    oldKey: 'set:swsh9.5tg:logo',
    oldPath: 'sets/swsh9.5tg/logo.webp',
    newKey: 'set:swsh9tg:logo',
    newPath: 'sets/swsh9tg/logo.webp',
  });
});

test('another set is out of scope even though its id contains the old one', () => {
  // The work-list query is a LIKE, which spans separators; the decision is this
  // function. `swsh9.5tgx` is a different set and must not be dragged along.
  assert.equal(
    deriveMove(
      {
        cache_key: 'card:swsh9.5tgx-TG01:low',
        kind: 'card',
        relative_path: 'images/en/swsh/swsh9.5tgx/TG01.low.webp',
      },
      rename,
    ),
    null,
  );
});

test('a localId that merely LOOKS like the set id is not the set segment', () => {
  assert.equal(
    deriveMove(
      {
        cache_key: 'card:sv01-swsh9.5tg:low',
        kind: 'card',
        relative_path: 'images/en/sv/sv01/swsh9.5tg.low.webp',
      },
      rename,
    ),
    null,
  );
});

test('a row whose key does not round-trip is left alone', () => {
  // `stale-duplicate:*` rows record a file under a serie the catalog disagrees
  // with. The path is under the old set id, but the key is not what paths.ts
  // would produce, so this command must not guess at a new one for it.
  assert.equal(
    deriveMove(
      {
        cache_key: 'stale-duplicate:images/en/swsh/swsh9.5tg/TG01.low.webp',
        kind: 'card',
        relative_path: 'images/en/swsh/swsh9.5tg/TG01.low.webp',
      },
      rename,
    ),
    null,
  );
});

test('a quality we do not serve is not a card asset', () => {
  assert.equal(
    deriveMove(
      {
        cache_key: 'card:swsh9.5tg-TG01:medium',
        kind: 'card',
        relative_path: 'images/en/swsh/swsh9.5tg/TG01.medium.webp',
      },
      rename,
    ),
    null,
  );
});

test('the serie segment is carried across, never rewritten', () => {
  // Only the set id changes in an upstream re-key. A rename that also moved the
  // serie would be a different operation and is not one this command performs.
  const mv = deriveMove(
    {
      cache_key: 'card:swsh9.5tg-TG05:low',
      kind: 'card',
      relative_path: 'images/en/swsh/swsh9.5tg/TG05.low.webp',
    },
    rename,
  );
  assert.equal(mv?.newPath.split('/')[2], 'swsh');
});
