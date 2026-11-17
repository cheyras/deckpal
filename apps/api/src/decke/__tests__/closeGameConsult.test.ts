/**
 * The close-game consult note (2026-11-17): on the Quick tier, a close game's
 * `battle_digest` result tells Haiku to `consult` before he writes the review.
 *
 * Pinned here: the note appears ONLY for Deck-E + Quick (`consultOffered`) +
 * a digest whose structured echo says `closeGame: true`, through the real
 * adapter and the real shared handler; it never touches the chip; and the
 * tier predicate is the one `toolsForTier` uses. That MCP never sees it is
 * pinned on the MCP side (apps/mcp/src/adapters/__tests__/mcp.test.ts) and in
 * the shared tool's own test (packages/agent-tools battleDigest.test.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDataTools, type ToolEvent } from '../adapters/aisdk.js'
import { CLOSE_GAME_CONSULT_NOTE, closeGameConsultNote } from '../closeGameConsult.js'
import { tierOffersConsult } from '../tools.js'
import type { TierName } from '../pathways/names.js'

const OPTS = {
  pool: null as never,
  userId: 'u1',
  jwt: 'jwt',
  apiBase: 'https://example.test/api',
}

const DECK = { id: 'deck-1', name: 'Slowking Toolbox', formatCode: 'standard', version: 3 }

function digestPayload(closeGame: boolean) {
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
      finalPrizes: closeGame ? { me: 4, opponent: 6 } : { me: 1, opponent: 6 },
      prizeTimeline: [],
      opponentCards: [{ name: 'Dragapult ex', count: 4 }],
      myPokemonUsed: ['Slowking'],
      opponentArchetypeGuess: 'Dragapult ex',
      endReason: 'prizes',
      leadChanged: closeGame,
      closeGame,
      unknowns: [],
    },
  }
}

type Exec = { execute: (input: unknown, opts: { toolCallId: string }) => Promise<string> }

/** Run `battle_digest` through the real adapter and handler against a stubbed API. */
async function runDigest(closeGame: boolean, consultOffered: boolean | undefined): Promise<{ text: string; events: ToolEvent[] }> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.pathname.endsWith('/decks')) return Response.json({ decks: [DECK] })
    if (url.pathname.endsWith('/decks/deck-1/logs/7/digest')) return Response.json(digestPayload(closeGame))
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

test('the note is added only for battle_digest, with consult offered, on a close game', () => {
  const close = { logId: 7, closeGame: true }
  assert.equal(closeGameConsultNote('battle_digest', close, true), CLOSE_GAME_CONSULT_NOTE)
  // Not Quick (or a sub-agent / an older caller that never says).
  assert.equal(closeGameConsultNote('battle_digest', close, false), '')
  assert.equal(closeGameConsultNote('battle_digest', close, undefined), '')
  // Not close, or no echo at all (an older agent-tools build), or a malformed one.
  assert.equal(closeGameConsultNote('battle_digest', { closeGame: false }, true), '')
  assert.equal(closeGameConsultNote('battle_digest', undefined, true), '')
  assert.equal(closeGameConsultNote('battle_digest', { closeGame: 'true' }, true), '')
  // Another tool carrying the same flag gets nothing.
  assert.equal(closeGameConsultNote('battle_logs', close, true), '')
})

test('the note names consult and asks for it BEFORE the review is written', () => {
  assert.match(CLOSE_GAME_CONSULT_NOTE, /close game/)
  assert.match(CLOSE_GAME_CONSULT_NOTE, /before you write its review call `consult` once/)
  assert.match(CLOSE_GAME_CONSULT_NOTE, /reader's own words/)
  assert.match(CLOSE_GAME_CONSULT_NOTE, /For you, not the reader/)
})

test('the tier that offers the note is exactly the tier that holds consult', () => {
  const tiers: TierName[] = ['quick', 'standard', 'deep']
  assert.deepEqual(tiers.filter(tierOffersConsult), ['quick'])
})

test('Deck-E + Quick + close game: the digest result ends with the consult note, and the chip does not carry it', async () => {
  const { text, events } = await runDigest(true, true)
  assert.match(text, /battle digest #7/, text)
  assert.ok(text.endsWith(CLOSE_GAME_CONSULT_NOTE), `no consult note at the end:\n${text}`)
  assert.equal(text.split(CLOSE_GAME_CONSULT_NOTE).length, 2, 'the note is added exactly once')
  const ok = events.find((e) => e.phase === 'ok')
  assert.ok(ok, 'no ok chip')
  assert.doesNotMatch(ok.phase === 'ok' ? ok.summary : '', /consult/i, 'the reader-facing chip must not carry a note addressed to the model')
})

test('Quick but not close: no note', async () => {
  const { text } = await runDigest(false, true)
  assert.match(text, /battle digest #7/, text)
  assert.doesNotMatch(text, /consult/i)
})

test('close, but not Quick (consultOffered false or absent): no note', async () => {
  for (const offered of [false, undefined]) {
    const { text } = await runDigest(true, offered)
    assert.match(text, /battle digest #7/, text)
    assert.match(text, /close game/, 'the digest still says it was close')
    assert.doesNotMatch(text, /consult/i, `consultOffered ${String(offered)} must not mention consult`)
  }
})
