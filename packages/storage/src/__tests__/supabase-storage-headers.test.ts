import assert from 'node:assert/strict';
import { it } from 'node:test';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test-only';
process.env.CARD_ART_BUCKET = 'card-art';

const { deleteObject } = await import('../object-store.js');

it('uses the secret key as apikey, not Bearer, on an authenticated Storage request', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (_url, init) => {
    called = true;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('apikey'), 'sb_secret_test-only');
    assert.equal(headers.has('authorization'), false);
    return new Response(null, { status: 200 });
  };
  try {
    assert.equal(await deleteObject('images/en/sv/1.low.webp'), true);
    assert.equal(called, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
