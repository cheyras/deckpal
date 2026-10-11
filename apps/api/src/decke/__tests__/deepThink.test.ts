import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEEP_GRANT_TTL_MS,
  DEEP_HOLD_MULTIPLIER,
  DEEP_OFFER_TTL_MS,
  DEEP_THINK_TOOL,
  approvedDeepPart,
  deepApprovalLeg,
  deepAvailableCredits,
  deepGrantThisTurn,
  deepRoute,
  deepThinkAnsweredThisTurn,
  deepThinkNote,
  deepThinkPricing,
  deepThinkResult,
  deepThinkScope,
  estimateCredits,
  grantFromOutput,
  mintDeepGrant,
  mintDeepOffer,
  settleDeepDecision,
  turnDecision,
  verifyDeepGrant,
} from '../deepThink.js'
import { readRouteEcho } from '../routeEcho.js'
import type { TierDecision } from '../tiers.js'

const SECRET = 'test-only-deep-think-secret'
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)
const INPUT = { why: 'Worth a real matchup read.', plan: 'Replay the turns and compare lines.' }
const QUESTION = 'Review my season'

type Part = Record<string, unknown>
type Message = { role: string; parts: Part[] }

const user = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }] })
const scopeOf = (messages: unknown, over: Partial<{ userId: string; conversationId: string; exchangeId: string }> = {}) =>
  deepThinkScope({ userId: 'user-1', conversationId: 'conv_12345678', exchangeId: 'ex-1', messages, ...over })!

/** The approval leg exactly as the browser sends it: the yes is the last part of the final message. */
function approvalLeg(o: {
  approved?: boolean
  offer?: string | null
  approvalId?: string
  toolCallId?: string
  signature?: string | null
  question?: string
  after?: Part[]
} = {}): Message[] {
  return [
    user(o.question ?? QUESTION),
    {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'This one deserves Deep Think.' },
        {
          type: `tool-${DEEP_THINK_TOOL}`,
          toolCallId: o.toolCallId ?? 'deep-1',
          input: INPUT,
          state: 'approval-responded',
          approval: {
            id: o.approvalId ?? 'approval-1',
            approved: o.approved ?? true,
            ...(o.signature === null ? {} : { signature: o.signature ?? 'sdk-signature' }),
          },
          ...(o.offer === null || o.offer === undefined ? {} : { deepOffer: o.offer }),
        },
        ...(o.after ?? []),
      ],
    },
  ]
}

/** An approval leg whose offer was minted for its own turn, as `chat.mjs` does. */
function signedApprovalLeg(o: Parameters<typeof approvalLeg>[0] = {}): Message[] {
  const offer = mintDeepOffer(SECRET, scopeOf([user(o?.question ?? QUESTION)]), {
    toolCallId: o?.toolCallId ?? 'deep-1',
    approvalId: o?.approvalId ?? 'approval-1',
  }, NOW)
  return approvalLeg({ ...o, offer })
}

const decision = (tier: TierDecision['tier'], pathways: TierDecision['pathways'] = ['battle_review']): TierDecision => ({
  tier,
  pathways,
  effort: tier === 'deep' ? 'high' : 'medium',
  reasons: ['floor:battle_review', ...(tier === 'deep' ? ['approved:deep'] : [])],
})

const V1 = { enabled: true, microUsdPerCredit: 10_000, markupBps: 0, estimatedMicroUsd: { chatTurn: 1, analysis: 1, planDeck: 1 }, lowBalance: 100 }
const V2 = { version: 2 as const, enabled: true, microUsdPerCredit: 10_000, markupBps: 0, lowBalance: 100, legHoldCredits: 25, legHoldMinCredits: 3, overageBufferMaxCredits: 50 }

// ── WHO MAY HAVE IT ─────────────────────────────────────────────────────────

test('only metered credits carry Deep Think: paid prices it, unlimited runs it, the rest never see it', () => {
  assert.equal(deepThinkPricing({ policy: V2 }), 'paid')
  assert.equal(deepThinkPricing({ policy: V2, unlimited: true }), 'unlimited')
  assert.equal(deepThinkPricing({ policy: { ...V2, enabled: false }, unlimited: true }), 'unlimited')
  assert.equal(deepThinkPricing({ policy: { ...V2, enabled: false } }), null, 'daily allowance / credits off')
  assert.equal(deepThinkPricing({ policy: V1 }), null, 'flat v1 pricing')
  assert.equal(deepThinkPricing({ policy: { ...V1, enabled: false } }), null, 'v1 credits off')
  assert.equal(deepThinkPricing({ policy: V1, unlimited: true }), null, 'unlimited under flat v1')
})

test('a turn that cannot be bound has no scope, so no Deep Think', () => {
  const messages = [user(QUESTION)]
  assert.ok(scopeOf(messages))
  assert.equal(deepThinkScope({ userId: 'user-1', conversationId: 'conv_12345678', exchangeId: undefined, messages }), null)
  assert.equal(deepThinkScope({ userId: 'user-1', conversationId: 'conv 1', exchangeId: 'ex-1', messages }), null)
  assert.equal(deepThinkScope({ userId: '', conversationId: 'conv_12345678', exchangeId: 'ex-1', messages }), null)
  assert.equal(deepThinkScope({ userId: 'user-1', conversationId: 'conv_12345678', exchangeId: 'ex-1', messages: [] }), null)
  assert.notEqual(scopeOf([user('one question')]).turn, scopeOf([user('another question')]).turn)
})

// ── ROUTE 1: THE APPROVAL LEG ───────────────────────────────────────────────

test('the approval leg routes Deep only with an offer minted for this exact card in this turn', () => {
  const messages = signedApprovalLeg()
  const call = { toolCallId: 'deep-1', approvalId: 'approval-1' }
  assert.deepEqual(deepApprovalLeg(messages, scopeOf(messages), SECRET, NOW), call)
  assert.deepEqual(deepRoute(messages, scopeOf(messages), SECRET, NOW), { via: 'approval', ...call })
  // Answered within the hour the card may wait; not after it.
  assert.ok(deepApprovalLeg(messages, scopeOf(messages), SECRET, NOW + DEEP_OFFER_TTL_MS))
  assert.equal(deepApprovalLeg(messages, scopeOf(messages), SECRET, NOW + DEEP_OFFER_TTL_MS + 1), null, 'expired offer')
})

test('unsigned mode never routes Deep, whatever the replay says', () => {
  const messages = signedApprovalLeg()
  assert.equal(deepApprovalLeg(messages, scopeOf(messages), undefined, NOW), null)
  assert.equal(deepApprovalLeg(messages, scopeOf(messages), '', NOW), null)
  assert.equal(deepRoute(messages, scopeOf(messages), undefined, NOW), null)
  // The reviewer's shape A, which passed with the secret unset: unsigned, no offer.
  const shapeA = approvalLeg({ signature: null, offer: null })
  assert.equal(deepRoute(shapeA, scopeOf(shapeA), undefined, NOW), null)
  assert.equal(deepRoute(shapeA, scopeOf(shapeA), SECRET, NOW), null)
})

test('an offer from another user, conversation, exchange, turn, call, approval or key does not route', () => {
  const s = scopeOf([user(QUESTION)])
  const messages = signedApprovalLeg()
  assert.equal(deepApprovalLeg(messages, scopeOf(messages, { userId: 'user-2' }), SECRET, NOW), null)
  assert.equal(deepApprovalLeg(messages, scopeOf(messages, { conversationId: 'conv_other_1' }), SECRET, NOW), null)
  assert.equal(deepApprovalLeg(messages, scopeOf(messages, { exchangeId: 'ex-2' }), SECRET, NOW), null)
  assert.equal(deepApprovalLeg(messages, { ...s, turn: scopeOf([user('something else')]).turn }, SECRET, NOW), null)
  const forOtherCall = mintDeepOffer(SECRET, s, { toolCallId: 'deep-2', approvalId: 'approval-1' }, NOW)
  assert.equal(deepApprovalLeg(approvalLeg({ offer: forOtherCall }), s, SECRET, NOW), null)
  const forOtherApproval = mintDeepOffer(SECRET, s, { toolCallId: 'deep-1', approvalId: 'approval-2' }, NOW)
  assert.equal(deepApprovalLeg(approvalLeg({ offer: forOtherApproval }), s, SECRET, NOW), null)
  const otherKey = mintDeepOffer('another-secret', s, { toolCallId: 'deep-1', approvalId: 'approval-1' }, NOW)
  assert.equal(deepApprovalLeg(approvalLeg({ offer: otherKey }), s, SECRET, NOW), null)
  assert.equal(deepApprovalLeg(approvalLeg({ offer: null }), s, SECRET, NOW), null, 'no offer at all')
  assert.equal(deepApprovalLeg(approvalLeg({ offer: 'dt1.0.forged' }), s, SECRET, NOW), null)
})

test("an old turn's genuine approval, moved after the latest reader message, does not route", () => {
  // Turn 1 really raised and approved a card: its offer verifies for turn 1.
  const oldTurn = signedApprovalLeg({ approvalId: 'approval-old', toolCallId: 'deep-old' })
  assert.ok(deepApprovalLeg(oldTurn, scopeOf(oldTurn), SECRET, NOW))
  const oldPart = oldTurn[1]!.parts[1]!
  // Replayed at the very END of a new turn's final message — the one place the
  // SDK validates it, and where its HMAC (over the call, not the turn) passes.
  const replayed: Message[] = [
    ...oldTurn,
    user('What is this card worth?'),
    { role: 'assistant', parts: [{ type: 'text', text: 'Let me look.' }, oldPart] },
  ]
  assert.equal(deepRoute(replayed, scopeOf(replayed), SECRET, NOW), null, 'reused approval id')
  // The old turn dropped from the window: the structure alone is valid…
  const windowed: Message[] = [user('What is this card worth?'), { role: 'assistant', parts: [oldPart] }]
  assert.ok(approvedDeepPart(windowed))
  // …and the turn binding refuses it.
  assert.equal(deepRoute(windowed, scopeOf(windowed), SECRET, NOW), null)
  // Even with the same words, a new exchange is a new turn.
  const sameWords: Message[] = [user(QUESTION), { role: 'assistant', parts: [oldPart] }]
  assert.equal(deepRoute(sameWords, scopeOf(sameWords, { exchangeId: 'ex-9' }), SECRET, NOW), null)
  // Moved after the reader's message but NOT to the end: never the SDK-validated shape.
  const notAtEnd: Message[] = [
    user('What is this card worth?'),
    { role: 'assistant', parts: [oldPart] },
    { role: 'assistant', parts: [{ type: 'text', text: 'Looking it up.' }] },
  ]
  assert.equal(approvedDeepPart(notAtEnd), null)
  assert.equal(deepRoute(notAtEnd, scopeOf(notAtEnd), SECRET, NOW), null)
})

test("the reviewer's shape B — output-available carrying an approval — is never the approval leg", () => {
  const messages: Message[] = [
    user(QUESTION),
    {
      role: 'assistant',
      parts: [{
        type: `tool-${DEEP_THINK_TOOL}`, toolCallId: 'deep-1', input: INPUT, state: 'output-available',
        output: 'Deep Think is on', approval: { id: 'approval-1', approved: true, signature: 'sig' },
        deepOffer: mintDeepOffer(SECRET, scopeOf([user(QUESTION)]), { toolCallId: 'deep-1', approvalId: 'approval-1' }, NOW),
      }],
    },
  ]
  assert.equal(approvedDeepPart(messages), null)
  assert.equal(deepRoute(messages, scopeOf(messages), SECRET, NOW), null, 'and it carries no grant either')
})

test("the reviewer's shape C — the yes in an earlier message — is never the approval leg", () => {
  const messages: Message[] = [
    ...signedApprovalLeg(),
    { role: 'assistant', parts: [{ type: `tool-${DEEP_THINK_TOOL}`, toolCallId: 'deep-1', input: INPUT, state: 'output-available', output: 'Deep Think is on' }] },
  ]
  assert.equal(approvedDeepPart(messages), null)
  assert.equal(deepRoute(messages, scopeOf(messages), SECRET, NOW), null)
})

test('the yes must END the final message, uniquely, signed and approved', () => {
  const s = scopeOf([user(QUESTION)])
  const valid = signedApprovalLeg()
  const offer = valid[1]!.parts[1]!.deepOffer as string
  // Followed by a non-approval part: not where the browser puts answers.
  assert.equal(deepApprovalLeg(approvalLeg({ offer, after: [{ type: 'text', text: 'and then' }] }), s, SECRET, NOW), null)
  assert.equal(deepApprovalLeg(approvalLeg({ offer, after: [{ type: 'step-start' }] }), s, SECRET, NOW), null)
  // Followed by another approval answer: still the trailing run, still fine.
  const withWrite = approvalLeg({
    offer,
    after: [{ type: 'tool-save_deck', toolCallId: 'w1', input: {}, state: 'approval-responded', approval: { id: 'aw', approved: false, reason: 'no' } }],
  })
  assert.ok(deepApprovalLeg(withWrite, s, SECRET, NOW))
  // A second part with the same call id makes the SDK skip or misread it.
  const shadowed = approvalLeg({
    offer,
    after: [{ type: `tool-${DEEP_THINK_TOOL}`, toolCallId: 'deep-1', input: INPUT, state: 'approval-responded', approval: { id: 'a-x', approved: false, reason: 'x' } }],
  })
  assert.equal(deepApprovalLeg(shadowed, s, SECRET, NOW), null)
  // The same approval id elsewhere: the SDK resolves ids last-one-wins.
  const reused: Message[] = [
    user('earlier'),
    { role: 'assistant', parts: [{ type: 'tool-log_cards', toolCallId: 'w0', input: {}, state: 'output-available', output: 'ok', approval: { id: 'approval-1', approved: true, signature: 's' } }] },
    ...valid,
  ]
  assert.equal(deepApprovalLeg(reused, s, SECRET, NOW), null)
  assert.equal(deepApprovalLeg(approvalLeg({ offer, approved: false }), s, SECRET, NOW), null, 'a decline')
  assert.equal(deepApprovalLeg(approvalLeg({ offer, signature: null }), s, SECRET, NOW), null, 'an unsigned yes')
  assert.equal(deepApprovalLeg([user(QUESTION)], s, SECRET, NOW), null)
  assert.equal(deepApprovalLeg([...valid, user('next')], s, SECRET, NOW), null, 'the final message is the reader')
  assert.equal(deepApprovalLeg(null, s, SECRET, NOW), null)
})

// ── ROUTE 2: A LATER LEG OF THE SAME TURN ───────────────────────────────────

/** A later leg: the approved call has become its finished result, carrying the grant. */
function laterLeg(output: unknown, question = QUESTION): Message[] {
  return [
    user(question),
    {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'This one deserves Deep Think.' },
        { type: `tool-${DEEP_THINK_TOOL}`, toolCallId: 'deep-1', input: INPUT, state: 'output-available', output },
      ],
    },
    { role: 'assistant', parts: [{ type: 'tool-goTo', toolCallId: 'g1', input: { to: '/decks' }, state: 'output-available', output: { ok: true } }] },
  ]
}

test('a later leg routes Deep only with a live grant minted for this turn', () => {
  const s = scopeOf([user(QUESTION)])
  const result = deepThinkResult({ grant: mintDeepGrant(SECRET, s, NOW) })
  // The browser replays the output as a bounded JSON string; an object is read too.
  for (const output of [JSON.stringify(result), result]) {
    const messages = laterLeg(output)
    assert.equal(deepGrantThisTurn(messages, scopeOf(messages), SECRET, NOW + 60_000), true)
    assert.deepEqual(deepRoute(messages, scopeOf(messages), SECRET, NOW + 60_000), { via: 'grant' })
  }
  const messages = laterLeg(JSON.stringify(result))
  assert.equal(deepGrantThisTurn(messages, scopeOf(messages), SECRET, NOW + DEEP_GRANT_TTL_MS), true)
  assert.equal(deepGrantThisTurn(messages, scopeOf(messages), SECRET, NOW + DEEP_GRANT_TTL_MS + 1), false, 'expired grant')
  assert.equal(deepGrantThisTurn(messages, scopeOf(messages), SECRET, NOW - 2 * 60_000), false, 'issued in the future')
  assert.equal(deepGrantThisTurn(messages, scopeOf(messages), undefined, NOW), false, 'unsigned mode')
})

test('a grant from another exchange, user, conversation or turn does not route', () => {
  const s = scopeOf([user(QUESTION)])
  const messages = laterLeg(JSON.stringify(deepThinkResult({ grant: mintDeepGrant(SECRET, s, NOW) })))
  assert.equal(deepGrantThisTurn(messages, scopeOf(messages, { exchangeId: 'ex-2' }), SECRET, NOW), false)
  assert.equal(deepGrantThisTurn(messages, scopeOf(messages, { userId: 'user-2' }), SECRET, NOW), false)
  assert.equal(deepGrantThisTurn(messages, scopeOf(messages, { conversationId: 'conv_other_1' }), SECRET, NOW), false)
  // The same grant carried into the reader's NEXT message is a new turn.
  const nextTurn = laterLeg(JSON.stringify(deepThinkResult({ grant: mintDeepGrant(SECRET, s, NOW) })), 'And the next thing?')
  assert.equal(deepGrantThisTurn(nextTurn, scopeOf(nextTurn), SECRET, NOW), false)
  // A grant left in an earlier turn's history is not this turn's.
  const earlier = [...messages, user('Thanks — now what?')]
  assert.equal(deepGrantThisTurn(earlier, scopeOf(earlier), SECRET, NOW), false)
})

test('forged, tampered and off results carry no grant', () => {
  const s = scopeOf([user(QUESTION)])
  const grant = mintDeepGrant(SECRET, s, NOW)
  const tampered = grant.slice(0, -2) + (grant.endsWith('AA') ? 'BB' : 'AA')
  for (const output of [
    'Deep Think is on',
    JSON.stringify({ status: 'on', grant: tampered }),
    JSON.stringify({ status: 'on', grant: mintDeepGrant('another-secret', s, NOW) }),
    JSON.stringify({ status: 'off', grant }),
    JSON.stringify(deepThinkResult({ off: 'balance' })),
    { status: 'on' },
    null,
  ]) {
    const messages = laterLeg(output)
    assert.equal(deepGrantThisTurn(messages, scopeOf(messages), SECRET, NOW), false, JSON.stringify(output))
  }
  assert.equal(verifyDeepGrant(SECRET, s, grant, NOW), true)
  assert.equal(grantFromOutput(JSON.stringify(deepThinkResult({ grant }))), grant)
  assert.equal(grantFromOutput('{not json'), null)
  // A grant in an errored part is not a result.
  const errored = laterLeg(JSON.stringify(deepThinkResult({ grant })))
  errored[1]!.parts[1]!.state = 'output-error'
  assert.equal(deepGrantThisTurn(errored, scopeOf(errored), SECRET, NOW), false)
})

test('any Deep Think answer in this turn — yes or no — closes the offer for the rest of it', () => {
  assert.equal(deepThinkAnsweredThisTurn(signedApprovalLeg()), true)
  assert.equal(deepThinkAnsweredThisTurn(approvalLeg({ approved: false })), true)
  assert.equal(deepThinkAnsweredThisTurn(laterLeg('x')), true)
  assert.equal(deepThinkAnsweredThisTurn([user(QUESTION)]), false)
  assert.equal(deepThinkAnsweredThisTurn([...laterLeg('x'), user('a new question')]), false)
  assert.equal(deepThinkAnsweredThisTurn(null), false)
})

// ── PRICE AND THE BALANCE FLOOR ─────────────────────────────────────────────

test('credit estimates are server-owned pathway bands and mixed work uses the larger band', () => {
  assert.deepEqual(estimateCredits(['battle_log']), { low: 40, high: 120 })
  assert.deepEqual(estimateCredits(['battle_review']), { low: 40, high: 120 })
  assert.deepEqual(estimateCredits(['deck_build']), { low: 60, high: 180 })
  assert.deepEqual(estimateCredits(['battle_review', 'deck_build']), { low: 60, high: 180 })
  assert.deepEqual(estimateCredits([]), { low: 40, high: 120 })
  assert.equal(DEEP_HOLD_MULTIPLIER, 8)
})

test('spendable credits are the hold plus what is left after it; unreadable is nothing', () => {
  assert.equal(deepAvailableCredits({ heldCredits: 200, balance: '35.500000000000' }), 235)
  assert.equal(deepAvailableCredits({ heldCredits: 12, balance: '0' }), 12)
  assert.equal(deepAvailableCredits({ heldCredits: 12 }), 0)
  assert.equal(deepAvailableCredits({}), 0)
})

test('a paid reader below the HIGH estimate answers on Standard and is told why', () => {
  // ~45 credits: admitted (min 3), cap ≈ 45, but one worst-case Opus step is
  // ~64 credits of output alone — the overage buffer would pay the rest.
  const short = settleDeepDecision({ decision: decision('deep'), pricing: 'paid', admission: { heldCredits: 45, balance: '0' }, answeredYes: true })
  assert.equal(short.decision.tier, 'standard')
  assert.equal(short.decision.effort, 'medium')
  assert.ok(short.decision.reasons.includes('deep:short_balance'))
  assert.ok(!short.decision.reasons.includes('approved:deep'))
  assert.equal(short.off, 'balance')
  assert.deepEqual(short.credits, { available: 45, needed: 120 })
  assert.match(deepThinkNote('balance', short.credits), /needs about 120 credits and you have 45/)
  // Just under the high end is still short; the low end never admits.
  assert.equal(settleDeepDecision({ decision: decision('deep'), pricing: 'paid', admission: { heldCredits: 119, balance: '0' }, answeredYes: true }).decision.tier, 'standard')
  assert.equal(settleDeepDecision({ decision: decision('deep'), pricing: 'paid', admission: { heldCredits: 40, balance: '0' }, answeredYes: true }).decision.tier, 'standard')

  // 200 held + 20 left, and exactly the high end, both run Deep.
  const enough = settleDeepDecision({ decision: decision('deep'), pricing: 'paid', admission: { heldCredits: 200, balance: '20' }, answeredYes: true })
  assert.equal(enough.decision.tier, 'deep')
  assert.equal(enough.off, null)
  assert.equal(settleDeepDecision({ decision: decision('deep'), pricing: 'paid', admission: { heldCredits: 120, balance: '0' }, answeredYes: true }).decision.tier, 'deep')
  // A deck build's band has a higher floor.
  const build = settleDeepDecision({ decision: decision('deep', ['deck_build']), pricing: 'paid', admission: { heldCredits: 150, balance: '0' }, answeredYes: true })
  assert.equal(build.decision.tier, 'standard')
  assert.deepEqual(build.credits, { available: 150, needed: 180 })
})

test('an unlimited account has no balance floor; a yes that did not route is said out loud', () => {
  const unlimited = settleDeepDecision({ decision: decision('deep'), pricing: 'unlimited', admission: { heldCredits: 0 }, answeredYes: true })
  assert.equal(unlimited.decision.tier, 'deep')
  assert.equal(unlimited.off, null)
  const unrouted = settleDeepDecision({ decision: decision('standard'), pricing: 'paid', admission: {}, answeredYes: true })
  assert.equal(unrouted.decision.tier, 'standard')
  assert.equal(unrouted.off, 'unavailable')
  assert.match(deepThinkNote('unavailable'), /couldn't start/)
  const plain = settleDeepDecision({ decision: decision('standard'), pricing: 'paid', admission: {}, answeredYes: false })
  assert.equal(plain.off, null)
  const ineligible = settleDeepDecision({ decision: decision('standard'), pricing: null, admission: {}, answeredYes: true })
  assert.equal(ineligible.off, null)
})

test('the tool result tells Opus to assume rather than ask, and an off result never carries a grant', () => {
  const on = deepThinkResult({ grant: 'g' })
  assert.equal(on.status, 'on')
  assert.match(on.note, /cannot ask the reader/)
  assert.match(on.note, /state the assumption/)
  const off = deepThinkResult({ off: 'unavailable' })
  assert.equal(off.status, 'off')
  assert.equal('grant' in off, false)
  assert.match(off.note, /do not offer Deep Think again this turn/)
})

// ── DEEP OUTRANKS THE ROUTE ECHO ────────────────────────────────────────────
//
// The approval leg and every grant leg are continuations, so the browser sends
// the first leg's Quick/Standard echo on them. Read the other way round, the
// turn would run Standard while holding 8× credits.

test('a Deep route outranks the echo: the approval leg with a Quick echo, a grant leg with a Standard echo', () => {
  const triaged: boolean[] = []
  const decide = (deepApproved: boolean): TierDecision => {
    triaged.push(deepApproved)
    return decision(deepApproved ? 'deep' : 'quick')
  }
  const quick = readRouteEcho({ tier: 'quick', pathways: ['battle_review'], effort: 'medium' })!
  const standard = readRouteEcho({ tier: 'standard', pathways: ['deck_build', 'research'], effort: 'medium' })!

  const approvalLeg = turnDecision({ deep: true, echo: quick, firstLeg: false, decide })
  assert.equal(approvalLeg.tier, 'deep')
  assert.equal(approvalLeg.effort, 'high')
  assert.deepEqual(approvalLeg.pathways, ['battle_review'], 'the turn keeps the pathways its first leg chose')
  assert.ok(approvalLeg.reasons.includes('approved:deep'))

  const grantLeg = turnDecision({ deep: true, echo: standard, firstLeg: false, decide })
  assert.equal(grantLeg.tier, 'deep')
  assert.deepEqual(grantLeg.pathways, ['deck_build', 'research'])
  // …and its price band follows those pathways.
  assert.deepEqual(estimateCredits(grantLeg.pathways), { low: 60, high: 180 })
  assert.deepEqual(triaged, [], 'triage was skipped with an echo, as the harness requires')

  // A Deep route with no echo (an older browser) decides through triage, Deep.
  assert.equal(turnDecision({ deep: true, echo: null, firstLeg: false, decide }).tier, 'deep')
  assert.deepEqual(triaged, [true])
})

test('without a Deep route the harness rule stands, and an echo can never carry Deep', () => {
  const decide = (deepApproved: boolean): TierDecision => decision(deepApproved ? 'deep' : 'quick')
  const quick = readRouteEcho({ tier: 'quick', pathways: ['small_talk'], effort: 'high' })!
  const reused = turnDecision({ deep: false, echo: quick, firstLeg: false, decide })
  assert.equal(reused.tier, 'quick')
  assert.equal(reused.effort, 'low', 'the echoed effort is re-derived, never trusted')
  assert.deepEqual(reused.reasons, ['echo'])
  // A continuation with no usable echo is floored at Standard; a first leg is not.
  assert.equal(turnDecision({ deep: false, echo: null, firstLeg: false, decide }).tier, 'standard')
  assert.equal(turnDecision({ deep: false, echo: null, firstLeg: true, decide }).tier, 'quick')
  // `tier: 'deep'` is not a valid echo, so it can only ever arrive as null.
  assert.equal(readRouteEcho({ tier: 'deep', pathways: ['battle_review'], effort: 'high' }), null)
  assert.equal(turnDecision({ deep: false, echo: readRouteEcho({ tier: 'deep', pathways: ['battle_review'], effort: 'high' }), firstLeg: false, decide }).tier, 'standard')
})
