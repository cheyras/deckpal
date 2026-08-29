// The crosswalk is only useful if the tier is actually willing to FETCH from it.
//
// The first version of this feature shipped a table whose hosts the cloud
// tier's SSRF allow-list refused, so every entry resolved and was then dropped
// — inert in production, and invisible to a test that only exercised the pure
// resolver. These assertions execute the real upstream check against the real
// table, which is the only way that class of gap gets caught.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SET_IMAGE_FALLBACK_TABLE,
  SET_IMAGE_FALLBACK_POLICY,
  isSetImageFallbackUrl,
} from '../setImageFallback.js';
import { checkUpstreamUrl, IMAGE_SOURCE_POLICY } from '../upstream.js';

describe('the crosswalk is fetchable under its own policy', () => {
  it('every entry passes the scoped upstream check', async () => {
    const refused: string[] = [];
    for (const e of SET_IMAGE_FALLBACK_TABLE) {
      const r = await checkUpstreamUrl(e.sourceUrl, SET_IMAGE_FALLBACK_POLICY);
      if (!r.ok) refused.push(`${e.setId}|${e.kind}: ${r.reason}`);
    }
    assert.deepEqual(refused, [], `entries the tier would refuse to fetch:\n${refused.join('\n')}`);
  });

  it('the scoped policy is TIGHTER than the default, not a general escape hatch', async () => {
    for (const bad of [
      'https://evil.example.com/x.png',
      'http://127.0.0.1/x.png',
      'http://169.254.169.254/latest/meta-data',
      // Allowed by the DEFAULT policy, deliberately not by this one.
      'https://raw.githubusercontent.com/a/b.png',
    ]) {
      const r = await checkUpstreamUrl(bad, SET_IMAGE_FALLBACK_POLICY);
      assert.equal(r.ok, false, `${bad} must not be fetchable under the crosswalk policy`);
    }
  });

  it('membership is by exact URL, not by host', () => {
    assert.equal(isSetImageFallbackUrl(SET_IMAGE_FALLBACK_TABLE[0]!.sourceUrl), true);
    // Same host as a real entry, not in the table.
    assert.equal(isSetImageFallbackUrl('https://images.pokemontcg.io/anything-else.png'), false);
    assert.equal(isSetImageFallbackUrl(''), false);
  });

  it('the default policy is left untouched by this feature', async () => {
    const a = await checkUpstreamUrl('https://assets.tcgdex.net/en/sv/sv1/logo.webp', IMAGE_SOURCE_POLICY);
    assert.equal(a.ok, true, 'card art must still fetch under the default policy');
    const b = await checkUpstreamUrl('https://images.pokemontcg.io/svp/symbol.png', IMAGE_SOURCE_POLICY);
    assert.equal(b.ok, false, 'the DEFAULT policy must not have been widened');
  });
});
