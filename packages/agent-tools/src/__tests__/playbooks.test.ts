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

/** Every key one schema takes, nested objects and arrays of objects included. */
function keysOf(schema: unknown): Set<string> {
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
  walk(schema);
  return keys;
}

/** Every key any tool's schema takes. */
function schemaKeys(): Set<string> {
  return new Set(tools.flatMap((t) => [...keysOf(t.inputSchema)]));
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

test('every argument written beside a tool ("`tool` with `arg`, `arg: value`") is one THAT tool takes (Astra, #344)', () => {
  // A real argument of another tool is still wrong here: zod drops it silently (`delete_list` with `restore` deleted).
  const wrong: string[] = [];
  for (const [where, text] of [['index', PLAYBOOK_INDEX_TEXT] as const, ...Object.entries(PLAYBOOK_TEXT)]) {
    for (const m of text.matchAll(/`([a-z][a-z_]*)` with ([^\n]*)/g)) {
      const tool = tools.find((x) => x.name === m[1]);
      if (!tool) continue;
      const takes = keysOf(tool.inputSchema);
      // The clause: to the end of the sentence, or to the next tool named in it.
      const sentence = m[2]!.split(/\.(?:\s|$)/)[0]!;
      const spans = [...sentence.matchAll(/`([^`]+)`/g)].map((x) => x[1]!);
      const stop = spans.findIndex((sp) => toolNames.has(sp));
      for (const span of stop < 0 ? spans : spans.slice(0, stop)) {
        for (const k of span.matchAll(/(?:^|[{,]\s*)([a-z][a-z_]*)(?=\s*[:,}=]|\s*$)/g)) {
          if (!takes.has(k[1]!)) wrong.push(`${where}: ${tool.name} has no ${k[1]}`);
        }
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test("a tool table row's arguments are that tool's: one tool per row, and an argument after another tool's name is that tool's", () => {
  // `| \`delete_list\` | ... \`restore: true\` |` read as delete_list's (Astra, #344). A `key: value` span, or a bare
  // snake_case one, is an argument; plain words (`cards`, `pricing`) can be values, so they are not checked here.
  const wrong: string[] = [];
  for (const [where, text] of [['index', PLAYBOOK_INDEX_TEXT] as const, ...Object.entries(PLAYBOOK_TEXT)]) {
    for (const line of text.split('\n')) {
      const cells = line.split('|').slice(1, -1);
      if (cells.length < 2) continue;
      const named = [...cells[0]!.matchAll(/`([a-z][a-z_]*)`/g)].map((m) => m[1]!).filter((n) => toolNames.has(n));
      if (!named.length) continue;
      if (named.length > 1) {
        wrong.push(`${where}: one tool per row (${named.join(', ')})`);
        continue;
      }
      let tool = named[0]!;
      for (const span of cells.slice(1).flatMap((c) => [...c.matchAll(/`([^`]+)`/g)].map((m) => m[1]!))) {
        if (toolNames.has(span)) {
          tool = span;
          continue;
        }
        const key = /^([a-z][a-z_]*)\s*[:=]/.exec(span)?.[1] ?? (/^[a-z]+_[a-z_]+$/.test(span) ? span : null);
        if (key && !RESULT_FIELDS.has(key) && !keysOf(tools.find((x) => x.name === tool)!.inputSchema).has(key)) {
          wrong.push(`${where}: ${tool} has no ${key}`);
        }
      }
    }
  }
  assert.deepEqual(wrong, []);
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
