/**
 * Deep Think: the one way a Deck-E request reaches Claude Opus 5.5.
 *
 * ── WHO MAY HAVE IT ─────────────────────────────────────────────────────────
 *
 * Only a deployment that SIGNS approvals (`DECKE_APPROVAL_SECRET`, see
 * `gate.ts`), and only a request whose credits are metered: a paid wallet, or
 * an unlimited account (which gets no price line). The daily allowance,
 * credits off and every flat v1 policy never see the tool, the offer or the
 * route.
 *
 * ── HOW A REQUEST BECOMES DEEP ──────────────────────────────────────────────
 *
 * Two ways, and nothing else. Both are read before admission, because they
 * size the credit hold (`DEEP_HOLD_MULTIPLIER`):
 *
 *   1. THE APPROVAL LEG (`deepApprovalLeg`). The final message ends with an
 *      `approval-responded`, `approved: true` `deep_think` part. That is the
 *      exact shape ai@7.0.113 validates before any tool or model work:
 *      `collectToolApprovals` reads approvals only from the final model
 *      message (the last block of the final UI message) and skips one whose
 *      call already has a result there; `validateApprovedToolApprovals` then
 *      checks the HMAC over approval id, call id, tool name and input and
 *      throws before any model call. An `output-available` part that carries
 *      an approval, or an approval in an earlier message, is never validated by
 *      the SDK, so it is never authority here either.
 *      The SDK's HMAC covers the CALL, not the turn: a genuinely signed
 *      approval from an older turn would verify again. So the approved part
 *      must also carry the OFFER token this server minted when it raised that
 *      exact card (`mintDeepOffer`), bound to this user, conversation,
 *      exchange (the browser's per-turn id), the reader's latest message, the
 *      call id and the approval id.
 *   2. A LATER LEG OF THE SAME TURN (`deepGrantThisTurn`). `deep_think`'s
 *      execute runs only after the SDK has accepted the signed approval, and
 *      only then mints a GRANT (`mintDeepGrant`): an HMAC over the same user,
 *      conversation, exchange and latest message, valid for
 *      `DEEP_GRANT_TTL_MS`. The browser replays that output on the turn's later
 *      legs. A grant from another turn, user or conversation, a tampered one or
 *      an expired one does not verify.
 *
 * Both tokens are HMAC-SHA256 under a key derived from `DECKE_APPROVAL_SECRET`
 * and compared in constant time; neither can be made without the secret.
 * Without the secret there is no Deep Think at all.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { isMetered, type CreditPolicy } from '../credits/policy.js'
import type { PathwayName } from './pathways/names.js'
import { decisionFromEcho, type RouteEcho } from './routeEcho.js'
import { continuationFloor, effortFor, type TierDecision } from './tiers.js'

export const DEEP_THINK_TOOL = 'deep_think'

/** Today's ordinary leg hold is 25 credits, so Deep Think reserves up to 200. */
export const DEEP_HOLD_MULTIPLIER = 8

/** How long one approval keeps a turn on Opus across its later legs. */
export const DEEP_GRANT_TTL_MS = 15 * 60_000

/**
 * How long a raised card may wait for its answer. Longer than the grant: a
 * reader may read the plan and come back. It is bound to the turn anyway.
 */
export const DEEP_OFFER_TTL_MS = 60 * 60_000

/** Clock skew tolerated on a token's issue time. */
const FUTURE_SKEW_MS = 60_000

export type DeepThinkPricing = 'paid' | 'unlimited'

/**
 * Whether this request's credits can carry Deep Think, from the frozen policy.
 * `paid` prices it (estimate, balance floor, larger hold); `unlimited` runs it
 * without a price line; everything else — v2 daily or credits off, and every
 * flat v1 policy — is null and is never offered it.
 */
export function deepThinkPricing(quote: { policy: CreditPolicy; unlimited?: boolean }): DeepThinkPricing | null {
  if (!isMetered(quote.policy)) return null
  if (quote.unlimited === true) return 'unlimited'
  return quote.policy.enabled ? 'paid' : null
}

/** The reader's turn, as the tokens bind it. */
export type DeepThinkScope = {
  userId: string
  conversationId: string
  exchangeId: string
  /** Digest of the reader's latest message: a new message is a new turn. */
  turn: string
}

const ID = /^[A-Za-z0-9_-]{1,128}$/

type UiPart = Record<string, unknown>
type UiMessage = { role?: unknown; parts?: unknown }

function partsOf(message: unknown): UiPart[] {
  const parts = (message as UiMessage | null)?.parts
  return Array.isArray(parts) ? parts.filter((part): part is UiPart => !!part && typeof part === 'object') : []
}

function latestUserIndex(messages: readonly unknown[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if ((messages[i] as UiMessage | null)?.role === 'user') return i
  }
  return -1
}

/**
 * The scope for this request, or null when it cannot be bound (no reader
 * message, or an identifier of the wrong shape). Null means no Deep Think.
 */
export function deepThinkScope(o: {
  userId: unknown
  conversationId: unknown
  exchangeId: unknown
  messages: unknown
}): DeepThinkScope | null {
  if (typeof o.userId !== 'string' || o.userId.length === 0 || o.userId.length > 128) return null
  if (typeof o.conversationId !== 'string' || !ID.test(o.conversationId)) return null
  if (typeof o.exchangeId !== 'string' || !ID.test(o.exchangeId)) return null
  if (!Array.isArray(o.messages)) return null
  const at = latestUserIndex(o.messages)
  if (at < 0) return null
  const said = partsOf(o.messages[at])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
  const turn = createHash('sha256').update(JSON.stringify(said)).digest('base64url')
  return { userId: o.userId, conversationId: o.conversationId, exchangeId: o.exchangeId, turn }
}

// ── TOKENS ──────────────────────────────────────────────────────────────────

const TOKEN = /^dt1\.(\d{13})\.([A-Za-z0-9_-]{43})$/

/** Derived, so these MACs can never be confused with the SDK's own approval HMAC. */
function keyFor(secret: string): Buffer {
  return createHmac('sha256', secret).update('deck-e/deep-think/token-key/v1').digest()
}

function mac(secret: string, fields: readonly string[]): Buffer {
  return createHmac('sha256', keyFor(secret)).update(JSON.stringify(fields)).digest()
}

function mint(secret: string, fields: readonly string[], now: number): string {
  const issuedAt = Math.floor(now)
  return `dt1.${issuedAt}.${mac(secret, [...fields, String(issuedAt)]).toString('base64url')}`
}

function verify(
  secret: string,
  fields: readonly string[],
  token: unknown,
  now: number,
  ttlMs: number,
): boolean {
  if (typeof token !== 'string' || token.length > 80) return false
  const parsed = TOKEN.exec(token)
  if (!parsed) return false
  const issuedAt = Number(parsed[1])
  if (!Number.isSafeInteger(issuedAt)) return false
  if (now - issuedAt > ttlMs || issuedAt - now > FUTURE_SKEW_MS) return false
  const given = Buffer.from(parsed[2]!, 'base64url')
  const expected = mac(secret, [...fields, String(issuedAt)])
  return given.length === expected.length && timingSafeEqual(given, expected)
}

type DeepCall = { toolCallId: string; approvalId: string }

const offerFields = (scope: DeepThinkScope, call: DeepCall) => [
  'deep-think-offer', scope.userId, scope.conversationId, scope.exchangeId, scope.turn, call.toolCallId, call.approvalId,
]
const grantFields = (scope: DeepThinkScope) => [
  'deep-think-grant', scope.userId, scope.conversationId, scope.exchangeId, scope.turn,
]

/** Minted when this server raises a `deep_think` card; replayed with its answer. */
export function mintDeepOffer(secret: string, scope: DeepThinkScope, call: DeepCall, now: number = Date.now()): string {
  return mint(secret, offerFields(scope, call), now)
}

export function verifyDeepOffer(
  secret: string,
  scope: DeepThinkScope,
  call: DeepCall,
  token: unknown,
  now: number = Date.now(),
): boolean {
  return verify(secret, offerFields(scope, call), token, now, DEEP_OFFER_TTL_MS)
}

/** Minted only by `deep_think`'s execute, after the SDK accepted the approval. */
export function mintDeepGrant(secret: string, scope: DeepThinkScope, now: number = Date.now()): string {
  return mint(secret, grantFields(scope), now)
}

export function verifyDeepGrant(secret: string, scope: DeepThinkScope, token: unknown, now: number = Date.now()): boolean {
  return verify(secret, grantFields(scope), token, now, DEEP_GRANT_TTL_MS)
}

// ── THE TWO ROUTES ──────────────────────────────────────────────────────────

const DEEP_PART = `tool-${DEEP_THINK_TOOL}`

const isApprovalAnswer = (part: UiPart) =>
  typeof part.type === 'string' && part.type.startsWith('tool-') && part.state === 'approval-responded'

/**
 * The approved `deep_think` part the SDK will validate on this request, or
 * null. Structural only: no secret is involved.
 *
 * It must sit in the trailing run of approval answers that ends the final
 * message, because that is where the browser appends answers and the only
 * place the SDK collects them. Its call id must be unique in that message — a
 * second part with the same id and an output would make the SDK skip
 * validation — and its approval id unique in the whole conversation, because
 * the SDK resolves approval ids last-one-wins across every message.
 */
export function approvedDeepPart(messages: unknown): (DeepCall & { offer: unknown }) | null {
  if (!Array.isArray(messages) || messages.length === 0) return null
  const final = messages[messages.length - 1] as UiMessage | null
  if (final?.role !== 'assistant') return null
  const at = latestUserIndex(messages)
  if (at < 0 || at >= messages.length - 1) return null
  const parts = partsOf(final)
  let start = parts.length
  while (start > 0 && isApprovalAnswer(parts[start - 1]!)) start -= 1
  const candidates = parts.slice(start).filter((part) =>
    part.type === DEEP_PART && (part.approval as { approved?: unknown } | undefined)?.approved === true,
  )
  if (candidates.length !== 1) return null
  const part = candidates[0]!
  const approval = part.approval as { id?: unknown; signature?: unknown }
  const toolCallId = part.toolCallId
  const approvalId = approval.id
  if (typeof toolCallId !== 'string' || toolCallId.length === 0) return null
  if (typeof approvalId !== 'string' || approvalId.length === 0) return null
  if (typeof approval.signature !== 'string' || approval.signature.length === 0) return null
  if (part.providerExecuted === true) return null
  if (parts.filter((p) => p.toolCallId === toolCallId).length !== 1) return null
  let sameApproval = 0
  for (const message of messages) {
    for (const p of partsOf(message)) {
      if ((p.approval as { id?: unknown } | undefined)?.id === approvalId) sameApproval += 1
    }
  }
  if (sameApproval !== 1) return null
  return { toolCallId, approvalId, offer: part.deepOffer }
}

/**
 * Route 1: this request answers, with yes, a `deep_think` card this server
 * raised in this turn. The SDK still re-validates the HMAC before the tool or
 * any model runs; this read decides only the tier and the hold.
 */
export function deepApprovalLeg(
  messages: unknown,
  scope: DeepThinkScope | null,
  secret: string | undefined,
  now: number = Date.now(),
): DeepCall | null {
  if (!secret || !scope) return null
  const part = approvedDeepPart(messages)
  if (!part) return null
  const call = { toolCallId: part.toolCallId, approvalId: part.approvalId }
  return verifyDeepOffer(secret, scope, call, part.offer, now) ? call : null
}

/** The grant inside a replayed `deep_think` output, if it carries one. */
export function grantFromOutput(output: unknown): string | null {
  let value = output
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const { status, grant } = value as { status?: unknown; grant?: unknown }
  return status === 'on' && typeof grant === 'string' ? grant : null
}

/** Route 2: a later leg of a turn whose approval leg minted a valid grant. */
export function deepGrantThisTurn(
  messages: unknown,
  scope: DeepThinkScope | null,
  secret: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!secret || !scope || !Array.isArray(messages)) return false
  const at = latestUserIndex(messages)
  if (at < 0) return false
  for (const message of messages.slice(at + 1)) {
    if ((message as UiMessage | null)?.role !== 'assistant') continue
    for (const part of partsOf(message)) {
      if (part.type !== DEEP_PART || part.state !== 'output-available') continue
      if (verifyDeepGrant(secret, scope, grantFromOutput(part.output), now)) return true
    }
  }
  return false
}

export type DeepRoute = ({ via: 'approval' } & DeepCall) | { via: 'grant' }

/** Both routes, in order. Null means this request is not Deep. */
export function deepRoute(
  messages: unknown,
  scope: DeepThinkScope | null,
  secret: string | undefined,
  now: number = Date.now(),
): DeepRoute | null {
  const approval = deepApprovalLeg(messages, scope, secret, now)
  if (approval) return { via: 'approval', ...approval }
  return deepGrantThisTurn(messages, scope, secret, now) ? { via: 'grant' } : null
}

/**
 * Has the reader already answered a `deep_think` card in this turn? Once they
 * have — yes or no — the offer line and the tool leave the model's view for
 * the rest of the turn.
 */
export function deepThinkAnsweredThisTurn(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false
  const at = latestUserIndex(messages)
  if (at < 0) return false
  return messages.slice(at + 1).some((message) => partsOf(message).some((part) =>
    part.type === DEEP_PART &&
    (part.state === 'approval-responded' || part.state === 'output-available' ||
      part.state === 'output-denied' || part.state === 'output-error'),
  ))
}

// ── PRICE ───────────────────────────────────────────────────────────────────

export type DeepThinkEstimate = { low: number; high: number }

/**
 * Credits are cents. At Opus 5.5's 2026-10-10 Gateway rates ($4/M input,
 * $20/M output), the analysis band is 25k input + 15k output = $0.40 and
 * 100k + 40k = $1.20. A full deck build commonly re-reads more catalog and
 * check output: 50k + 20k = $0.60 through 150k + 60k = $1.80. These are
 * aggregate billable tokens across the request's steps, not one prompt's
 * context window. The model never supplies or edits these server numbers.
 */
const ESTIMATE_BY_PATHWAY: Readonly<Record<PathwayName, DeepThinkEstimate>> = {
  battle_log: { low: 40, high: 120 },
  battle_review: { low: 40, high: 120 },
  deck_build: { low: 60, high: 180 },
  deck_iterate: { low: 60, high: 180 },
  collection_plan: { low: 40, high: 120 },
  lists: { low: 40, high: 120 },
  price_value: { low: 40, high: 120 },
  card_rules: { low: 40, high: 120 },
  research: { low: 40, high: 120 },
  navigate: { low: 40, high: 120 },
  small_talk: { low: 40, high: 120 },
  general: { low: 40, high: 120 },
}

const DEFAULT_ESTIMATE = ESTIMATE_BY_PATHWAY.general

export function estimateCredits(pathways: readonly PathwayName[]): DeepThinkEstimate {
  const estimates = pathways.length > 0
    ? pathways.map((pathway) => ESTIMATE_BY_PATHWAY[pathway])
    : [DEFAULT_ESTIMATE]
  return {
    low: Math.max(...estimates.map((estimate) => estimate.low)),
    high: Math.max(...estimates.map((estimate) => estimate.high)),
  }
}

/**
 * What a paid reader can spend on this request: the hold just taken plus what
 * is left after it (`decke_metered_begin` returns the post-hold balance). An
 * unreadable admission counts as nothing, which is the safe direction.
 */
export function deepAvailableCredits(admission: { heldCredits?: unknown; balance?: unknown }): number {
  const held = Number(admission.heldCredits ?? Number.NaN)
  const after = Number(admission.balance ?? Number.NaN)
  if (!Number.isFinite(held) || !Number.isFinite(after)) return 0
  return Math.max(0, Math.floor(held + after))
}

// ── THE TURN'S TIER ─────────────────────────────────────────────────────────

/**
 * This request's tier: Deep FIRST, then the browser's route echo, then triage.
 *
 * The approval leg and every grant leg are CONTINUATIONS, so the browser sends
 * the first leg's Quick/Standard echo on them (`routeEcho.ts`). A validated
 * Deep route outranks that echo — read the other way round, the turn would run
 * Standard while holding 8× credits. The echo itself can never carry Deep
 * (`readRouteEcho` rejects `tier: 'deep'`), so `deep` here is only ever the
 * route `deepRoute` verified and admission agreed with. With an echo, its
 * pathways are kept (triage was skipped); without one, triage decides.
 *
 * Below Deep it is exactly the harness rule: a valid echo is reused with its
 * effort re-derived (`decisionFromEcho`), and a continuation without one is
 * re-triaged at a Standard floor (`continuationFloor`).
 */
export function turnDecision(o: {
  deep: boolean
  echo: RouteEcho | null
  firstLeg: boolean
  /** `decideTier` over this request's triage; called only when there is no echo. */
  decide: (deepApproved: boolean) => TierDecision
}): TierDecision {
  if (o.deep) {
    if (!o.echo) return o.decide(true)
    return {
      tier: 'deep',
      pathways: [...o.echo.pathways],
      effort: effortFor('deep', o.echo.pathways),
      reasons: ['echo', 'approved:deep'],
    }
  }
  if (o.echo) return decisionFromEcho(o.echo)
  const decided = o.decide(false)
  return o.firstLeg ? decided : continuationFloor(decided)
}

// ── WHAT THE READER AND THE MODEL ARE TOLD ──────────────────────────────────

export type DeepThinkOff = 'balance' | 'unavailable'

/**
 * The request's final tier, after the two checks that can still take Deep
 * away once admission has answered:
 *
 *   - a PAID reader whose spendable credits (`deepAvailableCredits`) are below
 *     the HIGH end of this pathway's estimate answers on Standard. Admission
 *     itself only needs `legHoldMinCredits`, the hold is `least(25 × 8,
 *     balance)`, and the cap is checked only when a model operation starts —
 *     so one Opus step (up to 32k output tokens, about 64 credits, plus input)
 *     could otherwise overshoot a small cap and the overage buffer would eat
 *     the difference, again after every top-up. The low end (40) is below one
 *     worst-case step; the high end (120, 180 for a build) is above it, and it
 *     is the same threshold the card uses to offer a top-up instead.
 *   - a reader who said yes (`answeredYes`) whose request is nevertheless not
 *     Deep — no valid offer, or admission in a different pricing mode — is
 *     told so rather than silently answered on Standard.
 */
export function settleDeepDecision(o: {
  decision: TierDecision
  pricing: DeepThinkPricing | null
  admission: { heldCredits?: unknown; balance?: unknown }
  answeredYes: boolean
}): { decision: TierDecision; off: DeepThinkOff | null; credits?: { available: number; needed: number } } {
  if (o.decision.tier === 'deep' && o.pricing === 'paid') {
    const needed = estimateCredits(o.decision.pathways).high
    const available = deepAvailableCredits(o.admission)
    if (available < needed) {
      return {
        decision: {
          tier: 'standard',
          pathways: o.decision.pathways,
          effort: 'medium',
          reasons: [...o.decision.reasons.filter((reason) => reason !== 'approved:deep'), 'deep:short_balance'],
        },
        off: 'balance',
        credits: { available, needed },
      }
    }
  }
  if (o.decision.tier !== 'deep' && o.answeredYes && o.pricing !== null) {
    return { decision: o.decision, off: 'unavailable' }
  }
  return { decision: o.decision, off: null }
}

/** One line in Deck-E's voice, ahead of the answer, when an approved Deep Think did not start. */
export function deepThinkNote(off: DeepThinkOff, credits?: { available: number; needed: number }): string {
  if (off === 'balance' && credits) {
    return `Deep Think needs about ${credits.needed} credits and you have ${credits.available}, ` +
      "so I'll answer this one the normal way.\n\n"
  }
  return "Deep Think couldn't start for this one, so I'll answer it the normal way.\n\n"
}

export type DeepThinkResult =
  | { status: 'on'; grant: string; note: string }
  | { status: 'off'; note: string }

/** `deep_think`'s output, on the leg that carried the approval. */
export function deepThinkResult(state: { grant: string } | { off: DeepThinkOff }): DeepThinkResult {
  if ('grant' in state) {
    return {
      status: 'on',
      grant: state.grant,
      note:
        'Deep Think is on for this request — take the time it deserves: research what changes, ' +
        'reason it through, check the work, then answer in full. You cannot ask the reader ' +
        'anything during Deep Think: where a choice is ambiguous, state the assumption you are ' +
        'making and carry on.',
    }
  }
  return {
    status: 'off',
    note: state.off === 'balance'
      ? "Deep Think did not start: the reader's credit balance is below its estimate. Answer this " +
        'request well on the ordinary tier now, and do not offer Deep Think again this turn.'
      : 'Deep Think could not start for this request. Answer it well on the ordinary tier now, ' +
        'and do not offer Deep Think again this turn.',
  }
}
