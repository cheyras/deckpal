import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import {
  fetchSourceBytes,
  fetchSourceBytesWithExtensionFallback,
} from '../fetch-source.js';
import { PLACEHOLDER_WEBP } from '../placeholder.js';
import { IMAGE_SOURCE_POLICY, type UpstreamPolicy } from '../upstream.js';

/**
 * The cold-asset fetch, against two real HTTP servers (CodeQL js/request-forgery #36).
 *
 * WHY A REAL SERVER. The bug this closes is not visible in the URL we ask for —
 * it is visible one hop later. `redirect: 'follow'` checked nothing after the
 * first request, so an allow-listed upstream answering `302` to somewhere else
 * was followed, cross-origin, and the bytes were cached and republished to a
 * PUBLIC bucket. A test that only asserts on the initial URL passes while that is
 * still true, which is exactly the test not to write. So:
 *
 *   `upstream`  stands in for assets.tcgdex.net — the only allow-listed host;
 *   `internal`  stands in for the thing an SSRF is reaching for. Same machine,
 *               but addressed as `localhost` rather than `127.0.0.1`, so it is a
 *               DIFFERENT HOST to the allow-list and must never be contacted.
 *
 * `internal.hits` is asserted to stay at zero. That is the assertion that fails
 * on the pre-fix code: undici follows the hop and the counter reads 1.
 *
 * The policy is passed explicitly because production's allow-list is
 * `assets.tcgdex.net` / `raw.githubusercontent.com` and a test must not need the
 * internet. `allowPrivateAddresses` is the only thing relaxed — the host check,
 * the per-hop re-check and every content check run exactly as they ship.
 */

const HTML_SOFT_404 = Buffer.from('<html><body>not found</body></html>');
const NOT_AN_IMAGE = Buffer.from('this is plain text pretending to be a webp');
/** Enough of a PNG for sniffContentType: the eight-byte signature. */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

let upstream: Server;
let internal: Server;
let upstreamPort = 0;
let internalPort = 0;
let internalHits = 0;

/** Only `127.0.0.1` is allow-listed. `localhost` deliberately is not. */
let policy: UpstreamPolicy;

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });

before(async () => {
  internal = createServer((req, res) => {
    internalHits++;
    res.writeHead(200, { 'content-type': 'image/webp' });
    res.end(PLACEHOLDER_WEBP);
  });
  internalPort = await listen(internal);

  upstream = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    switch (path) {
      case '/good.webp':
        res.writeHead(200, { 'content-type': 'image/webp', etag: '"abc123"' });
        return res.end(PLACEHOLDER_WEBP);
      case '/ladder.webp': // gone under the recorded extension …
        res.writeHead(404);
        return res.end();
      case '/ladder.png': // … but alive as a sibling, which is the documented case
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(PNG_BYTES);
      case '/soft404.webp': // the TCGdex trap: 200, but HTML
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(HTML_SOFT_404);
      case '/liar.webp': // says image, is not
        res.writeHead(200, { 'content-type': 'image/webp' });
        return res.end(NOT_AN_IMAGE);
      case '/empty.webp':
        res.writeHead(200, { 'content-type': 'image/webp' });
        return res.end();
      case '/gone.webp':
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('gone');
      case '/to-internal.webp': // THE bug: allow-listed host → somewhere else
        res.writeHead(302, { location: `http://localhost:${internalPort}/steal.webp` });
        return res.end();
      case '/to-metadata.webp':
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/iam/' });
        return res.end();
      case '/to-file.webp':
        res.writeHead(302, { location: 'file:///etc/passwd' });
        return res.end();
      case '/relative.webp': // a relative Location is legal and must still work
        res.writeHead(302, { location: '/good.webp' });
        return res.end();
      case '/chain.webp':
        res.writeHead(307, { location: './relative.webp' });
        return res.end();
      case '/loop.webp':
        res.writeHead(302, { location: '/loop.webp' });
        return res.end();
      case '/no-location.webp':
        res.writeHead(302);
        return res.end();
      case '/bad-location.webp':
        res.writeHead(302, { location: 'http://' }); // a scheme with no authority
        return res.end();
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  upstreamPort = await listen(upstream);

  policy = {
    originFor: (host) => (host === '127.0.0.1' ? `http://127.0.0.1:${upstreamPort}` : null),
    allowPrivateAddresses: true,
  };
});

after(async () => {
  await new Promise((r) => upstream.close(r));
  await new Promise((r) => internal.close(r));
});

const up = (path: string): string => `http://127.0.0.1:${upstreamPort}${path}`;

describe('fetchSourceBytes — the happy path still works', () => {
  it('fetches and sniffs an allow-listed asset', async () => {
    const res = await fetchSourceBytes(up('/good.webp'), 5_000, policy);
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.contentType, 'image/webp');
    assert.equal(res.ok && res.bytes.length, PLACEHOLDER_WEBP.length);
    assert.equal(res.ok && res.etag, '"abc123"');
  });

  it('follows a relative Location on the same host', async () => {
    internalHits = 0;
    const res = await fetchSourceBytes(up('/relative.webp'), 5_000, policy);
    assert.equal(res.ok, true, res.ok ? '' : res.reason);
    assert.equal(res.ok && res.contentType, 'image/webp');
  });

  it('follows a chain of same-host hops', async () => {
    const res = await fetchSourceBytes(up('/chain.webp'), 5_000, policy);
    assert.equal(res.ok, true, res.ok ? '' : res.reason);
  });
});

describe('fetchSourceBytes — the destination control', () => {
  it('refuses a non-allow-listed host up front, without connecting', async () => {
    internalHits = 0;
    const res = await fetchSourceBytes(`http://localhost:${internalPort}/steal.webp`, 5_000, policy);
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /not an allow-listed image upstream/);
    assert.equal(res.ok ? -1 : res.httpStatus, 0);
    assert.equal(internalHits, 0, 'nothing may be sent to a host we refused');
  });

  it('refuses a REDIRECT from an allow-listed host to a non-allow-listed one', async () => {
    // The whole point. Pre-fix (`redirect: 'follow'`) this returned ok:true with
    // the internal server's bytes, and internalHits was 1.
    internalHits = 0;
    const res = await fetchSourceBytes(up('/to-internal.webp'), 5_000, policy);
    assert.equal(res.ok, false, 'a cross-host redirect must not be followed');
    assert.match(res.ok ? '' : res.reason, /refused redirect 302/);
    assert.match(res.ok ? '' : res.reason, /not an allow-listed image upstream/);
    assert.equal(internalHits, 0, 'the internal server must never be contacted');
  });

  it('refuses a redirect to the cloud metadata address', async () => {
    const res = await fetchSourceBytes(up('/to-metadata.webp'), 5_000, policy);
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /169\.254\.169\.254/);
  });

  it('refuses a redirect to a non-web scheme', async () => {
    const res = await fetchSourceBytes(up('/to-file.webp'), 5_000, policy);
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /scheme 'file:' is not fetchable/);
  });

  it('stops on a redirect loop instead of spinning', async () => {
    const res = await fetchSourceBytes(up('/loop.webp'), 5_000, policy);
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /more than 5 redirects/);
  });

  it('rejects a redirect with no Location', async () => {
    const res = await fetchSourceBytes(up('/no-location.webp'), 5_000, policy);
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /with no Location/);
  });

  it('rejects a Location it cannot resolve', async () => {
    const res = await fetchSourceBytes(up('/bad-location.webp'), 5_000, policy);
    assert.equal(res.ok, false);
  });

  it('applies the SHIPPING allow-list by default — no policy argument', async () => {
    internalHits = 0;
    const res = await fetchSourceBytes(`http://localhost:${internalPort}/steal.webp`, 5_000);
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /not an allow-listed image upstream/);
    assert.equal(internalHits, 0);
    // and the default really is the exported production policy
    assert.equal(IMAGE_SOURCE_POLICY.allowPrivateAddresses, false);
  });
});

describe('fetchSourceBytes — the content checks are unchanged', () => {
  it('still rejects the TCGdex 200-with-HTML soft 404', async () => {
    const res = await fetchSourceBytes(up('/soft404.webp'), 5_000, policy);
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /soft-404 trap/);
  });

  it('still rejects bytes that are not a recognised raster image', async () => {
    const res = await fetchSourceBytes(up('/liar.webp'), 5_000, policy);
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /not a recognised raster image/);
  });

  it('still rejects an empty body', async () => {
    const res = await fetchSourceBytes(up('/empty.webp'), 5_000, policy);
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /empty body/);
  });

  it('still reports a hard 404 with its status', async () => {
    const res = await fetchSourceBytes(up('/gone.webp'), 5_000, policy);
    assert.equal(res.ok, false);
    assert.equal(res.ok ? -1 : res.httpStatus, 404);
  });
});

describe('fetchSourceBytesWithExtensionFallback', () => {
  it('finds the .png sibling when the recorded .webp is a 404', async () => {
    const res = await fetchSourceBytesWithExtensionFallback(up('/ladder.webp'), 5_000, policy);
    assert.equal(res.result.ok, true, res.result.ok ? '' : res.result.reason);
    assert.equal(res.usedFallback, true);
    assert.ok(res.url.endsWith('/ladder.png'), res.url);
    assert.equal(res.result.ok && res.result.contentType, 'image/png');
  });

  it('does not walk the ladder when the first URL answered', async () => {
    const res = await fetchSourceBytesWithExtensionFallback(up('/good.webp'), 5_000, policy);
    assert.equal(res.result.ok, true);
    assert.equal(res.usedFallback, false);
  });

  it('does NOT re-ask a refused host under three more extensions', async () => {
    internalHits = 0;
    const res = await fetchSourceBytesWithExtensionFallback(
      `http://localhost:${internalPort}/steal.webp`,
      5_000,
      policy,
    );
    assert.equal(res.result.ok, false);
    assert.equal(res.usedFallback, false);
    assert.equal(internalHits, 0);
  });
});
