import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  IMAGE_SOURCE_HOSTS,
  IMAGE_SOURCE_POLICY,
  checkUpstreamUrl,
  isPrivateAddress,
  type UpstreamPolicy,
} from '../upstream.js';

/**
 * The upstream destination control (CodeQL js/request-forgery #36).
 *
 * Everything here is OFFLINE. The host allow-list is checked before any name is
 * resolved, so every rejection case answers without a packet; the one case that
 * does resolve uses `localhost`, which comes out of the hosts file. A security
 * test that needs the internet is a security test that gets skipped.
 */

/** Allows `localhost` so the resolved-address layer can be exercised offline. */
const localhostPolicy = (allowPrivateAddresses: boolean): UpstreamPolicy => ({
  originFor: (host) => (host === 'localhost' ? 'http://localhost' : null),
  allowPrivateAddresses,
});

describe('IMAGE_SOURCE_HOSTS', () => {
  it('is exactly the two upstreams the code can derive a URL for', () => {
    assert.deepEqual([...IMAGE_SOURCE_HOSTS].sort(), [
      'assets.tcgdex.net',
      'raw.githubusercontent.com',
    ]);
    for (const host of IMAGE_SOURCE_HOSTS) {
      assert.equal(IMAGE_SOURCE_POLICY.originFor(host), `https://${host}`);
    }
  });

  it('hands back a CONSTANT origin rather than echoing the input', async () => {
    // The host of the outgoing request is chosen from the list, never carried
    // through from the URL — which is what makes a hostname trick impossible
    // rather than merely unlikely. Run against the localhost policy so the
    // assertion needs no DNS; the production constants are pinned above.
    const res = await checkUpstreamUrl('http://LOCALHOST.:80/en/sv/x.webp', localhostPolicy(true));
    assert.equal(res.ok, true, res.ok ? '' : res.reason);
    assert.equal(res.ok && res.url.origin, 'http://localhost');
    assert.equal(res.ok && res.url.href, 'http://localhost/en/sv/x.webp');
  });

  it('refuses an image CDN that was never approved — the allow-list default', () => {
    // The list is the policy: anything not on it is denied by the SAME default,
    // whether it was ruled out deliberately or simply never considered. That is
    // what stops a refill quietly re-fetching from an unapproved source, and it
    // is why the list never needs to enumerate what it blocks. `assets.example`
    // stands in for any such host; the assertion is about the default, not it.
    assert.equal(IMAGE_SOURCE_HOSTS.includes('assets.example'), false);
    assert.equal(IMAGE_SOURCE_POLICY.originFor('assets.example'), null);
  });
});

describe('checkUpstreamUrl — host allow-list (default policy, no DNS)', () => {
  const refused: Array<[string, RegExp]> = [
    ['https://evil.example/card.webp', /not an allow-listed image upstream/],
    // A plausible, well-formed card-art CDN that is simply not approved. This is
    // the case that matters in practice: the refusal is not about maliciousness,
    // it is about absence from the list.
    ['https://assets.example/en/sv/sv01/1/high.webp', /not an allow-listed image upstream/],
    ['http://169.254.169.254/latest/meta-data/iam/', /not an allow-listed/],
    ['http://127.0.0.1:8080/admin', /not an allow-listed/],
    ['http://[::1]:8080/admin', /not an allow-listed/],
    ['http://10.0.0.5/internal', /not an allow-listed/],
    ['http://metadata.google.internal/computeMetadata/v1/', /not an allow-listed/],
    // Suffix and prefix tricks against a naive `endsWith` / `includes` check.
    ['https://assets.tcgdex.net.evil.example/card.webp', /not an allow-listed/],
    ['https://evil.example/assets.tcgdex.net/card.webp', /not an allow-listed/],
    ['https://notassets.tcgdex.net/card.webp', /not an allow-listed/],
    // The bucket itself is not an upstream — bytes never come back from there.
    ['https://example.supabase.co/storage/v1/object/public/card-art/x.webp', /not an allow-listed/],
    // Schemes that are not the web.
    ['file:///etc/passwd', /scheme 'file:' is not fetchable/],
    ['gopher://127.0.0.1:11211/', /scheme 'gopher:' is not fetchable/],
    ['data:image/webp;base64,UklGRg==', /scheme 'data:' is not fetchable/],
    // Not a URL at all.
    ['/images/en/sv/1.low.webp', /not a parseable URL/],
    ['assets.tcgdex.net/card.webp', /not a parseable URL/],
    ['', /not a parseable URL/],
  ];

  for (const [url, reason] of refused) {
    it(`refuses ${JSON.stringify(url)}`, async () => {
      const res = await checkUpstreamUrl(url, IMAGE_SOURCE_POLICY);
      assert.equal(res.ok, false);
      assert.match(res.ok ? '' : res.reason, reason);
    });
  }

  it('refuses an explicit port that is not the allow-listed one', async () => {
    const res = await checkUpstreamUrl('https://assets.tcgdex.net:8443/en/sv/x.webp');
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /port '8443' is not the allow-listed port/);
  });

  it('refuses a path outside the character allow-list', async () => {
    for (const path of ['/en/sv/x webp', '/en/sv/x|webp', '/en/sv/x%00', '/en/(sv)/x.webp', '/en/sv/x@y']) {
      const res = await checkUpstreamUrl(`https://assets.tcgdex.net${path}`);
      assert.equal(res.ok, false, `${path} must be refused`);
      assert.match(res.ok ? '' : res.reason, /path is not allow-listed|query is not allow-listed/);
    }
  });

  it('accepts the paths this project actually derives', async () => {
    for (const path of [
      '/en/sv/sv03.5/102/low.webp',
      '/univ/mc/2021swsh/symbol.webp',
      '/PokeAPI/sprites/bf4c47ac82c33b330e33d98b8882d1cedb2f53e7/sprites/pokemon/other/official-artwork/shiny/150.png',
    ]) {
      const res = await checkUpstreamUrl(`http://localhost${path}`, localhostPolicy(true));
      assert.equal(res.ok, true, `${path}: ${res.ok ? '' : res.reason}`);
      assert.equal(res.ok && res.url.href, `http://localhost${path}`);
    }
  });

  it('refuses an allow-listed host carrying embedded credentials', async () => {
    const res = await checkUpstreamUrl('https://user:pw@assets.tcgdex.net/x.webp');
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /embedded credentials/);
  });
});

describe('checkUpstreamUrl — host matching is exact but case/dot tolerant', () => {
  it('accepts an upper-case hostname', async () => {
    const res = await checkUpstreamUrl('http://LOCALHOST/x.webp', localhostPolicy(true));
    assert.equal(res.ok, true);
  });

  it('accepts a fully-qualified trailing dot', async () => {
    const res = await checkUpstreamUrl('http://localhost./x.webp', localhostPolicy(true));
    assert.equal(res.ok, true);
  });
});

describe('checkUpstreamUrl — resolved-address layer', () => {
  it('refuses an allow-listed name that resolves to a non-public address', async () => {
    // The DNS-rebinding / hijacked-record shape: the NAME passes the allow-list
    // and the ADDRESS is loopback. `localhost` is the one such name every box has.
    const res = await checkUpstreamUrl('http://localhost/x.webp', localhostPolicy(false));
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.reason, /resolves to non-public address/);
  });

  it('is the only thing the test escape hatch turns off', async () => {
    const res = await checkUpstreamUrl('http://localhost/x.webp', localhostPolicy(true));
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.url.href, 'http://localhost/x.webp');
  });
});

describe('isPrivateAddress', () => {
  const private_ = [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1', // CGNAT
    '127.0.0.1',
    '127.1.1.1',
    '169.254.169.254', // the one that matters: cloud instance metadata
    '169.254.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1', // multicast
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fe80::1%eth0',
    'fc00::1',
    'fd12:3456:789a::1',
    'ff02::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:169.254.169.254',
    '::ffff:10.0.0.1',
    '64:ff9b::127.0.0.1', // NAT64 onto loopback
    '2002:7f00:0001::1', // 6to4 onto 127.0.0.1
    'not-an-ip',
    '999.1.1.1',
    '',
  ];
  for (const ip of private_) {
    it(`treats ${JSON.stringify(ip)} as non-public`, () => {
      assert.equal(isPrivateAddress(ip), true);
    });
  }

  const public_ = [
    '1.1.1.1',
    '8.8.8.8',
    '104.16.0.1', // Cloudflare, where assets.tcgdex.net actually lives
    '140.82.121.4', // GitHub
    '172.15.255.255', // just below RFC1918
    '172.32.0.1', // just above RFC1918
    '100.63.255.255', // just below CGNAT
    '100.128.0.1', // just above CGNAT
    '192.0.1.1',
    '198.20.0.1',
    '223.255.255.255', // just below multicast
    '2606:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '2002:0808:0808::1', // 6to4 onto 8.8.8.8
  ];
  for (const ip of public_) {
    it(`treats ${JSON.stringify(ip)} as public`, () => {
      assert.equal(isPrivateAddress(ip), false);
    });
  }
});
