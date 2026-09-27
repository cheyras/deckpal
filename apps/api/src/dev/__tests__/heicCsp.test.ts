import { test } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { createApp } from '../../index.js';
import { closePool } from '../../db.js';

test('self-host policy permits the HEIC worker without script eval', async () => {
  const server: http.Server = createApp().listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/deckpal/`);
    const csp = response.headers.get('content-security-policy');
    assert.ok(csp);
    assert.match(csp, /(?:^|;\s*)worker-src 'self' blob:(?:;|$)/);
    assert.match(csp, /(?:^|;\s*)img-src 'self' data: blob:(?:;|$)/);
    assert.match(csp, /(?:^|;\s*)script-src 'self'(?:;|$)/);
    assert.doesNotMatch(csp, /unsafe-eval/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await closePool();
  }
});
