/**
 * A read-only connection (migration 075) is served the read tools and nothing
 * else. The REST API refuses its writes too, but a model should never be shown
 * a tool it cannot use: it would try it, fail, and tell the person something
 * is broken. So the tool list itself is the first refusal, pinned here.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/server';
import { allTools, deckeImprovementTools, type Ctx } from '@deckpal/agent-tools';
import { registerAllTools } from '../mcp.js';

function registered(options?: { readOnly?: boolean; deckeImprovementRead?: boolean }): string[] {
  const names: string[] = [];
  const server = { registerTool: (name: string) => names.push(name) } as unknown as McpServer;
  registerAllTools(server, {} as Ctx, options);
  return names;
}

test('a read-only connection sees exactly the tools marked readOnlyHint', () => {
  const reads = allTools().filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
  assert.deepEqual(registered({ readOnly: true }), reads);
  assert.equal(reads.length, 15, 'the ordinary catalogue is 15 reads before capability-gated tools');
  assert.ok(reads.includes('check_deck'), 'deck checking must remain available on read-only connections');
  assert.ok(reads.includes('battle_digest'), 'a read-only connection can still review a game it cannot log');
});

test('no tool that writes or deletes reaches a read-only connection', () => {
  const served = new Set(registered({ readOnly: true }));
  for (const name of ['log_cards', 'save_deck', 'delete_deck', 'delete_list', 'edit_list', 'revert', 'deck_strategy']) {
    assert.equal(served.has(name), false, `${name} must not be served read-only`);
  }
});

test('a full connection still sees every tool, in catalogue order', () => {
  const ordinary = allTools().map((t) => t.name);
  assert.deepEqual(registered(), ordinary);
  assert.deepEqual(registered({ readOnly: false }), ordinary);
});

test('only a credential carrying decke_improvement_read sees the collection tools', () => {
  const names = deckeImprovementTools.map((tool) => tool.name);
  assert.deepEqual(registered().filter((name) => names.includes(name)), []);
  assert.deepEqual(registered({ deckeImprovementRead: true }).filter((name) => names.includes(name)), names);
  assert.deepEqual(registered({ readOnly: true, deckeImprovementRead: true }).filter((name) => names.includes(name)), names);
});
