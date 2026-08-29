/**
 * add_battle_log / edit_battle_log inference paths — the deck_id-optional and
 * dry_run behaviours added so a pasted battle log with no named deck no longer
 * dead-ends (the owner's #1 ask). See `tools/deckIntel.ts` and the
 * POST /decks/log-preview handler in `apps/api/src/routes/decks.ts`.
 *
 * Pure: `ctx.api` is stubbed the way the sibling tests in this package stub it
 * (see `lists.test.ts`, `entities.test.ts`) — no database, no network. The
 * handlers route through `ctx.api` only, so a recording stub is enough to
 * assert both what they render and which endpoints they never touch.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allTools } from '../index.js';
import type { Api } from '../api.js';
import type { Ctx } from '../ctx.js';

const byName = (n: string) => allTools().find((d) => d.name === n)!;

/**
 * A recording stub `Api`. Every `get`/`send` is routed through the caller's
 * functions and appended to `sends`/`gets`, so a test can assert "no write
 * endpoint was ever called" — which is the load-bearing invariant on the
 * deck_id-omitted and dry_run paths.
 */
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

/** True when a write endpoint (attach a log / patch a log) was hit. */
const wroteLog = (api: StubApi): boolean =>
  api.sends.some(
    (s) =>
      (s.method === 'POST' && /\/decks\/[^/]+\/logs$/.test(s.path)) ||
      (s.method === 'PATCH' && /\/decks\/[^/]+\/logs\/\d+$/.test(s.path)),
  );

const logPreviewResponse = (overrides: Partial<{ result: 'win' | 'loss' | 'tie' | null; opponent: string | null; candidates: unknown[] }> = {}) => ({
  parsed: {
    result: overrides.result ?? 'win',
    opponent: overrides.opponent ?? 'Robni16',
    turns: 12,
    prizes: { me: 6, opponent: 2 },
    confidence: 'high',
    myPokemon: ['Charizard ex'],
    opponentDeckGuess: 'Dragapult ex / Dusknoir',
  },
  candidates: overrides.candidates ?? [],
});

// ── add_battle_log: deck_id OMITTED → ranked candidates, never writes ─────────

test('add_battle_log with no deck_id returns ranked candidates (real ids, best first) and writes nothing', async () => {
  const api = stubApi({
    send: (method, path) => {
      if (method === 'POST' && path === '/decks/log-preview') {
        return logPreviewResponse({
          candidates: [
            { deckId: 'aaa-111', name: 'Charizard ex', format: 'standard', version: 3, score: 42, matchedNames: 8, total: 10 },
            { deckId: 'bbb-222', name: 'Drapuult', format: 'standard', version: 1, score: 18, matchedNames: 4, total: 12 },
          ],
        });
      }
      throw new Error(`unexpected send ${method} ${path}`);
    },
  });
  const ctx = makeCtx(api);

  const res = await byName('add_battle_log').handler({ log: 'RAW LOG', player_name: 'Me', dry_run: true }, ctx);

  assert.equal(res.isError, undefined, 'the candidates path is a NON-ERROR result');
  // dry_run: true (the new default) → the branch's own SPEC claim is now real:
  // "Nothing was logged." is the first line, the candidates follow.
  assert.ok(res.text.startsWith('Nothing was logged.'), 'dry_run: true → "Nothing was logged." on line 1');
  // Both real ids, best first.
  assert.match(res.text, /aaa-111/);
  assert.match(res.text, /bbb-222/);
  assert.ok(res.text.indexOf('aaa-111') < res.text.indexOf('bbb-222'), 'best-first ordering');
  // Score and matched counts on each row.
  assert.match(res.text, /score 42/);
  assert.match(res.text, /matched 8\/10/);
  assert.match(res.text, /Charizard ex/);
  // The parsed line is echoed so the model can carry it into the follow-up call.
  assert.match(res.text, /WIN vs Robni16/);
  assert.match(res.text, /Dragapult ex \/ Dusknoir/);
  assert.match(res.text, /confidence high/);
  // The instruction to come back with deck_id.
  assert.match(res.text, /add_battle_log again with deck_id/);
  // And nothing was written.
  assert.equal(wroteLog(api), false, 'must not POST the log to any deck');
});

test('add_battle_log with no deck_id and zero candidates says so and lists NONE', async () => {
  const api = stubApi({
    send: () => logPreviewResponse({ result: null, opponent: null, candidates: [] }),
  });
  const ctx = makeCtx(api);

  const res = await byName('add_battle_log').handler({ log: 'RAW', dry_run: true }, ctx);

  assert.equal(res.isError, undefined);
  assert.ok(res.text.startsWith('Nothing was logged.'), 'dry_run: true → "Nothing was logged." on line 1');
  assert.match(res.text, /matched none of your decks/i);
  // No invented candidate rows and no invented ids — the entities doctrine,
  // applied to the new path: never an invented example id in a message.
  assert.equal(/^[^-\n]* — /m.test(res.text), false, 'must not render any candidate row');
  assert.match(res.text, /add_battle_log again with deck_id/);
  assert.equal(wroteLog(api), false);
});

test('add_battle_log with exactly one candidate names it as the only match and STILL does not write', async () => {
  const api = stubApi({
    send: () =>
      logPreviewResponse({
        candidates: [{ deckId: 'only-1', name: 'Only Deck', format: 'standard', version: 2, score: 30, matchedNames: 5, total: 5 }],
      }),
  });
  const ctx = makeCtx(api);

  const res = await byName('add_battle_log').handler({ log: 'RAW', dry_run: true }, ctx);

  assert.equal(res.isError, undefined);
  assert.ok(res.text.startsWith('Nothing was logged.'), 'dry_run: true → "Nothing was logged." on line 1');
  assert.match(res.text, /only-1/);
  assert.match(res.text, /Only Deck/);
  assert.match(res.text, /matches one of your decks/i);
  // Writes stay strict even with a lone candidate — this path never writes.
  assert.equal(wroteLog(api), false);
});

// ── add_battle_log: dry_run with deck_id → "Nothing was logged.", no write ────

test('add_battle_log dry_run with deck_id renders the substance on line 1 and "Nothing was logged." on line 2, calls no write endpoint', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return { decks: [{ id: 'deck-1', name: 'Charizard ex', formatCode: 'standard', version: 3 }] };
      throw new Error(`unexpected get ${path}`);
    },
    send: (method, path) => {
      if (method === 'POST' && path === '/decks/log-preview') return logPreviewResponse();
      throw new Error(`unexpected send ${method} ${path}`);
    },
  });
  const ctx = makeCtx(api);

  const res = await byName('add_battle_log').handler(
    { deck_id: 'Charizard ex', log: 'RAW', notes: 'misplayed t3', dry_run: true },
    ctx,
  );

  assert.equal(res.isError, undefined);
  // Line 1 carries the substance — deck name + parsed result — so the approval
  // card (which takes line 1 via summarise) names the deck, not just "Nothing was logged."
  assert.ok(res.text.startsWith("Would attach to 'Charizard ex'"), `first line was: ${res.text.split('\n')[0]}`);
  // "Nothing was logged." moved to line 2.
  assert.match(res.text, /Nothing was logged\./);
  // The deck it would attach to, and the parsed line, are both shown.
  assert.match(res.text, /Charizard ex/);
  assert.match(res.text, /v3/);
  assert.match(res.text, /WIN vs Robni16/);
  assert.match(res.text, /misplayed t3/);
  assert.match(res.text, /Re-run with dry_run: false to log/);
  assert.equal(wroteLog(api), false, 'dry_run must not POST the log');
});

// ── edit_battle_log: dry_run → field-by-field would-change plan, no write ──────

test('edit_battle_log dry_run renders the substance on line 1 and "Nothing was changed." on line 2, writes nothing', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/decks') return { decks: [{ id: 'deck-1', name: 'Charizard ex', formatCode: 'standard', version: 3 }] };
      if (/\/decks\/deck-1\/logs\/7$/.test(path)) {
        return {
          log: {
            id: 7,
            deckVersion: 3,
            result: 'win',
            opponent: 'OldFoe',
            opponentDeck: 'Old Archetype',
            turns: 10,
            prizes: { me: 6, opponent: 3 },
            notes: 'old notes',
            playedAt: '2026-08-01T12:00:00.000Z',
            source: 'web',
            rawLog: 'RAW',
            parsed: null,
            createdAt: '2026-08-01T12:00:00.000Z',
          },
        };
      }
      throw new Error(`unexpected get ${path}`);
    },
    send: () => {
      throw new Error('edit_battle_log dry_run must not send anything');
    },
  });
  const ctx = makeCtx(api);

  const res = await byName('edit_battle_log').handler(
    { deck_id: 'Charizard ex', log_id: 7, result: 'loss', notes: 'new notes', dry_run: true },
    ctx,
  );

  assert.equal(res.isError, undefined);
  // Line 1 carries the substance — which log on which deck, and which fields.
  assert.ok(res.text.startsWith("Would change log #7 on 'Charizard ex'"), `first line was: ${res.text.split('\n')[0]}`);
  // "Nothing was changed." moved to line 2.
  assert.match(res.text, /Nothing was changed\./);
  // Field-by-field: current → new for each changed field.
  assert.match(res.text, /result: WIN → LOSS/);
  assert.match(res.text, /notes: old notes → new notes/);
  // An unchanged field is not mentioned.
  assert.equal(res.text.includes('opponent_deck'), false, 'opponent_deck was not changed and must not appear');
  assert.match(res.text, /Re-run with dry_run: false to apply/);
  assert.equal(api.sends.length, 0, 'dry_run must not PATCH');
});