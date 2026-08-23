/**
 * The two decisions the chat panel makes that no screenshot can check.
 *
 * WHICH OPENERS GET OFFERED. NN/g's correction to the empty state is that
 * re-serving a suggestion someone already passed over reads as nagging. That is
 * a claim about the SECOND visit, so it is invisible in any single frame and
 * exactly the kind of thing that silently stops working.
 *
 * WHAT A SCREEN READER IS TOLD. The failure mode of a live region is not that
 * it says nothing — it is that it says far too much, at the wrong moment, in
 * fragments. A test is the only place that distinction is legible.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  OPENER_POOL,
  chooseOpeners,
  noteShown,
  readOpenerLog,
  replyAnnouncement,
  writeOpenerLog,
  type Opener,
  type OpenerLog,
  type OpenerStore,
} from '../deckeChatState'

// ── Openers ──────────────────────────────────────────────────────────────────

/** A stand-in for `window.localStorage` that can be told to misbehave. */
function fakeStore(opts: { throwOnRead?: boolean; throwOnWrite?: boolean } = {}): OpenerStore & {
  data: Map<string, string>
} {
  const data = new Map<string, string>()
  return {
    data,
    getItem(k) {
      if (opts.throwOnRead) throw new Error('SecurityError: access denied')
      return data.get(k) ?? null
    },
    setItem(k, v) {
      if (opts.throwOnWrite) throw new Error('QuotaExceededError')
      data.set(k, v)
    },
  }
}

test('a clean slate gets one opener of each kind, in pool order', () => {
  const chosen = chooseOpeners(OPENER_POOL, {})
  assert.equal(chosen.length, 3)
  assert.deepEqual(
    chosen.map((o) => o.kind),
    ['ask', 'show', 'go'],
  )
  assert.deepEqual(
    chosen.map((o) => o.id),
    ['count', 'closest', 'decks'],
  )
})

test('the second visit offers a different one of every kind', () => {
  const first = chooseOpeners(OPENER_POOL, {})
  const log = noteShown({}, first)
  const second = chooseOpeners(OPENER_POOL, log)
  assert.equal(second.length, 3)
  for (const o of second) {
    assert.ok(
      !first.some((f) => f.id === o.id),
      `${o.id} was shown last time and came straight back — that is the nagging`,
    )
  }
  // And the kinds are preserved, so the range on show does not narrow.
  assert.deepEqual(
    second.map((o) => o.kind),
    ['ask', 'show', 'go'],
  )
})

test('a pool of two per kind cycles rather than exhausting', () => {
  let log: OpenerLog = {}
  const seen: string[][] = []
  for (let i = 0; i < 4; i += 1) {
    const chosen = chooseOpeners(OPENER_POOL, log)
    seen.push(chosen.map((o) => o.id))
    log = noteShown(log, chosen)
  }
  assert.deepEqual(seen[0], ['count', 'closest', 'decks'])
  assert.deepEqual(seen[1], ['worth', 'recent', 'lists'])
  // Third time round both members of each kind have been seen once, so the tie
  // breaks on pool order and the cycle repeats. Predictable beats random here:
  // a random offer cannot be screenshotted or gated.
  assert.deepEqual(seen[2], seen[0])
  assert.deepEqual(seen[3], seen[1])
})

test('the sighting count is capped so one opener cannot be exiled forever', () => {
  let log: OpenerLog = { count: 98 }
  const only = OPENER_POOL.filter((o) => o.kind === 'ask')
  log = noteShown(log, only)
  log = noteShown(log, only)
  log = noteShown(log, only)
  assert.equal(log.count, 99)
})

test('storage that throws on access is survived, not caught downstream', () => {
  const hostile = fakeStore({ throwOnRead: true, throwOnWrite: true })
  assert.deepEqual(readOpenerLog(hostile), {})
  assert.doesNotThrow(() => writeOpenerLog(hostile, { count: 1 }))
  // A viewer with no storage at all is the same story, and must not be a crash.
  assert.deepEqual(readOpenerLog(null), {})
  assert.doesNotThrow(() => writeOpenerLog(null, { count: 1 }))
})

test('a round trip through storage survives, and junk in it does not', () => {
  const store = fakeStore()
  writeOpenerLog(store, noteShown({}, chooseOpeners(OPENER_POOL, {})))
  assert.deepEqual(readOpenerLog(store), { count: 1, closest: 1, decks: 1 })

  const key = [...store.data.keys()][0]!
  store.data.set(key, 'not json at all')
  assert.deepEqual(readOpenerLog(store), {})
  store.data.set(key, '["an","array"]')
  assert.deepEqual(readOpenerLog(store), {})
  store.data.set(key, '{"count":"lots","gone":4,"closest":2}')
  // A non-number is dropped; an id no longer in the pool is dropped with it, so
  // retiring an opener does not leave dead keys in someone's browser forever.
  assert.deepEqual(readOpenerLog(store), { closest: 2 })
})

test('every opener in the pool has a unique id and a distinct line', () => {
  const ids = new Set(OPENER_POOL.map((o) => o.id))
  const texts = new Set(OPENER_POOL.map((o) => o.text))
  assert.equal(ids.size, OPENER_POOL.length)
  assert.equal(texts.size, OPENER_POOL.length)
  // Two per kind is what makes rotation possible at all.
  for (const kind of ['ask', 'show', 'go'] as const) {
    assert.ok(OPENER_POOL.filter((o) => o.kind === kind).length >= 2, kind)
  }
})

test('an unknown pool shape does not produce an empty offer', () => {
  const pool: Opener[] = [{ id: 'solo', kind: 'ask', text: 'Only one' }]
  assert.deepEqual(chooseOpeners(pool, {}), pool)
  assert.deepEqual(chooseOpeners([], {}), [])
})

// ── The turn-boundary announcement ───────────────────────────────────────────

test('a turn that produced nothing announces nothing', () => {
  assert.equal(replyAnnouncement([]), '')
  assert.equal(replyAnnouncement([{ kind: 'text', text: '' }]), '')
  assert.equal(replyAnnouncement([{ kind: 'text', text: '   \n ' }]), '')
})

test('tool rows alone are never announced here', () => {
  // `ToolRow` owns its own live region and announces its own failure. Saying it
  // again from the transcript is how a failed lookup announced itself twice.
  assert.equal(replyAnnouncement([{ kind: 'tool' }, { kind: 'tool' }]), '')
})

test('the announcement describes shape, never content', () => {
  const said = replyAnnouncement([
    { kind: 'text', text: 'You own 604 cards across 12 sets, and the rarest is' },
    { kind: 'tool' },
  ])
  assert.equal(said, 'Deck-E replied.')
  assert.ok(!said.includes('604'), 'the reply text must not leak into the region')
})

test('panels are counted, and counted honestly', () => {
  assert.equal(
    replyAnnouncement([{ kind: 'text', text: 'here you go' }, { kind: 'screen' }]),
    'Deck-E replied, with 1 panel.',
  )
  assert.equal(
    replyAnnouncement([
      { kind: 'text', text: 'here you go' },
      { kind: 'screen' },
      { kind: 'screen' },
    ]),
    'Deck-E replied, with 2 panels.',
  )
  assert.equal(replyAnnouncement([{ kind: 'screen' }]), 'Deck-E showed 1 panel.')
  assert.equal(
    replyAnnouncement([{ kind: 'screen' }, { kind: 'screen' }, { kind: 'tool' }]),
    'Deck-E showed 2 panels.',
  )
})

test('a kind this build does not know is ignored rather than described', () => {
  assert.equal(replyAnnouncement([{ kind: 'something-new' }]), '')
})
