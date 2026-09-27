/**
 * `edit_list` and `delete_list` — CONTRACT tests.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * `lists.test.ts` in this same directory covers `meansCreate`/`peelRarity` —
 * the pure helpers these two tools use — but never calls either HANDLER, and
 * `toolErrors.test.ts` covers exactly one path (`edit_list` on a broken
 * `ctx.db`, for the secret-leak guard). Everything else — the create/edit
 * split, `add_cards` resolution, `add_missing`, item removal, `dry_run`, and
 * `delete_list`'s soft-delete/restore/purge shapes — had zero coverage
 * (QUAL-04). `edit_list` additionally resolves cards through `ctx.db`
 * (`resolveCardsBatch`/`variantsOfMany`, the same functions `log_cards` uses),
 * so this file stubs both `ctx.db` and `ctx.api`.
 *
 * Pins:
 *  - the create/edit MODE split (the bug this tool's own schema comment
 *    documents: an ambiguous call must create, never silently append to an
 *    existing same-named list);
 *  - `add_cards` resolves the same card-reference shape `log_cards` accepts,
 *    through the batch resolver, not a per-item loop;
 *  - `dry_run` sends no mutating call, including the `add_missing` PREVIEW
 *    request, which must itself be a dry-run probe, not a real add;
 *  - `delete_list`'s three destructive shapes send exactly what they claim;
 *    and
 *  - STRICT resolution on every write path.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
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

/** A card catalogue for `add_cards` resolution, matching `resolve.ts`'s `CARD_SELECT` columns. */
const PIKACHU_ROW = {
  id: 1,
  tcgdex_id: 'sv01-25',
  name: 'Pikachu',
  local_id: '025',
  rarity: 'Common',
  category: 'Pokemon',
  set_tcgdex_id: 'sv01',
  set_name: 'Scarlet & Violet',
  series_slug: 'sv',
  best_minor: 50,
};

function makeCtx(api: StubApi): Ctx {
  return {
    userId: 'u1',
    api,
    db: {
      query: async <T extends pg.QueryResultRow>(sql: string, params: unknown[]): Promise<{ rows: T[] }> => {
        if (/FROM browsable_card c/.test(sql) && /tcgdex_id = ANY\(\$1::text\[\]\)/.test(sql)) {
          const ids = params[0] as string[];
          return { rows: (ids.includes('sv01-25') ? [PIKACHU_ROW] : []) as unknown as T[] };
        }
        if (/FROM card_variant cv/.test(sql)) {
          return {
            rows: [
              { card_id: 1, id: 9001, variant_kind_code: 'normal', display_name: null, is_primary: true, owned_qty: 0 },
            ] as unknown as T[],
          };
        }
        return { rows: [] as unknown as T[] };
      },
    },
  } as unknown as Ctx;
}

const LISTS = { lists: [{ id: 'list-1', name: 'Binder A', kind: 'dynamic', itemCount: 2 }] };

const listDetail = (over: Partial<{ name: string; kind: string; itemCount: number; items: unknown[] }> = {}) => ({
  list: { id: 'list-1', name: over.name ?? 'Binder A', kind: over.kind ?? 'dynamic', itemCount: over.itemCount ?? (over.items?.length ?? 2), progress: null, marketValueUsd: null, updatedAt: '2026-08-01T00:00:00.000Z' },
  items: over.items ?? [
    { itemId: 'item-1', position: 1, kind: 'card', cardId: 'sv01-25', name: 'Pikachu' },
    { itemId: 'item-2', position: 2, kind: 'card', cardId: 'sv01-26', name: 'Raichu' },
  ],
});

// ── edit_list: create vs edit ────────────────────────────────────────────────

test('edit_list create makes a NEW list even when a same-named one exists — never appends to it', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      if (method === 'POST' && path === '/lists') {
        assert.equal((body as { name: string }).name, 'Binder A');
        return { list: { id: 'list-2', name: 'Binder A', kind: 'dynamic' } };
      }
      throw new Error(`unexpected send ${method} ${path}`);
    },
  });
  const originalGet = api.get.bind(api);
  api.get = async (path: string) => (path === '/lists/list-2' ? listDetail({ items: [] }) : originalGet(path));

  const res = await byName('edit_list').handler(
    { mode: 'create', name: 'Binder A', kind: 'dynamic', dry_run: false },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Created dynamic list 'Binder A' — id list-2/);
  assert.equal(api.sends.some((s) => s.path.includes('list-1')), false, 'must never touch the existing list of the same name');
});

test("mode 'edit' with no resolvable list_id fails, naming how to create instead", async () => {
  const api = stubApi({});
  const res = await byName('edit_list').handler({ mode: 'edit', kind: 'dynamic', dry_run: true }, makeCtx(api));
  assert.equal(res.isError, true);
  assert.match(res.text, /mode 'edit' needs list_id/);
  assert.equal(api.sends.length, 0);
});

test('edit_list edit on an approximate name is a CHOICE, never an action — STRICT resolution', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('edit_list').handler({ mode: 'edit', list_id: 'binder a-1', kind: 'dynamic', dry_run: true }, makeCtx(api));

  assert.equal(res.isError, true);
  assert.match(res.text, /To CREATE a new list/);
  assert.equal(api.sends.length, 0);
});

// ── add_cards: resolved through the SAME batch resolver as log_cards ────────

test('edit_list add_cards resolves a card_id through ctx.db and plans it — dry_run sends nothing', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      if (path === '/lists/list-1') return listDetail();
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('edit_list').handler(
    { mode: 'edit', list_id: 'Binder A', add_cards: [{ card_id: 'sv01-25' }], kind: 'dynamic', dry_run: true },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /add Pikachu \(sv01-25, normal\)/);
  assert.equal(api.sends.length, 0);
});

test('edit_list add_cards dry_run:false sends the bulk-add call with the resolved variant id', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      if (path === '/lists/list-1') return listDetail();
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      if (method === 'POST' && path === '/lists/list-1/items/bulk') {
        assert.deepEqual((body as { items: unknown[] }).items, [{ cardVariantId: 9001, dexId: undefined, quantity: 1, note: undefined }]);
        return { added: 1, alreadyPresent: 0, unresolved: [], batchId: 'batch-add-1' };
      }
      throw new Error(`unexpected send ${method} ${path}`);
    },
  });

  const res = await byName('edit_list').handler(
    { mode: 'edit', list_id: 'Binder A', add_cards: [{ card_id: 'sv01-25' }], kind: 'dynamic', dry_run: false },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /done: added 1/);
  assert.match(res.text, /undo with revert\(batch_id: "batch-add-1"\)/);
});

test('edit_list add_cards with an unresolvable card is reported and does not stop the rename from applying', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      if (path === '/lists/list-1') return listDetail();
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      if (method === 'PATCH' && path === '/lists/list-1') {
        assert.equal((body as { name: string }).name, 'Renamed');
        return {};
      }
      throw new Error(`unexpected send ${method} ${path}`);
    },
  });

  const res = await byName('edit_list').handler(
    { mode: 'edit', list_id: 'Binder A', name: 'Renamed', add_cards: [{ card_id: 'no-such-card' }], kind: 'dynamic', dry_run: false },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /FAILED: add/);
  assert.match(res.text, /done: rename → 'Renamed'/);
});

// ── add_missing: the preview call is ITSELF a dry run ───────────────────────

test('edit_list add_missing dry_run asks the API for a PREVIEW (dryRun:true) and sends no other write', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      if (path === '/lists/list-1') return listDetail();
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path, body) => {
      assert.equal(method, 'POST');
      assert.equal(path, '/lists/list-1/items/bulk');
      assert.equal((body as { dryRun: boolean }).dryRun, true, 'the PREVIEW call itself must be a dry run against the API');
      return { wouldAdd: 3, items: [{ label: 'Bulbasaur' }, { label: 'Ivysaur' }, { label: 'Venusaur' }] };
    },
  });

  const res = await byName('edit_list').handler(
    { mode: 'edit', list_id: 'Binder A', add_missing: { set_id: 'sv01', goal: 'complete' }, kind: 'dynamic', dry_run: true },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /add 3 missing card\(s\) from sv01/);
  assert.equal(api.sends.length, 1, 'only the preview call, never a real add, while dry_run is true');
});

test('edit_list add_missing needs an existing list_id — cannot target a list being created in the same call', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('edit_list').handler(
    { mode: 'create', name: 'Fresh List', add_missing: { set_id: 'sv01', goal: 'complete' }, kind: 'dynamic', dry_run: true },
    makeCtx(api),
  );

  assert.equal(res.isError, true);
  assert.match(res.text, /add_missing needs an existing list_id/);
});

// ── remove_item_ids and restore ─────────────────────────────────────────────

test('edit_list remove_item_ids flags an id that is not in this list, before executing', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      if (path === '/lists/list-1') return listDetail();
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('edit_list').handler(
    { mode: 'edit', list_id: 'Binder A', remove_item_ids: ['item-1', 'item-999'], kind: 'dynamic', dry_run: true },
    makeCtx(api),
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /remove item item-1\n/);
  assert.match(res.text, /remove item item-999 — NOT IN THIS LIST \(will fail\)/);
  assert.equal(api.sends.length, 0);
});

test('edit_list restore:true resolves against the recycle bin', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists?deleted=true') return LISTS;
      throw new Error(`unexpected get ${path} — restore must look in the bin`);
    },
    send: (method, path) => {
      assert.equal(method, 'POST');
      assert.equal(path, '/lists/list-1/restore');
      return { list: listDetail().list };
    },
  });

  const res = await byName('edit_list').handler({ list_id: 'Binder A', restore: true, kind: 'dynamic', dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Restored/);
});

// ── delete_list: soft delete / purge / approximate-name refusal ────────────

test('delete_list dry_run reports what would happen and sends nothing', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      if (path === '/lists/list-1') return listDetail();
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('delete_list').handler({ list_id: 'Binder A', purge: false, dry_run: true }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /DRY RUN — nothing deleted\. Would delete/);
  assert.match(res.text, /restorable afterwards/);
  assert.equal(api.sends.length, 0);
});

test('delete_list purge:true dry_run:false sends ?purge=true and reports PURGED with no restore offer', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      if (path === '/lists/list-1') return listDetail();
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path) => {
      assert.equal(method, 'DELETE');
      assert.equal(path, '/lists/list-1?purge=true');
      return { restorable: false };
    },
  });

  const res = await byName('delete_list').handler({ list_id: 'Binder A', purge: true, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /PURGED dynamic list 'Binder A'/);
  assert.equal(res.text.includes('restore'), false);
});

test('delete_list dry_run:false soft-deletes and offers restore via edit_list', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      if (path === '/lists/list-1') return listDetail();
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path) => {
      assert.equal(method, 'DELETE');
      assert.equal(path, '/lists/list-1');
      return { restorable: true, batchId: 'batch-del-list-1' };
    },
  });

  const res = await byName('delete_list').handler({ list_id: 'Binder A', purge: false, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /restore with edit_list\(list_id: "list-1", restore: true\)/);
  assert.match(res.text, /revert\(batch_id: "batch-del-list-1"\)/);
});

test('delete_list on an approximate name is a CHOICE, never an action, even with purge:true', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/lists') return LISTS;
      throw new Error(`unexpected get ${path}`);
    },
    send: () => {
      throw new Error('must never be reached');
    },
  });

  const res = await byName('delete_list').handler({ list_id: 'binder a-1', purge: true, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, true);
  assert.equal(api.sends.length, 0);
});
