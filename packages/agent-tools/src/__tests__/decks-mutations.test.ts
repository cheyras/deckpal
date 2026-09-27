/**
 * `save_deck` and `delete_deck` — CONTRACT tests.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * Per the quality audit that opened this work (QUAL-04): every write and
 * revert handler in `packages/agent-tools` had zero test coverage, and
 * `save_deck`/`delete_deck` are two of the three tools in this package that
 * can rewrite or destroy a deck's ENTIRE card list with no undo path other
 * than `revert`/`deck_history revert_to`. Both route entirely through
 * `ctx.api` (SPEC §3 — deck logic stays single-sourced in deckpal-api), so a
 * stub `Api` is enough; no database, no network. Same convention as
 * `deckReads.test.ts` and `deckIntel-infer.test.ts`.
 *
 * This file pins:
 *  - `save_deck`'s create/edit MODE split — the reported bug this tool's own
 *    schema comment describes: an ambiguous call must never silently rewrite
 *    someone's existing deck when they meant to create a new one;
 *  - `dry_run` on both tools never sends a mutating call;
 *  - the diff-based reconciliation (`cards` replaces the WHOLE list — an
 *    omitted card is removed, not left alone);
 *  - `delete_deck`'s three destructive shapes (soft delete / restore /
 *    `purge:true`, which has no undo) each send the exact request they claim
 *    to; and
 *  - STRICT name resolution on every write path — an approximate name must
 *    come back as a question, never as an action, per `entities.ts`'s
 *    documented asymmetry between reads and writes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allTools } from '../index.js';
import type { Api } from '../api.js';
import type { Ctx } from '../ctx.js';

const byName = (n: string) => allTools().find((d) => d.name === n)!;

interface StubApi extends Api {
  sends: { method: string; path: string; body?: unknown }[];
  gets: { path: string }[];
}

function stubApi(opts: {
  get?: (path: string) => unknown;
  send?: (method: string, path: string, body?: unknown) => unknown;
}): StubApi {
  const sends: { method: string; path: string; body?: unknown }[] = [];
  const gets: { path: string }[] = [];
  return {
    sends,
    gets,
    base: 'https://test/api',
    get: async (path: string) => {
      gets.push({ path });
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

const deckDetail = (over: Partial<{ name: string; formatCode: string; version: number; cards: { cardId: string; quantity: number }[] }> = {}) => ({
  deck: { id: 'deck-1', name: over.name ?? 'Toolbox Slowking', formatCode: over.formatCode ?? 'standard', version: over.version ?? 2, totalCount: 60, valueUsd: null, legal: true, updatedAt: '2026-08-01T00:00:00.000Z', strategyMd: null },
  counts: { total: 60, pokemon: 23, trainer: 27, energy: 10, distinctNames: 20 },
  cards: (over.cards ?? [{ cardId: 'sv01-25', quantity: 4 }]).map((c) => ({
    cardId: c.cardId,
    name: c.cardId,
    number: '025',
    setId: 'sv01',
    category: 'Pokemon',
    quantity: c.quantity,
    owned: 0,
    have: false,
    price: null,
  })),
  validation: { format: 'standard', legal: true, counts: { total: 60, pokemon: 23, trainer: 27, energy: 10, unresolved: 0 }, violations: [], warnings: [] },
});

// ── save_deck: create vs edit is EXPLICIT, never inferred into a rewrite ────

test('save_deck create makes a brand new deck even when a same-named one already exists — never appends to it', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      if (method === 'POST' && path === '/decks') {
        assert.equal((body as { name: string }).name, 'Toolbox Slowking');
        return { deck: { id: 'deck-2', name: 'Toolbox Slowking', formatCode: 'standard' } };
      }
      if (method === 'POST' && path === '/decks/deck-2/cards') return {};
      if (method === 'GET') throw new Error('unreachable');
      throw new Error(`unexpected send ${method} ${path}`);
    },
  });
  // A second GET on /decks/deck-2 for the post-op recount.
  const originalGet = api.get.bind(api);
  api.get = async (path: string) => {
    if (path === '/decks/deck-2') return deckDetail({ name: 'Toolbox Slowking' });
    return originalGet(path);
  };

  const res = await byName('save_deck').handler(
    { mode: 'create', name: 'Toolbox Slowking', cards: [{ card_id: 'sv01-25', quantity: 4 }], dry_run: false },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Created deck 'Toolbox Slowking' \(standard\) — id deck-2/);
  assert.ok(api.sends.some((s) => s.method === 'POST' && s.path === '/decks'), 'must create a NEW deck');
  assert.equal(api.sends.some((s) => s.path === 'deck-1' || s.path.includes('deck-1')), false, 'must never touch the existing deck of the same name');
});

test('save_deck dry_run on create previews and sends nothing', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('save_deck').handler(
    { mode: 'create', name: 'New Deck', cards: [{ card_id: 'sv01-25', quantity: 4 }], dry_run: true },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /DRY RUN — nothing executed\. Would:/);
  assert.match(res.text, /CREATE a new deck called 'New Deck'/);
  assert.equal(api.sends.length, 0);
});

test("mode 'edit' with no resolvable deck_id fails rather than silently creating one", async () => {
  const api = stubApi({});
  const res = await byName('save_deck').handler({ mode: 'edit', name: 'X', dry_run: true }, makeCtx(api));
  assert.equal(res.isError, true);
  assert.match(res.text, /mode 'edit' needs deck_id/);
  assert.equal(api.sends.length, 0);
  assert.equal(api.gets.length, 0);
});

test('save_deck edit on an approximate (fuzzy) name is a CHOICE, never an action — STRICT resolution', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('save_deck').handler(
    { mode: 'edit', deck_id: 'slowking toolbox', cards: [{ card_id: 'sv01-25', quantity: 1 }], dry_run: true },
    makeCtx(api),
  );

  assert.equal(res.isError, true, 'a fuzzy hit on a write must refuse, not proceed');
  assert.equal(api.sends.length, 0);
});

test('save_deck edit RECONCILES the whole list — a card omitted from `cards` is removed, not left alone', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckDetail({ cards: [{ cardId: 'sv01-25', quantity: 4 }, { cardId: 'sv01-26', quantity: 2 }] });
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('save_deck').handler(
    { mode: 'edit', deck_id: 'Toolbox Slowking', cards: [{ card_id: 'sv01-25', quantity: 4 }], dry_run: true },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /remove x2 sv01-26/, 'the card left out of the target list must be planned for removal');
  assert.equal(/set sv01-25/.test(res.text), false, 'sv01-25 is unchanged and must not appear as an op');
  assert.equal(api.sends.length, 0, 'dry_run must send nothing');
});

test('save_deck edit dry_run:false actually runs the diffed operations against the API', async () => {
  const ops: string[] = [];
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckDetail({ cards: [{ cardId: 'sv01-25', quantity: 4 }] });
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      ops.push(`${method} ${path}`);
      if (method === 'PATCH' && path === '/decks/deck-1/cards/sv01-25') {
        assert.equal((body as { quantity: number }).quantity, 2);
        return {};
      }
      throw new Error(`unexpected send ${method} ${path}`);
    },
  });
  const originalGet = api.get.bind(api);
  let getCount = 0;
  api.get = async (path: string) => {
    if (path === '/decks/deck-1') {
      getCount++;
      // First call (pre-diff) has qty 4; the post-op recount has qty 2.
      return getCount === 1 ? deckDetail({ cards: [{ cardId: 'sv01-25', quantity: 4 }] }) : deckDetail({ cards: [{ cardId: 'sv01-25', quantity: 2 }] });
    }
    return originalGet(path);
  };

  const res = await byName('save_deck').handler(
    { mode: 'edit', deck_id: 'Toolbox Slowking', cards: [{ card_id: 'sv01-25', quantity: 2 }], dry_run: false },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.ok(ops.includes('PATCH /decks/deck-1/cards/sv01-25'));
  assert.match(res.text, /Updated deck 'Toolbox Slowking'/);
});

test('save_deck with no changes reports "No changes" and writes nothing', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckDetail({ cards: [{ cardId: 'sv01-25', quantity: 4 }] });
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('save_deck').handler(
    { mode: 'edit', deck_id: 'Toolbox Slowking', cards: [{ card_id: 'sv01-25', quantity: 4 }], dry_run: false },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /No changes — deck 'Toolbox Slowking' already matches/);
  assert.equal(api.sends.length, 0);
});

test('save_deck ptcgl_text and cards together is rejected before any query', async () => {
  const api = stubApi({});
  const res = await byName('save_deck').handler(
    { name: 'X', ptcgl_text: '4 Pikachu sv1 25', cards: [{ card_id: 'sv01-25', quantity: 4 }], dry_run: true },
    makeCtx(api),
  );
  assert.equal(res.isError, true);
  assert.match(res.text, /Pass either ptcgl_text or cards, not both/);
  assert.equal(api.gets.length, 0);
});

// ── delete_deck: soft delete, restore, and purge (no undo) each send exactly what they claim ─

test('delete_deck dry_run reports what would happen and sends nothing', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckDetail();
      if (path === '/decks/deck-1/versions') return { versions: [{ battleLogs: { total: 3 } }] };
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('delete_deck').handler({ deck_id: 'Toolbox Slowking', purge: false, restore: false, dry_run: true }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /DRY RUN — nothing deleted\. Would delete/);
  assert.match(res.text, /restorable afterwards/);
  assert.equal(api.sends.length, 0);
});

test('delete_deck purge:true dry_run says PERMANENTLY and warns there is no undo', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckDetail();
      if (path === '/decks/deck-1/versions') return { versions: [] };
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('delete_deck').handler({ deck_id: 'Toolbox Slowking', purge: true, restore: false, dry_run: true }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Would PERMANENTLY destroy/);
  assert.match(res.text, /CANNOT be recovered/);
  assert.equal(api.sends.length, 0);
});

test('delete_deck dry_run:false soft-deletes with the plain DELETE (no ?purge=true) and offers restore', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckDetail();
      if (path === '/decks/deck-1/versions') return { versions: [] };
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path) => {
      assert.equal(method, 'DELETE');
      assert.equal(path, '/decks/deck-1');
      return { restorable: true, batchId: 'batch-del-1' };
    },
  });

  const res = await byName('delete_deck').handler({ deck_id: 'Toolbox Slowking', purge: false, restore: false, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Deleted deck 'Toolbox Slowking'/);
  assert.match(res.text, /restore with delete_deck\(deck_id: "deck-1", restore: true, dry_run: false\)/);
  assert.match(res.text, /revert\(batch_id: "batch-del-1"\)/);
});

test('delete_deck purge:true dry_run:false sends ?purge=true and reports PURGED with no restore offer', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckDetail();
      if (path === '/decks/deck-1/versions') return { versions: [] };
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path) => {
      assert.equal(method, 'DELETE');
      assert.equal(path, '/decks/deck-1?purge=true');
      return { restorable: false };
    },
  });

  const res = await byName('delete_deck').handler({ deck_id: 'Toolbox Slowking', purge: true, restore: false, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /PURGED deck 'Toolbox Slowking'/);
  assert.equal(res.text.includes('restore'), false, 'a purge must never suggest an undo that does not exist');
});

test('delete_deck restore:true resolves against the RECYCLE BIN, not the live index', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks?deleted=true') return DECKS;
      throw new Error(`unexpected get ${path} — restore must look in the bin, not the live index`);
    },
    send: (method, path) => {
      assert.equal(method, 'POST');
      assert.equal(path, '/decks/deck-1/restore');
      return { deck: deckDetail() };
    },
  });

  const res = await byName('delete_deck').handler({ deck_id: 'Toolbox Slowking', purge: false, restore: true, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Restored deck 'Toolbox Slowking'/);
});

test('delete_deck on an approximate name is a CHOICE, never an action, even with purge:true', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
    send: () => {
      throw new Error('must never be reached');
    },
  });

  const res = await byName('delete_deck').handler({ deck_id: 'slowking toolbox', purge: true, restore: false, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, true);
  assert.equal(api.sends.length, 0);
});
