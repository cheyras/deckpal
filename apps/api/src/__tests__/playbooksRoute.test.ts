/**
 * `GET /playbooks` (playbooks.ts): the agent playbooks, public. JSON for the /skill page; `?format=markdown` for the
 * pointer skill's fallback, which a plain fetch must be able to read without running the page's JavaScript (Astra, #344).
 * Pure: the handler on a bare Express app, no database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import express from 'express';
import { PLAYBOOK_INDEX_TEXT, PLAYBOOK_NAMES, PLAYBOOK_TEXT } from '@deckpal/agent-tools';
import { playbooksHandler } from '../playbooks.js';

test('the playbooks are public: JSON for the page, one Markdown document for a plain fetch', async () => {
  const app = express();
  app.get('/playbooks', playbooksHandler);
  const server: http.Server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/playbooks`;

    const json = await fetch(base);
    assert.equal(json.status, 200);
    assert.match(json.headers.get('cache-control') ?? '', /public, max-age=300/);
    const body = (await json.json()) as { index: string; playbooks: Array<{ name: string; text: string }> };
    assert.equal(body.index, PLAYBOOK_INDEX_TEXT);
    assert.deepEqual(body.playbooks.map((p) => p.name), PLAYBOOK_NAMES);

    const md = await fetch(`${base}?format=markdown`);
    assert.equal(md.status, 200);
    assert.match(md.headers.get('content-type') ?? '', /^text\/markdown/);
    const text = await md.text();
    assert.ok(text.startsWith(PLAYBOOK_INDEX_TEXT), 'the index first');
    for (const name of PLAYBOOK_NAMES) assert.ok(text.includes(PLAYBOOK_TEXT[name]), `${name} whole`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
