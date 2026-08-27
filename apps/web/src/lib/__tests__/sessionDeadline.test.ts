/**
 * The regression test for issue #75.
 *
 * The property under test is the one the bug violated: **a session read can
 * never take longer than its deadline.** `@supabase/auth-js` attaches no
 * timeout to the token refresh that `getSession()` can trigger, so a stalled
 * network held that promise open forever — and `main.tsx`'s `beforeLoad`,
 * `AuthGuard` and every call in `api.ts` awaited it. The visible result was an
 * indefinitely blank page.
 *
 * A never-settling promise is exactly what a stalled fetch IS, so it is what
 * these tests use. Before the fix, the equivalent code awaited that promise
 * directly and this suite would hang until the runner's own timeout killed it;
 * after it, each case resolves in single-digit milliseconds.
 *
 *   node --import tsx --test src/lib/__tests__/sessionDeadline.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { withDeadline, readWithDeadline, SESSION_DEADLINE_MS } from '../sessionDeadline'

/** A promise that behaves like a fetch on a stranded socket: it never settles. */
const stalled = <T,>(): Promise<T> => new Promise<T>(() => {})

test('withDeadline: the work wins when it settles in time', async () => {
  const result = await withDeadline(Promise.resolve('answer'), 1000)
  assert.deepEqual(result, { value: 'answer', timedOut: false })
})

test('withDeadline: a stalled promise answers `timedOut` instead of hanging', async () => {
  const started = Date.now()
  const result = await withDeadline(stalled<string>(), 25)
  const elapsed = Date.now() - started

  assert.deepEqual(result, { value: null, timedOut: true })
  // The point of the whole change: BOUNDED. Generous upper bound so a loaded
  // CI box cannot make this flake — the failure mode it guards is "forever",
  // not "a bit slow".
  assert.ok(elapsed < 2000, `expected the deadline to be honoured, waited ${elapsed}ms`)
})

test('withDeadline: a late answer reaches onLate, so a timeout is recoverable', async () => {
  let resolveWork: (v: string) => void = () => {}
  const work = new Promise<string>((r) => {
    resolveWork = r
  })

  const late: string[] = []
  const result = await withDeadline(work, 10, (v) => late.push(v))
  assert.equal(result.timedOut, true)
  assert.deepEqual(late, [])

  resolveWork('arrived late')
  await work
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(late, ['arrived late'], 'onLate must fire when the read finally lands')
})

test('withDeadline: a rejection before the deadline is an answer, and propagates', async () => {
  await assert.rejects(
    () => withDeadline(Promise.reject(new Error('network down')), 1000),
    /network down/,
  )
})

test('withDeadline: a rejection AFTER the deadline is swallowed, not unhandled', async () => {
  let rejectWork: (e: Error) => void = () => {}
  const work = new Promise<string>((_r, rej) => {
    rejectWork = rej
  })
  const result = await withDeadline(work, 10)
  assert.equal(result.timedOut, true)

  // Nobody is listening any more; this must not become an unhandled rejection.
  rejectWork(new Error('too late to matter'))
  await work.catch(() => {})
  await new Promise((r) => setTimeout(r, 0))
})

test('readWithDeadline: a stalled getSession resolves as UNKNOWN, not as signed out', async () => {
  const started = Date.now()
  const read = await readWithDeadline<{ access_token: string }>(() => stalled(), 25)
  const elapsed = Date.now() - started

  assert.equal(read.session, null)
  assert.equal(read.timedOut, true, 'timedOut is what stops a caller reading null as "signed out"')
  assert.ok(elapsed < 2000, `expected the deadline to be honoured, waited ${elapsed}ms`)
})

test('readWithDeadline: a real session comes back untouched', async () => {
  const session = { access_token: 'token' }
  const read = await readWithDeadline(async () => ({ data: { session } }), 1000)
  assert.deepEqual(read, { session, timedOut: false })
})

test('readWithDeadline: a genuinely signed-out read is null and NOT timedOut', async () => {
  const read = await readWithDeadline(async () => ({ data: { session: null } }), 1000)
  assert.deepEqual(read, { session: null, timedOut: false })
})

test('readWithDeadline: a throwing client reads as signed out rather than exploding', async () => {
  // This runs inside a router `beforeLoad` and inside a render; a throw there
  // is a broken page, and "no session" is the honest answer to "we could not ask".
  const read = await readWithDeadline(async () => {
    throw new Error('client blew up')
  }, 1000)
  assert.deepEqual(read, { session: null, timedOut: false })
})

test('the shipped deadline is finite and short enough to be a deadline', () => {
  assert.ok(Number.isFinite(SESSION_DEADLINE_MS))
  assert.ok(SESSION_DEADLINE_MS > 0 && SESSION_DEADLINE_MS <= 10_000, String(SESSION_DEADLINE_MS))
})
