import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardCacheKey,
  cardRelativePath,
  cardSourceUrl,
  imageSubPathFromUrl,
  parseImagePath,
  setImageCacheKey,
  setImageRelativePath,
} from '@deckscout/storage';

/**
 * Pure tests for the image URL parser — no DB, no network, no Supabase.
 *
 * This is the security boundary for the cloud image tier: the parsed
 * `relativePath` becomes a Supabase Storage object key, so a path that escapes
 * its subtree would read/write objects it has no business touching. The parser
 * is an ALLOW-list (decode once, then `[A-Za-z0-9][A-Za-z0-9.-]*` per segment),
 * which is why none of the traversal shapes below can survive it.
 *
 * It is also the regression test for the bug that motivated the tier: an image
 * URL must resolve to an image answer or a 404 — never to the SPA shell.
 */

// ── Happy paths ──────────────────────────────────────────────────────────────

test('parses a card path into ref, quality, object key and cache key', () => {
  const r = parseImagePath('en/sv/sv03.5/102/low.webp');
  assert.equal(r.ok, true);
  assert.ok(r.ok);
  assert.equal(r.asset.kind, 'card');
  assert.ok(r.asset.kind === 'card');
  assert.deepEqual(r.asset.ref, { serie: 'sv', set: 'sv03.5', localId: '102' });
  assert.equal(r.asset.quality, 'low');
  assert.equal(r.asset.relativePath, 'images/en/sv/sv03.5/102.low.webp');
  assert.equal(r.asset.cacheKey, 'card:sv03.5-102:low');
  assert.equal(r.asset.canonicalSourceUrl, 'https://assets.tcgdex.net/en/sv/sv03.5/102/low.webp');
  assert.equal(r.asset.assetKind, 'card');
});

test('parses high quality and non-numeric local ids (TG05, SV107, P-A sets)', () => {
  const hi = parseImagePath('en/swsh/swsh12.5gg/TG05/high.webp');
  assert.ok(hi.ok && hi.asset.kind === 'card');
  assert.equal(hi.asset.relativePath, 'images/en/swsh/swsh12.5gg/TG05.high.webp');
  assert.equal(hi.asset.cacheKey, 'card:swsh12.5gg-TG05:high');

  const promo = parseImagePath('en/tcgp/P-A/001/low.webp');
  assert.ok(promo.ok && promo.asset.kind === 'card');
  assert.equal(promo.asset.relativePath, 'images/en/tcgp/P-A/001.low.webp');
});

test('parses set logo and symbol paths', () => {
  const logo = parseImagePath('sets/sv03.5/logo.webp');
  assert.ok(logo.ok && logo.asset.kind === 'set');
  assert.equal(logo.asset.relativePath, 'sets/sv03.5/logo.webp');
  assert.equal(logo.asset.cacheKey, 'set:sv03.5:logo');
  assert.equal(logo.asset.assetKind, 'set-logo');

  const sym = parseImagePath('sets/A1/symbol.webp');
  assert.ok(sym.ok && sym.asset.kind === 'set');
  assert.equal(sym.asset.cacheKey, 'set:A1:symbol');
  assert.equal(sym.asset.assetKind, 'set-symbol');
});

test('the parser agrees with the path builders it shares a module with', () => {
  const ref = { serie: 'sv', set: 'sv03.5', localId: '006' };
  const r = parseImagePath('en/sv/sv03.5/006/high.webp');
  assert.ok(r.ok && r.asset.kind === 'card');
  assert.equal(r.asset.relativePath, cardRelativePath(ref, 'high'));
  assert.equal(r.asset.cacheKey, cardCacheKey(ref, 'high'));
  assert.equal(r.asset.canonicalSourceUrl, cardSourceUrl(ref, 'high'));

  const s = parseImagePath('sets/base1/logo.webp');
  assert.ok(s.ok && s.asset.kind === 'set');
  assert.equal(s.asset.relativePath, setImageRelativePath('base1', 'logo'));
  assert.equal(s.asset.cacheKey, setImageCacheKey('base1', 'logo'));
});

// ── Path traversal: every shape must be rejected ─────────────────────────────

const TRAVERSAL: string[] = [
  'en/sv/../../../etc/passwd/low.webp',
  'en/sv/sv03.5/../102/low.webp',
  'en/../../../../root/.ssh/id_rsa',
  'sets/../../secrets/logo.webp',
  'sets/../bug-reports/logo.webp',
  '../../images/en/sv/sv03.5/102.low.webp',
  'en/sv/sv03.5/%2e%2e/low.webp',
  'en/sv/%2e%2e%2f%2e%2e%2fetc/passwd/low.webp',
  'sets/%2E%2E/logo.webp',
  'en/sv/sv03.5/..%2f..%2f/low.webp',
  'en/sv/sv03.5/102/..%5clow.webp',
  'en/sv/sv03.5/102/low.webp/../../../../etc/passwd',
  '/etc/passwd',
  'sets/a/../../../logo.webp',
  'en/sv/sv03.5/a..b/low.webp', // '..' anywhere in a segment, not just alone
];

for (const p of TRAVERSAL) {
  test(`rejects traversal: ${p}`, () => {
    const r = parseImagePath(p);
    assert.equal(r.ok, false, `expected rejection for ${p}`);
  });
}

test('rejects segments with separators, nulls, backslashes and leading dots', () => {
  for (const p of [
    'en/sv/sv03.5/.hidden/low.webp',
    'en/sv/sv03.5/102/low.webp\0',
    'en\\sv\\sv03.5\\102\\low.webp',
    'en/sv/sv03.5//low.webp',
    'en/sv/sv03.5/102/',
    '',
    '/',
    'en/sv/sv03.5/102/low.webp?x=1',
    'en/sv/sv03.5/102/low.webp#frag',
    'en/sv/sv03.5/102/low.webp%00.txt',
  ]) {
    assert.equal(parseImagePath(p).ok, false, `expected rejection for ${JSON.stringify(p)}`);
  }
});

test('rejects a malformed percent-escape instead of throwing', () => {
  const r = parseImagePath('en/sv/sv03.5/%E0%A4%A/low.webp');
  assert.equal(r.ok, false);
});

// ── Shape / vocabulary rejections ────────────────────────────────────────────

test('a card path with an unserved language or quality is a bad request, not a 404', () => {
  assert.deepEqual(parseImagePath('fr/sv/sv03.5/102/low.webp'), {
    ok: false,
    reason: 'bad-request',
  });
  assert.deepEqual(parseImagePath('en/sv/sv03.5/102/medium.webp'), {
    ok: false,
    reason: 'bad-request',
  });
  assert.deepEqual(parseImagePath('en/sv/sv03.5/102/low.png'), {
    ok: false,
    reason: 'bad-request',
  });
});

test('set paths only serve logo|symbol .webp', () => {
  assert.equal(parseImagePath('sets/sv03.5/background.webp').ok, false);
  assert.equal(parseImagePath('sets/sv03.5/logo.png').ok, false);
  assert.equal(parseImagePath('sets/sv03.5').ok, false);
});

test('unknown route shapes (sprites, arbitrary depth) are not-found, never HTML', () => {
  for (const p of ['sprites/pixel/6.png', 'sprites/art/shiny/6.png', 'en/sv/sv03.5/102/a/low.webp']) {
    const r = parseImagePath(p);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.reason === 'not-found');
  }
});

// ── Request-URL extraction ───────────────────────────────────────────────────

test('extracts the sub-path from the literal URL', () => {
  assert.equal(
    imageSubPathFromUrl('/deckscout/images/en/sv/sv03.5/102/low.webp'),
    'en/sv/sv03.5/102/low.webp',
  );
  assert.equal(
    imageSubPathFromUrl('/deckscout/images/sets/base1/logo.webp?v=2'),
    'sets/base1/logo.webp',
  );
});

test("extracts the sub-path from Vercel's rewritten ?p= capture group", () => {
  assert.equal(
    imageSubPathFromUrl('/api/images?p=en/sv/sv03.5/102/low.webp'),
    'en/sv/sv03.5/102/low.webp',
  );
  assert.equal(
    imageSubPathFromUrl('/api/images?p=sets/base1/logo.webp&cb=1'),
    'sets/base1/logo.webp',
  );
});

test('leaves %-escapes in ?p= for the parser to decode exactly once', () => {
  // URLSearchParams would decode here, and a second decode inside the parser is
  // how allow-lists get walked past. The raw value must reach parseImagePath.
  assert.equal(imageSubPathFromUrl('/api/images?p=en%2Fsv%2F%2e%2e%2Flow.webp'), 'en%2Fsv%2F%2e%2e%2Flow.webp');
  assert.equal(parseImagePath(imageSubPathFromUrl('/api/images?p=en%2Fsv%2F%2e%2e%2Flow.webp')!).ok, false);
});

test('a non-image URL yields no sub-path (the handler 404s rather than guessing)', () => {
  assert.equal(imageSubPathFromUrl('/api/series'), null);
  assert.equal(imageSubPathFromUrl('/index.html'), null);
  assert.equal(imageSubPathFromUrl('/deckscout/images/'), null);
  assert.equal(imageSubPathFromUrl(undefined), null);
  assert.equal(imageSubPathFromUrl(''), null);
});

test('end to end: every traversal attempt is still rejected after URL extraction', () => {
  for (const url of [
    '/deckscout/images/../../etc/passwd',
    '/deckscout/images/en/sv/../../../etc/passwd/low.webp',
    '/api/images?p=../../etc/passwd',
    '/api/images?p=%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  ]) {
    const sub = imageSubPathFromUrl(url);
    if (sub === null) continue; // already rejected
    assert.equal(parseImagePath(sub).ok, false, `expected rejection for ${url}`);
  }
});
