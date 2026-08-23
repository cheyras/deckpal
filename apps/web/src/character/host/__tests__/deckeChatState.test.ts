/**
 * The decisions the chat panel makes that no screenshot can check.
 *
 * WHICH OPENERS GET OFFERED. NN/g's correction to the empty state is that
 * re-serving a suggestion someone already passed over reads as nagging. That is
 * a claim about the SECOND visit, so it is invisible in any single frame and
 * exactly the kind of thing that silently stops working. The second pass made it
 * a harder claim: *"different suggestions every time … a way to gradually teach
 * people what they can do with Deck-E"*, which is about the tenth visit.
 *
 * WHAT A SCREEN READER IS TOLD. The failure mode of a live region is not that
 * it says nothing — it is that it says far too much, at the wrong moment, in
 * fragments. A test is the only place that distinction is legible.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  OPENER_COUNT,
  OPENER_POOL,
  chooseOpeners,
  noteShown,
  readLastSaid,
  readOpenerLog,
  replyAnnouncement,
  writeLastSaid,
  writeOpenerLog,
  type Opener,
  type OpenerKind,
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

const ids = (o: readonly Opener[]) => o.map((x) => x.id)

/**
 * THE SEED IS WHAT MAKES THIS PAGE PHOTOGRAPHABLE.
 *
 * On a clean slate every kind and every member has zero sightings, so without a
 * tie-break the offer would be the first three kinds and the first member of
 * each — forever, for every first-time reader. The seed breaks those ties, and
 * pinning it pins the result, which is what `/dev/chat-ui` and the visual
 * harness rely on so that a screenshot diff is a change to the product and not a
 * change to the dice.
 *
 * MUTATION: ignore `opts.seed` in `chooseOpeners` (always seed from `Date.now()`)
 * and the second assertion goes red.
 */
test('a pinned seed gives a reproducible offer', () => {
  const a = chooseOpeners(OPENER_POOL, {}, { seed: 7 })
  const b = chooseOpeners(OPENER_POOL, {}, { seed: 7 })
  assert.equal(a.length, OPENER_COUNT)
  assert.deepEqual(ids(a), ids(b), 'the same seed must produce the same three chips')

  // And a different seed genuinely moves it — otherwise the "reproducible" test
  // above would pass just as well on a function that ignores the seed entirely.
  const seen = new Set<string>()
  for (let s = 0; s < 12; s += 1) seen.add(ids(chooseOpeners(OPENER_POOL, {}, { seed: s })).join(','))
  assert.ok(seen.size > 1, 'every seed produced the same trio — the seed is not being read')
})

/**
 * MUTATION: drop the `if (out.length >= want) break` and four chips come back;
 * make `kindOrder` a single repeated kind and the second assertion goes red.
 *
 * Three of one subject is the failure the old pool had in miniature — two of its
 * six entries were collection counts — and it is the opposite of teaching range.
 */
test('the offer is three chips from three different subjects', () => {
  for (let s = 0; s < 20; s += 1) {
    const chosen = chooseOpeners(OPENER_POOL, {}, { seed: s })
    assert.equal(chosen.length, OPENER_COUNT, `seed ${s}`)
    const kinds = new Set(chosen.map((o) => o.kind))
    assert.equal(kinds.size, OPENER_COUNT, `seed ${s} offered ${[...kinds].join('/')}`)
  }
})

/**
 * THE NAGGING RULE, WHICH IS THE ORIGINAL ONE.
 *
 * MUTATION: return `{}` from `noteShown` — i.e. stop counting sightings — and
 * this goes red.
 */
test('the second visit offers three the viewer has not been shown', () => {
  const first = chooseOpeners(OPENER_POOL, {}, { seed: 1 })
  const log = noteShown({}, first)
  const second = chooseOpeners(OPENER_POOL, log, { seed: 1, avoid: ids(first) })
  for (const o of second) {
    assert.ok(
      !first.some((f) => f.id === o.id),
      `${o.id} was shown last time and came straight back — that is the nagging`,
    )
  }
})

/**
 * *"A way to gradually teach people what they can do with Deck-E."*
 *
 * The old pool could offer three SUBJECTS, ever. This asserts the curriculum:
 * ten visits have to have covered most of the eight areas, not ten variations on
 * three of them.
 *
 * ── THE SEED IS FIXED ACROSS ALL TEN VISITS, AND THAT IS THE TEST ────────────
 *
 * The first version of this used a different seed per visit and came back GREEN
 * when `seenIn` was mutated out of the kind ordering — because the jitter alone
 * shuffles eight kinds well enough that ten random draws cover most of them.
 * It asserted a property the RNG was providing and the rotation was not.
 *
 * Pinning one seed freezes the jitter, so the ONLY thing that can move the kinds
 * between visits is the sighting count. That is the mechanism under test.
 *
 * MUTATION: drop `seenIn(kind)` from `kindOrder` and this goes red — the same
 * three kinds come back every time and the reader never learns he does battle
 * logs. Watched.
 */
test('ten openings teach most of what he can do, not three areas of it', () => {
  let log: OpenerLog = {}
  let previous: string[] = []
  const kindsSeen = new Set<OpenerKind>()
  for (let visit = 0; visit < 10; visit += 1) {
    const chosen = chooseOpeners(OPENER_POOL, log, { seed: 11, avoid: previous })
    for (const o of chosen) kindsSeen.add(o.kind)
    log = noteShown(log, chosen)
    previous = ids(chosen)
  }
  const allKinds = new Set(OPENER_POOL.map((o) => o.kind))
  assert.ok(
    kindsSeen.size >= allKinds.size - 1,
    `ten visits showed only ${kindsSeen.size} of ${allKinds.size} subjects: ${[...kindsSeen].join(', ')}`,
  )
})

/**
 * MUTATION: change the member pick to `members[0]` — dropping the
 * `members.find((m) => !avoid.includes(m.o.id))` — and this goes red.
 *
 * ── A DEAD GUARD WAS REMOVED TO GET HERE ─────────────────────────────────────
 *
 * `chooseOpeners` used to compare its result against `avoid` and re-draw if they
 * matched. Mutating that branch out left the suite GREEN, which is how it was
 * found: the member pick has ALREADY excluded every avoided id, so the branch
 * could not fire — and on the one pool where it could (a kind with a single
 * member) the re-draw returned the same thing anyway. It is gone. A guard that
 * cannot fire is a guard somebody will trust.
 */
test('the same trio never comes back twice running', () => {
  // The hostile case: a clean log, so sightings say nothing at all and only the
  // avoid-list can prevent the repeat.
  const previous = chooseOpeners(OPENER_POOL, {}, { seed: 3 })
  const again = chooseOpeners(OPENER_POOL, {}, { seed: 3, avoid: ids(previous) })
  assert.notDeepEqual(ids(again), ids(previous))
  for (const o of again) assert.ok(!ids(previous).includes(o.id), `${o.id} came straight back`)
})

/**
 * MUTATION: remove the `Math.min(…, 99)` cap in `noteShown` and this goes red.
 * A corrupted huge value would otherwise make one opener unreachable forever.
 */
test('the sighting count is capped so one opener cannot be exiled forever', () => {
  let log: OpenerLog = { count: 98 }
  const only = OPENER_POOL.filter((o) => o.kind === 'collection')
  log = noteShown(log, only)
  log = noteShown(log, only)
  log = noteShown(log, only)
  assert.equal(log.count, 99)
})

test('storage that throws on access is survived, not caught downstream', () => {
  const hostile = fakeStore({ throwOnRead: true, throwOnWrite: true })
  assert.deepEqual(readOpenerLog(hostile), {})
  assert.doesNotThrow(() => writeOpenerLog(hostile, { count: 1 }))
  assert.deepEqual(readLastSaid(hostile), {})
  assert.doesNotThrow(() => writeLastSaid(hostile, { greetingId: 'x' }))
  // A viewer with no storage at all is the same story, and must not be a crash.
  assert.deepEqual(readOpenerLog(null), {})
  assert.doesNotThrow(() => writeOpenerLog(null, { count: 1 }))
  assert.deepEqual(readLastSaid(null), {})
  assert.doesNotThrow(() => writeLastSaid(null, { greetingId: 'x' }))
})

test('a round trip through storage survives, and junk in it does not', () => {
  const store = fakeStore()
  const chosen = chooseOpeners(OPENER_POOL, {}, { seed: 4 })
  writeOpenerLog(store, noteShown({}, chosen))
  assert.deepEqual(
    readOpenerLog(store),
    Object.fromEntries(chosen.map((o) => [o.id, 1])),
  )

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

/**
 * MUTATION: drop the `.slice(0, 8)` in `readLastSaid` and the last assertion
 * goes red. This is parsed out of a place the reader can edit by hand, and the
 * array is handed straight to `avoid`, which is scanned once per opener.
 */
test('the last-said memory round-trips, and refuses junk and bulk', () => {
  const store = fakeStore()
  writeLastSaid(store, { greetingId: 'up-late', subheadId: 'decks', openerIds: ['a', 'b'] })
  assert.deepEqual(readLastSaid(store), {
    greetingId: 'up-late',
    subheadId: 'decks',
    farewellId: undefined,
    openerIds: ['a', 'b'],
  })

  const key = [...store.data.keys()].find((k) => k.includes('lastSaid'))!
  store.data.set(key, 'not json')
  assert.deepEqual(readLastSaid(store), {})
  store.data.set(key, JSON.stringify({ greetingId: 42, openerIds: 'nope' }))
  assert.deepEqual(readLastSaid(store), {
    greetingId: undefined,
    subheadId: undefined,
    farewellId: undefined,
    openerIds: undefined,
  })
  store.data.set(key, JSON.stringify({ openerIds: Array.from({ length: 500 }, (_, i) => `x${i}`) }))
  assert.equal(readLastSaid(store).openerIds?.length, 8)
})

/**
 * MUTATION: give two openers the same `text` and the second assertion goes red.
 *
 * Three per kind is what makes rotation possible at the MEMBER level; the pool
 * having at least as many kinds as slots is what makes it possible at the kind
 * level, which is where the teaching happens.
 */
test('the pool can actually rotate: unique lines, enough of each kind', () => {
  const idSet = new Set(OPENER_POOL.map((o) => o.id))
  const textSet = new Set(OPENER_POOL.map((o) => o.text))
  assert.equal(idSet.size, OPENER_POOL.length, 'two openers share an id')
  assert.equal(textSet.size, OPENER_POOL.length, 'two openers share a line')

  const kinds = [...new Set(OPENER_POOL.map((o) => o.kind))]
  assert.ok(kinds.length > OPENER_COUNT, `only ${kinds.length} subjects — the kind cannot rotate`)
  for (const kind of kinds) {
    assert.ok(
      OPENER_POOL.filter((o) => o.kind === kind).length >= 2,
      `${kind} has fewer than two openers, so it cannot offer a second one`,
    )
  }
})

test('a degenerate pool does not produce an empty offer', () => {
  const pool: Opener[] = [{ id: 'solo', kind: 'collection', text: 'Only one' }]
  assert.deepEqual(ids(chooseOpeners(pool, {}, { seed: 1 })), ['solo'])
  // Even when the one thing it has is the thing it was told to avoid — a repeat
  // beats a blank empty state.
  assert.deepEqual(ids(chooseOpeners(pool, {}, { seed: 1, avoid: ['solo'] })), ['solo'])
  assert.deepEqual(chooseOpeners([], {}, { seed: 1 }), [])
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
