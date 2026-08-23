/**
 * The segmented approval card's logic, driven directly.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * Everything under test here decides WHAT GETS WRITTEN to a real collection. The
 * two bugs already shipped on this path were invisible because the logic lived
 * in a React hook nothing could import; this is the same path with more
 * authority on it, so the logic lives in a pure module and the module is driven
 * here with no DOM, no `fetch` and no Supabase.
 *
 * Six of these tests exist because a specific failure was named, and each was
 * proved failable by mutating the code and watching it go red. The mutation is
 * recorded above each one, because a test nobody has seen fail is a test nobody
 * has checked.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ApprovalEditError,
  acceptButtonLabel,
  acceptCount,
  acceptedItems,
  asksSelection,
  assertNarrowing,
  assertRouteAgrees,
  batchContent,
  canonicalJSON,
  commitCorrection,
  correctionIdempotencyKey,
  correctionReason,
  includedRows,
  initialChoices,
  isEdited,
  resolveBatchItems,
  runAccept,
  sections,
  transportFromThrown,
  type ApprovalPreview,
  type BatchResponse,
  type CommitTransport,
  type CorrectionRequest,
  type HeldItem,
  type PreviewRow,
  type RowChoice,
  type Verdict,
} from '../approvalCardState'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NORMAL = { variantId: 37183, kindCode: 'normal', label: 'Normal', isPrimary: true, ownedQty: 0 }
const REVERSE = { variantId: 37184, kindCode: 'reverse', label: 'Reverse Holo', isPrimary: false, ownedQty: 2 }

function row(over: Partial<PreviewRow> & { index: number }): PreviewRow {
  return {
    cardId: `card-${over.index}`,
    cardName: `Card ${over.index}`,
    setId: 'me05',
    number: String(over.index),
    certainty: 'stated',
    candidates: [],
    wouldUseVariantId: null,
    variantId: 1000 + over.index,
    variantLabel: 'Normal',
    mode: 'delta',
    value: 1,
    before: 0,
    after: 1,
    clamped: false,
    ...over,
  }
}

function preview(rows: PreviewRow[], over: Partial<ApprovalPreview> = {}): ApprovalPreview {
  return {
    toolCallId: 'call_a7f3',
    tool: 'log_cards',
    title: 'Log collection changes',
    summary: 'log_cards DRY RUN — 1 item(s)',
    ok: true,
    editable: true,
    rows,
    skipped: [],
    ...over,
  }
}

/** The unstated row: no printing named, two printings exist. Section 2. */
const UNSTATED = row({
  index: 0,
  certainty: 'unstated',
  candidates: [NORMAL, REVERSE],
  wouldUseVariantId: 37183,
  variantId: 37183,
  cardId: 'me05-84',
  cardName: 'Pitch Black',
})

const choices = (entries: Record<number, Partial<RowChoice>>): Map<number, RowChoice> =>
  new Map(
    Object.entries(entries).map(([k, v]) => [
      Number(k),
      { removed: false, variantId: null, value: null, ...v },
    ]),
  )

const okBody = (over: Partial<BatchResponse> = {}): BatchResponse => ({
  batchId: 'batch_1',
  replayed: false,
  applied: 1,
  unchanged: 0,
  items: [{ variantId: 37184, cardId: 'me05-84', before: 0, after: 1, clamped: false }],
  ...over,
})

/** Records the order side effects happen in — the only way to pin an ordering. */
function recorder() {
  const order: string[] = []
  return {
    order,
    commit:
      (result: CommitTransport = { received: true, ok: true, body: okBody() }) =>
      async (r: CorrectionRequest): Promise<CommitTransport> => {
        order.push(`commit:${r.idempotencyKey}`)
        return result
      },
    settle: (v: Verdict) => {
      order.push(v.approved ? 'settle:approved' : 'settle:denied')
    },
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. THE IDEMPOTENCY KEY — scoped to the held call, not to its content
// ═════════════════════════════════════════════════════════════════════════════
//
// PROVED FAILABLE: changed `correctionIdempotencyKey` to `ripCommit.ts`'s
// content-only form (`decke-approval-${fnv(content)}`, dropping `toolCallId`).
// The first test below went red on the "distinct calls" assertion, and the
// repeat-correction test went red on `commit:` keys being equal — which is the
// production bug: the server honours a caller key unbucketed and for ever, so
// the second identical correction returns `replayed: true` and writes nothing.

test('the idempotency key is scoped to the toolCallId, not to the batch content', () => {
  const items = [{ variantId: 37184, delta: 1 }]
  const a = correctionIdempotencyKey('call_a7f3', items)
  const b = correctionIdempotencyKey('call_zzz9', items)

  assert.notEqual(a, b, 'two different held calls with identical content share one key')
  assert.ok(a.startsWith('decke-approval-call_a7f3#'), a)
  // The same call twice — a double-tap or a retry — MUST collide, because that
  // is the one case where `replayed: true` is the truth.
  assert.equal(correctionIdempotencyKey('call_a7f3', items), a)
  // Order does not change identity: the same intent is the same batch.
  assert.equal(
    correctionIdempotencyKey('call_a7f3', [
      { variantId: 5, delta: 1 },
      { variantId: 9, delta: 2 },
    ]),
    correctionIdempotencyKey('call_a7f3', [
      { variantId: 9, delta: 2 },
      { variantId: 5, delta: 1 },
    ]),
  )
  // ...but the MODE does. "set to 5" and "+5" are different requests.
  assert.notEqual(
    correctionIdempotencyKey('c', [{ variantId: 5, quantity: 5 }]),
    correctionIdempotencyKey('c', [{ variantId: 5, delta: 5 }]),
  )
  assert.ok(a.length <= 200, 'the server rejects a key over 200 chars rather than truncating it')
})

test('A REPEATED IDENTICAL CORRECTION STILL WRITES — the bug nothing else would catch', async () => {
  // The scenario, verbatim from the review: the reader asks for one Pitch
  // Black, corrects it to the reverse holo, Accepts. Next week they do exactly
  // the same thing. With a content-only key the second POST collides against a
  // week-old batch, `/collection/batch` returns the ORIGINAL response with
  // `replayed: true`, nothing is written, and the reason recites last week's
  // numbers as fresh.
  const seen = new Set<string>()
  const commit = async (r: CorrectionRequest): Promise<CommitTransport> => {
    // The server's actual behaviour for a caller-supplied key: honoured
    // indefinitely, never bucketed (`mutations.ts:121-122`, `collection.ts:367`).
    if (seen.has(r.idempotencyKey)) {
      return { received: true, ok: true, body: okBody({ replayed: true, applied: 1 }) }
    }
    seen.add(r.idempotencyKey)
    return { received: true, ok: true, body: okBody() }
  }

  const args = (toolCallId: string) => ({
    toolCallId,
    held: [{ card_id: 'me05-84', delta: 1 }] as HeldItem[],
    preview: preview([UNSTATED]),
    choices: choices({ 0: { variantId: 37184 } }) as ReadonlyMap<number, RowChoice>,
  })

  const week1 = await runAccept(args('call_week1'), { commit, settle: () => {} })
  const week2 = await runAccept(args('call_week2'), { commit, settle: () => {} })

  assert.equal(week1.path, 'B')
  assert.equal(week2.path, 'B')
  assert.equal(week1.path === 'B' ? week1.outcome.kind : null, 'applied')
  assert.equal(week2.path === 'B' ? week2.outcome.kind : null, 'applied')
  assert.equal(
    week2.path === 'B' && week2.outcome.kind === 'applied' ? week2.outcome.replayed : true,
    false,
    'the second identical correction was swallowed as a replay — nothing was written',
  )
  assert.equal(seen.size, 2, 'the two corrections shared one idempotency key')
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. A `replayed: true` RESPONSE IS NEVER REPORTED AS APPLIED
// ═════════════════════════════════════════════════════════════════════════════
//
// PROVED FAILABLE: deleted the `if (outcome.replayed)` branch from
// `correctionReason`, so a replay fell through to the success sentence. This
// test went red on both assertions — the reason then said "has already landed"
// and named an applied count for a request that wrote nothing.

test('a replayed response is reported as already-applied, never as a fresh write', () => {
  const replayed = correctionReason(
    { kind: 'applied', body: okBody({ replayed: true }), replayed: true },
    { removed: 0, unpicked: 0 },
  )
  assert.match(replayed, /ALREADY applied/)
  assert.match(replayed, /nothing new was written/)
  assert.doesNotMatch(replayed, /has already landed/, 'a replay was narrated as a fresh write')

  const fresh = correctionReason(
    { kind: 'applied', body: okBody(), replayed: false },
    { removed: 0, unpicked: 0 },
  )
  assert.match(fresh, /has already landed/)
  assert.match(fresh, /batch_1/)
  assert.match(fresh, /1 applied/)
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. COMMIT-THEN-SETTLE ORDERING
// ═════════════════════════════════════════════════════════════════════════════
//
// PROVED FAILABLE: moved `deps.settle(...)` above `await commitCorrection(...)`
// in `runAccept`. This test went red immediately on the recorded order. Invert
// the ordering and the model is told a corrected write landed before anything
// has been sent — the unfalsifiable-in-the-moment failure the whole control
// exists to prevent.

test('Path B commits BEFORE it settles, always', async () => {
  const rec = recorder()
  const result = await runAccept(
    {
      toolCallId: 'call_a7f3',
      held: [{ card_id: 'me05-84', delta: 1 }],
      preview: preview([UNSTATED]),
      choices: choices({ 0: { variantId: 37184 } }),
    },
    { commit: rec.commit(), settle: rec.settle },
  )

  assert.equal(result.path, 'B')
  assert.equal(rec.order.length, 2)
  assert.ok(rec.order[0].startsWith('commit:'), `first side effect was ${rec.order[0]}`)
  assert.equal(rec.order[1], 'settle:denied')
})

test('a lost response is retried once with the SAME key, then reported unconfirmed', async () => {
  // The retry is only safe because the key is scoped to the held call: it
  // either applies or comes back `replayed: true` with the real numbers.
  const keys: string[] = []
  const commit = async (r: CorrectionRequest): Promise<CommitTransport> => {
    keys.push(r.idempotencyKey)
    return { received: false, error: 'Failed to fetch' }
  }
  const verdicts: Verdict[] = []
  const result = await runAccept(
    {
      toolCallId: 'call_a7f3',
      held: [{ card_id: 'me05-84', delta: 1 }],
      preview: preview([UNSTATED]),
      choices: choices({ 0: { variantId: 37184 } }),
    },
    { commit, settle: (v) => verdicts.push(v) },
  )

  assert.equal(keys.length, 2, 'a lost response was not retried')
  assert.equal(keys[0], keys[1], 'the retry used a different key — it could double-write')
  assert.equal(result.path === 'B' ? result.outcome.kind : null, 'unconfirmed')
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0].approved, false)
})

test('a retry that lands is reported applied, with the real numbers', async () => {
  let n = 0
  const commit = async (): Promise<CommitTransport> =>
    ++n === 1
      ? { received: false, error: 'timeout' }
      : { received: true, ok: true, body: okBody({ replayed: true }) }

  const outcome = await commitCorrection(
    { items: [{ variantId: 1, delta: 1 }], source: 's', note: 'n', idempotencyKey: 'k' },
    commit,
  )
  assert.equal(outcome.kind, 'applied')
  assert.equal(outcome.kind === 'applied' ? outcome.replayed : null, true)
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. THE THREE-WAY OUTCOME NEVER ASSERTS AN UNOBSERVED NEGATIVE
// ═════════════════════════════════════════════════════════════════════════════
//
// PROVED FAILABLE: collapsed `unconfirmed` into `failed` in `commitCorrection`
// (returning `{kind:'failed'}` when no response arrived). Both assertions below
// went red — the reason then told the model "NOTHING was written" about a POST
// whose response was merely lost, and `/collection/batch` commits BEFORE it
// responds.

test('a lost response never says "nothing was written"', () => {
  const unconfirmed = correctionReason({ kind: 'unconfirmed', error: 'Failed to fetch' }, { removed: 0, unpicked: 0 })
  assert.match(unconfirmed, /could NOT confirm/)
  assert.doesNotMatch(unconfirmed, /NOTHING was written/, 'asserted a negative nobody observed')
  assert.match(unconfirmed, /do NOT say nothing was written/)

  // A RECEIVED error is different, and may say it — the transaction rolled back
  // or never started, which is a fact.
  const failed = correctionReason({ kind: 'failed', error: 'it failed with 23505' }, { removed: 0, unpicked: 0 })
  assert.match(failed, /NOTHING was written/)
  assert.match(failed, /23505/)
})

test('a thrown error with no evidence of a response is classified unconfirmed', () => {
  assert.deepEqual(transportFromThrown(new Error('Failed to fetch')), {
    received: false,
    error: 'Failed to fetch',
  })
  const withStatus = Object.assign(new Error('Bad Request'), { status: 400 })
  assert.deepEqual(transportFromThrown(withStatus), {
    received: true,
    ok: false,
    error: 'Bad Request',
  })
})

test('an empty batch is never POSTed, and struck-out is a different fact from unpicked', async () => {
  const commit = async (): Promise<CommitTransport> => {
    throw new Error('a batch with nothing in it was sent')
  }

  const allRemoved = await runAccept(
    {
      toolCallId: 'c',
      held: [{ card_id: 'x', delta: 1 }],
      preview: preview([row({ index: 0 })]),
      choices: choices({ 0: { removed: true } }),
    },
    { commit, settle: () => {} },
  )
  assert.equal(allRemoved.path === 'B' ? allRemoved.reason : '', 'The reader removed every row before this ran. Nothing was written and nothing was attempted.')

  const nonePicked = await runAccept(
    {
      toolCallId: 'c',
      held: [{ card_id: 'me05-84', delta: 1 }],
      preview: preview([UNSTATED]),
      choices: choices({ 0: {} }),
    },
    { commit, settle: () => {} },
  )
  assert.match(nonePicked.path === 'B' ? nonePicked.reason : '', /did not pick a printing/)
  assert.doesNotMatch(
    nonePicked.path === 'B' ? nonePicked.reason : '',
    /removed every row/,
    'an unanswered question was narrated as a decision',
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. AN UNEDITED ACCEPT TAKES THE SIGNED PATH, UNCHANGED
// ═════════════════════════════════════════════════════════════════════════════
//
// PROVED FAILABLE: made `isEdited` return `true` unconditionally. This test went
// red on `path === 'A'` and on the commit assertion — the common case would
// have left the proven signed path and started writing from the browser.

test('an unedited accept settles approved:true and issues NO client write', async () => {
  const rec = recorder()
  const result = await runAccept(
    {
      toolCallId: 'call_a7f3',
      held: [{ card_id: 'me05-84', variant_id: 37184, delta: 1 }],
      preview: preview([row({ index: 0, certainty: 'stated', variantId: 37184 })]),
      choices: initialChoices(preview([row({ index: 0 })])),
    },
    {
      commit: async () => {
        throw new Error('Path A must never issue a client batch')
      },
      settle: rec.settle,
    },
  )

  assert.equal(result.path, 'A')
  assert.deepEqual(rec.order, ['settle:approved'])
})

test('a single-printing card needs no question, so it is still Path A', async () => {
  const result = await runAccept(
    {
      toolCallId: 'c',
      held: [{ card_id: 'x', delta: 1 }],
      preview: preview([row({ index: 0, certainty: 'only-one', variantId: 41000 })]),
      choices: choices({ 0: {} }),
    },
    {
      commit: async () => {
        throw new Error('Path A must never issue a client batch')
      },
      settle: () => {},
    },
  )
  assert.equal(result.path, 'A')
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. CLASSIFICATION KEYS ON CANDIDATE COUNT, NOT RESOLUTION STATUS
// ═════════════════════════════════════════════════════════════════════════════
//
// The server half of this is pinned in `packages/agent-tools/src/__tests__/
// resolve.test.ts`. This is the client half: the card must put a silently
// defaulted printing in section 2 and refuse to write it unasked.
//
// PROVED FAILABLE: changed `asksSelection` to key on `row.variantId === null`
// (a resolution-status proxy — an `unstated` row HAS a resolved `variantId`,
// because the server silently picked the primary). Every assertion below went
// red: the row moved to section 1, the router said unedited, and Accept wrote
// the primary printing nobody named.

test('a silently-defaulted printing is a question, not a known row', () => {
  const p = preview([UNSTATED])
  // The row RESOLVED — it carries a variantId, which is what the primary
  // default produced. That is precisely why status is the wrong key.
  assert.equal(UNSTATED.variantId, 37183)
  assert.equal(asksSelection(UNSTATED), true)
  assert.deepEqual(sections(p).known, [])
  assert.deepEqual(sections(p).asking, [UNSTATED])
})

test('an unpicked section-2 row is excluded from the write, and Accept says so', () => {
  const p = preview([UNSTATED, row({ index: 1 })])
  const untouched = choices({ 0: {}, 1: {} })
  assert.equal(acceptCount(p, untouched), 1, 'the button counted a row nobody answered for')
  assert.deepEqual(includedRows(p, untouched).map((r) => r.index), [1])
  assert.deepEqual(resolveBatchItems(p, untouched), [{ variantId: 1001, delta: 1 }])

  const picked = choices({ 0: { variantId: 37184 }, 1: {} })
  assert.equal(acceptCount(p, picked), 2)
  assert.deepEqual(resolveBatchItems(p, picked), [
    { variantId: 37184, delta: 1 },
    { variantId: 1001, delta: 1 },
  ])
})

test('the reader’s pick reaches the batch, and it is not the primary', async () => {
  // The single assertion that proves a pick is not cosmetic.
  let sent: CorrectionRequest | null = null
  await runAccept(
    {
      toolCallId: 'c',
      held: [{ card_id: 'me05-84', delta: 1 }],
      preview: preview([UNSTATED]),
      choices: choices({ 0: { variantId: 37184 } }),
    },
    {
      commit: async (r) => {
        sent = r
        return { received: true, ok: true, body: okBody() }
      },
      settle: () => {},
    },
  )
  assert.deepEqual(sent!.items, [{ variantId: 37184, delta: 1 }])
  assert.notEqual(sent!.items[0].variantId, 37183, 'the primary was written instead of the pick')
})

test('a stated printing on a multi-printing card stays in section 1', () => {
  const stated = row({ index: 0, certainty: 'stated', candidates: [NORMAL, REVERSE], variantId: 37184 })
  assert.equal(asksSelection(stated), false)
  assert.deepEqual(sections(preview([stated])).asking, [])
})

// ── The router, and the cross-check it is not (correction 5) ─────────────────

test('the router reads the reader’s gestures, not a rebuilt list', () => {
  const p = preview([row({ index: 0 }), row({ index: 1 })])
  assert.equal(isEdited(p, choices({ 0: {}, 1: {} })), false)
  assert.equal(isEdited(p, choices({ 0: { removed: true }, 1: {} })), true)
  // A section-2 row is an edit by its mere presence: picked, it adds a
  // variant_id the held call did not have; unpicked, it is excluded.
  assert.equal(isEdited(preview([UNSTATED]), choices({ 0: {} })), true)
  assert.equal(isEdited(preview([UNSTATED]), choices({ 0: { variantId: 37183 } })), true)
})

test('the two derivations must agree, or nothing is sent', () => {
  const p = preview([row({ index: 0 }), row({ index: 1 })])
  const held: HeldItem[] = [{ card_id: 'a', delta: 1 }, { card_id: 'b', delta: 1 }]

  // Agreement, both ways round.
  assert.doesNotThrow(() => assertRouteAgrees(held, p, choices({ 0: {}, 1: {} })))
  assert.doesNotThrow(() => assertRouteAgrees(held, p, choices({ 0: { removed: true }, 1: {} })))

  // A card whose choices claim an edit that the rebuilt batch does not show —
  // the shape a dropped `removed` flag produces. It must THROW, not guess.
  const brokenPreview = preview([{ ...row({ index: 0 }), certainty: 'unstated', candidates: [NORMAL] }])
  assert.throws(
    () =>
      // `acceptedItems` here rebuilds an identical list because the row is
      // included with a variant_id equal to nothing changing — simulated by
      // handing it a held item that already carries the pick.
      assertRouteAgrees([{ card_id: 'a', delta: 1, variant_id: 37183 }], brokenPreview, choices({ 0: { variantId: 37183 } })),
    ApprovalEditError,
  )
})

test('items the planner refused outright are outside the comparison', () => {
  // A malformed item never became a row. `log_cards` skips it server-side
  // either way, so including it in the comparison would make an untouched card
  // look edited and push the common case off the signed path.
  const p = preview([row({ index: 0 }), row({ index: 2 })])
  const held: HeldItem[] = [
    { card_id: 'a', delta: 1 },
    { card_id: 'b', delta: 1, quantity: 2 }, // both delta and quantity — refused
    { card_id: 'c', delta: 1 },
  ]
  assert.equal(isEdited(p, choices({ 0: {}, 2: {} })), false)
  assert.doesNotThrow(() => assertRouteAgrees(held, p, choices({ 0: {}, 2: {} })))
})

// ── The stepper, and the path it forces ──────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE WORST BUG THE STEPPER COULD HAVE HAD, PINNED.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Path A settles the held call `approved: true`, which replays HIS arguments
 * verbatim through the server's own `log_cards`. A router blind to the stepper
 * would therefore take a reader who had visibly changed "+1" to "+4" down the
 * path that writes +1 — and the transcript would then report his number as
 * though it were theirs, which is the exact class of failure this whole
 * round-trip exists to make impossible.
 *
 * MUTATION: drop the `effectiveValue(r, c) !== r.value` clause from `isEdited`
 * and the first assertion goes red. Watched.
 */
test('stepping the amount forces the corrected path, not the replay', () => {
  const p = preview([row({ index: 0 })])
  assert.equal(isEdited(p, choices({ 0: { value: 4 } })), true, 'a stepped row is an edit')
  assert.equal(isEdited(p, choices({ 0: {} })), false, 'an untouched one is not')
  // A value equal to his after clamping is NOT an edit — otherwise a stored
  // choice that happens to match would push the common case off the signed path
  // for no reason.
  assert.equal(isEdited(p, choices({ 0: { value: 1 } })), false)
  assert.equal(isEdited(p, choices({ 0: { value: 0 } })), false, 'clamped back to his 1')
})

/**
 * MUTATION: delete the `if (value !== row.value)` block from `acceptedItems` and
 * the first assertion goes red — the corrected batch would carry his amount
 * while the card showed the reader's.
 *
 * The KEY it writes matters as much as the value: `log_cards` refuses an item
 * carrying both `delta` and `quantity`, so a `quantity` row must never grow a
 * `delta` and vice versa.
 */
test('a stepped row reaches the wire with the reader amount, under the right key', () => {
  const p = preview([row({ index: 0 }), row({ index: 1, mode: 'quantity', value: 2, before: 5, after: 2 })])
  const held: HeldItem[] = [
    { card_id: 'a', delta: 1 },
    { card_id: 'b', quantity: 2 },
  ]
  const got = acceptedItems(held, p, choices({ 0: { value: 4 }, 1: { value: 0 } }))
  assert.deepEqual(got, [
    { index: 0, item: { card_id: 'a', delta: 4 } },
    { index: 1, item: { card_id: 'b', quantity: 0 } },
  ])
  assert.doesNotThrow(() => assertNarrowing(held, p, got))

  // And the resolved batch agrees, because both read `effectiveValue`.
  assert.deepEqual(resolveBatchItems(p, choices({ 0: { value: 4 }, 1: { value: 0 } })), [
    { variantId: 1000, delta: 4 },
    { variantId: 1001, quantity: 0 },
  ])
})

/**
 * MUTATION: change `resolveBatchItems` back to `row.value` and this goes red
 * while the card on screen still shows 4. That is the two-numbers-one-card
 * failure mode in its purest form: everything looks right and the wrong quantity
 * is written.
 */
test('the two derivations agree about a stepped row', () => {
  const p = preview([row({ index: 0 })])
  const held: HeldItem[] = [{ card_id: 'a', delta: 1 }]
  const c = choices({ 0: { value: 7 } })
  assert.doesNotThrow(() => assertRouteAgrees(held, p, c))
  assert.deepEqual(resolveBatchItems(p, c), [{ variantId: 1000, delta: 7 }])
})

// ── Narrowing ────────────────────────────────────────────────────────────────

test('narrowing rejects everything except picking a printing from that row', () => {
  const p = preview([UNSTATED, row({ index: 1 })])
  const held: HeldItem[] = [{ card_id: 'me05-84', delta: 1 }, { card_id: 'b', delta: 3 }]

  // Legal: pick a printing this row actually offers.
  assert.doesNotThrow(() =>
    assertNarrowing(held, p, [{ index: 0, item: { card_id: 'me05-84', delta: 1, variant_id: 37184 } }]),
  )
  // A printing that is not one of THIS row's candidates.
  assert.throws(
    () => assertNarrowing(held, p, [{ index: 0, item: { card_id: 'me05-84', delta: 1, variant_id: 99999 } }]),
    /not one of its candidates/,
  )
  // A card that changed.
  assert.throws(
    () => assertNarrowing(held, p, [{ index: 1, item: { card_id: 'z', delta: 3 } }]),
    /changed something other than its printing or its amount/,
  )
  // A row that was never previewed — an addition.
  assert.throws(() => assertNarrowing(held, p, [{ index: 7, item: { card_id: 'q', delta: 1 } }]), /never previewed/)
  // Out of order, or repeated: not a subsequence.
  assert.throws(
    () =>
      assertNarrowing(held, p, [
        { index: 1, item: { card_id: 'b', delta: 3 } },
        { index: 0, item: { card_id: 'me05-84', delta: 1, variant_id: 37184 } },
      ]),
    /out of order or repeated/,
  )
})

/**
 * THE STEPPER'S HALF OF THE NARROWING CHECK.
 *
 * The rule used to be "every surviving row keeps its operation EXACTLY", which
 * was right for a card with no stepper on it. Now the amount MAY move, and this
 * pins the four ways it may not.
 *
 * MUTATION: delete the whole `── The amount ──` block from `assertNarrowing` and
 * every `throws` below goes green — i.e. the card would be free to send a
 * negative delta for a row the reader was shown as an add, or to change a
 * `delta` row into a `quantity` one. Watched.
 */
test('narrowing lets the amount move, but only inside this row own bounds', () => {
  const p = preview([row({ index: 0 }), row({ index: 1, value: -2, before: 5, after: 3 })])
  const held: HeldItem[] = [
    { card_id: 'a', delta: 1 },
    { card_id: 'b', delta: -2 },
  ]

  // Legal: step an add up, step a removal deeper.
  assert.doesNotThrow(() => assertNarrowing(held, p, [{ index: 0, item: { card_id: 'a', delta: 6 } }]))
  assert.doesNotThrow(() => assertNarrowing(held, p, [{ index: 1, item: { card_id: 'b', delta: -5 } }]))

  // ACROSS ZERO. An add may not become a removal — the confirm button's verb is
  // derived from the sign, so this is a button that changes meaning under the
  // reader's hand between reading it and pressing it.
  assert.throws(
    () => assertNarrowing(held, p, [{ index: 0, item: { card_id: 'a', delta: -1 } }]),
    /outside 1…99 for this row/,
  )
  assert.throws(
    () => assertNarrowing(held, p, [{ index: 1, item: { card_id: 'b', delta: 2 } }]),
    /outside -99…-1 for this row/,
  )
  // Past the ceiling.
  assert.throws(
    () => assertNarrowing(held, p, [{ index: 0, item: { card_id: 'a', delta: 4000 } }]),
    /outside 1…99 for this row/,
  )
  // A fraction — the server's zod schema rejects it, and no control here can
  // produce one, so its arrival means something upstream is wrong.
  assert.throws(
    () => assertNarrowing(held, p, [{ index: 0, item: { card_id: 'a', delta: 1.5 } }]),
    /non-integer delta/,
  )
  // SWAPPING WHICH KIND OF AMOUNT THE ROW CARRIES. `log_cards` refuses an item
  // holding both, so this would be a row that silently stopped applying.
  assert.throws(
    () => assertNarrowing(held, p, [{ index: 0, item: { card_id: 'a', delta: 1, quantity: 4 } }]),
    /changed which kind of amount it carries/,
  )
})

test('a stated printing may not be overridden', () => {
  const stated = row({ index: 0, certainty: 'stated', candidates: [NORMAL, REVERSE], variantId: 37183 })
  assert.throws(
    () =>
      assertNarrowing([{ card_id: 'a', delta: 1, variant_id: 37183 }], preview([stated]), [
        { index: 0, item: { card_id: 'a', delta: 1, variant_id: 37184 } },
      ]),
    /overrode a stated printing/,
  )
})

test('acceptedItems keeps index alignment when rows are dropped from the middle', () => {
  const p = preview([row({ index: 0 }), row({ index: 1 }), row({ index: 2 })])
  const held: HeldItem[] = [{ card_id: 'a' }, { card_id: 'b' }, { card_id: 'c' }]
  const got = acceptedItems(held, p, choices({ 0: {}, 1: { removed: true }, 2: {} }))
  assert.deepEqual(got, [
    { index: 0, item: { card_id: 'a' } },
    { index: 2, item: { card_id: 'c' } },
  ])
  assert.doesNotThrow(() => assertNarrowing(held, p, got))
})

// ── Canonical JSON ───────────────────────────────────────────────────────────

test('canonicalJSON is key-order blind, at every depth', () => {
  assert.equal(
    canonicalJSON({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }),
    canonicalJSON({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
  )
  assert.notEqual(canonicalJSON({ a: 1 }), canonicalJSON({ a: '1' }))
  assert.equal(canonicalJSON({ a: 1, b: undefined }), canonicalJSON({ a: 1 }))
  assert.equal(canonicalJSON([1, 2]), '[1,2]')
  assert.equal(canonicalJSON(null), 'null')
})

test('batchContent is order-independent and mode-distinguishing', () => {
  assert.equal(
    batchContent([{ variantId: 2, delta: 1 }, { variantId: 1, delta: 2 }]),
    batchContent([{ variantId: 1, delta: 2 }, { variantId: 2, delta: 1 }]),
  )
  assert.notEqual(batchContent([{ variantId: 1, quantity: 0 }]), batchContent([{ variantId: 1, delta: 0 }]))
})

// ── The reason, capped ───────────────────────────────────────────────────────

test('a large corrected batch does not become a multi-kilobyte tool result', () => {
  const many = okBody({
    applied: 40,
    items: Array.from({ length: 40 }, (_, i) => ({
      variantId: i,
      cardId: `c-${i}`,
      before: 0,
      after: 1,
      clamped: false,
    })),
  })
  const reason = correctionReason({ kind: 'applied', body: many, replayed: false }, { removed: 0, unpicked: 0 })
  assert.match(reason, /and 32 more — batch batch_1 has the full list/)
  assert.ok(reason.length < 900, `reason was ${reason.length} chars`)
})

test('the Accept button names the operation, and its count tracks the picks', () => {
  // The last thing read before a write is authorised. "Add 3 cards" on a batch
  // that sets three quantities to zero is the shape of press somebody regrets.
  const adds = preview([row({ index: 0 }), row({ index: 1 })])
  assert.equal(acceptButtonLabel(adds, choices({ 0: {}, 1: {} })), 'Add 2 cards')
  assert.equal(acceptButtonLabel(adds, choices({ 0: { removed: true }, 1: {} })), 'Add 1 card')
  assert.equal(acceptButtonLabel(adds, choices({ 0: { removed: true }, 1: { removed: true } })), 'Nothing to add')

  const removes = preview([row({ index: 0, value: -1 })])
  assert.equal(acceptButtonLabel(removes, choices({ 0: {} })), 'Remove 1 card')

  const sets = preview([row({ index: 0, mode: 'quantity', value: 0 })])
  assert.equal(acceptButtonLabel(sets, choices({ 0: {} })), 'Apply 1 change')

  const mixed = preview([row({ index: 0 }), row({ index: 1, value: -2 })])
  assert.equal(acceptButtonLabel(mixed, choices({ 0: {}, 1: {} })), 'Apply 2 changes')

  // And an unpicked printing is not counted, because it is not written.
  const withQuestion = preview([UNSTATED, row({ index: 1 })])
  assert.equal(acceptButtonLabel(withQuestion, choices({ 0: {}, 1: {} })), 'Add 1 card')
  assert.equal(acceptButtonLabel(withQuestion, choices({ 0: { variantId: 37184 }, 1: {} })), 'Add 2 cards')
})

test('the reason distinguishes removed rows from unpicked ones', () => {
  const reason = correctionReason({ kind: 'applied', body: okBody(), replayed: false }, { removed: 2, unpicked: 1 })
  assert.match(reason, /2 row\(s\) they removed/)
  assert.match(reason, /1 row\(s\) whose printing they did not pick/)
})
