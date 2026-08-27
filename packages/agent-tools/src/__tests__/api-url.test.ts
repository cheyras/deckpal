import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveApiUrl } from '../api.js';

/**
 * URL composition for the Deck-E / MCP self-hop (CodeQL js/request-forgery #56, #57).
 *
 * `const url = base + path` was string concatenation with a MODEL-supplied id in
 * the middle. The two halves of the fix are pinned here:
 *
 *   1. composition is still faithful — the deployment's path prefix survives, and
 *      every path shape the tools actually build resolves where it did before.
 *      `new URL('/decks', base)` on its own would silently drop `/deckpal/api`,
 *      so "just use new URL" is a real regression if it stops at that;
 *   2. an id carrying `?`, `#`, `..` or `//` cannot change WHICH request is made.
 */

const CLOUD = 'https://deckpal.app/deckpal/api';
const LOCAL = 'http://127.0.0.1:3700/deckpal/api';

describe('resolveApiUrl — composition is unchanged', () => {
  const cases: Array<[string, string, string]> = [
    [CLOUD, '/health', 'https://deckpal.app/deckpal/api/health'],
    [CLOUD, '/decks', 'https://deckpal.app/deckpal/api/decks'],
    [CLOUD, '/decks?deleted=true', 'https://deckpal.app/deckpal/api/decks?deleted=true'],
    [CLOUD, '/decks/abc123', 'https://deckpal.app/deckpal/api/decks/abc123'],
    [CLOUD, '/decks/abc/cards/sv03.5-102', 'https://deckpal.app/deckpal/api/decks/abc/cards/sv03.5-102'],
    [CLOUD, '/decks/abc/logs?version=2&pageSize=1', 'https://deckpal.app/deckpal/api/decks/abc/logs?version=2&pageSize=1'],
    [CLOUD, '/mutations?limit=20', 'https://deckpal.app/deckpal/api/mutations?limit=20'],
    [LOCAL, '/health', 'http://127.0.0.1:3700/deckpal/api/health'],
    // A trailing slash on the base must not double up.
    ['https://deckpal.app/deckpal/api/', '/health', 'https://deckpal.app/deckpal/api/health'],
    // A base with no path prefix at all.
    ['https://deckpal.app', '/health', 'https://deckpal.app/health'],
  ];

  for (const [base, path, expected] of cases) {
    it(`${base} + ${path}`, () => {
      assert.equal(resolveApiUrl(base, path).href, expected);
      // …and it is byte-identical to what plain concatenation produced, which is
      // the only way to know this change moved no traffic.
      assert.equal(resolveApiUrl(base, path).href, base.replace(/\/$/, '') + path);
    });
  }

  it('percent-encodes nothing the call sites already encoded', () => {
    const id = encodeURIComponent('weird id?#&');
    assert.equal(
      resolveApiUrl(CLOUD, `/decks/${id}`).href,
      'https://deckpal.app/deckpal/api/decks/weird%20id%3F%23%26',
    );
  });
});

describe('resolveApiUrl — an id cannot change the request', () => {
  it('keeps a raw ? out of the query when the call site encodes it', () => {
    const url = resolveApiUrl(CLOUD, `/decks/${encodeURIComponent('abc?deleted=true')}`);
    assert.equal(url.search, '', 'the id must stay a path segment');
    assert.equal(url.pathname, '/deckpal/api/decks/abc%3Fdeleted%3Dtrue');
  });

  it('keeps a raw # out of the fragment when the call site encodes it', () => {
    const url = resolveApiUrl(CLOUD, `/decks/${encodeURIComponent('abc#frag')}`);
    assert.equal(url.hash, '');
    assert.equal(url.pathname, '/deckpal/api/decks/abc%23frag');
  });

  it('refuses a path that escapes the API base with ..', () => {
    assert.throws(() => resolveApiUrl(CLOUD, '/decks/../../admin'), /outside the configured/);
    assert.throws(() => resolveApiUrl(CLOUD, '/../../../etc/passwd'), /outside the configured/);
    assert.throws(
      () => resolveApiUrl(CLOUD, `/decks/${'..'}/${'..'}/profile/tokens`),
      /outside the configured/,
    );
  });

  it('refuses a protocol-relative path rather than normalising it', () => {
    // `new URL('//evil.example', base)` is https://evil.example/ — the classic.
    assert.throws(() => resolveApiUrl(CLOUD, '//evil.example/steal'), /single-slash/);
    assert.throws(() => resolveApiUrl(CLOUD, '///evil.example/steal'), /single-slash/);
  });

  it('refuses an absolute URL as the path', () => {
    assert.throws(() => resolveApiUrl(CLOUD, 'https://evil.example/steal'), /single-slash/);
    assert.throws(() => resolveApiUrl(CLOUD, 'http://169.254.169.254/'), /single-slash/);
  });

  it('refuses a relative path — every caller passes an absolute one', () => {
    assert.throws(() => resolveApiUrl(CLOUD, 'decks'), /single-slash/);
    assert.throws(() => resolveApiUrl(CLOUD, ''), /single-slash/);
  });

  it('never leaves the configured host', () => {
    for (const path of ['/decks/../../..', '/decks/%2e%2e/%2e%2e', '/decks/x/../../../y']) {
      let href: string | null = null;
      try {
        href = resolveApiUrl(CLOUD, path).href;
      } catch {
        continue; // refused outright is also fine
      }
      assert.ok(href.startsWith('https://deckpal.app/deckpal/api/'), `${path} → ${href}`);
    }
  });
});
