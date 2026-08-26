// Pure unit test for cardArt.ts — the client-side derivation of a public object
// URL from an image-tier path (DECISIONS.md 2026-08-26). No DB, no browser;
// mirrors the `node --import tsx --test` convention used by insightsCaption.test.ts.
//
// WHY THIS IS PINNED. The whole change rests on one claim: the object path is a
// pure function of the request path, so the browser can address the object itself
// and skip the serverless hop. If that mapping is wrong the app does not throw —
// it 404s, silently falls back to the proxy, and quietly performs exactly as
// badly as it did before, on every image, with nothing in the UI to show for it.
// The two rewrites below are also genuinely non-obvious in a way that invites a
// hand-rolled reimplementation to get them wrong:
//
//   card art  …/<localId>/<quality>.webp  →  …/<localId>.<quality>.webp
//   sprites   sprites/pixel/25.png        →  sprites/25.png
//
// The expectations here were taken from the LIVE tier's own `Location` headers
// (`curl -I https://deckpal.app/deckpal/images/…`), not from reading the code, so
// this is a check against production behaviour rather than a restatement of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objectUrlFor } from '../cardArt.js';

const BASE = 'https://example.supabase.co/storage/v1/object/public/card-art/';

test('card art moves the quality out of the path and into the filename', () => {
  assert.equal(
    objectUrlFor(BASE, '/deckpal/images/en/sv/sv03.5/001/low.webp'),
    `${BASE}images/en/sv/sv03.5/001.low.webp`,
  );
  assert.equal(
    objectUrlFor(BASE, '/deckpal/images/en/sv/sv03.5/001/high.webp'),
    `${BASE}images/en/sv/sv03.5/001.high.webp`,
  );
});

test('unpadded local ids survive verbatim (older eras are not zero-padded upstream)', () => {
  assert.equal(
    objectUrlFor(BASE, '/deckpal/images/en/sm/sm3/1/low.webp'),
    `${BASE}images/en/sm/sm3/1.low.webp`,
  );
});

test('set imagery keeps its sub-path unchanged', () => {
  assert.equal(
    objectUrlFor(BASE, '/deckpal/images/sets/sv03.5/logo.webp'),
    `${BASE}sets/sv03.5/logo.webp`,
  );
  assert.equal(
    objectUrlFor(BASE, '/deckpal/images/sets/me01/symbol.webp'),
    `${BASE}sets/me01/symbol.webp`,
  );
});

test('sprites DROP the style segment — the trap a reimplementation would fall into', () => {
  // Verified against the live tier's redirect target, which is `sprites/25.png`.
  assert.equal(
    objectUrlFor(BASE, '/deckpal/images/sprites/pixel/25.png'),
    `${BASE}sprites/25.png`,
  );
  assert.equal(
    objectUrlFor(BASE, '/deckpal/images/sprites/pixel/shiny/25.png'),
    `${BASE}sprites/shiny/25.png`,
  );
  assert.equal(
    objectUrlFor(BASE, '/deckpal/images/sprites/art/6.png'),
    `${BASE}sprites/other/official-artwork/6.png`,
  );
  assert.equal(
    objectUrlFor(BASE, '/deckpal/images/sprites/art/shiny/6.png'),
    `${BASE}sprites/other/official-artwork/shiny/6.png`,
  );
});

test('no base (self-host has no object tier) → null, so callers keep the proxied path', () => {
  assert.equal(objectUrlFor('', '/deckpal/images/en/sv/sv03.5/001/low.webp'), null);
});

test('anything the tier would not serve → null, never a guessed URL', () => {
  for (const bad of [
    '/deckpal/images/fr/sv/sv03.5/001/low.webp', // language we do not serve
    '/deckpal/images/en/sv/sv03.5/001/medium.webp', // quality we do not serve
    '/deckpal/images/en/sv/sv03.5/001/low.png', // extension we do not serve
    '/deckpal/images/sets/sv03.5/banner.webp', // set image kind we do not serve
    '/deckpal/images/en/sv/../../etc/passwd', // traversal
    '/deckpal/images/en/sv/%2e%2e/x/low.webp', // encoded traversal
    '/api/sets/sv03.5', // not an image path at all
    '',
  ]) {
    assert.equal(objectUrlFor(BASE, bad), null, `expected null for ${bad || '<empty>'}`);
  }
  assert.equal(objectUrlFor(BASE, null), null);
  assert.equal(objectUrlFor(BASE, undefined), null);
});
