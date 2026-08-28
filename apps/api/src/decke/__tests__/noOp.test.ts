/**
 * A write that changes nothing does not get a dialog.
 *
 * ── THE DEFECT, MEASURED ─────────────────────────────────────────────────────
 *
 * 2026-08-27, typed into the conversation it happened in: *"Flagging this for a
 * future improvement agent — you attempted to edit the strategy guide again
 * instead of just looking at it."*
 *
 * Reproduced against the live model on `scripts/decke-read-vs-write-probe.mjs`,
 * n=12, asked "Give me insights about my slowking deck". Two trials in twelve
 * did this:
 *
 *   decks(deck: 'slowking')      → the deck AND its stored guide
 *   deck_strategy(deck_id: 'slowking', markdown: <that guide, byte for byte>)
 *
 * A consent dialog for a write with no consequence.
 *
 * ── WHAT THESE TESTS ARE FOR ─────────────────────────────────────────────────
 *
 * The dangerous failure of this feature is not "the dialog came back". It is
 * `needsApproval` answering false while `execute` goes ahead and writes — an
 * unapproved write, which is strictly worse than the nuisance being fixed and
 * is exactly the pairing `aisdk.ts` warns about in its own comment. So the
 * assertions below are weighted towards the failure direction: every path that
 * cannot answer must fall back to ASKING, and the two halves must agree.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NoOpMemo, hasNoOpCheck, noOpMessage } from '../noOp.js'
import { buildDataTools } from '../adapters/aisdk.js'

const GUIDE = 'Slowking control.\n\nLock the board, Iono resets their hand.'

/**
 * A `Ctx` whose API serves one deck with one guide.
 *
 * `needDeck` reads `/decks` to resolve the reference and the check then reads
 * `/decks/<id>` for the current guide, so both are served — resolving a
 * reference differently from the way the write tool resolves it is a way to
 * compare against the wrong deck, which is why the check uses the real
 * `needDeck` rather than trusting the id as sent.
 */
function fakeCtx(guide: string | null, seen: string[] = []) {
  return {
    pool: null as never,
    userId: 'u1',
    jwt: 'j',
    apiBase: 'https://x.test/api',
    api: {
      get: async (path: string) => {
        seen.push(`GET ${path}`)
        if (path.startsWith('/decks/')) return { deck: { id: 'd1', name: 'Toolbox Slowking', strategyMd: guide } }
        if (path.startsWith('/decks')) return { decks: [{ id: 'd1', name: 'Toolbox Slowking' }] }
        if (path.startsWith('/lists')) return { lists: [] }
        return {}
      },
      send: async (method: string, path: string) => {
        seen.push(`${method} ${path}`)
        return { deck: { id: 'd1', name: 'Toolbox Slowking', strategyMd: guide, version: 1, formatCode: 'standard' } }
      },
    },
  } as never
}

// ─────────────────────────────────────────────────────────────────────────────
// THE MEMO'S OWN CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

test('a tool with no check is never a no-op, and costs no round trip', async () => {
  // The default for everything the map does not mention. `log_cards` deletes and
  // adds real cards; nothing here is allowed to have an opinion about it.
  const memo = new NoOpMemo()
  let ran = 0
  const answer = await memo.isNoOpWrite('log_cards', { items: [] }, async (fn) => {
    ran++
    return fn(fakeCtx(GUIDE))
  })
  assert.equal(answer, false)
  assert.equal(ran, 0, 'a tool with no check must not open a context, let alone call an API')
  assert.equal(hasNoOpCheck('log_cards'), false)
  assert.equal(hasNoOpCheck('deck_strategy'), true)
})

test('a check that throws means ASK — never "go ahead"', async () => {
  // THE FAILURE DIRECTION, and the single most important assertion in this file.
  // A thrown fetch, an API that 500s, a deck that vanished: none of them may be
  // read as permission. Everything that cannot answer falls back to the dialog.
  const memo = new NoOpMemo()
  const answer = await memo.isNoOpWrite('deck_strategy', { deck_id: 'd1', markdown: 'x' }, async () => {
    throw new Error('the network is on fire')
  })
  assert.equal(answer, false)
})

test('the answer is memoised, so the two halves cannot disagree', async () => {
  // `needsApproval` and `execute` ask the identical question about the identical
  // call. Two round trips would be waste; two DIFFERENT answers would be an
  // unapproved write, because `needsApproval` said "no dialog" and `execute`
  // would then have found something to do.
  const memo = new NoOpMemo()
  let calls = 0
  const ask = () =>
    memo.isNoOpWrite('deck_strategy', { deck_id: 'd1', markdown: GUIDE }, async (fn) => {
      calls++
      return fn(fakeCtx(GUIDE))
    })
  const [a, b] = await Promise.all([ask(), ask()])
  assert.equal(a, true)
  assert.equal(b, true)
  assert.equal(calls, 1, 'the second reader must get the first reader’s answer, not its own round trip')
})

test('different arguments are a different question', async () => {
  // The memo is keyed on (tool, arguments) via `callKey`, so changing the guide
  // and calling again is a fresh check rather than a cached "nothing to do".
  const memo = new NoOpMemo()
  const run = async (fn: (c: never) => Promise<boolean>) => fn(fakeCtx(GUIDE))
  assert.equal(await memo.isNoOpWrite('deck_strategy', { deck_id: 'd1', markdown: GUIDE }, run), true)
  assert.equal(
    await memo.isNoOpWrite('deck_strategy', { deck_id: 'd1', markdown: `${GUIDE}\n\nNew matchup notes.` }, run),
    false,
  )
})

test('a write clears the memo, because it can change the answer', async () => {
  // Same trigger and same reasoning as `CallLedger.invalidate`. A guide that
  // matched before an edit does not match after one, and serving the stale
  // "that would change nothing" is how a real edit goes quietly missing.
  const memo = new NoOpMemo()
  let calls = 0
  const run = async (fn: (c: never) => Promise<boolean>) => {
    calls++
    return fn(fakeCtx(GUIDE))
  }
  await memo.isNoOpWrite('deck_strategy', { deck_id: 'd1', markdown: GUIDE }, run)
  memo.invalidate()
  await memo.isNoOpWrite('deck_strategy', { deck_id: 'd1', markdown: GUIDE }, run)
  assert.equal(calls, 2)
})

// ─────────────────────────────────────────────────────────────────────────────
// WHAT COUNTS AS THE SAME GUIDE
// ─────────────────────────────────────────────────────────────────────────────

test('the recorded failure — the guide saved back byte for byte — is a no-op', async () => {
  // The tape's own approval card carried the deck's UUID, which is what a write
  // has to send: the handler resolves STRICTLY when it writes, so an approximate
  // name never reaches a `PUT` in the first place.
  const memo = new NoOpMemo()
  for (const ref of ['d1', 'Toolbox Slowking']) {
    assert.equal(
      await memo.isNoOpWrite('deck_strategy', { deck_id: ref, markdown: GUIDE }, (fn) => fn(fakeCtx(GUIDE))),
      true,
      ref,
    )
  }
})

test('trailing whitespace and line endings are not a change', async () => {
  // `PUT /decks/:id/strategy` trims on the way in, so this compares what would
  // actually be stored rather than what was typed.
  const memo = new NoOpMemo()
  const run = (fn: (c: never) => Promise<boolean>) => fn(fakeCtx(GUIDE))
  assert.equal(await memo.isNoOpWrite('deck_strategy', { deck_id: 'd1', markdown: `${GUIDE}\n\n` }, run), true)
  assert.equal(
    await memo.isNoOpWrite('deck_strategy', { deck_id: 'd1', markdown: GUIDE.replace(/\n/g, '\r\n') }, run),
    true,
  )
})

test('anything a reader would call an edit still asks', async () => {
  // The comparison is deliberately NOT loose. Normalising case or collapsing
  // runs of spaces would swallow a real edit, and the cost of being wrong in
  // that direction is a write somebody wanted and silently did not get.
  const memo = new NoOpMemo()
  const run = (fn: (c: never) => Promise<boolean>) => fn(fakeCtx(GUIDE))
  for (const [what, md] of [
    ['a sentence added', `${GUIDE} Also strong into Gardevoir.`],
    ['a different case', GUIDE.toUpperCase()],
    ['a word removed', GUIDE.replace('control', '')],
    ['collapsed blank line', GUIDE.replace('\n\n', '\n')],
    ['cleared entirely', ''],
  ] as const) {
    assert.equal(await memo.isNoOpWrite('deck_strategy', { deck_id: 'd1', markdown: md }, run), false, what)
  }
})

test('with no guide stored, writing one is never a no-op', async () => {
  const memo = new NoOpMemo()
  assert.equal(
    await memo.isNoOpWrite('deck_strategy', { deck_id: 'd1', markdown: GUIDE }, (fn) => fn(fakeCtx(null))),
    false,
  )
})

test('a READ is not a no-op write, whatever is stored', async () => {
  // `deck_strategy` with no markdown reads the guide. It never reaches the
  // approval path, and answering "true" about it would be a claim about a
  // different call than the one that was made.
  const memo = new NoOpMemo()
  assert.equal(
    await memo.isNoOpWrite('deck_strategy', { deck_id: 'd1' }, (fn) => fn(fakeCtx(GUIDE))),
    false,
  )
})

test('a deck reference that does not resolve asks', async () => {
  // Strict resolution, like the write branch of the handler itself. An
  // approximate name compared loosely could match a deck the write would not
  // have touched — so a miss is "ask", not "nothing to do".
  const memo = new NoOpMemo()
  assert.equal(
    await memo.isNoOpWrite('deck_strategy', { deck_id: 'a deck that is not there', markdown: GUIDE }, (fn) =>
      fn(fakeCtx(GUIDE)),
    ),
    false,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO HALVES, AT THE BOUNDARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The whole boundary, over a stubbed transport.
 *
 * `buildDataTools` builds its own `Ctx` through `withToolCtx`, which builds its
 * own `api` from `apiBase` and the bearer — so a hand-made `ctx.api` never
 * reaches it. Stubbing `fetch` is what makes the REAL resolution, the REAL
 * `needsApproval` and the REAL `execute` run against known data, which is the
 * only arrangement that can catch the two halves drifting apart.
 */
function stubFetch(guide: string | null, seen: string[]) {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const url = String((input as { url?: string })?.url ?? input)
    const method = init?.method ?? 'GET'
    seen.push(`${method} ${url}`)
    const json = /\/decks\/[^/?]+$/.test(url)
      ? { deck: { id: 'd1', name: 'Toolbox Slowking', strategyMd: guide, version: 1, formatCode: 'standard' } }
      : url.includes('/decks')
        ? { decks: [{ id: 'd1', name: 'Toolbox Slowking' }] }
        : {}
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return () => {
    globalThis.fetch = real
  }
}

test('needsApproval and execute agree, and the no-op one neither asks nor writes', async () => {
  // THE PAIRING `aisdk.ts` WARNS ABOUT, asserted end to end: `needsApproval`
  // false means "raise no dialog", never "run it". If `execute` stopped
  // checking, this call would become a write that happens unasked.
  const seen: string[] = []
  const restore = stubFetch(GUIDE, seen)
  try {
    const tools = buildDataTools({
      pool: null as never,
      userId: 'u1',
      jwt: 'jwt',
      apiBase: 'https://example.test/api',
      include: (d: { name: string }) => d.name === 'deck_strategy',
    } as never) as Record<string, { needsApproval?: unknown; execute?: unknown }>

    const t = tools.deck_strategy!
    const ask = t.needsApproval as (i: unknown) => Promise<boolean>
    const run = t.execute as (i: unknown, o: { toolCallId: string }) => Promise<string>

    const noop = { deck_id: 'd1', markdown: GUIDE }
    assert.equal(await ask(noop), false, 'a write that changes nothing must not raise a dialog')
    const said = await run(noop, { toolCallId: 'c1' })
    assert.match(String(said), /would not change anything/, 'execute must refuse it too, in words')
    assert.equal(
      seen.some((s) => s.startsWith('PUT')),
      false,
      'nothing may be written for a call that raised no dialog',
    )

    // AND THE REAL EDIT STILL ASKS. Without this the test would pass for a
    // predicate that always said no, which is the unapproved-write bug wearing
    // a new coat — the same trap `approval.test.ts` documents for its helper.
    assert.equal(await ask({ deck_id: 'd1', markdown: `${GUIDE}

New notes.` }), true)
  } finally {
    restore()
  }
})

test('the two call sites read the same predicate', () => {
  // Pinned in the source because the failure is a future edit that checks in one
  // place and not the other, which no unit test of either half alone can see.
  const src = readFileSync(new URL('../adapters/aisdk.ts', import.meta.url), 'utf8')
  const uses = src.match(/isNoOpWrite\(/g) ?? []
  assert.ok(uses.length >= 3, `expected the helper plus both call sites, found ${uses.length}`)
  assert.match(src, /needsApproval[\s\S]{0,600}isNoOpWrite/, 'needsApproval stopped consulting it')
  assert.match(src, /execute[\s\S]*?await isNoOpWrite/, 'execute stopped consulting it')
})

test('what the model is told is a fact, not a failure', () => {
  // It lands in the conversation and he may well say it out loud, so it has to
  // be true and it has to close the loop: nothing happened, nothing to retry,
  // and do not describe it as something you just saved.
  const m = noOpMessage('deck_strategy')
  assert.match(m, /nothing was written/)
  assert.match(m, /not a failure/)
  assert.match(m, /nothing to retry/)
  assert.match(m, /do not describe it as something you just saved/)
})
