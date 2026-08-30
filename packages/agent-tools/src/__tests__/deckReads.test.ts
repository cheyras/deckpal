/**
 * Two read paths that were harder to reach than the thing they read.
 *
 * 1. `deck_history` resolved its deck with `strict: true` above the mode
 *    branch, so the timeline and snapshot GETs inherited a rule that only the
 *    `revert_to` write needs. Measured in one turn: `decks` accepted
 *    'slowking toolbox' and `deck_history` refused it, about the same deck.
 *    The tests below pin both halves — the reads resolve loosely and say which
 *    deck they picked, the revert still refuses to guess.
 * 2. `decks` reported the strategy guide as `'# heading' (14267 chars)` with no
 *    way to ask for its text, so reading a guide meant a second, approval-gated
 *    `deck_strategy` call. `include: ['strategy']` renders it from the payload
 *    this handler already has.
 *
 * Pure: `ctx.api` is stubbed the way the sibling tests stub it (see
 * `deckIntel-infer.test.ts`) — no database, no network.
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
      return opts.get ? opts.get(path) : {};
    },
    send: async (method: string, path: string, body?: unknown) => {
      sends.push({ method, path, body });
      return opts.send ? opts.send(method, path, body) : {};
    },
  } as unknown as StubApi;
}

function makeCtx(api: StubApi): Ctx {
  return { db: { query: async () => ({ rows: [] }) }, userId: 'u1', api } as unknown as Ctx;
}

/**
 * The deck index every test resolves against. One deck, whose name is a
 * word-swapped near miss for FUZZY — a single fuzzy hit, which is the case
 * `strict` turns into a question and loose matching resolves.
 */
const DECKS = { decks: [{ id: 'deck-1', name: 'Toolbox Slowking', formatCode: 'standard', version: 2 }] };
const FUZZY = 'slowking toolbox';

const totals = (t = 0) => ({ total: t, wins: 0, losses: 0, ties: 0 });

const versionsPayload = {
  current: 2,
  versions: [
    {
      version: 1,
      note: 'first list',
      source: 'web',
      createdAt: '2026-07-01T00:00:00.000Z',
      cardCount: 60,
      formatCode: 'standard',
      battleLogs: totals(2),
      isCurrent: false,
    },
    {
      version: 2,
      note: null,
      source: 'deckpal-mcp',
      createdAt: '2026-08-01T00:00:00.000Z',
      cardCount: 60,
      formatCode: 'standard',
      battleLogs: totals(),
      isCurrent: true,
    },
  ],
};

const versionDetail = (version: number, isCurrent: boolean) => ({
  version,
  isCurrent,
  formatCode: 'standard',
  note: null,
  source: 'web',
  createdAt: '2026-07-01T00:00:00.000Z',
  strategyMd: null,
  cardCount: 1,
  cards: [{ cardId: 1, tcgdexId: 'sv01-25', name: 'Slowking', quantity: 4 }],
  battleLogs: totals(version === 2 ? 0 : 2),
  diff: null,
});

/** True when the handler reached the versions API at all. */
const readVersions = (api: StubApi): boolean => api.gets.some((g) => g.path.includes('/versions'));

// ── deck_history: the reads resolve the way their siblings do ─────────────────

test('deck_history timeline resolves a fuzzy name and names the deck it picked', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/versions') return versionsPayload;
      throw new Error(`unexpected get ${path}`);
    },
  });
  const ctx = makeCtx(api);

  const res = await byName('deck_history').handler(
    { deck_id: FUZZY, include_strategy: true, dry_run: true },
    ctx,
  );

  assert.equal(res.isError, undefined, 'a timeline read must not refuse an approximate name');
  assert.match(res.text, /v1 /);
  assert.match(res.text, /v2 \(current\)/);
  assert.match(res.text, /2 version\(s\), current v2/);
  // The echo: a timeline is version numbers and dates, so without this line a
  // wrong fuzzy hit is invisible in the output.
  assert.match(res.text, /read 'slowking toolbox' as deck deck-1 — Toolbox Slowking/);
});

test('deck_history snapshot resolves a fuzzy name and names the deck it picked', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/versions/1') return versionDetail(1, false);
      throw new Error(`unexpected get ${path}`);
    },
  });
  const ctx = makeCtx(api);

  const res = await byName('deck_history').handler(
    { deck_id: FUZZY, version: 1, include_strategy: true, dry_run: true },
    ctx,
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /x4 Slowking \| sv01-25/);
  assert.match(res.text, /read 'slowking toolbox' as deck deck-1 — Toolbox Slowking/);
});

// ── deck_history: the write still refuses to guess ───────────────────────────

test('deck_history revert_to STAYS strict on a fuzzy name — a ranked candidate, never a rollback', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path) => {
      throw new Error(`revert must not be reached: ${method} ${path}`);
    },
  });
  const ctx = makeCtx(api);

  const res = await byName('deck_history').handler(
    { deck_id: FUZZY, revert_to: 1, include_strategy: true, dry_run: true },
    ctx,
  );

  assert.equal(res.isError, true, 'an approximate name on the revert branch is a choice, not an action');
  assert.match(res.text, /No deck is named exactly 'slowking toolbox'/);
  // The candidate is a real id from the caller's own index, one step from done.
  assert.match(res.text, /deck-1 — Toolbox Slowking/);
  assert.equal(readVersions(api), false, 'must not read the version history of a deck it did not resolve');
  assert.equal(api.sends.length, 0);
});

test('deck_history revert_to on an EXACT name still runs its dry run', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1/versions') return versionsPayload;
      if (path === '/decks/deck-1/versions/1') return versionDetail(1, false);
      if (path === '/decks/deck-1/versions/2') return versionDetail(2, true);
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path) => {
      throw new Error(`dry_run must not write: ${method} ${path}`);
    },
  });
  const ctx = makeCtx(api);

  const res = await byName('deck_history').handler(
    { deck_id: 'Toolbox Slowking', revert_to: 1, include_strategy: true, dry_run: true },
    ctx,
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /DRY RUN — nothing reverted\. Would restore deck to v1/);
  assert.equal(api.sends.length, 0);
});

// ── decks: include 'strategy' returns the guide, not a label for it ──────────

const GUIDE = '# Opening plan\n\nLead with Slowking, retreat into Fezandipiti.';

const deckDetail = {
  deck: {
    id: 'deck-1',
    name: 'Toolbox Slowking',
    formatCode: 'standard',
    version: 2,
    totalCount: 60,
    valueUsd: 120,
    legal: true,
    updatedAt: '2026-08-01T00:00:00.000Z',
    strategyMd: GUIDE,
  },
  counts: { total: 60, pokemon: 23, trainer: 27, energy: 10, distinctNames: 20 },
  cards: [],
  validation: { format: 'standard', legal: true, counts: { total: 60, pokemon: 23, trainer: 27, energy: 10, unresolved: 0 }, violations: [], warnings: [] },
};

function decksStub(): StubApi {
  return stubApi({
    get: (path) => {
      if (path === '/decks') return DECKS;
      if (path === '/decks/deck-1') return deckDetail;
      if (path === '/decks/deck-1/logs?pageSize=1') return { totals: totals() };
      throw new Error(`unexpected get ${path}`);
    },
  });
}

test("decks include: ['strategy'] returns the guide TEXT, not just its heading and length", async () => {
  const api = decksStub();
  const res = await byName('decks').handler({ deck_id: 'deck-1', deleted: false, include: ['strategy'] }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.ok(res.text.includes(GUIDE), 'the whole guide is rendered — deck_strategy returns no less');
  assert.match(res.text, new RegExp(`strategy guide \\(${GUIDE.length} chars\\):`));
  // One deck read, one logs read — the guide costs no extra API call.
  assert.equal(api.gets.filter((g) => g.path.startsWith('/decks/deck-1')).length, 2);
});

test('decks without the strategy include still returns only the label', async () => {
  const api = decksStub();
  const res = await byName('decks').handler({ deck_id: 'deck-1', deleted: false, include: ['cards'] }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /strategy 'Opening plan' \(\d+ chars\)/);
  assert.equal(res.text.includes('Fezandipiti'), false, 'the guide body is opt-in');
});
