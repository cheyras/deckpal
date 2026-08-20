/**
 * The card-art texture URL marker.
 *
 * This is the piece of `cardArt.ts` that can be checked without a GPU, and it is
 * the piece whose failure mode is worst: a wrong answer here breaks card
 * textures on the cloud deployment ONLY, only for a card the reader has already
 * scrolled past, and never in dev. See the note on `TEXTURE_MARK`.
 *
 * The cache and the eviction pass are NOT covered here — they need a real
 * `TextureLoader`, which needs a DOM and a GPU. They are exercised in the
 * browser instead: forty-eight distinct card images requested against a
 * twenty-four texture limit with twelve bound to visible cards, which settles at
 * twelve net new textures and does not hang. That is a gap, and it is the honest
 * shape of the gap rather than a test that proves nothing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { marked } from '../cardArt'

test('a card image gets its own cache entry', () => {
  assert.equal(marked('/deckpal/images/en/base/base1/4/low.webp'), '/deckpal/images/en/base/base1/4/low.webp?decke=1')
  assert.equal(marked('https://deckpal.app/deckpal/images/en/base/base1/4/low.webp'), 'https://deckpal.app/deckpal/images/en/base/base1/4/low.webp?decke=1')
})

test('an existing query string is preserved, not clobbered', () => {
  // The cloud tier routes on `p=`. Replacing the query rather than appending to
  // it would ask the image service for nothing at all.
  assert.equal(marked('/api/images?p=images/en/base/base1/4/low.webp'), '/api/images?p=images/en/base/base1/4/low.webp&decke=1')
})

test('marking is idempotent', () => {
  // `assign` marks to look the cache up and `load` marks again to key it. A
  // second mark that appended a second parameter would make those two different
  // strings, so every warm texture would miss its own cache entry — which
  // presents as "preload does nothing".
  const once = marked('/deckpal/images/en/base/base1/4/low.webp')
  assert.equal(marked(once), once)
  assert.equal(marked('/x.webp?decke=1&a=2'), '/x.webp?decke=1&a=2')
})

test('a relative URL stays relative', () => {
  // Resolving against the document would bake the current origin into the cache
  // key, so the same card would be two entries on two pages — and in the
  // self-host build, where the app lives under /deckpal, it would bake in the
  // wrong base entirely.
  assert.ok(marked('/deckpal/images/x.webp').startsWith('/'))
})

test('a fragment stays at the end', () => {
  assert.equal(marked('/x.webp#frag'), '/x.webp?decke=1#frag')
})

test('anything that is not an http URL is passed through untouched', () => {
  // A caller handing us a data: or blob: URL is doing something reasonable —
  // the dev harnesses draw test cards on a canvas — and appending a query
  // parameter to one produces a URL that will not decode.
  for (const u of ['data:image/png;base64,AAAA', 'blob:http://x/1-2-3', 'models/decke/card_back.webp']) {
    assert.equal(marked(u), u)
  }
})
