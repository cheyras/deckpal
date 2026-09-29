import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deckeImprovementTools, type Api, type Ctx } from '../index.js';

const tool = (name: string) => deckeImprovementTools.find((candidate) => candidate.name === name)!;

function context(get: (path: string) => unknown): Ctx & { paths: string[] } {
  const paths: string[] = [];
  const api: Api = {
    base: 'https://deckpal.test/api',
    async get(path) { paths.push(path); return get(path); },
    async send() { throw new Error('read-only improvement tools never send'); },
  };
  return { paths, api, userId: 'admin', db: { async query() { return { rows: [] } as never; } } };
}

test('decke_improvement_list sends every contract filter and renders the cursor', async () => {
  const ctx = context(() => ({ items: [{ id: 'c1', startedAt: 'start', updatedAt: 'end', turnCount: 2, costUsd: 0.3, costCoverage: 'partial', hasError: true }], nextCursor: 'next|id' }));
  const result = await tool('decke_improvement_list').handler({ build_pr: 42, vote: '-1', has_error: true, cursor: 'old|id', limit: 17 }, ctx);
  assert.match(ctx.paths[0]!, /build_pr=42/);
  assert.match(ctx.paths[0]!, /vote=-1/);
  assert.match(ctx.paths[0]!, /has_error=true/);
  assert.match(result.text, /c1.*HAS ERROR/);
  assert.match(result.text, /next_cursor: next\|id/);
});

test('decke_improvement_read keeps full tool payloads but pages turns', async () => {
  const ctx = context(() => ({
    conversation: { id: '11111111-1111-4111-8111-111111111111', costUsd: 0.01, costCoverage: 'complete' },
    turns: [
      { seq: 0, asked: 'skip me', answered: 'old' },
      { seq: 1, asked: 'Why?', answered: 'Because', legs: [{ leg: 0, toolCalls: [{ name: 'lookup', args: { id: 7 }, output: { full: 'answer' } }] }], events: [{ kind: 'animation', payload: { state: 'thinking' } }] },
      { seq: 2, asked: 'later', answered: 'later' },
    ],
  }));
  const result = await tool('decke_improvement_read').handler({ id: '11111111-1111-4111-8111-111111111111', from_turn: 1, limit: 1 }, ctx);
  assert.doesNotMatch(result.text, /skip me/);
  assert.match(result.text, /"full":"answer"/);
  assert.match(result.text, /"state":"thinking"/);
  assert.match(result.text, /call again with from_turn:2/);
});

test('decke_improvement_search encodes the query and returns snippets with ids', async () => {
  const ctx = context(() => ({ items: [{ conversationId: 'c9', seq: 3, askedSnippet: 'clear failure', answeredSnippet: 'retry worked', toolNames: ['lookup'] }] }));
  const result = await tool('decke_improvement_search').handler({ query: 'failure & retry', limit: 5 }, ctx);
  assert.equal(ctx.paths[0], '/admin/decke-improvement/search?q=failure+%26+retry&limit=5');
  assert.match(result.text, /c9 \| turn 3 \| clear failure/);
  assert.match(result.text, /retry worked.*tools lookup/);
});

test('all three improvement tools are read-only', () => {
  for (const name of ['decke_improvement_list', 'decke_improvement_read', 'decke_improvement_search']) {
    assert.equal(tool(name).annotations.readOnlyHint, true);
  }
});
