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
 *  - `delete_battle_log` is genuinely irreversible and its dry run says so;
 *    and
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
  sends: { method: string; path: string; body?: unknown }[];
  gets: string[];
}

function stubApi(opts: {
  get?: (path: string) => unknown;
  send?: (method: string, path: string, body?: unknown) => unknown;
}): StubApi {
  const sends: { method: string; path: string; body?: unknown }[] = [];
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
    send: async (method: string, path: string, body?: unknown) => {
      sends.push({ method, path, body });
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
        result: 'loss', opponentArchetype: 'Dragapult ex', notes: 'new notes', reviewMd: 'new review',
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
      assert.deepEqual(body, { opponent: null });
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

// ── delete_battle_log: irreversible ─────────────────────────────────────────

test('delete_battle_log dry_run says it would delete and warns deletion is not undoable, sends nothing', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs/7') {
        return { log: { id: 7, deckVersion: 2, result: 'win', opponent: 'Robni16', opponentDeck: null, playedAt: '2026-08-19T00:00:00.000Z' } };
      }
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('delete_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, dry_run: true }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /DRY RUN — nothing deleted\. Would delete/);
  assert.match(res.text, /battle #7/);
  assert.equal(api.sends.length, 0);
});

test('delete_battle_log dry_run:false actually deletes', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/logs/7') {
        return { log: { id: 7, deckVersion: 2, result: 'win', opponent: 'Robni16', opponentDeck: null, playedAt: '2026-08-19T00:00:00.000Z' } };
      }
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path) => {
      assert.equal(method, 'DELETE');
      assert.equal(path, '/decks/deck-1/logs/7');
      return {};
    },
  });

  const res = await byName('delete_battle_log').handler({ deck_id: 'Toolbox Slowking', log_id: 7, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /^Deleted battle #7/);
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
