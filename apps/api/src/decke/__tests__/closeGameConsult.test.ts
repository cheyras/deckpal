/**
 * The close-game consult note (2026-11-17): on the Quick tier, a close game's
 * `battle_digest` result tells Haiku to `consult` before he writes the review.
 *
 * Pinned here: the note appears ONLY for Deck-E + Quick on a battle pathway
 * (`consultOffered`, from `closeGameConsultOffered`) + a digest whose
 * structured echo shows a GENUINELY close game (narrowed 2026-11-25: not a
 * concession, owner known, and a final gap of at most 2 with someone at 3+ or
 * a lead change after both sides reached 3), through the real adapter and the
 * real shared handler; its wording is conditional, because it is replayed to
 * later turns that may not hold `consult`; it never touches the chip; and the
 * tier predicate is the one `toolsForTier` uses. That MCP never sees it is
 * pinned on the MCP side (apps/mcp/src/adapters/__tests__/mcp.test.ts) and in
 * the shared tool's own test (packages/agent-tools battleDigest.test.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDataTools, type ToolEvent } from '../adapters/aisdk.js'
import {
  CLOSE_GAME_BRIEF_CONSULT_NOTE,
  CLOSE_GAME_CONSULT_NOTE,
  closeGameConsultNote,
  closeGameConsultOffered,
  isConsultWorthyClose,
} from '../closeGameConsult.js'
import { CONSULT_BRIEF_MAX } from '../consult.js'
import { tierOffersConsult } from '../tools.js'
import { PATHWAY_NAMES, type TierName } from '../pathways/names.js'

const OPTS = {
  pool: null as never,
  userId: 'u1',
  jwt: 'jwt',
  apiBase: 'https://example.test/api',
}

const DECK = { id: 'deck-1', name: 'Slowking Toolbox', formatCode: 'standard', version: 3 }

type Shape = 'close' | 'blowout'

/** A 4–6 loss whose lead changed at 4–4 (close), or a 1–6 loss after taking the first Prize (blowout). */
function digestPayload(shape: Shape, over: Record<string, unknown> = {}) {
  const close = shape === 'close'
  return {
    logId: 7,
    deckVersion: 3,
    origin: 'ptcgl',
    result: 'loss',
    digest: {
      players: { me: 'HarborKite', opponent: 'QuartzFox' },
      playerNames: ['QuartzFox', 'HarborKite'],
      confidence: 'high',
      result: 'loss',
      wentFirst: 'opponent',
      totalTurns: 12,
      turns: { me: 6, opponent: 6 },
      mulligans: { me: 0, opponent: 0 },
      firstAttackTurn: { me: 2, opponent: 3 },
      finalPrizes: close ? { me: 4, opponent: 6 } : { me: 1, opponent: 6 },
      prizeTimeline: close
        ? [
            { turn: 2, side: 'me', prizes: 2, knockedOut: 'Dreepy', score: { me: 2, opponent: 0 } },
            { turn: 5, side: 'opponent', prizes: 2, knockedOut: 'Slowpoke', score: { me: 2, opponent: 2 } },
            { turn: 6, side: 'me', prizes: 2, knockedOut: 'Drakloak', score: { me: 4, opponent: 2 } },
            { turn: 9, side: 'opponent', prizes: 2, knockedOut: 'Slowking', score: { me: 4, opponent: 4 } },
            { turn: 11, side: 'opponent', prizes: 2, knockedOut: 'Slowking', score: { me: 4, opponent: 6 } },
          ]
        : [
            { turn: 2, side: 'me', prizes: 1, knockedOut: 'Dreepy', score: { me: 1, opponent: 0 } },
            { turn: 3, side: 'opponent', prizes: 2, knockedOut: 'Slowking', score: { me: 1, opponent: 2 } },
            { turn: 5, side: 'opponent', prizes: 2, knockedOut: 'Slowking', score: { me: 1, opponent: 4 } },
            { turn: 7, side: 'opponent', prizes: 2, knockedOut: 'Latias ex', score: { me: 1, opponent: 6 } },
          ],
      opponentCards: [{ name: 'Dragapult ex', count: 4 }],
      myPokemonUsed: ['Slowking'],
      opponentArchetypeGuess: 'Dragapult ex',
      endReason: 'prizes',
      // The digest's own broad verdict: BOTH games had the lead change hands.
      leadChanged: true,
      closeGame: true,
      unknowns: [],
      ...over,
    },
  }
}

type Exec = { execute: (input: unknown, opts: { toolCallId: string }) => Promise<string> }

/** Run `battle_digest` through the real adapter and handler against a stubbed API. */
async function runDigest(
  shape: Shape,
  consultOffered: boolean | undefined,
  over: Record<string, unknown> = {},
): Promise<{ text: string; events: ToolEvent[] }> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.pathname.endsWith('/decks')) return Response.json({ decks: [DECK] })
    if (url.pathname.endsWith('/decks/deck-1/logs/7/digest')) return Response.json(digestPayload(shape, over))
    return Response.json({ error: { code: 'not_found', message: `unexpected ${url.pathname}` } }, { status: 404 })
  }) as typeof fetch
  const events: ToolEvent[] = []
  try {
    const tools = buildDataTools({
      ...OPTS,
      include: (def) => def.name === 'battle_digest',
      onEvent: (e) => events.push(e),
      ...(consultOffered === undefined ? {} : { consultOffered }),
    }) as unknown as Record<string, Exec>
    const text = await tools.battle_digest!.execute({ deck_id: 'deck-1', log_id: 7 }, { toolCallId: 'digest-1' })
    return { text, events }
  } finally {
    globalThis.fetch = originalFetch
  }
}

/** A structured echo as `digestEcho` (packages/agent-tools) writes it. */
const echo = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  logId: 7,
  closeGame: true,
  endReason: 'prizes',
  ownerKnown: true,
  finalPrizes: { me: 4, opponent: 6 },
  lateLeadChange: false,
  reviewDepth: 'standard',
  ...over,
})

test('the note is added only for battle_digest, with the note offered, on a genuinely close game', () => {
  const close = echo()
  assert.equal(closeGameConsultNote('battle_digest', close, true), CLOSE_GAME_CONSULT_NOTE)
  // Not offered (not Quick, not a battle pathway, a sub-agent, an older caller).
  assert.equal(closeGameConsultNote('battle_digest', close, false), '')
  assert.equal(closeGameConsultNote('battle_digest', close, undefined), '')
  // Not close, or no echo at all (an older agent-tools build), or a malformed one.
  assert.equal(closeGameConsultNote('battle_digest', echo({ closeGame: false }), true), '')
  assert.equal(closeGameConsultNote('battle_digest', undefined, true), '')
  assert.equal(closeGameConsultNote('battle_digest', echo({ closeGame: 'true' }), true), '')
  assert.equal(closeGameConsultNote('battle_digest', echo({ finalPrizes: { me: '4', opponent: 6 } }), true), '')
  // Another tool carrying the same facts gets nothing.
  assert.equal(closeGameConsultNote('battle_logs', close, true), '')
})

test('which games are worth a consult: the narrowed trigger', () => {
  // A 5–6 loss: genuinely close.
  assert.equal(isConsultWorthyClose(echo({ finalPrizes: { me: 5, opponent: 6 } })), true)
  // A blowout where the reader took the first Prize: the digest says close (the lead changed), the consult does not.
  assert.equal(isConsultWorthyClose(echo({ finalPrizes: { me: 1, opponent: 6 }, lateLeadChange: false })), false)
  // A lead that changed hands after both sides had 3: worth it, whatever the final gap.
  assert.equal(isConsultWorthyClose(echo({ finalPrizes: { me: 3, opponent: 6 }, lateLeadChange: true })), true)
  // A concession at 1–2: a "gap" of 1 is not a close game, and nor is any concession.
  assert.equal(isConsultWorthyClose(echo({ endReason: 'concede', finalPrizes: { me: 1, opponent: 2 } })), false)
  assert.equal(isConsultWorthyClose(echo({ endReason: 'concede', finalPrizes: { me: 5, opponent: 5 } })), false)
  // The gap only counts once someone has taken 3.
  assert.equal(isConsultWorthyClose(echo({ endReason: 'other', finalPrizes: { me: 2, opponent: 1 } })), false)
  // Unknown owner: no side to review, no consult.
  assert.equal(isConsultWorthyClose(echo({ ownerKnown: false, finalPrizes: null })), false)
  assert.equal(isConsultWorthyClose(echo({ ownerKnown: undefined })), false)
})

test('the note is conditional, so a later turn replaying it without consult is not told to call a missing tool', () => {
  // The note rides in the tool output, which the browser replays to the model
  // for FULL_REPLAY_TURNS later turns (apps/web/src/character/host/chat/toolReplay.ts).
  // Those turns may be on Standard (no `consult`) or only asking a follow-up.
  for (const note of [CLOSE_GAME_CONSULT_NOTE, CLOSE_GAME_BRIEF_CONSULT_NOTE]) {
    assert.match(note, /If you are about to write this game's review and you hold `consult`, call it once first/)
    assert.match(note, /If you are only answering a question about the game, or you do not hold `consult`, ignore this/)
    assert.doesNotMatch(note.replace(/If you are about to write[^.]*\./, ''), /(^|\. )[Cc]all `consult`/, 'no bare imperative to call consult')
    assert.match(note, /For you, not the reader/)
  }
})

test('the brief is bounded by CONSULT_BRIEF_MAX, not "this digest text"', () => {
  assert.equal(CONSULT_BRIEF_MAX, 8_000, 'update the expectation below if the cap moves')
  assert.match(CLOSE_GAME_CONSULT_NOTE, /the parts of this digest that matter, under 8,000 characters/)
  assert.doesNotMatch(CLOSE_GAME_CONSULT_NOTE, /this digest text/)
  assert.match(CLOSE_GAME_CONSULT_NOTE, /reader's own words/)
})

test('a close game whose depth line says brief still gets the consult, and a short review', () => {
  assert.equal(closeGameConsultNote('battle_digest', echo({ reviewDepth: 'brief' }), true), CLOSE_GAME_BRIEF_CONSULT_NOTE)
  assert.match(CLOSE_GAME_BRIEF_CONSULT_NOTE, /depth line says brief, so after the consult the review is still two or three lines/)
  assert.ok(CLOSE_GAME_BRIEF_CONSULT_NOTE.endsWith('.)'))
})

test('the note is offered only on Quick AND a battle pathway', () => {
  assert.equal(closeGameConsultOffered(true, ['battle_log']), true)
  assert.equal(closeGameConsultOffered(true, ['battle_review']), true)
  assert.equal(closeGameConsultOffered(true, ['general', 'battle_log']), true)
  assert.equal(closeGameConsultOffered(false, ['battle_log']), false, 'not Quick: no consult tool')
  for (const p of PATHWAY_NAMES.filter((n) => n !== 'battle_log' && n !== 'battle_review')) {
    assert.equal(closeGameConsultOffered(true, [p]), false, `${p} must not get the note`)
  }
})

test('the tier that offers the note is exactly the tier that holds consult', () => {
  const tiers: TierName[] = ['quick', 'standard', 'deep']
  assert.deepEqual(tiers.filter(tierOffersConsult), ['quick'])
})

test('Deck-E + Quick + genuinely close 4–6 loss: the digest result ends with the consult note, and the chip does not carry it', async () => {
  const { text, events } = await runDigest('close', true)
  assert.match(text, /battle digest #7/, text)
  assert.ok(text.endsWith(CLOSE_GAME_CONSULT_NOTE), `no consult note at the end:\n${text}`)
  assert.equal(text.split(CLOSE_GAME_CONSULT_NOTE).length, 2, 'the note is added exactly once')
  const ok = events.find((e) => e.phase === 'ok')
  assert.ok(ok, 'no ok chip')
  assert.doesNotMatch(ok.phase === 'ok' ? ok.summary : '', /consult/i, 'the reader-facing chip must not carry a note addressed to the model')
})

test('a genuinely close 5–6 loss gets the note', async () => {
  const { text } = await runDigest('close', true, { finalPrizes: { me: 5, opponent: 6 } })
  assert.ok(text.endsWith(CLOSE_GAME_CONSULT_NOTE), text)
})

test('a 1–6 blowout after taking the first Prize: the digest says close, but no note', async () => {
  const { text } = await runDigest('blowout', true)
  assert.match(text, /close game \(the lead changed hands\)/, 'the digest keeps its own broad verdict')
  assert.doesNotMatch(text, /consult/i)
})

test('a concession at 1–2: no note', async () => {
  const { text } = await runDigest('close', true, {
    endReason: 'concede',
    finalPrizes: { me: 1, opponent: 2 },
    prizeTimeline: [
      { turn: 2, side: 'me', prizes: 1, knockedOut: 'Dreepy', score: { me: 1, opponent: 0 } },
      { turn: 3, side: 'opponent', prizes: 2, knockedOut: 'Slowpoke', score: { me: 1, opponent: 2 } },
    ],
  })
  assert.match(text, /ended by concession/, text)
  assert.doesNotMatch(text, /consult/i)
})

test('unknown owner: no note', async () => {
  const { text } = await runDigest('close', true, {
    players: { me: null, opponent: null },
    turns: null, mulligans: null, firstAttackTurn: null, finalPrizes: null, prizeTimeline: [],
  })
  assert.match(text, /could not tell which one owns this deck/, text)
  assert.doesNotMatch(text, /consult/i)
})

test('close, but the note not offered (consultOffered false or absent): no note', async () => {
  for (const offered of [false, undefined]) {
    const { text } = await runDigest('close', offered)
    assert.match(text, /battle digest #7/, text)
    assert.match(text, /close game/, 'the digest still says it was close')
    assert.doesNotMatch(text, /consult/i, `consultOffered ${String(offered)} must not mention consult`)
  }
})
