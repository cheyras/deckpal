/**
 * The connector's judgment layer (guidance.ts): server instructions and four
 * prompts, added 2026-10-10 because Claude over MCP logged battles "but did the
 * bare minimum" — no debrief, no analysis, no summary worth reading.
 *
 * Two kinds of test, on purpose:
 *
 * 1. CONTENT. The battle-log playbook is the reason this file exists, so its
 *    load-bearing sentences are pinned — debrief before logging, origin
 *    in_person with an explicit result, the reader's words in `notes` and the
 *    analysis in `review`, `opponent_archetype`, and the three review depths.
 *    A wording cleanup that drops one fails here, not in a user's chat.
 *
 * 2. THE WIRE. Guidance that names a tool or field the client does not have is
 *    worse than none (see guidance.ts). So every snake_case identifier the
 *    guidance mentions must be a real tool in `@deckpal/agent-tools`' registry
 *    or a real property/enum value in a schema `tools/list` actually
 *    advertises; and the instructions and prompts are read back through the
 *    real SDK over an in-memory transport, which is what proves that
 *    `new McpServer(info, { instructions })` and `registerPrompt` are being
 *    called the way @modelcontextprotocol/server 2.1 expects.
 *
 * Runs against `@deckpal/agent-tools`' dist (its package `default` export), so
 * build that package first — CI's "Build @deckpal/agent-tools" step does.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { InMemoryTransport, LATEST_PROTOCOL_VERSION, type JSONRPCMessage } from '@modelcontextprotocol/server';
import { allTools, type Ctx } from '@deckpal/agent-tools';
import type { ToolVisibility } from '../adapters/mcp.js';
import { PROMPTS, SERVER_INSTRUCTIONS } from '../guidance.js';
import { buildServer } from '../server.js';

// ── A minimal JSON-RPC client over the SDK's in-memory transport ─────────────

interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface Connection {
  init: Record<string, unknown>;
  request: (method: string, params?: Record<string, unknown>) => Promise<RpcReply>;
  close: () => Promise<void>;
}

async function connect(options: ToolVisibility = {}): Promise<Connection> {
  // The ctx is never touched: nothing here calls a tool or reads the resource.
  const server = buildServer({} as Ctx, options);
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const waiting = new Map<number, (reply: RpcReply) => void>();
  client.onmessage = (message: JSONRPCMessage) => {
    const id = (message as { id?: unknown }).id;
    if (typeof id === 'number' && waiting.has(id)) {
      waiting.get(id)!(message as RpcReply);
      waiting.delete(id);
    }
  };
  await server.connect(serverSide);
  await client.start();

  let nextId = 1;
  const request = (method: string, params?: Record<string, unknown>) =>
    new Promise<RpcReply>((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      void client.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) } as JSONRPCMessage);
    });

  const reply = await request('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'guidance-test', version: '0.0.0' },
  });
  assert.equal(reply.error, undefined, `initialize failed: ${JSON.stringify(reply.error)}`);
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);
  return { init: reply.result!, request, close: () => server.close() };
}

interface AdvertisedTool {
  name: string;
  inputSchema: { properties?: Record<string, JsonSchema> };
}

interface JsonSchema {
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
}

/** Property names and string enum values anywhere in an advertised schema. */
function schemaWords(schema: JsonSchema | undefined, into: Set<string>): void {
  if (!schema) return;
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    into.add(key);
    schemaWords(child, into);
  }
  schemaWords(schema.items, into);
  for (const branch of schema.anyOf ?? []) schemaWords(branch, into);
  for (const value of schema.enum ?? []) if (typeof value === 'string') into.add(value);
}

/** These checks read @deckpal/agent-tools' dist, so a field added on a branch is invisible until it is rebuilt. */
const STALE_HINT = 'Not in the registry or advertised schemas. If it was just added to @deckpal/agent-tools, rebuild that package (pnpm --filter @deckpal/agent-tools build): these tests read its dist.';

function promptDef(name: string) {
  const found = PROMPTS.find((candidate) => candidate.name === name);
  assert.ok(found, `missing prompt ${name}`);
  return found;
}

/**
 * Every prompt rendered, for the identifier scan. The values are plain words
 * so that only the template's own identifiers are scanned, never an argument
 * name echoed back.
 */
const RENDERED_PROMPTS = PROMPTS.map((p) =>
  p.render(Object.fromEntries(p.arguments.map((a) => [a.name, 'Sample value']))),
);

// ── Content ──────────────────────────────────────────────────────────────────

describe('server instructions: content', () => {
  test('fit the 4,000-character budget (they ride along on every turn)', () => {
    assert.ok(SERVER_INSTRUCTIONS.length <= 4_000, `${SERVER_INSTRUCTIONS.length} characters exceeds 4,000`);
  });

  test('DeckPal data over memory, and dry run before every write', () => {
    assert.match(SERVER_INSTRUCTIONS, /source of truth for card text.*legality.*prices.*never from memory/s);
    assert.match(SERVER_INSTRUCTIONS, /previews by default.*get the user's yes.*`dry_run`: false/s);
  });

  test('an in-person game is debriefed in chat BEFORE it is logged, on the five questions', () => {
    const debrief = SERVER_INSTRUCTIONS.match(/BEFORE any `add_battle_log` call, ask 3–5 debrief questions[^\n]*/);
    assert.ok(debrief, 'the debrief must come before the first add_battle_log call');
    for (const topic of [/main attacker and notable cards/, /who went first/, /prizes/, /most frustrating play/, /turn they'd replay/]) {
      assert.match(debrief[0], topic);
    }
  });

  test("logs it as origin in_person with an explicit result, the reader's words in notes and the analysis in review", () => {
    assert.match(SERVER_INSTRUCTIONS, /`origin`: "in_person", an explicit `result`/);
    assert.match(SERVER_INSTRUCTIONS, /user's own words go in `notes`; your analysis \(markdown\) goes in `review`/);
    assert.match(SERVER_INSTRUCTIONS, /Always set `opponent_archetype`/);
  });

  test('sizes the review: light, standard, deep, keyed off the per-archetype record', () => {
    assert.match(SERVER_INSTRUCTIONS, /Light:.*2–3 lines/);
    assert.match(SERVER_INSTRUCTIONS, /Standard:.*turning point.*variance, misplay, list or matchup.*one lesson/);
    assert.match(SERVER_INSTRUCTIONS, /Deep:.*new to this deck or met >= 3 times/);
    assert.match(SERVER_INSTRUCTIONS, /Read `battle_logs` for the deck first: in its archetype record/);
  });

  test('result reviews are honest about sample size and stop at two next steps', () => {
    assert.match(SERVER_INSTRUCTIONS, /record with its number of games/);
    assert.match(SERVER_INSTRUCTIONS, /at most two next steps/);
  });

  test('deck work: check_deck until legal at 60, then save with an evidence-bearing version_note', () => {
    assert.match(SERVER_INSTRUCTIONS, /Run `check_deck`.*repeat until it is legal at 60/s);
    assert.match(SERVER_INSTRUCTIONS, /`version_note` citing the evidence/);
  });
});

describe('guidance names only what an MCP client has', () => {
  const texts = [SERVER_INSTRUCTIONS, ...RENDERED_PROMPTS];

  test('no Deck-E-only tool or affordance leaks in', () => {
    for (const text of texts) {
      assert.doesNotMatch(text, /\b(ask_user|showDeck|goTo|escort|express|web_research)\b|@pasted|Deep Think/);
    }
  });

  test('every backticked tool name in the instructions exists in the shared registry', () => {
    const registry = new Set(allTools().map((tool) => tool.name));
    // A backticked snake_case word is either an argument (some tool's input
    // field) or a tool. Whatever is not a field must be a registered tool.
    const fields = new Set(allTools().flatMap((tool) =>
      Object.keys((tool.inputSchema as { shape?: Record<string, unknown> } | undefined)?.shape ?? {})));
    const toolish = [...SERVER_INSTRUCTIONS.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)]
      .map((m) => m[1]!)
      .filter((word) => !fields.has(word));
    assert.ok(new Set(toolish).size >= 9, `expected the playbooks to name their tools, found ${[...new Set(toolish)].join(', ')}`);
    assert.deepEqual(toolish.filter((name) => !registry.has(name)), [], STALE_HINT);
  });

  describe('against the live tools/list', () => {
    let tools: AdvertisedTool[] = [];
    let known = new Set<string>();
    let conn: Connection;

    before(async () => {
      conn = await connect();
      const reply = await conn.request('tools/list');
      tools = (reply.result as { tools: AdvertisedTool[] }).tools;
      known = new Set(allTools().map((tool) => tool.name));
      for (const tool of tools) schemaWords(tool.inputSchema as JsonSchema, known);
    });
    after(() => conn.close());

    test('every snake_case identifier in the instructions and prompts is a real tool, field or enum value', () => {
      const unknown = new Set<string>();
      for (const text of texts) {
        for (const [word] of text.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) {
          if (!known.has(word)) unknown.add(word);
        }
      }
      assert.deepEqual([...unknown], [], STALE_HINT);
    });

    test('each field the playbooks tell the model to set exists on the tool they name', () => {
      const fieldsOf = (name: string) => {
        const tool = tools.find((t) => t.name === name);
        assert.ok(tool, `${name} is not advertised`);
        return tool.inputSchema.properties ?? {};
      };
      const add = fieldsOf('add_battle_log');
      for (const field of ['deck_id', 'log', 'origin', 'result', 'opponent_deck', 'opponent_archetype', 'notes', 'review', 'dry_run']) {
        assert.ok(field in add, `add_battle_log has no ${field}. ${STALE_HINT}`);
      }
      assert.ok(add.origin!.enum?.includes('in_person'), "add_battle_log's origin must accept in_person");
      const edit = fieldsOf('edit_battle_log');
      for (const field of ['review', 'notes', 'opponent_archetype', 'dry_run']) assert.ok(field in edit, `edit_battle_log has no ${field}`);
      const save = fieldsOf('save_deck');
      for (const field of ['mode', 'version_note', 'dry_run']) assert.ok(field in save, `save_deck has no ${field}`);
      assert.deepEqual(save.mode!.enum, ['create', 'edit']);
      assert.ok('deck_id' in fieldsOf('battle_logs'));
      fieldsOf('check_deck');
      fieldsOf('deck_history');
      fieldsOf('set_progress');
      // deck_strategy is the one write the instructions single out as having
      // no preview. If it grows a dry_run, that sentence becomes wrong.
      assert.equal('dry_run' in fieldsOf('deck_strategy'), false);
    });
  });
});

// ── The wire ─────────────────────────────────────────────────────────────────

describe('over the SDK', () => {
  let conn: Connection;
  before(async () => { conn = await connect(); });
  after(() => conn.close());

  test('initialize returns the instructions verbatim and advertises prompts', () => {
    assert.equal(conn.init.instructions, SERVER_INSTRUCTIONS);
    assert.ok((conn.init.capabilities as Record<string, unknown>).prompts, 'prompts capability missing');
  });

  test('prompts/list advertises the four prompts with their arguments and required flags', async () => {
    const reply = await conn.request('prompts/list');
    const listed = (reply.result as {
      prompts: { name: string; title?: string; description?: string; arguments?: { name: string; description?: string; required?: boolean }[] }[];
    }).prompts;
    assert.deepEqual(listed.map((p) => p.name), ['log-battle', 'review-results', 'build-deck', 'plan-collection']);
    for (const def of PROMPTS) {
      const wire = listed.find((p) => p.name === def.name)!;
      assert.equal(wire.title, def.title);
      assert.equal(wire.description, def.description);
      assert.deepEqual(
        wire.arguments,
        def.arguments.map((a) => ({ name: a.name, description: a.description, required: a.required })),
      );
    }
  });

  const get = async (name: string, args: Record<string, string>) => {
    const reply = await conn.request('prompts/get', { name, arguments: args });
    assert.equal(reply.error, undefined, JSON.stringify(reply.error));
    const { messages } = reply.result as { messages: { role: string; content: { type: string; text: string } }[] };
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.role, 'user');
    return messages[0]!.content.text;
  };

  test('log-battle carries a pasted log and the whole playbook', async () => {
    const paste = 'Setup\nAsh chose heads for the opening coin flip.\nTurn # 1 - Ash\'s Turn';
    const text = await get('log-battle', { how: paste });
    assert.ok(text.includes(paste), 'the paste must reach the model verbatim');
    assert.match(text, /verbatim as `log`/);
    assert.match(text, /3–5 debrief questions in one message BEFORE logging/);
    assert.match(text, /origin "in_person", an explicit result/);
    assert.match(text, /My own words go in notes; your analysis goes in review/);
    assert.match(text, /light .* standard .* deep/s);
    assert.match(text, /opponent_archetype/);
  });

  test("log-battle accepts a bare mode word: 'in person' starts the debrief, 'paste' waits for the log", async () => {
    const inPerson = await get('log-battle', { how: 'in person' });
    assert.match(inPerson, /It was an in-person game\. Ask me which deck and the result along with the debrief/);
    assert.doesNotMatch(inPerson, /Here is what I have/);
    const paste = await get('log-battle', { how: 'paste' });
    assert.match(paste, /I will paste the PTCG Live battle log in my next message/);
  });

  test('review-results names the deck and caps next steps', async () => {
    const text = await get('review-results', { deck: 'Toolbox Slowking' });
    assert.match(text, /"Toolbox Slowking"/);
    assert.match(text, /number of games/);
    assert.match(text, /at most two concrete next steps/);
  });

  test('build-deck renders format and goal, and asks when the goal is left out', async () => {
    const withGoal = await get('build-deck', { format: 'Standard', budget_goal: '$40 and league-ready' });
    assert.match(withGoal, /a Standard Pokémon TCG deck/);
    assert.match(withGoal, /Budget \/ goal: \$40 and league-ready/);
    assert.match(withGoal, /check_deck .* legal at 60/);
    const without = await get('build-deck', { format: 'Expanded' });
    assert.match(without, /Budget \/ goal: not decided yet — ask me\./);
  });

  test('plan-collection renders the set and DeckPal\'s three goals', async () => {
    const text = await get('plan-collection', { set: 'Prismatic Evolutions' });
    assert.match(text, /finish Prismatic Evolutions/);
    assert.match(text, /complete .* master .* grandmaster/s);
    assert.match(text, /Never invent pull rates/);
  });

  test('a missing or blank required argument is refused by the SDK, not rendered as "undefined"', async () => {
    const missing = await conn.request('prompts/get', { name: 'review-results', arguments: {} });
    assert.ok(missing.error, 'expected an error for a missing deck');
    const blank = await conn.request('prompts/get', { name: 'log-battle', arguments: { how: '   ' } });
    assert.ok(blank.error, 'expected an error for a blank how');
  });
});

test('a read-only connection gets the same instructions, which tell it what to do without write tools', async () => {
  const conn = await connect({ readOnly: true });
  try {
    assert.equal(conn.init.instructions, SERVER_INSTRUCTIONS);
    const reply = await conn.request('tools/list');
    const names = (reply.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    assert.equal(names.includes('add_battle_log'), false);
    assert.match(SERVER_INSTRUCTIONS, /If `add_battle_log` or `save_deck` is missing, this connection is read-only/);
  } finally {
    await conn.close();
  }
});

test('prompt definitions render each argument they declare', () => {
  for (const def of PROMPTS) {
    const args = Object.fromEntries(def.arguments.map((a) => [a.name, `marker-${a.name}`]));
    const text = def.render(args);
    for (const a of def.arguments) assert.ok(text.includes(`marker-${a.name}`), `${def.name} dropped ${a.name}`);
  }
  assert.deepEqual(promptDef('build-deck').arguments.map((a) => [a.name, a.required]), [['format', true], ['budget_goal', false]]);
});
