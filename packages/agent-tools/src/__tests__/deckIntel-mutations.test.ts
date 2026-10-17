/**
 * `deck_strategy`, `add_battle_log`/`edit_battle_log` (the APPLY paths — their
 * dry_run paths are already pinned by `deckIntel-infer.test.ts`),
 * `delete_battle_log`, and `deck_history`'s `revert_to` (the apply path — its
 * dry_run/strict-refusal paths are already pinned by `deckReads.test.ts`).
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * QUAL-04 found that every write and revert handler in this package had zero
 * test coverage. `deckIntel-infer.test.ts` and `deckReads.test.ts` since
 * closed part of that gap for `add_battle_log`/`edit_battle_log`/
 * `deck_history`, but only their DRY-RUN branches — the actual write, and
 * `deck_strategy` and `delete_battle_log` in full, were still untested. All
 * five tools route entirely through `ctx.api` (SPEC §3), so a stub `Api` is
 * enough.
 *
 * Pins:
 *  - `deck_strategy` reads loosely but WRITES strictly (the same asymmetry
 *    `save_deck` and `deck_history` document), reports the previous guide's
 *    heading before replacing it, and clearing it with an empty string is
 *    distinct from leaving it untouched;
 *  - `add_battle_log`/`edit_battle_log` apply paths send exactly the fields
 *    that were set (never an implicit clear of an omitted one);
 *  - `delete_battle_log` moves a log to the deck's recycle bin, `restore`
 *    brings it back, and only `purge` is irreversible — each dry run says
 *    which (2026-10-12; before that every delete was permanent);
 *  - the writes a retry would double (`add_battle_log`, a revert) carry a
 *    retry key, and the ones that set a state do not; and
 *  - `deck_history revert_to` apply reports the new version and surfaces any
 *    card the catalog can no longer resolve as a SKIPPED row rather than
 *    failing the whole revert.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allTools } from '../index.js';
import type { Api } from '../api.js';
import type { Ctx } from '../ctx.js';

const byName = (n: string) => allTools().find((d) => d.name === n)!;

interface StubApi extends Api {
  sends: { method: string; path: string; body?: unknown; headers?: Record<string, string> }[];
  gets: string[];
}

function stubApi(opts: {
  get?: (path: string) => unknown;
  send?: (method: string, path: string, body?: unknown) => unknown;
}): StubApi {
  const sends: { method: string; path: string; body?: unknown; headers?: Record<string, string> }[] = [];
  const gets: string[] = [];
  return {
    sends,
    gets,
    base: 'https://test/api',
    get: async (path: string) => {
      gets.push(path);
      if (opts.get) return opts.get(path);
      throw new Error(`unexpected get ${path}`);
    },
    send: async (method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
      sends.push({ method, path, body, ...(headers ? { headers } : {}) });
      if (opts.send) return opts.send(method, path, body);
      throw new Error(`unexpected send ${method} ${path}`);
    },
  } as unknown as StubApi;
}

function makeCtx(api: StubApi): Ctx {
  return { db: { query: async () => ({ rows: [] }) }, userId: 'u1', api } as unknown as Ctx;
}

const DECKS = { decks: [{ id: 'deck-1', name: 'Toolbox Slowking', formatCode: 'standard', version: 2 }] };

const deckLite = (over: Partial<{ strategyMd: string | null; version: number }> = {}) => ({
  deck: { id: 'deck-1', name: 'Toolbox Slowking', formatCode: 'standard', version: over.version ?? 2, strategyMd: over.strategyMd ?? null },
  counts: { total: 60 },
  validation: { legal: true },
});

// ── deck_strategy ────────────────────────────────────────────────────────────

test('deck_strategy READ resolves loosely — an approximate name still answers', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckLite({ strategyMd: '# Opening plan\n\nLead with Slowking.' });
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('deck_strategy').handler({ deck_id: 'slowking toolbox' }, makeCtx(api));

  assert.equal(res.isError, undefined, 'a read must not refuse an approximate name');
  assert.match(res.text, /Lead with Slowking\./);
});

test('deck_strategy over MCP previews a rewrite by default and saves only on dry_run:false; Deck-E saves at once', async () => {
  const get = (path: string) => {
    if (path === '/decks') return DECKS;
    if (path === '/decks/deck-1') return deckLite({ strategyMd: '# Opening plan\n\nLead with Slowking.\nBench Dusclops.' });
    throw new Error(`unexpected get ${path}`);
  };
  const tool = byName('deck_strategy');
  assert.ok(tool.mcp, 'the MCP server needs its own contract for this tool');
  assert.equal(tool.mcp.inputSchema.parse({ deck_id: 'x', markdown: 'y' }).dry_run, true);
  assert.equal('dry_run' in tool.inputSchema!.shape, false, "Deck-E's schema must not grow a dry_run its approval card already covers");

  const previewApi = stubApi({ get });
  const preview = await tool.mcp.handler({ deck_id: 'Toolbox Slowking', markdown: '# Opening plan\n\nLead with Slowking.\nBench Munkidori.', dry_run: true }, makeCtx(previewApi));
  assert.equal(preview.isError, undefined, preview.text);
  assert.match(preview.text, /^DRY RUN — nothing saved\./);
  assert.match(preview.text, /1 line\(s\) added, 1 removed/);
  assert.equal(previewApi.sends.length, 0);

  const save = () => ({ ...deckLite({ strategyMd: '# New' }) });
  const applyApi = stubApi({ get, send: save });
  await tool.mcp.handler({ deck_id: 'Toolbox Slowking', markdown: '# New', dry_run: false }, makeCtx(applyApi));
  assert.deepEqual(applyApi.sends.map((s) => [s.method, s.path]), [['PUT', '/decks/deck-1/strategy']]);

  const deckeApi = stubApi({ get, send: save });
  await tool.handler({ deck_id: 'Toolbox Slowking', markdown: '# New' }, makeCtx(deckeApi));
  assert.deepEqual(deckeApi.sends.map((s) => [s.method, s.path]), [['PUT', '/decks/deck-1/strategy']]);
});

test('deck_strategy WRITE on an approximate name is a CHOICE, never an action', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
    send: () => {
      throw new Error('must never be reached');
    },
  });

  const res = await byName('deck_strategy').handler({ deck_id: 'slowking toolbox', markdown: '# New plan' }, makeCtx(api));

  assert.equal(res.isError, true);
  assert.equal(api.sends.length, 0);
});

test('deck_strategy write reports the PREVIOUS guide before replacing it', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckLite({ strategyMd: '# Old plan\n\nRetreat early.' });
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      assert.equal(method, 'PUT');
      assert.equal(path, '/decks/deck-1/strategy');
      assert.equal((body as { strategyMd: string }).strategyMd, '# New plan');
      return deckLite({ strategyMd: '# New plan' });
    },
  });

  const res = await byName('deck_strategy').handler({ deck_id: 'Toolbox Slowking', markdown: '# New plan' }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Strategy guide saved/);
  assert.match(res.text, /Replaced previous guide 'Old plan'/);
  assert.match(res.text, /Snapshotted with v2 — strategy edits never bump the deck version/);
});

test('deck_strategy write with an EMPTY string clears the guide and sends null, not an empty string', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckLite({ strategyMd: '# Old plan' });
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      assert.equal((body as { strategyMd: string | null }).strategyMd, null);
      return deckLite({ strategyMd: null });
    },
  });

  const res = await byName('deck_strategy').handler({ deck_id: 'Toolbox Slowking', markdown: '' }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Strategy guide cleared/);
});

test('deck_strategy on a deck with no previous guide says so, not "Replaced \'none\'"', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckLite({ strategyMd: null });
      throw new Error(`unexpected get ${path}`);
    },
    send: () => deckLite({ strategyMd: '# New plan' }),
  });

  const res = await byName('deck_strategy').handler({ deck_id: 'Toolbox Slowking', markdown: '# New plan' }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /There was no previous guide\./);
});

// ── add_battle_log: the APPLY path (dry_run:false) ──────────────────────────

test('add_battle_log dry_run:true uses the deck-specific write route preparation', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      assert.equal(method, 'POST');
      assert.equal(path, '/decks/deck-1/logs');
      assert.deepEqual(body, {
        rawLog: 'RAW', origin: 'ptcgl', result: 'loss', playerName: 'Me', opponentDeck: 'Dragapult ex',
        notes: 'misplayed t3', playedAt: '2026-10-09T12:00:00.000Z',
        source: 'deckpal-mcp', dryRun: true,
      });
      return {
        dryRun: true,
        attachedToVersion: 2,
        preview: {
          deckName: 'Toolbox Slowking', version: 2, result: 'loss', opponent: 'Rival',
          opponentDeck: 'Dragapult ex', opponentDeckGuess: 'Dragapult ex', turns: 9,
          prizes: { me: 3, opponent: 6 }, confidence: 'high', myPokemon: ['Slowking'],
          notes: 'misplayed t3', playedAt: '2026-10-09T12:00:00.000Z',
        },
      };
    },
  });

  const res = await byName('add_battle_log').handler(
    {
      deck_id: 'Toolbox Slowking', log: 'RAW', result: 'loss', player_name: 'Me',
      opponent_deck: 'Dragapult ex', notes: 'misplayed t3',
      played_at: '2026-10-09T12:00:00.000Z', dry_run: true,
    },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /^Would attach to 'Toolbox Slowking' \(v2\): LOSS vs Rival \(Dragapult ex\)/);
  assert.match(res.text, /Nothing was logged\./);
  assert.equal(api.sends.length, 1, 'preview must make one deck-specific dry-run call');
});

test('add_battle_log dry_run:false attaches the log and sends only the fields that were set', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs?version=2&pageSize=1') return { totals: { total: 1, wins: 1, losses: 0, ties: 0 } };
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      assert.equal(method, 'POST');
      assert.equal(path, '/decks/deck-1/logs');
      assert.deepEqual(body, { rawLog: 'RAW', origin: 'ptcgl', source: 'deckpal-mcp' });
      return {
        attachedToVersion: 2,
        log: {
          id: 7,
          deckVersion: 2,
          result: 'win',
          opponent: 'Robni16',
          opponentDeck: null,
          turns: 12,
          prizes: { me: 6, opponent: 2 },
          notes: null,
          playedAt: '2026-08-19T00:00:00.000Z',
          source: 'deckpal-mcp',
          rawLog: 'RAW',
          parsed: { confidence: 'high' },
          createdAt: '2026-08-19T00:00:00.000Z',
        },
      };
    },
  });

  const res = await byName('add_battle_log').handler({ deck_id: 'Toolbox Slowking', log: 'RAW', dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Logged battle #7 → attached to v2/);
  assert.match(res.text, /v2 record: 1W–0L–0T \(1 log\(s\)\)/);
});

test('add_battle_log dry_run:false forwards optional overrides only when given', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs?version=2&pageSize=1') return { totals: { total: 1, wins: 0, losses: 1, ties: 0 } };
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      assert.deepEqual(body, {
        rawLog: 'RAW',
        origin: 'ptcgl',
        result: 'loss',
        playerName: 'Me',
        opponentDeck: 'Dragapult ex',
        opponentArchetype: "N's Zoroark ex",
        notes: 'misplayed t3',
        reviewMd: '## Review\nSequence the gust first.',
        source: 'deckpal-mcp',
      });
      return {
        attachedToVersion: 2,
        log: {
          id: 8,
          deckVersion: 2,
          result: 'loss',
          opponent: null,
          opponentDeck: 'Dragapult ex',
          turns: null,
          prizes: null,
          notes: 'misplayed t3',
          playedAt: '2026-08-19T00:00:00.000Z',
          source: 'deckpal-mcp',
          rawLog: 'RAW',
          parsed: null,
          createdAt: '2026-08-19T00:00:00.000Z',
        },
      };
    },
  });

  const res = await byName('add_battle_log').handler(
    {
      deck_id: 'Toolbox Slowking', log: 'RAW', result: 'loss', player_name: 'Me',
      opponent_deck: 'Dragapult ex', opponent_archetype: "N's Zoroark ex",
      notes: 'misplayed t3', review: '## Review\nSequence the gust first.', dry_run: false,
    },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Logged battle #8/);
});

test('add_battle_log records an in-person game without log and attributes Deck-E', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs?version=2&pageSize=1') return { totals: { total: 1, wins: 1, losses: 0, ties: 0 } };
      throw new Error(`unexpected get ${path}`);
    },
    send: (_method, path, body) => {
      assert.equal(path, '/decks/deck-1/logs');
      assert.deepEqual(body, {
        origin: 'in_person', result: 'win', opponentDeck: 'Gardevoir ex',
        opponentArchetype: 'Gardevoir ex', notes: 'I topdecked the gust.',
        reviewMd: '## Read\nThe prize map held.', source: 'deck-e',
      });
      return {
        attachedToVersion: 2,
        log: {
          id: 9, deckVersion: 2, result: 'win', opponent: null,
          opponentDeck: 'Gardevoir ex', opponentArchetype: 'gardevoir-ex', origin: 'in_person',
          turns: null, prizes: null, notes: 'I topdecked the gust.', reviewMd: '## Read\nThe prize map held.',
          playedAt: '2026-10-10T00:00:00.000Z', source: 'deck-e', rawLog: null,
          parsed: null, createdAt: '2026-10-10T00:00:00.000Z',
        },
      };
    },
  });
  const ctx = { ...makeCtx(api), source: 'deck-e' };

  const res = await byName('add_battle_log').handler({
    deck_id: 'Toolbox Slowking', origin: 'in_person', result: 'win',
    opponent_deck: 'Gardevoir ex', opponent_archetype: 'Gardevoir ex',
    notes: 'I topdecked the gust.', review: '## Read\nThe prize map held.', dry_run: false,
  }, ctx);

  assert.equal(res.isError, undefined, res.text);
  assert.match(res.text, /Logged battle #9/);
});

// ── edit_battle_log: the APPLY path ─────────────────────────────────────────

test('edit_battle_log dry_run:false applies and recomputes the version record', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs?version=3&pageSize=1') return { totals: { total: 2, wins: 1, losses: 1, ties: 0 } };
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      assert.equal(method, 'PATCH');
      assert.equal(path, '/decks/deck-1/logs/7');
      assert.deepEqual(body, {
        result: 'loss', opponentArchetype: 'Dragapult ex', notes: 'new notes', reviewMd: 'new review', source: 'deckpal-mcp',
      });
      return {
        log: {
          id: 7,
          deckVersion: 3,
          result: 'loss',
          opponent: 'OldFoe',
          opponentDeck: null,
          turns: 10,
          prizes: { me: 3, opponent: 6 },
          notes: 'new notes',
          playedAt: '2026-08-01T12:00:00.000Z',
          source: 'web',
          rawLog: 'RAW',
          parsed: null,
          createdAt: '2026-08-01T12:00:00.000Z',
        },
      };
    },
  });

  const res = await byName('edit_battle_log').handler(
    {
      deck_id: 'Toolbox Slowking', log_id: 7, result: 'loss',
      opponent_archetype: 'Dragapult ex', notes: 'new notes', review: 'new review', dry_run: false,
    },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Updated battle #7 \(v3\)/);
  assert.match(res.text, /v3 record now: 1W–1L–0T \(2 log\(s\)\)/);
});

test('edit_battle_log with NO fields to change refuses before reaching the API', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('edit_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, true);
  assert.match(res.text, /pass at least one field to change/);
  assert.equal(api.sends.length, 0);
});

test('edit_battle_log null CLEARS a field explicitly — omitted and null are different requests', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs?version=2&pageSize=1') return { totals: { total: 1, wins: 0, losses: 0, ties: 1 } };
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      assert.deepEqual(body, { opponent: null, source: 'deckpal-mcp' });
      return {
        log: {
          id: 7,
          deckVersion: 2,
          result: 'tie',
          opponent: null,
          opponentDeck: null,
          turns: null,
          prizes: null,
          notes: null,
          playedAt: '2026-08-01T12:00:00.000Z',
          source: 'web',
          rawLog: 'RAW',
          parsed: null,
          createdAt: '2026-08-01T12:00:00.000Z',
        },
      };
    },
  });

  const res = await byName('edit_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, opponent: null, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
});

// ── delete_battle_log: recycle bin, restore, purge ──────────────────────────

const LOG7 = { id: 7, deckVersion: 2, result: 'win', opponent: 'Robni16', opponentDeck: null, playedAt: '2026-08-19T00:00:00.000Z' };

/** The API's answer for a log that is not live (it may be in the bin). */
function noLiveLog(): never {
  throw new Error("No battle log '7'");
}

test('delete_battle_log dry_run says the log goes to the recycle bin and can come back, sends nothing', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs/7') return { log: LOG7 };
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('delete_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, dry_run: true }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /DRY RUN — nothing deleted\. Would move battle #7 .* to the recycle bin \(restore: true brings it back\)/);
  assert.equal(api.sends.length, 0);
});

test('delete_battle_log dry_run:false moves it to the bin, with no retry key (a delete sets a state)', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs/7') return { log: LOG7 };
      throw new Error(`unexpected get ${path}`);
    },
    send: () => ({ deleted: 7, restorable: true, batchId: 'b1' }),
  });

  const res = await byName('delete_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /^Deleted battle #7 .* recycle bin; delete_battle_log with restore: true puts it back\./);
  assert.deepEqual(api.sends.map((s) => [s.method, s.path, s.headers]), [['DELETE', '/decks/deck-1/logs/7', undefined]]);
});

test('delete_battle_log purge says PERMANENTLY in its dry run and sends ?purge=true when applied', async () => {
  const get = (path: string) => {
    if (path === '/decks') return DECKS;
    if (path === '/decks/deck-1/logs/7') return { log: LOG7 };
    throw new Error(`unexpected get ${path}`);
  };
  const dry = await byName('delete_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, purge: true, dry_run: true }, makeCtx(stubApi({ get })));
  assert.match(dry.text, /Would PERMANENTLY delete battle #7 .*This cannot be undone\./s);

  const api = stubApi({ get, send: () => ({ deleted: 7, restorable: false, batchId: 'b2' }) });
  const res = await byName('delete_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, purge: true, dry_run: false }, makeCtx(api));
  assert.match(res.text, /^Permanently deleted battle #7/);
  assert.deepEqual(api.sends.map((s) => [s.method, s.path]), [['DELETE', '/decks/deck-1/logs/7?purge=true']]);
});

test('delete_battle_log restore finds the log in the bin and posts the restore', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs/7') return noLiveLog();
      if (path === '/decks/deck-1/logs/deleted') return { logs: [{ ...LOG7, deletedAt: '2026-10-12T09:00:00.000Z' }] };
      throw new Error(`unexpected get ${path}`);
    },
    send: () => ({ log: LOG7, batchId: 'b3' }),
  });

  const dry = await byName('delete_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, restore: true, dry_run: true }, makeCtx(api));
  assert.match(dry.text, /Would restore battle #7 .* from the recycle bin \(deleted 2026-10-12\)/);
  assert.equal(api.sends.length, 0);

  const res = await byName('delete_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, restore: true, dry_run: false }, makeCtx(api));
  assert.equal(res.isError, undefined, res.text);
  assert.match(res.text, /^Restored battle #7 \| v2/);
  assert.deepEqual(api.sends.map((s) => [s.method, s.path, s.headers]), [['POST', '/decks/deck-1/logs/7/restore', undefined]]);
});

test('delete_battle_log on a log already in the bin says so and sends nothing — a retried delete lands softly', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs/7') return noLiveLog();
      if (path === '/decks/deck-1/logs/deleted') return { logs: [{ ...LOG7, deletedAt: '2026-10-12T09:00:00.000Z' }] };
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('delete_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /already in the recycle bin — nothing changed/);
  assert.equal(api.sends.length, 0);
});

test('delete_battle_log on a log that is neither live nor binned fails and names why', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs/7') return noLiveLog();
      if (path === '/decks/deck-1/logs/deleted') return { logs: [] };
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('delete_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, restore: true, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, true);
  assert.match(res.text, /no battle log #7 .* live or in the recycle bin/);
});

test('delete_battle_log refuses restore and purge together before reaching the API', async () => {
  const api = stubApi({});
  const res = await byName('delete_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, restore: true, purge: true, dry_run: false }, makeCtx(api));
  assert.equal(res.isError, true);
  assert.equal(api.gets.length + api.sends.length, 0);
});

test('battle_logs deleted:true lists the recycle bin with when each log went in', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs/deleted') {
        return { logs: [{ ...LOG7, origin: 'ptcgl', opponentArchetype: null, turns: 9, prizes: null, deletedAt: '2026-10-12T09:00:00.000Z' }] };
      }
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('battle_logs').handler({ deck_id: 'Toolbox Slowking', deleted: true, include_raw: false, page: 1 }, makeCtx(api));

  assert.equal(res.isError, undefined, res.text);
  assert.match(res.text, /#7.*deleted 2026-10-12/);
  assert.match(res.text, /1 deleted log\(s\)\. delete_battle_log with restore: true puts one back/);
});

// ── retry keys: only on the writes a retry would double ─────────────────────

test('add_battle_log sends a retry key, and a replayed call says nothing new was written', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path.startsWith('/mutations?idempotency_key=')) return { batches: [] };
      if (path === '/decks/deck-1/logs?version=2&pageSize=1') return { totals: { total: 1, wins: 1, losses: 0, ties: 0 } };
      throw new Error(`unexpected get ${path}`);
    },
    send: () => ({ attachedToVersion: 2, replayed: true, log: { ...LOG7, turns: null, prizes: null, notes: null, source: 'deckpal-mcp', rawLog: 'RAW', parsed: null } }),
  });

  const res = await byName('add_battle_log').handler({ deck_id: 'Toolbox Slowking', log: 'RAW', dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined, res.text);
  assert.match(api.sends[0]!.headers?.['idempotency-key'] ?? '', /^retry:add_battle_log:[0-9a-f]{64}:\d+$/);
  assert.match(res.text, /^Already logged as battle #7 on v2 — this exact request had already run/);
  assert.match(res.text, /log it with played_at or notes/);
});

test('the retry key ignores source, so Deck-E and MCP spellings of one call share a key', async () => {
  const { retryKey } = await import('../writeKey.js');
  const ctx = makeCtx(stubApi({ get: () => ({ batches: [] }) }));
  const req = (source: string) => ({ method: 'POST', path: '/decks/d/logs', body: { rawLog: 'RAW', source } });
  const now = Date.UTC(2026, 9, 12, 10, 5);
  assert.deepEqual(await retryKey(ctx, 'add_battle_log', req('web'), now), await retryKey(ctx, 'add_battle_log', req('deckpal-mcp'), now));
  assert.notDeepEqual(
    await retryKey(ctx, 'add_battle_log', req('web'), now),
    await retryKey(ctx, 'add_battle_log', { ...req('web'), body: { rawLog: 'OTHER' } }, now),
  );
});

test("a retry just after a window boundary reuses the previous window's key when that write committed", async () => {
  const { retryKey, RETRY_WINDOW_MS } = await import('../writeKey.js');
  const now = 1000 * RETRY_WINDOW_MS + 5_000; // five seconds into a new window
  const asked: string[] = [];
  const ctx = makeCtx(stubApi({
    get: (path) => {
      asked.push(path);
      return { batches: [{ status: 'committed' }] };
    },
  }));
  const headers = await retryKey(ctx, 'deck_history', { method: 'POST', path: '/decks/d/revert', body: { toVersion: 1 } }, now);
  assert.match(headers['idempotency-key']!, /:999$/);
  assert.match(asked[0]!, /idempotency_key=retry%3Adeck_history%3A[0-9a-f]{64}%3A999/);
});

test('delete_battle_log on an approximate name is a CHOICE, never an action', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
    send: () => {
      throw new Error('must never be reached');
    },
  });

  const res = await byName('delete_battle_log').handler({ deck_id: 'slowking toolbox', log_id: 7, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, true);
  assert.equal(api.sends.length, 0);
});

// ── deck_history revert_to: the APPLY path ──────────────────────────────────

test("deck_history revert_to dry_run:false reports the new version and preserves the replaced version", async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      assert.equal(method, 'POST');
      assert.equal(path, '/decks/deck-1/revert');
      assert.deepEqual(body, { toVersion: 1, includeStrategy: true, source: 'deckpal-mcp' });
      return {
        deck: { id: 'deck-1', name: 'Toolbox Slowking', formatCode: 'standard', version: 3, strategyMd: '# Restored' },
        counts: { total: 60 },
        validation: { legal: true },
        revert: { toVersion: 1, version: 3, bumped: true, skippedCards: [] },
      };
    },
  });

  const res = await byName('deck_history').handler(
    { deck_id: 'Toolbox Slowking', revert_to: 1, include_strategy: true, dry_run: false },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /created v3; v2 keeps the list it replaced \(see deck_history\)/);
  assert.match(res.text, /deck now: 60 card\(s\), legal, strategy 'Restored'/);
  // Every revert makes a version, so a retried one is keyed and lands once.
  assert.match(api.sends[0]!.headers?.['idempotency-key'] ?? '', /^retry:deck_history:/);
});

test('deck_history revert_to dry_run:false lists a SKIPPED card without failing the revert', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
    send: () => ({
      deck: { id: 'deck-1', name: 'Toolbox Slowking', formatCode: 'standard', version: 2, strategyMd: null },
      counts: { total: 59 },
      validation: { legal: true },
      revert: {
        toVersion: 1,
        version: 2,
        bumped: false,
        skippedCards: [{ cardId: 99, tcgdexId: 'old-99', name: 'Delisted Card' }],
      },
    }),
  });

  const res = await byName('deck_history').handler(
    { deck_id: 'Toolbox Slowking', revert_to: 1, include_strategy: false, dry_run: false },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /created v2; v1 keeps the list it replaced \(see deck_history\)/);
  assert.match(res.text, /SKIPPED \(no longer in catalog\): Delisted Card \| old-99/);
});

test('deck_history revert_to on an approximate name is a CHOICE, never an action', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
    send: () => {
      throw new Error('must never be reached');
    },
  });

  const res = await byName('deck_history').handler({ deck_id: 'slowking toolbox', revert_to: 1, include_strategy: true, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, true);
  assert.equal(api.sends.length, 0);
});
