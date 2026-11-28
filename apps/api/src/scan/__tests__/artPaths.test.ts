import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parseImagePath } from '@deckpal/storage/paths';
import { cardImages } from '../../db.js';
import { artUrls, cachePath } from '../topup.js';

/**
 * Where the scanner's art lookups go, and that they agree with the address the API emits and the
 * object the image tier stores. Run: pnpm --filter deckpal-api test:scan
 */

const BUCKET = 'https://example.supabase.co/storage/v1/object/public/card-art';

test('an ordinary card: same cache file and sources as before', () => {
  const t = { serie: 'sv', set: 'sv03.5', local_id: '006' };
  assert.equal(cachePath('/cache', t), join('/cache', 'images', 'en', 'sv', 'sv03.5', '006.low.webp'));
  assert.deepEqual(artUrls(BUCKET, t), [
    `${BUCKET}/images/en/sv/sv03.5/006.low.webp`,
    'https://assets.tcgdex.net/en/sv/sv03.5/006/low.webp',
  ]);
  assert.deepEqual(artUrls(null, t), ['https://assets.tcgdex.net/en/sv/sv03.5/006/low.webp']);
});

test('the Unown "!" and "?" cards: the spelled-out object, and TCGdex under its own key', () => {
  const question = { serie: 'ex', set: 'exu', local_id: '%3F' };
  const exclamation = { serie: 'ex', set: 'exu', local_id: '!' };
  assert.equal(cachePath('/cache', question), join('/cache', 'images', 'en', 'ex', 'exu', 'question.low.webp'));
  assert.equal(cachePath('/cache', exclamation), join('/cache', 'images', 'en', 'ex', 'exu', 'exclamation.low.webp'));
  assert.deepEqual(artUrls(BUCKET, question), [
    `${BUCKET}/images/en/ex/exu/question.low.webp`,
    'https://assets.tcgdex.net/en/ex/exu/%253F/low.webp',
  ]);
  assert.deepEqual(artUrls(BUCKET, exclamation), [
    `${BUCKET}/images/en/ex/exu/exclamation.low.webp`,
    'https://assets.tcgdex.net/en/ex/exu/!/low.webp',
  ]);
});

test('the API emits the address whose stored object is the file the scanner reads', () => {
  for (const localId of ['%3F', '!', '006']) {
    const images = cardImages('ex', 'exu', localId);
    const parsed = parseImagePath(images.low.slice('/deckpal/images/'.length));
    assert.ok(parsed.ok && parsed.asset.kind === 'card', images.low);
    assert.equal(parsed.asset.ref.localId, localId);
    assert.equal(join('/cache', parsed.asset.relativePath), cachePath('/cache', { serie: 'ex', set: 'exu', local_id: localId }));
    assert.equal(`${BUCKET}/${parsed.asset.relativePath}`, artUrls(BUCKET, { serie: 'ex', set: 'exu', local_id: localId })[0]);
  }
  assert.deepEqual(cardImages('ex', 'exu', '%3F'), {
    low: '/deckpal/images/en/ex/exu/question/low.webp',
    high: '/deckpal/images/en/ex/exu/question/high.webp',
  });
  assert.deepEqual(cardImages('ex', 'exu', '!'), {
    low: '/deckpal/images/en/ex/exu/exclamation/low.webp',
    high: '/deckpal/images/en/ex/exu/exclamation/high.webp',
  });
});
