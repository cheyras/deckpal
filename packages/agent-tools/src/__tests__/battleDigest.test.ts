/**
 * `battle_digest` (2026-10-10) — the read a model uses to judge one game.
 *
 * The digest itself is computed and pinned server-side
 * (apps/api/src/deck/__tests__/battleDigest.test.ts, on the real fixture
 * logs). What this file pins is the tool around it, through a stub `Api` in the
 * same pattern as `deckIntel-mutations.test.ts`:
 *
 *  - it is registered, READ-ONLY (the control that lets an agent run it without
 *    asking), and sits with the other deck-intelligence tools;
 *  - it asks the digest route for the right deck and log, forwarding
 *    `player_name` only when given;
 *  - the text a model receives carries every fact the review needs and never
 *    exceeds 3,000 characters, however large the game;
 *  - an in-person game ("no game log to digest") is an ANSWER, not a failure,
 *    so it does not count against the failing-tool budget; and
 *  - an unidentified owner is said, never rendered as a guessed side.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allTools } from '../index.js';
import { DIGEST_TEXT_MAX, renderBattleDigest, type DigestPayload } from '../tools/battleDigest.js';
import type { Api } from '../api.js';
import type { Ctx } from '../ctx.js';

const tool = () => allTools().find((d) => d.name === 'battle_digest')!;

interface StubApi extends Api {
  gets: string[];
}

function stubApi(get: (path: string) => unknown): StubApi {
  const gets: string[] = [];
  return {
    gets,
    base: 'https://test/api',
    get: async (path: string) => {
      gets.push(path);
      return get(path);
    },
    send: async (method: string, path: string) => {
      throw new Error(`a read tool sent ${method} ${path}`);
    },
  } as unknown as StubApi;
}

function makeCtx(api: StubApi): Ctx {
  return { db: { query: async () => ({ rows: [] }) }, userId: 'u1', api } as unknown as Ctx;
}

const DECKS = { decks: [{ id: 'deck-1', name: 'Toolbox Banette', formatCode: 'standard', version: 2 }] };

/** The Dragapult game from apps/api's fixture log, as the route returns it. */
function payload(over: Partial<DigestPayload['digest']> = {}, top: Partial<DigestPayload> = {}): DigestPayload {
  return {
    logId: 7,
    deckVersion: 2,
    origin: 'ptcgl',
    result: 'win',
    ...top,
    digest: {
      players: { me: 'PlayerA', opponent: 'PlayerB' },
      playerNames: ['PlayerB', 'PlayerA'],
      confidence: 'high',
      result: 'win',
      wentFirst: 'opponent',
      totalTurns: 14,
      turns: { me: 7, opponent: 7 },
      mulligans: { me: 0, opponent: 1 },
      firstAttackTurn: { me: 4, opponent: 3 },
      finalPrizes: { me: 6, opponent: 5 },
      prizeTimeline: [
        { turn: 3, side: 'opponent', prizes: 1, knockedOut: 'Poltchageist', score: { me: 0, opponent: 1 } },
        { turn: 5, side: 'opponent', prizes: 1, knockedOut: 'Banette', score: { me: 0, opponent: 2 } },
        { turn: 7, side: 'me', prizes: 1, knockedOut: 'Dusknoir', score: { me: 1, opponent: 2 } },
        { turn: 14, side: 'me', prizes: 2, knockedOut: 'Dragapult ex', score: { me: 6, opponent: 5 } },
      ],
      opponentCards: [
        { name: 'Dragapult ex', count: 16 },
        { name: 'Judge', count: 2 },
        { name: 'Hilda', count: 1 },
      ],
      myPokemonUsed: ['Poltchageist', 'Shuppet', 'Dhelmise', 'Banette'],
      opponentArchetypeGuess: 'Dragapult ex / Dusknoir',
      endReason: 'prizes',
      leadChanged: true,
      closeGame: true,
      unknowns: [
        "the opponent's hand, and any card of theirs that was never shown",
        'which cards were prized, on either side',
      ],
      ...over,
    },
  };
}

function apiFor(body: unknown | ((path: string) => unknown)): StubApi {
  return stubApi((path) => {
    if (path === '/decks') return DECKS;
    if (path.startsWith('/decks/deck-1/logs/7/digest')) {
      if (typeof body === 'function') return (body as (p: string) => unknown)(path);
      return body;
    }
    throw new Error(`unexpected get ${path}`);
  });
}

// ── Registration ─────────────────────────────────────────────────────────────

test('battle_digest is registered read-only, beside the other battle tools', () => {
  const def = tool();
  assert.ok(def, 'battle_digest is not in allTools()');
  assert.equal(def.annotations.readOnlyHint, true, 'a read the agent may run without asking');
  assert.equal(def.annotations.destructiveHint, undefined);
  const names = allTools().map((d) => d.name);
  assert.equal(names.indexOf('battle_digest'), names.indexOf('delete_battle_log') + 1);
  assert.equal(def.inputSchema!.safeParse({ deck_id: 'x', log_id: 7 }).success, true);
  assert.equal(def.inputSchema!.safeParse({ deck_id: 'x', log_id: 0 }).success, false);
  assert.equal(def.inputSchema!.safeParse({ deck_id: 'x' }).success, false);
});

// ── The read ─────────────────────────────────────────────────────────────────

test('it reads the digest route for that deck and log, and renders every fact a review needs', async () => {
  const api = apiFor(payload());
  const res = await tool().handler({ deck_id: 'Toolbox Banette', log_id: 7 }, makeCtx(api));

  assert.equal(res.isError, undefined, res.text);
  assert.ok(api.gets.includes('/decks/deck-1/logs/7/digest'), `asked for: ${api.gets.join(', ')}`);
  for (const fact of [
    'battle digest #7', 'v2', "'Toolbox Banette'", 'stored result WIN',
    'players: me PlayerA vs PlayerB',
    'ended on prizes', '14 turns (me 7, opp 7)', 'went first: opponent', 'mulligans: me 0, opp 1',
    'first attack damage: me T4, opp T3',
    'prizes taken: me 6 – opp 5 · close game (the lead changed hands)',
    'T3 opp +1 Poltchageist (0–1)', 'T14 me +2 Dragapult ex (6–5)',
    'my Pokemon used: Poltchageist, Shuppet, Dhelmise, Banette',
    'opponent archetype guess (from their board): Dragapult ex / Dusknoir',
    'Dragapult ex ×16', 'Judge ×2',
    "unknown (never guess these): the opponent's hand",
  ]) {
    assert.ok(res.text.includes(fact), `missing: ${fact}\n---\n${res.text}`);
  }
  assert.ok(res.text.length <= DIGEST_TEXT_MAX);
});

// 2026-11-17: Deck-E's Quick tier may tell Haiku to `consult` on a close game
// (apps/api/src/decke/closeGameConsult.ts). The facts it judges on travel in
// `structured`, which only Deck-E's adapter reads; the TEXT — the whole of what
// an MCP client receives — never mentions a consult, because MCP has no consult
// tool.
test('the structured echo carries the closeness facts, and the text never mentions consult', async () => {
  for (const closeGame of [true, false]) {
    const res = await tool().handler(
      { deck_id: 'Toolbox Banette', log_id: 7 },
      makeCtx(apiFor(payload({ closeGame, leadChanged: closeGame }))),
    );
    assert.equal(res.isError, undefined, res.text);
    assert.deepEqual(res.structured, {
      logId: 7,
      closeGame,
      endReason: 'prizes',
      ownerKnown: true,
      finalPrizes: { me: 6, opponent: 5 },
      // 4-1 down after turn 9 (in the full game), won 6-5: the lead last changed at 6-5.
      lateLeadChange: true,
      reviewDepth: null,
    });
    assert.doesNotMatch(res.text, /consult/i, `closeGame ${closeGame}: the shared text must not name a Deck-E-only tool`);
  }
});

test('a blowout with an early lead change: close by the digest verdict, but the lead changed before 3 Prizes each', async () => {
  // Opponent took the first Prize, then the owner took the next six: 6-1. The
  // digest calls that close (the lead changed hands); the echo says when.
  const res = await tool().handler(
    { deck_id: 'Toolbox Banette', log_id: 7 },
    makeCtx(apiFor(payload({
      finalPrizes: { me: 6, opponent: 1 },
      prizeTimeline: [
        { turn: 3, side: 'opponent', prizes: 1, knockedOut: 'Poltchageist', score: { me: 0, opponent: 1 } },
        { turn: 4, side: 'me', prizes: 2, knockedOut: 'Drakloak', score: { me: 2, opponent: 1 } },
        { turn: 6, side: 'me', prizes: 2, knockedOut: 'Dragapult ex', score: { me: 4, opponent: 1 } },
        { turn: 8, side: 'me', prizes: 2, knockedOut: 'Dragapult ex', score: { me: 6, opponent: 1 } },
      ],
      leadChanged: true,
      closeGame: true,
    }))),
  );
  assert.equal(res.isError, undefined, res.text);
  assert.deepEqual(res.structured, {
    logId: 7,
    closeGame: true,
    endReason: 'prizes',
    ownerKnown: true,
    finalPrizes: { me: 6, opponent: 1 },
    lateLeadChange: false,
    reviewDepth: null,
  });
});

test('the echo says when the owner is unknown, how it ended, and the replay review depth', async () => {
  const unknown = await tool().handler(
    { deck_id: 'Toolbox Banette', log_id: 7 },
    makeCtx(apiFor(payload({
      players: { me: null, opponent: null }, finalPrizes: null, prizeTimeline: [], endReason: 'concede',
    }))),
  );
  assert.equal(unknown.structured?.ownerKnown, false);
  assert.equal(unknown.structured?.finalPrizes, null);
  assert.equal(unknown.structured?.endReason, 'concede');
  assert.equal(unknown.structured?.lateLeadChange, false);

  const withReplay = await tool().handler(
    { deck_id: 'Toolbox Banette', log_id: 7 },
    makeCtx(apiFor(payload({}, {
      replay: {
        players: ['PlayerB', 'PlayerA'], me: 1,
        replay: { completed: true, replayed: 1, actions: 1, stoppedTurn: null, reason: null, unscripted: [] },
        turns: [], attacks: [], moments: [], finalBoard: null, cards: [[], []], ending: null,
        assessment: { score: 3, depth: 'brief', reasons: [] },
      },
    }))),
  );
  assert.equal(withReplay.isError, undefined, withReplay.text);
  assert.equal(withReplay.structured?.reviewDepth, 'brief');
});

test('player_name is forwarded only when given, encoded', async () => {
  const api = apiFor(payload());
  await tool().handler({ deck_id: 'Toolbox Banette', log_id: 7 }, makeCtx(api));
  await tool().handler({ deck_id: 'Toolbox Banette', log_id: 7, player_name: 'Ash K&Co' }, makeCtx(api));
  const digests = api.gets.filter((p) => p.includes('/digest'));
  assert.deepEqual(digests, [
    '/decks/deck-1/logs/7/digest',
    '/decks/deck-1/logs/7/digest?playerName=Ash%20K%26Co',
  ]);
});

test('a corrected stored result is shown, and the log text is named when it disagrees', async () => {
  const res = await tool().handler(
    { deck_id: 'Toolbox Banette', log_id: 7 },
    makeCtx(apiFor(payload({ result: 'loss' }, { result: 'win' }))),
  );
  assert.match(res.text, /stored result WIN \(the log text reads LOSS\)/);
});

test('a near-miss deck name still reads, and names the deck it resolved to', async () => {
  const res = await tool().handler({ deck_id: 'banette toolbox', log_id: 7 }, makeCtx(apiFor(payload())));
  assert.equal(res.isError, undefined, res.text);
  assert.match(res.text, /Toolbox Banette/);
});

// ── What it cannot do ────────────────────────────────────────────────────────

test('an in-person game is an ANSWER, not a failure', async () => {
  const api = apiFor(() => {
    throw new Error('no game log to digest — this game was reported in person');
  });
  const res = await tool().handler({ deck_id: 'Toolbox Banette', log_id: 7 }, makeCtx(api));
  assert.equal(res.isError, undefined, 'counting this as an error would trip the failing-tool budget');
  assert.match(res.text, /Battle #7: no game log to digest — this game was reported in person/);
  assert.match(res.text, /battle_logs \(log_id 7\)/);
});

test('any other API error is a failure, said as one', async () => {
  const api = apiFor(() => {
    throw new Error("No battle log '7'");
  });
  const res = await tool().handler({ deck_id: 'Toolbox Banette', log_id: 7 }, makeCtx(api));
  assert.equal(res.isError, true);
  assert.match(res.text, /^battle_digest failed: No battle log '7'/);
});

test('an unidentified owner is SAID, with the names to choose from — never a guessed side', async () => {
  const unidentified = payload({
    players: { me: null, opponent: null },
    playerNames: ['Alice', 'Bob'],
    confidence: 'low',
    result: null,
    wentFirst: null,
    turns: null,
    mulligans: null,
    firstAttackTurn: null,
    finalPrizes: null,
    prizeTimeline: [],
    opponentCards: [],
    myPokemonUsed: [],
    opponentArchetypeGuess: null,
  });
  const res = await tool().handler({ deck_id: 'Toolbox Banette', log_id: 7 }, makeCtx(apiFor(unidentified)));
  assert.equal(res.isError, undefined);
  assert.match(res.text, /could not tell which one owns this deck — the log names Alice and Bob/);
  assert.match(res.text, /player_name/);
  assert.doesNotMatch(res.text, /players: me /);
  assert.doesNotMatch(res.text, /prizes taken/);
});

test('a huge game still renders under 3,000 characters, header and unknowns intact', () => {
  const big = payload({
    prizeTimeline: Array.from({ length: 60 }, (_, i) => ({
      turn: i + 1, side: i % 2 ? 'me' as const : 'opponent' as const, prizes: 1,
      knockedOut: `A Very Long Pokemon Name Number ${i} ex`, score: { me: i, opponent: i },
    })),
    opponentCards: Array.from({ length: 200 }, (_, i) => ({ name: `Opponent Card With A Long Name ${i}`, count: 200 - i })),
    myPokemonUsed: Array.from({ length: 40 }, (_, i) => `My Pokemon ${i}`),
  });
  const text = renderBattleDigest(big, 'Toolbox Banette');
  assert.ok(text.length <= DIGEST_TEXT_MAX, `rendered ${text.length} chars`);
  assert.match(text, /^battle digest #7/);
  assert.match(text, /unknown \(never guess these\)/);
  assert.match(text, /\+\d+ more/, 'a shortened list must say it was shortened');
  // The opening and the finish of the timeline survive; the middle is elided.
  assert.match(text, /T1 opp \+1/);
  assert.match(text, /T60 me \+1/);
});
