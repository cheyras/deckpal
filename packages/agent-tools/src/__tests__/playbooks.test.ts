/**
 * The playbooks (playbooks/texts.ts, the `playbook` tool): DeckPal's step-by-step guides. An instruction a model cannot
 * follow is worse than none, so every tool a playbook names must be in the registry, and every snake_case argument it
 * names must be an argument some tool takes. The index must route to every playbook, and each stays small enough to
 * read on every job.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allTools, PLAYBOOK_INDEX_TEXT, PLAYBOOK_NAMES, PLAYBOOK_TEXT } from '../index.js';

const tools = allTools();
const toolNames = new Set(tools.map((t) => t.name));

/** Every key any tool's schema takes, nested objects and arrays of objects included. */
function schemaKeys(): Set<string> {
  const keys = new Set<string>();
  const walk = (s: unknown): void => {
    if (!s || typeof s !== 'object') return;
    const def = (s as { _def?: Record<string, unknown>; shape?: unknown }) ;
    const shape = typeof (s as { shape?: unknown }).shape === 'object' ? (s as { shape: Record<string, unknown> }).shape : null;
    if (shape) for (const [k, v] of Object.entries(shape)) {
      keys.add(k);
      walk(v);
    }
    const d = def._def ?? {};
    for (const inner of [d.innerType, d.type, d.schema, (d as { element?: unknown }).element]) walk(inner);
    if (Array.isArray(d.options)) for (const o of d.options) walk(o);
  };
  for (const t of tools) walk(t.inputSchema);
  return keys;
}

const ALL_TEXT = [PLAYBOOK_INDEX_TEXT, ...Object.values(PLAYBOOK_TEXT)];
/** Names a playbook quotes from a tool's RESULT text, not its arguments (card_price_history pages by next_offset). */
const RESULT_FIELDS = new Set(['next_offset']);

test('every tool a playbook names is a real DeckPal tool', () => {
  const missing = new Set<string>();
  for (const text of ALL_TEXT) {
    for (const m of text.matchAll(/`([a-z][a-z_]*)`/g)) {
      const name = m[1]!;
      // A backticked snake_case word that is a tool name somewhere in the catalogue style ("battle_logs").
      if (/_/.test(name) && !toolNames.has(name) && !schemaKeys().has(name) && !RESULT_FIELDS.has(name)) missing.add(name);
    }
  }
  assert.deepEqual([...missing], [], `named but not a tool or an argument: ${[...missing].join(', ')}`);
});

test('every snake_case argument a playbook passes ("arg:" or "arg =") is one some tool takes', () => {
  const keys = schemaKeys();
  const missing = new Set<string>();
  for (const text of ALL_TEXT) {
    for (const m of text.matchAll(/`([a-z][a-z_]*_[a-z_]+)\s*[:=]/g)) if (!keys.has(m[1]!)) missing.add(m[1]!);
  }
  assert.deepEqual([...missing], []);
});

test('the index routes to every playbook, and names the tool that opens them', () => {
  for (const name of PLAYBOOK_NAMES) assert.match(PLAYBOOK_INDEX_TEXT, new RegExp(`\\b${name}\\b`), `${name} is not in the index`);
  assert.match(PLAYBOOK_INDEX_TEXT, /call `playbook` with the job's name/);
  assert.match(PLAYBOOK_INDEX_TEXT, /deckpal\.app\/skill/);
});

test('each playbook stays small enough to read on every job', () => {
  assert.ok(PLAYBOOK_INDEX_TEXT.length <= 3_600, `index ${PLAYBOOK_INDEX_TEXT.length}`);
  for (const [name, text] of Object.entries(PLAYBOOK_TEXT)) assert.ok(text.length <= 5_000, `${name} ${text.length}`);
});

test("the owner's changes are in the playbooks (2026-10-13 tests)", () => {
  // Rules from DeckPal, not memory, and the two invented myths named.
  assert.match(PLAYBOOK_TEXT.rules, /rules_lookup/);
  // Deep reviews use the digest's turns and the simulator's turn review; reasonable plays are not misplays.
  assert.match(PLAYBOOK_TEXT['game-analysis'], /battle_turn_review/);
  assert.match(PLAYBOOK_TEXT['game-analysis'], /detail: 'turns'/);
  // Records split by how games ended.
  assert.match(PLAYBOOK_TEXT['record-review'], /ended before the last Prize/);
  // No asking for a screen name DeckPal already knows.
  assert.match(PLAYBOOK_TEXT['battle-log'], /Do not ask for a name/);
});

test('the playbook tool: no name gives the index, a name gives that playbook, and it is a read', async () => {
  const tool = tools.find((t) => t.name === 'playbook')!;
  assert.ok(tool, 'registered');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal((await tool.handler({}, {} as never)).text, PLAYBOOK_INDEX_TEXT);
  assert.equal((await tool.handler({ name: 'rules' }, {} as never)).text, PLAYBOOK_TEXT.rules);
  assert.equal(tool.inputSchema!.safeParse({ name: 'nope' }).success, false);
});
