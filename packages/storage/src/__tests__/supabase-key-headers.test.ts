import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { supabaseKeyHeaders } from '../supabase-key-headers.mjs';

describe('Supabase API key headers', () => {
  it('keeps the legacy JWT on apikey and Authorization during migration', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
    assert.deepEqual(supabaseKeyHeaders(jwt), {
      apikey: jwt,
      authorization: `Bearer ${jwt}`,
    });
  });

  it('sends an opaque secret key only on apikey', () => {
    assert.deepEqual(supabaseKeyHeaders('sb_secret_example'), { apikey: 'sb_secret_example' });
  });

  it('sends an opaque publishable key only on apikey', () => {
    assert.deepEqual(supabaseKeyHeaders('sb_publishable_example'), { apikey: 'sb_publishable_example' });
  });
});
