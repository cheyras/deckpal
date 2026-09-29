import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDeepTools } from '../deep.js';
import { deepRefused, isNoWork } from '../deepOutcome.js';
import { DEEP_TOOL_NAMES, seedMeteredRefusals } from '../meteredRefusals.js';

const INPUT = { query: 'current Standard meta', topic: 'competitive', purpose: 'Current Standard meta' };

test('the metered deep tier now contains only web_research', () => {
  assert.deepEqual([...DEEP_TOOL_NAMES], ['web_research']);
});

test('a tier-wide refusal blocks later web research in the same turn', () => {
  const ledger = seedMeteredRefusals(null);
  ledger.note('web_research', INPUT, 'cap');
  assert.equal(ledger.unavailable('web_research'), true);
  assert.equal(ledger.blocked('web_research', { ...INPUT, query: 'different' }), 'cap');
  assert.equal(ledger.unavailable('research_meta'), false);
});

test('a credit refusal blocks only the identical research call', () => {
  const ledger = seedMeteredRefusals(null);
  ledger.note('web_research', INPUT, 'credits');
  assert.equal(ledger.blocked('web_research', { topic: 'competitive', purpose: 'Current Standard meta', query: 'current Standard meta' }), 'credits');
  assert.equal(ledger.blocked('web_research', { ...INPUT, query: 'latest regional results' }), undefined);
  assert.equal(ledger.unavailable('web_research'), false);
});

test('a replayed web_research refusal seeds the execution guard', () => {
  const history = [
    { role: 'user', parts: [{ type: 'text', text: 'research this' }] },
    {
      role: 'assistant',
      parts: [{
        type: 'tool-web_research', state: 'output-available', input: INPUT,
        output: deepRefused('not enough credits', 'credits'),
      }],
    },
  ];
  assert.equal(seedMeteredRefusals(history).blocked('web_research', INPUT), 'credits');
});

test('a blocked forced execution is not charged again', async () => {
  const ledger = seedMeteredRefusals(null);
  ledger.note('web_research', INPUT, 'credits');
  let charges = 0;
  const tools = buildDeepTools({
    ctx: { pool: null as never, userId: 'u', jwt: 'j', apiBase: 'https://example.test/api' },
    gateway: (() => { throw new Error('provider must not run'); }) as never,
    charge: async () => { charges += 1; return { allowed: true }; },
    refusals: ledger,
  }) as unknown as Record<string, {
    needsApproval: (input: unknown) => boolean;
    execute: (input: Record<string, unknown>, options: { toolCallId: string }) => Promise<string>;
  }>;
  assert.equal(tools.web_research!.needsApproval(INPUT), false);
  const output = await tools.web_research!.execute(INPUT, { toolCallId: 'r1' });
  assert.equal(charges, 0);
  assert.ok(isNoWork(output));
});
