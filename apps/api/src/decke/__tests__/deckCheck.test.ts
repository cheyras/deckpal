/**
 * `showDeck`'s two reaches, over a real HTTP round trip, in the shape
 * `api/chat.mjs` actually calls them: the turn's tool OPTIONS (`toolCtx`), not
 * a tool `Ctx`.
 *
 * The bug this pins: `chat.mjs` passed `toolCtx` straight to the shared
 * `checkDeck(ctx, …)`, which reads `ctx.api`. `toolCtx` has no `api`, so every
 * `showDeck` threw before it drew anything — and `tools.test.ts` never saw it,
 * because it hands `buildTools` a fake `checkDeck`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type pg from 'pg'
import { checkDeck, ownedDeck } from '../deckCheck.js'
import { withToolCtx } from '../ctx.js'

const MINE = '11111111-1111-4111-8111-111111111111'
const THEIRS = '22222222-2222-4222-8222-222222222222'

async function fakeApi(): Promise<{
  base: string
  seen: Array<{ method: string; path: string; auth: string | undefined; body: unknown }>
  close: () => Promise<void>
}> {
  const seen: Array<{ method: string; path: string; auth: string | undefined; body: unknown }> = []
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    seen.push({ method: req.method!, path: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined })
    res.setHeader('content-type', 'application/json')
    if (req.method === 'POST' && req.url === '/api/decks/check') {
      res.end(JSON.stringify({ format: 'standard', total: 4, legal: true, issues: [], evolution_gaps: [], owned: 4,
        missing_cost_usd: 0, ptcgl: '', lines: [] }))
      return
    }
    // The reader's own index — RLS and the route's user filter mean another
    // account's deck is simply not in it.
    if (req.method === 'GET' && req.url === '/api/decks') {
      res.end(JSON.stringify({ decks: [
        { id: MINE, name: 'Dragapult ex', formatCode: 'standard', version: 2 },
        { id: '33333333-3333-4333-8333-333333333333', name: 'Dragapult ex / Dusknoir', formatCode: 'standard', version: 1 },
      ] }))
      return
    }
    if (req.method === 'GET' && req.url === '/api/lists') {
      res.end(JSON.stringify({ lists: [] }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: { message: 'no route' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    base: `http://127.0.0.1:${port}/api`,
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/** Exactly what `chat.mjs` builds: no `api`, no `db` — those are this module's job. */
const toolCtx = (base: string) => ({ pool: {} as pg.Pool, userId: 'reader', jwt: 'reader-token', apiBase: base })
// The way chat.mjs calls both: inside withToolCtx, which builds the Ctx (and its api).
const asReader = <T>(base: string, fn: (ctx: Parameters<typeof checkDeck>[0]) => Promise<T>) => withToolCtx(toolCtx(base), fn)

test('checkDeck takes the chat turn\'s tool options and reaches the API as the reader', async () => {
  const api = await fakeApi()
  try {
    const result = await asReader(api.base, (ctx) => checkDeck(ctx, { format: 'standard', cards: [{ card_id: 'sv01-1', quantity: 4 }] }))
    assert.equal(result.total, 4)
    assert.deepEqual(api.seen.map((r) => [r.method, r.path, r.auth]), [['POST', '/api/decks/check', 'Bearer reader-token']])
    assert.deepEqual(api.seen[0]!.body, { format: 'standard', cards: [{ card_id: 'sv01-1', quantity: 4 }] })
  } finally {
    await api.close()
  }
})

test('ownedDeck finds a deck among the reader\'s own and nowhere else', async () => {
  const api = await fakeApi()
  try {
    assert.deepEqual(await asReader(api.base, (ctx) => ownedDeck(ctx, MINE)), { deck: { id: MINE, name: 'Dragapult ex' } })
    assert.deepEqual(await asReader(api.base, (ctx) => ownedDeck(ctx, 'Dragapult ex')), { deck: { id: MINE, name: 'Dragapult ex' } },
      'an exact name is the deck it names')
    const theirs = await asReader(api.base, (ctx) => ownedDeck(ctx, THEIRS))
    assert.ok('miss' in theirs, 'another account\'s deck id must not resolve')
    const near = await asReader(api.base, (ctx) => ownedDeck(ctx, 'Dragapult'))
    assert.ok('miss' in near, 'a near name is a choice, never a pick')
    assert.ok(api.seen.every((r) => r.auth === 'Bearer reader-token'), 'every lookup goes as the reader')
  } finally {
    await api.close()
  }
})
