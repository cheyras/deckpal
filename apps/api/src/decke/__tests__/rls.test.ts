/**
 * The connection lifecycle, exercised through its failure paths.
 *
 * This is the code that stands between a streaming endpoint and the pool
 * exhaustion that made the API unusable once already (DECISIONS.md 2026-08-12).
 * Its happy path is trivial and its interesting behaviour is entirely in what
 * happens when something does NOT return: a connect that never resolves, a
 * query that outlives its budget, a reader who closes the tab mid-read.
 *
 * None of that is observable from a passing request, which is why it is tested
 * here against a fake pool rather than left to be discovered in production with
 * `PGPOOL_MAX_CHAT=2`.
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ToolHoldTimeout, openRlsSession } from '../rls.js'

const saved = process.env.DECKE_PGRLS_MAX_HOLD_MS
afterEach(() => {
  if (saved === undefined) delete process.env.DECKE_PGRLS_MAX_HOLD_MS
  else process.env.DECKE_PGRLS_MAX_HOLD_MS = saved
  delete process.env.SUPABASE_MODE
})

/** A client that records how it was disposed of. */
function fakeClient(opts: { onQuery?: (sql: string) => Promise<unknown> } = {}) {
  const state = { released: 0, destroyed: 0, queries: [] as string[] }
  return {
    state,
    client: {
      escapeLiteral: (s: string) => `'${s.replace(/'/g, "''")}'`,
      query: (sql: string) => {
        state.queries.push(sql)
        return opts.onQuery ? opts.onQuery(sql) : Promise.resolve({ rows: [] })
      },
      release: (destroy?: boolean) => {
        state.released++
        if (destroy) state.destroyed++
      },
    },
  }
}

const poolOf = (client: unknown, connect?: () => Promise<unknown>) =>
  ({ connect: connect ?? (() => Promise.resolve(client)) }) as never

test('the ordinary path checks out, and gives the connection back intact', async () => {
  const { client, state } = fakeClient()
  const s = await openRlsSession(poolOf(client), 'u1')
  await s.query('SELECT 1')
  await s.finish()

  assert.equal(state.released, 1)
  assert.equal(state.destroyed, 0, 'a clean session must return a reusable connection')
})

test('a query that outlives the budget rejects rather than hanging for ever', async () => {
  // THE BUG THIS CATCHES: the watchdog destroys the CONNECTION, which does not
  // settle a query already in flight on it. Awaiting `client.query` directly,
  // the caller waits for ever on a connection that no longer exists — the
  // watchdog protecting the pool while the request hangs anyway.
  process.env.DECKE_PGRLS_MAX_HOLD_MS = '120'
  const { client, state } = fakeClient({ onQuery: () => new Promise(() => {}) })
  const s = await openRlsSession(poolOf(client), 'u1')

  await assert.rejects(() => s.query('SELECT pg_sleep(600)'), (e: Error) => e instanceof ToolHoldTimeout)
  assert.ok(state.destroyed >= 1, 'the connection must be destroyed, never pooled')
})

test('a connection that arrives AFTER we gave up is still reclaimed', async () => {
  // `Promise.race` abandons the loser, it does not cancel it. A `pool.connect()`
  // that resolves late hands back a checked-out client with nobody holding a
  // reference to release it — checked out for the life of the instance. This is
  // the exhaustion failure arriving through the code written to prevent it.
  process.env.DECKE_PGRLS_MAX_HOLD_MS = '80'
  const { client, state } = fakeClient()
  let resolveLate: (c: unknown) => void = () => {}
  const late = new Promise((r) => {
    resolveLate = r
  })

  const attempt = openRlsSession(poolOf(null, () => late as Promise<unknown>), 'u1')
  await assert.rejects(attempt, (e: Error) => e instanceof ToolHoldTimeout)

  // The pool hands it over a moment after we stopped waiting.
  resolveLate(client)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(state.destroyed, 1, 'the late connection leaked instead of being reclaimed')
})

test('an abort mid-session destroys the connection rather than pooling it', async () => {
  const { client, state } = fakeClient()
  const ac = new AbortController()
  const s = await openRlsSession(poolOf(client), 'u1', ac.signal)

  ac.abort()
  await new Promise((r) => setTimeout(r, 10))

  assert.equal(state.destroyed, 1)
  // And a query afterwards refuses rather than touching a dead connection.
  await assert.rejects(() => s.query('SELECT 1'))
})

test('an already-aborted turn never checks a connection out at all', async () => {
  // A reader who pressed stop should not cause a database round trip — and on a
  // frozen instance, that round trip is the one that never returns.
  let connects = 0
  const ac = new AbortController()
  ac.abort()
  const pool = { connect: () => { connects++; return Promise.resolve({}) } } as never

  await assert.rejects(() => openRlsSession(pool, 'u1', ac.signal))
  assert.equal(connects, 0)
})

test('in SUPABASE_MODE the RLS preamble is one batched statement', async () => {
  // Three awaits would cost a quarter-second before the first tool query — the
  // database is ~90 ms away. The batch is not a micro-optimisation, it is the
  // difference between a lookup feeling instant and feeling laggy.
  process.env.SUPABASE_MODE = '1'
  const { client, state } = fakeClient()
  const s = await openRlsSession(poolOf(client), 'user-uuid')
  await s.finish()

  const preamble = state.queries[0] ?? ''
  assert.match(preamble, /^BEGIN;/)
  assert.match(preamble, /set_config\('request\.jwt\.claims'/)
  assert.match(preamble, /SET LOCAL role = 'authenticated'/)
  assert.match(preamble, /"sub":"user-uuid"/)
  assert.match(state.queries[1] ?? '', /^COMMIT;\s*RESET ROLE/)
})

test('the claims JSON is escaped, not interpolated', async () => {
  // It cannot be a bind parameter — the extended protocol permits one statement
  // per call and this is a batch — so the escaping is the control.
  process.env.SUPABASE_MODE = '1'
  const { client, state } = fakeClient()
  const s = await openRlsSession(poolOf(client), "u'; DROP TABLE app_user; --")
  await s.discard()

  const preamble = state.queries[0] ?? ''
  // The quote must be DOUBLED, which is how it stays inside the literal. Note
  // the naive assertion — "the string `'; DROP TABLE` does not appear" — is
  // wrong and passes for the wrong reason either way: correctly-escaped output
  // contains `''; DROP TABLE`, which has the naive needle as a substring. Check
  // the escaping, not the scary words.
  assert.match(preamble, /u''; DROP TABLE app_user/, 'the quote was not doubled')
  // And nothing terminated the literal early: an odd number of quotes before
  // the statement separator would mean the rest was parsed as SQL.
  const literal = preamble.slice(preamble.indexOf("'"), preamble.lastIndexOf("'") + 1)
  assert.equal(
    (literal.match(/'/g) ?? []).length % 2,
    0,
    'unbalanced quotes — part of the claims JSON is being parsed as SQL',
  )
})

test('a failing session rolls back and still returns the connection', async () => {
  process.env.SUPABASE_MODE = '1'
  const { client, state } = fakeClient()
  const s = await openRlsSession(poolOf(client), 'u1')
  await s.discard()

  assert.match(state.queries[1] ?? '', /^ROLLBACK;/)
  assert.equal(state.released, 1)
  assert.equal(state.destroyed, 0)
})
