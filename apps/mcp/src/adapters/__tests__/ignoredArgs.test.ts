/**
 * An argument a tool does not take is SAID, not swallowed (mcp.ts `callSchema`, Phase 4, 2026-10-14).
 *
 * In the owner's Haiku test the model paged `search_cards` with card_price_history's `offset`. zod
 * stripped it, page 1 came back again, and the model took that for the whole result. Over MCP a
 * call is now validated loose, the handler runs on the declared arguments only, and the result's
 * first line names what was ignored. The advertised schema is unchanged.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ctx } from '@deckpal/agent-tools';
import { connectInMemory } from '../../audit/connect.js';
import { listTools } from '../../audit/surface.js';

/** A ctx whose API records the paths it was asked for and answers an empty mutation log and list index. */
function recordingCtx(): { ctx: Ctx; paths: string[] } {
  const paths: string[] = [];
  const api = {
    base: 'https://test/api',
    get: async (path: string) => {
      paths.push(path);
      if (path.startsWith('/mutations')) return { total: 0, page: 1, pageSize: 25, batches: [] };
      if (path.startsWith('/lists')) return { lists: [] };
      return {};
    },
    send: async () => ({}),
  };
  return { ctx: { db: { query: async () => ({ rows: [] }) }, userId: 'u1', api } as unknown as Ctx, paths };
}

const textOf = (reply: { result?: unknown }) =>
  ((reply.result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? '').join('\n');

test('a paging argument the tool does not take is named on the first line, with how it does page', async () => {
  const { ctx, paths } = recordingCtx();
  const conn = await connectInMemory(ctx);
  try {
    const reply = await conn.request('tools/call', { name: 'mutation_history', arguments: { limit: 200 } });
    assert.equal(reply.error, undefined, JSON.stringify(reply.error));
    const text = textOf(reply);
    assert.equal(text.split('\n')[0], 'Ignored `limit`: mutation_history has no such argument. It pages with `page` (and `page_size`).');
    assert.match(text, /No operations match/, 'and the tool still ran');
    assert.ok(paths.some((p) => p.includes('limit=25')), 'on its declared arguments only: the default page size, not 200');
  } finally {
    await conn.close();
  }
});

test('any other unknown argument is named too, without the paging hint, and several are listed together', async () => {
  const { ctx } = recordingCtx();
  const conn = await connectInMemory(ctx);
  try {
    const reply = await conn.request('tools/call', { name: 'lists', arguments: { list_name: 'Binder', sort: 'name' } });
    assert.equal(reply.error, undefined, JSON.stringify(reply.error));
    assert.equal(textOf(reply).split('\n')[0], 'Ignored `list_name`, `sort`: lists has no such arguments.');
  } finally {
    await conn.close();
  }
});

test('a call with only declared arguments reads exactly as before, and the advertised schema is unchanged', async () => {
  const { ctx } = recordingCtx();
  const conn = await connectInMemory(ctx);
  try {
    const reply = await conn.request('tools/call', { name: 'mutation_history', arguments: { page_size: 10 } });
    assert.doesNotMatch(textOf(reply), /Ignored/);
    const { tools } = await listTools();
    const schema = tools.find((t) => t.name === 'mutation_history')!.inputSchema as Record<string, unknown>;
    assert.deepEqual(Object.keys(schema), ['type', 'properties'], 'validated loose, advertised exactly as before: no additionalProperties line added');
  } finally {
    await conn.close();
  }
});
