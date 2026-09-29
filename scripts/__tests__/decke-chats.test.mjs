import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseArgs, runCli } from '../decke-chats.mjs';

test('argument parsing covers filters, booleans and multi-word search', () => {
  assert.deepEqual(parseArgs(['search', 'tool', 'failed', '--from', '2026-09-01', '--vote', '-1', '--has-error', '--build-pr', '271', '--limit', '12', '--format', 'jsonl']), {
    command: 'search', id: undefined, query: 'tool failed',
    options: { format: 'jsonl', from: '2026-09-01', vote: '-1', hasError: true, buildPr: '271', limit: 12 },
  });
  assert.throws(() => parseArgs(['read']), /needs one conversation id/);
  assert.throws(() => parseArgs(['list', '--format', 'csv']), /markdown or jsonl/);
});

test('list writes JSONL with a fake fetch and never exposes the token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'decke-chats-list-'));
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.authorization });
    return new Response(JSON.stringify({ items: [{ id: 'c1' }, { id: 'c2' }], nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await runCli(parseArgs(['list', '--format', 'jsonl', '--out', dir]), { fetch, env: { DECKPAL_TOKEN: 'secret-token', DECKPAL_API_BASE: 'https://example.test/api' } });
  assert.equal(await readFile(join(dir, 'list.jsonl'), 'utf8'), '{"id":"c1"}\n{"id":"c2"}\n');
  assert.match(seen[0].url, /\/api\/admin\/decke-improvement\?limit=50/);
  assert.equal(seen[0].auth, 'Bearer secret-token');
  assert.doesNotMatch(seen[0].url, /secret-token/);
});

test('markdown list omits legacy exact timing fields', async () => {
  let output = '';
  const fetch = async () => new Response(JSON.stringify({
    items: [{ id: 'c1', date: '2026-09-28', updatedOffsetMs: 433421, turnCount: 2, costUsd: 0.01 }],
    nextCursor: null,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  await runCli(parseArgs(['list']), {
    fetch,
    stdout: { write(value) { output += value; } },
    env: { DECKPAL_TOKEN: 'token', DECKPAL_API_BASE: 'https://example.test/api' },
  });
  assert.match(output, /2026-09-28 UTC/);
  assert.doesNotMatch(output, /433421|last activity|\bms\b/i);
});

test('dump paginates and writes one markdown file plus index JSONL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'decke-chats-dump-'));
  const fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/c1')) return new Response('# Conversation c1\n', { status: 200 });
    if (parsed.pathname.endsWith('/c2')) return new Response('# Conversation c2\n', { status: 200 });
    const second = parsed.searchParams.has('cursor');
    return new Response(JSON.stringify(second
      ? { items: [{ id: 'c2' }], nextCursor: null }
      : { items: [{ id: 'c1' }], nextCursor: 'next|c1' }), { status: 200 });
  };
  await runCli(parseArgs(['dump', '--since', '7d', '--out', dir]), {
    fetch,
    env: { DECKPAL_TOKEN: 'token', DECKPAL_API_BASE: 'https://example.test/api' },
    now: () => Date.parse('2026-09-28T00:00:00Z'),
  });
  assert.deepEqual((await readdir(dir)).sort(), ['c1.md', 'c2.md', 'index.jsonl']);
  assert.equal(await readFile(join(dir, 'c2.md'), 'utf8'), '# Conversation c2\n');
  assert.match(await readFile(join(dir, 'index.jsonl'), 'utf8'), /"file":"c1\.md"/);
});
