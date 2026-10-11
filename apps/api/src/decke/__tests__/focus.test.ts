import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToolSet } from 'ai';
import { allTools } from '@deckpal/agent-tools';
import { focusedTools } from '../focus.js';

const definitions = allTools();
const tools = Object.fromEntries(definitions.map(({ name }) => [name, {}])) as ToolSet;

test('step zero shows add_battle_log and every other tool, including writes', () => {
  assert.deepEqual(focusedTools(tools, 0), Object.keys(tools));
  const visible = new Set(focusedTools(tools, 0));
  assert.ok(visible.has('add_battle_log'));
  for (const write of definitions.filter((definition) => !definition.annotations.readOnlyHint)) {
    assert.ok(visible.has(write.name), `step zero hid write tool ${write.name}`);
  }
});

test('later steps expose the same complete tool set', () => {
  assert.deepEqual(focusedTools(tools, 7), Object.keys(tools));
});

test('impossible tools remain the one filtered class on every step', () => {
  const impossible = (name: string) => name === 'save_deck' || name === 'web_research';
  assert.deepEqual(
    focusedTools(tools, 0, impossible),
    Object.keys(tools).filter((name) => !impossible(name)),
  );
});
