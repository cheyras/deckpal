/**
 * Deck-E's brain — POST /api/chat.
 *
 * ITS OWN FUNCTION, DELIBERATELY, AND NOT PART OF THE EXPRESS APP.
 *
 * `apps/api/src/index.ts` wraps every authenticated request in a Postgres
 * transaction to make RLS policies fire, holding one pooled connection for the
 * whole request and reclaiming it with a watchdog at 30 s. Its own comment says
 * why that is safe: "No endpoint in this API streams or long-polls."
 *
 * A streaming chat endpoint breaks both halves of that sentence. It would hold
 * a database connection for the length of a conversation, cap concurrent Deck-E
 * users at the pool maximum (12, per contract B2), and get its connection
 * yanked mid-sentence at thirty seconds. Worse, the RLS path only runs in
 * SUPABASE_MODE — so none of that reproduces locally. It would be a
 * production-only failure, which is the most expensive kind.
 *
 * Vercel gives filesystem routes precedence over `vercel.json` rewrites, so
 * this file claims `/api/chat` without touching the rewrite that funnels
 * everything else into Express. Reads and writes are ordinary short REST calls
 * to the Express API, carrying the user's own JWT — so Deck-E has exactly the
 * permissions the signed-in user has, enforced by the same RLS policies, and no
 * service-role credential exists anywhere on this path.
 *
 * ── THE ONE DATABASE CONNECTION, AND ITS RULE ────────────────────────────────
 *
 * This function used to say "never opens a database connection", which was true
 * and was also why it had no rate limit. It now opens exactly one, for exactly
 * one statement, BEFORE the stream starts: the meter (migration 039).
 *
 * The rule that keeps the reasoning at the top of this file intact:
 * **never hold a connection across the stream.** The meter charges, releases,
 * and only then does the model get called. Nothing inside `execute` touches the
 * pool. A connection held across a stream would reintroduce every problem this
 * file exists to avoid, plus a new one — Vercel freezes an instance after the
 * response socket dies, so a connection checked out at that moment is checked
 * out for ever.
 */
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  stepCountIs,
  toUIMessageStream,
} from 'ai'

/**
 * How many SERVER steps one turn may take.
 *
 * Named rather than inlined because two places have to agree: the `stopWhen`
 * that enforces it, and the check after the stream that notices a turn spent
 * all of them without ever answering. Two copies of 12 is two copies that can
 * drift, and the drift would be silent — the check would simply stop firing.
 */
const MAX_STEPS = 24

const ANTHROPIC_CACHE = { anthropic: { cacheControl: { type: 'ephemeral' } } }
const isAnthropic = (choice) => choice.id.startsWith('anthropic/')

/**
 * ONE cache breakpoint, on the system prompt. Anthropic caches the prefix in
 * the order tools → system → messages, so this single breakpoint also covers
 * every tool definition. Anthropic allows at most four breakpoints per request;
 * marking each tool as well (≈30 of them) got all but four ignored, with a
 * Gateway warning — measured by scripts/decke-leg-smoke.mjs, 2026-09-28.
 */
function cachedInstructions(choice, content) {
  return isAnthropic(choice)
    ? { role: 'system', content, providerOptions: ANTHROPIC_CACHE }
    : content
}

/** Gateway-native cross-model failover; no second application-level charge or retry loop. */
function chatProviderOptions(choice) {
  return { gateway: { models: [choice.fallback] } }
}

/**
 * The browser-fulfilled tools, as a Set, for the empty-answer guard's
 * navigation-handoff carve-out. Built from the real `CLIENT_TOOLS` export so it
 * cannot go stale the way a hand-written copy would. See `decke/turnGuards.ts`.
 */
const CLIENT_SET = new Set(CLIENT_TOOLS)

/**
 * The server-executed cosmetic tools (`express`, `showScreen`), as a Set, for
 * the empty-answer guard's panel/server carve-out: a turn that ran one of these
 * and produced no text is NOT an empty-answer defect — the panel IS the answer.
 * Built from the real `SERVER_TOOLS` export so it cannot go stale. See
 * `decke/turnGuards.ts`.
 */
const SERVER_SET = new Set(SERVER_TOOLS)

/**
 * Tools whose over-long arguments may be trimmed by `repairToolCall`.
 *
 * A tool belongs here only if it RENDERS rather than stores, and only if its
 * own result reports what was trimmed (`repairs.take(toolCallId)`). Both halves
 * are required: trimming a stored value is editing the reader's own words, and
 * trimming without reporting is the silent correction `decke/tools.ts` refuses
 * to make. `showScreen` draws a panel and says what it shortened; nothing else
 * qualifies today.
 */
const REPAIRABLE = new Set(['showScreen'])

import { createGateway } from '@ai-sdk/gateway'

// Everything imported here comes from `apps/api/dist` — COMPILED output, not
// source. `apps/web` builds a browser bundle and its `.ts` files are never
// emitted as Node-importable JS, so the character's own directory is the wrong
// home for anything a serverless function has to load. These modules live in
// `apps/api/src/decke/` for that reason, and because a system prompt and a tool
// allowlist are server concerns in the first place.
import { verifySupabaseJwt, createSupabaseJwksProvider } from '../apps/api/dist/auth.js'
import { buildSystemPrompt } from '../apps/api/dist/decke/prompt.js'
import { buildTools, CLIENT_TOOLS, SERVER_TOOLS } from '../apps/api/dist/decke/tools.js'
import { MODELS, budgetFor } from '../apps/api/dist/decke/models.js'
import { creditWork } from '../apps/api/dist/credits/work.js'
import { ensureAdminBootstrap } from '../apps/api/dist/admin/access.js'
import { beginAiRequest, runAiUsage, observeUsageModel, finishAiRequest, meteredCapReached, safeUsageCode } from '../apps/api/dist/decke/usage.js'
import { assertDeckeAccess, beginMeteredCredits, readPolicy, reserveCredits, refundUnstarted, chatChargeReference, payloadHash } from '../apps/api/dist/credits/runtime.js'
import { isMetered } from '../apps/api/dist/credits/policy.js'
import { capFor, chargeSql, refusalText, verdictFrom } from '../apps/api/dist/decke/meter.js'
import { readerNamedPrinting } from '../apps/api/dist/decke/printingSaid.js'
import { declinedCalls } from '../apps/api/dist/decke/declined.js'
import { extractPastedLog } from '../apps/api/dist/decke/pastedLog.js'
import {
  pasteBackstopNeeded,
  PASTE_BACKSTOP_LINE,
  pasteBackstopInstruction,
} from '../apps/api/dist/decke/pasteBackstop.js'
import { meteredCapText, outOfCreditsText } from '../apps/api/dist/decke/credits.js'
import { buildDataTools, correctiveApplyTools, dataToolSummary } from '../apps/api/dist/decke/adapters/aisdk.js'
import { apiBaseFor, selfHopHeadersFor } from '../apps/api/dist/decke/ctx.js'
import { buildDeepTools } from '../apps/api/dist/decke/deep.js'
import { checkDeck } from '../apps/api/dist/decke/deckCheck.js'
import { seedMeteredRefusals } from '../apps/api/dist/decke/meteredRefusals.js'
import { createNarrationFilter, stripToolSyntax as stripToolSyntaxImpl } from '../apps/api/dist/decke/narration.js'
import { autoShareAndRecordLeg } from '../apps/api/dist/decke/improvement.js'
import { focusedTools } from '../apps/api/dist/decke/focus.js'
import { spokeAndSettled } from '../apps/api/dist/decke/stopRule.js'
import { createGrounding } from '../apps/api/dist/decke/grounding.js'
import { RepairLog, clampStrings } from '../apps/api/dist/decke/repair.js'
import {
  needsAnswerNudge,
  needsContinuation,
  errorBudgetExceeded,
  shouldFireFlailing,
  summarizeFailures,
  phantomClaims,
  promisedWithoutActing,
  ungroundedCardIds,
  harvestObservedIds,
  seedObservedIds,
} from '../apps/api/dist/decke/turnGuards.js'
import { failingTools, readerAsksRetry } from '../apps/api/dist/decke/failing.js'
import { readReflex } from '../apps/api/dist/decke/reflex.js'
import {
  auditTurn,
  turnToolNames,
  CORRECTIVE_TOOLS,
  correctiveInstruction,
  CORRECTION_LINE,
  CORRECTION_FAILED_LINE,
} from '../apps/api/dist/decke/audit.js'
import {
  validateWire,
  windowForModel,
  boundedRoute,
  boundedLandmarks,
  boundedEvidence,
  readBodyCapped,
} from '../apps/api/dist/decke/wireBounds.js'
import { makePool } from '@deckpal/db'

/**
 * The Deck-E Gateway credential.
 *
 * A DEDICATED KEY, not the one in `AI_GATEWAY_API_KEY`. That one belongs to the
 * marketing image generator (`scripts/gen-marketing-images.mjs`); keeping them
 * apart means this feature's spend is legible on its own and can be revoked
 * without taking a build script down with it.
 *
 * The dev-only fallback is dev-only ON PURPOSE. In production a missing key
 * must fail loudly rather than quietly billing another key — contract B11
 * exists because a gate that silently resolved to "nobody" went unnoticed for
 * four days.
 */
function gatewayKey() {
  const dedicated = process.env.DECKE_VERCEL_AI_GATEWAY_KEY
  if (dedicated) return dedicated
  if (process.env.NODE_ENV !== 'production' && process.env.AI_GATEWAY_API_KEY) {
    return process.env.AI_GATEWAY_API_KEY
  }
  return null
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? ''
const jwks = SUPABASE_URL ? createSupabaseJwksProvider(SUPABASE_URL) : undefined

async function userFromRequest(request) {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  try {
    const payload = await verifySupabaseJwt(token, { secret: JWT_SECRET, jwksProvider: jwks })
    return payload?.sub ? { id: payload.sub, token } : null
  } catch {
    // An expired or forged token is not an error worth detail — it is signed
    // out. The client's own session refresh is the remedy.
    return null
  }
}

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/**
 * The chat function's own pool — lazily created, deliberately tiny.
 *
 * SEPARATE FROM THE EXPRESS APP'S, because this is a separate process. That is
 * not a design choice here, it is a fact about serverless: `api/index.mjs` and
 * this file never share memory, so `/api/health`'s pool census cannot see this
 * pool and never will. Health reports the CONFIGURED value instead, which is
 * the honest version of B11 for something it cannot measure in-process.
 *
 * Sized by `PGPOOL_MAX_CHAT` under contract B2's `request` role. Default 2: one
 * statement per request, held for milliseconds, so concurrency here is bounded
 * by how many requests can be mid-METER at once — not by how many can be
 * mid-conversation, which is the number that would have needed a large pool.
 *
 * LAZY, because a module-level pool would connect on cold start for every
 * request including the ones that 401 before they need it, and because a
 * deployment with no database configured should fail at the meter with a
 * legible error rather than at import with an opaque one.
 */
let poolRef = null
function chatPool() {
  if (!poolRef) {
    const configured = Number.parseInt(process.env.PGPOOL_MAX_CHAT ?? '', 10)
    poolRef = makePool({
      role: 'request',
      ...(Number.isFinite(configured) && configured > 0 ? { max: configured } : { max: 2 }),
    })
  }
  return poolRef
}

/**
 * How long the meter may take before we give up on it.
 *
 * `apps/mcp/src/rls.ts` has no watchdog and the spec calls that out as the gap
 * this class of code keeps falling into. The meter is one statement against a
 * database ~90 ms away, so five seconds is enormously generous and still bounds
 * the case that matters: a database that has stopped answering must not turn
 * every Deck-E request into a hung socket holding a pooled connection on an
 * instance Vercel is about to freeze.
 */
const METER_TIMEOUT_MS = Number.parseInt(process.env.DECKE_METER_TIMEOUT_MS ?? '', 10) || 5_000

/**
 * Charge one unit against a tier, and say whether it was allowed.
 *
 * FAILS OPEN, and that is a decision rather than an oversight. If the database
 * is unreachable, the alternatives are: refuse every Deck-E request (the meter
 * becomes an outage amplifier — a database blip takes the character down), or
 * serve the request unmetered (a bounded overspend during a bounded incident,
 * on a feature whose gate is already a short list of accounts).
 *
 * The second is right HERE and would be wrong for the entitlement check, which
 * is why entitlement is checked separately and from environment variables that
 * cannot be unreachable. Access control fails closed; accounting fails open.
 * They are different questions and they get different answers.
 *
 * It is logged loudly either way, because "the meter was off for six hours" is
 * something that must be discoverable afterwards.
 */
/**
 * A driver error's CODE, allowlisted, never its message.
 *
 * ── WHY THE ALLOWLIST AND NOT JUST "log the code" ────────────────────────────
 *
 * `charge()` below has done this since CodeQL caught the original: a `pg`
 * connection failure's `message` is built from the connection parameters, so
 * "password authentication failed for user …" and DSN fragments end up in it,
 * and this log line fires exactly when the database is unreachable — which is
 * exactly when those details are in the error.
 *
 * Logging `err.code` instead is nearly right and not enough. `code` is
 * driver-supplied and CodeQL correctly refuses to treat it as clean, because
 * nothing guarantees what a library puts there. Testing it against
 * `^[A-Za-z0-9_]{1,32}$` and falling back to a literal is what actually breaks
 * the flow: ECONNREFUSED, 28P01 and ETIMEDOUT all pass, and anything shaped like
 * a sentence does not.
 *
 * Extracted here because the credit path added two more log sites that copied
 * the intent and not the guard, and CodeQL flagged both on the pull request.
 * One implementation is the only way that stays true.
 */
function errCode(err) {
  const raw = String(err?.code ?? err?.name ?? '')
  return /^[A-Za-z0-9_]{1,32}$/.test(raw) ? raw : 'unrecognised'
}

/**
 * Race against a deadline, and CLEAR THE TIMER when the race settles.
 *
 * Both halves matter and they pull opposite ways. A timer left running keeps
 * the caller alive for the full five seconds after a meter that answered
 * in ninety milliseconds — on a serverless platform billed by wall clock, on
 * the hot path of every single turn. And `unref()`ing it instead is the bug
 * CI just caught one layer down in `rls.ts`: an unref'd timer does not hold
 * the loop open, so the case the timer EXISTS for — something that never
 * settles — is exactly the case where the process can exit with the race
 * pending.
 *
 * Clearing on settle is the version that is right in both directions.
 * `label` carries the caller's prefix (`credits:` / `meter:`) so the thrown
 * message still says which system timed out.
 */
const withDeadline = (promise, label) => {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), METER_TIMEOUT_MS)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/**
 * Spend credits, or refuse.
 *
 * ── THE SAME DEADLINE AND THE SAME FAIL DIRECTION AS `charge` ────────────────
 *
 * Accounting fails OPEN. If the database is unreachable the turn is served
 * unmetered and the failure is logged loudly, exactly as the meter does — a
 * bounded overspend during a bounded incident beats a product that stops
 * working because a counter is unreachable. Access control fails closed, and it
 * is checked separately, from environment variables that cannot be down.
 *
 * ── BALANCE FIRST, LOG SECOND, AND NEVER THE OTHER WAY ───────────────────────
 *
 * The UPDATE is the thing that must not be lost. If the audit INSERT fails the
 * credits are still gone, which is the safe direction: a gap in a statement is
 * recoverable, free work is not. So the log is written after and its failure is
 * swallowed with a loud line rather than rolled back.
 */
async function charge(userId, tier) {
  const cap = capFor(tier)
  if (cap <= 0) return { allowed: false, used: 0, cap }

  let client
  try {
    client = await withDeadline(chatPool().connect(), 'meter: pool connect')
    const res = await withDeadline(client.query(chargeSql(tier), [userId, cap]), 'meter: query')
    return verdictFrom(res.rows, cap)
  } catch (err) {
    // THE CODE AND THE NAME, NEVER THE MESSAGE.
    //
    // Caught by CodeQL on this PR, and it is right. A `pg` connection failure's
    // `message` is built from the connection parameters — which come from
    // PGHOST/PGUSER/PGPASSWORD — so "password authentication failed for user
    // …" and DSN fragments end up in it. This log line is the one that fires
    // when the database is unreachable, which is exactly when those details are
    // in the error, and Vercel's function logs are not the place for them.
    //
    // `code` is what is actually diagnostic anyway: ECONNREFUSED, 28P01,
    // ETIMEDOUT. Anyone debugging this needs to know WHICH failure, not the
    // sentence the driver wrote about it — and if they need more, the database's
    // own logs have it without a copy in ours.
    // CONSTRAINED IN SHAPE, not merely chosen carefully.
    //
    // Reading `err.code` instead of `err.message` was not enough for CodeQL,
    // and CodeQL is being reasonable: it tracks taint through the whole error
    // object and cannot know that a `pg` error's `code` is a five-character
    // SQLSTATE while its `message` is built from the connection string. From
    // its position, both are "something derived from the environment".
    //
    // So the shape is enforced rather than assumed. SQLSTATE (`28P01`) and Node
    // syscall codes (`ECONNREFUSED`) are short and alphanumeric; anything that
    // is not becomes `unrecognised`. That turns "I am fairly sure this field is
    // safe" into "nothing else can get out of here", which is the version worth
    // having — and it keeps holding if a future driver decides to put something
    // chattier in `code`.
    const code = errCode(err)
    console.error(
      `[deck-e] METER UNAVAILABLE — serving ${tier} unmetered for this request. ` +
        `Accounting fails open on purpose; entitlement does not. Cause code: ${code}`,
    )
    return { allowed: true, used: -1, cap }
  } finally {
    // ALWAYS, including the timeout paths. A client that is never released is
    // the whole failure mode the watchdog above exists to prevent, and getting
    // this wrong inside the code that prevents it would be a particular kind of
    // embarrassing.
    try {
      client?.release()
    } catch {
      /* the pool discards a broken client on its own */
    }
  }
}

/**
 * The request pipeline, written against web standards.
 *
 * Kept in this shape because the AI SDK speaks it — `createUIMessageStreamResponse`
 * hands back a `Response` whose body is a `ReadableStream`. The Node adapter at
 * the bottom of this file is what bridges it to the runtime.
 */
async function serve(request) {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const key = gatewayKey()
  if (!key) {
    // Observable rather than silent: the client shows Deck-E as unavailable and
    // `/api/health` reports the same fact. B11, rule 2.
    return json({ error: 'deck-e is not configured on this deployment' }, 503)
  }

  const user = await userFromRequest(request)
  if (!user) return json({ error: 'sign in to talk to deck-e' }, 401)

  // ── THE GATE THAT MEANS ANYTHING ──────────────────────────────────────────
  //
  // The client has its own entitlement check and it is correct, but it runs in
  // a browser, so what it decides is whether to draw a button. Until this line
  // existed, any signed-in account could `curl` a full model turn onto the
  // owner's Gateway key. Verified against the deployed endpoint before it was
  // fixed; that is not a hypothetical.
  //
  // BEFORE the body is even parsed, so a rejected caller costs one JWT
  // verification and nothing else.
  try {
    if (!await ensureAdminBootstrap()) return json({ error: 'Account permissions are not ready.' }, 503)
    await assertDeckeAccess(user.id)
  } catch (error) {
    return json({ error: error.status === 403 ? error.message : 'Account authorization is unavailable.' }, error.status === 403 ? 403 : 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'malformed body' }, 400)
  }

  // `conversationId` is LOG-ONLY: it names the conversation on the one
  // structured line a tripped circuit breaker writes, so two lines can be told
  // apart as one outage or two. Nothing reads it for a decision, and an older
  // browser that does not send it logs `conversation=unknown` rather than
  // suppressing the line. See `decke/failing.ts`.
  const { conversationId, exchangeId, seq } = body ?? {}

  // ── HOW MUCH CONVERSATION ONE REQUEST MAY CARRY (SEC-04) ──────────────────
  //
  // BEFORE anything reads the history and before the meter, so a request this
  // endpoint will not serve costs the caller nothing and the owner nothing.
  // The shape is the browser's own — text and `tool-*` parts, `user` and
  // `assistant` roles — and a part larger than a pasted battle log is a 413
  // with a sentence the reader can act on. `route` and `landmarks` are page
  // context for the prompt, so they are clipped rather than refused. See
  // `decke/wireBounds.ts`.
  const wire = validateWire(body?.messages)
  if (!wire.ok) return json({ error: wire.error, code: wire.code }, wire.status)
  const messages = wire.messages
  const route = boundedRoute(body?.route)
  const landmarks = boundedLandmarks(body?.landmarks)
  // What replies the browser's window dropped still owe the two
  // conversation-wide ledgers below — failures and lookup records only, and
  // never shown to the model. See `boundedEvidence`.
  const evidence = boundedEvidence(body?.evidence)

  // ── AND WHAT THE METER ALREADY REFUSED IN THIS TURN ───────────────────────
  //
  // Meter refusals are account state, distinct from a reader declining a write.
  // Once a priced tool is unavailable, do not spend more steps retrying it.
  //
  // SEEDED FROM THE REPLAYED HISTORY for the reason this whole function
  // re-derives everything: each approval is a fresh POST and the server keeps
  // nothing between requests, so an in-memory closure would cover the SDK's own
  // steps and miss the browser leg the measured bug actually lived on.
  //
  // TURN-SCOPED, not conversation-scoped: the seed reads only what follows the
  // reader's last message, so their next message re-evaluates a balance that a
  // top-up or a daily reset may have changed. See `decke/meteredRefusals.ts`.
  const deepRefusals = seedMeteredRefusals(messages)

  // ── AND WHAT HAS BEEN FAILING ALL CONVERSATION ────────────────────────────
  //
  // Same source, same lifetime, same reason as `declined` below: rebuilt from
  // the replayed history because the server keeps nothing between requests.
  // `battle_logs` 500ed on four turns of one conversation and was re-called on
  // every one of them — the error chips were erased at the turn boundary, so
  // nothing in the model's context said the tool had ever failed. The browser
  // now replays failed calls as `output-error` parts and this counts them.
  //
  // The reader's own latest message is the ONLY thing that re-opens a tripped
  // breaker — the same "one fact the model cannot fake" argument `declined.ts`
  // makes for its own bypass. See `decke/failing.ts`.
  const failing = failingTools([...evidence, ...messages])
  const retryRequested = readerAsksRetry(latestUserText(messages))
  // ── THE METER ─────────────────────────────────────────────────────────────
  //
  // Charged AFTER validation and BEFORE the model, which is the only ordering
  // that is both fair and safe: a malformed request should not cost the caller
  // a turn, and a well-formed one must not reach the Gateway until it has been
  // paid for.
  //
  // One turn is one BILLED REQUEST, not one thing the reader typed — a journey
  // costs up to four. Migration 039's header explains why that is the honest
  // unit even though it reads stingier than it is.
  let quote, reference, meter, usage
  const meterTurn = async (userId, { tier, reason, toolCallId, args }) => {
    await assertDeckeAccess(userId)
    if (isMetered(quote.policy)) {
      // One hold belongs to the whole request. Research still receives its own
      // usage operation, but never creates a second wallet reservation.
      if (toolCallId) {
        if (!quote.policy.enabled && !quote.unlimited) return { ...(await charge(userId, tier)), credits: false,
          ...creditWork(async () => {}, request.signal) }
        return { allowed: true, credits: quote.policy.enabled && !quote.unlimited,
          balance: meter?.balance, ...creditWork(async () => {}, request.signal) }
      }
      const result = await beginMeteredCredits(chatPool(), userId, usage.id)
      usage.meteredStarted = result.allowed
      // Every metered refusal is a credit refusal (the balance, a debt or a payment
      // hold), never the daily allowance, so it must offer the wallet, not "tomorrow".
      const admission = { ...result, credits: !result.allowed || result.mode === 'paid', held: result.reason === 'payment_hold',
        needed: result.needed ?? (result.allowed ? undefined : quote.policy.legHoldMinCredits),
        ...creditWork(async () => {}, request.signal) }
      if (!result.allowed || result.mode !== 'daily') return admission
      return { ...admission, ...(await charge(userId, tier)), credits: false }
    }
    if (!quote.policy.enabled && !quote.unlimited) return { ...(await charge(userId, tier)), credits: false,
      ...creditWork(async () => {}, request.signal) }
    const tool = reason === 'chat_turn' ? 'chat_turn' : reason.slice(5)
    const spendKey = toolCallId ? `${reference.key}:deep:${toolCallId}` : reference.key
    const hash = toolCallId ? payloadHash({ tool, args, toolCallId }) : reference.hash
    const result = await reserveCredits(chatPool(), userId, tool, quote, spendKey, hash)
    return { ...result, credits: true, ...creditWork(
      () => refundUnstarted(chatPool(), userId, result.spendId),
      request.signal,
    ) }
  }
  try {
    quote = await readPolicy(chatPool(), user.id)
    reference = chatChargeReference(conversationId, messages, route, landmarks, { exchangeId, seq })
    usage = await beginAiRequest(chatPool(), { userId: user.id, conversationId, exchangeId, seq, requestKey: reference.key, payloadHash: reference.hash, quote, messages, signal: request.signal })
    meter = await meterTurn(user.id, { tier: 'chat_turns', reason: 'chat_turn' })
  } catch (error) {
    if (usage) await finishAiRequest(usage, 'failed')
    const status = [400,403,409].includes(error.status) ? error.status : 503
    return json({ error: status === 503 ? 'Credit accounting is unavailable. No model work was started.' : error.message }, status)
  }
  if (!meter.allowed) {
    await finishAiRequest(usage, 'failed', 0)
    // A SPOKEN REFUSAL, not a 500. The browser turns this status into his own
    // words in the transcript, so a budget reads as a budget rather than as a
    // malfunction. 429 and not 403: the account is entitled, it has simply
    // spent today's allowance, and those are different sentences.
    // A topped-up balance does NOT come back tomorrow, so the refusal must not
    // say it does. `retryAfterDay` is what the browser turns into "try me again
    // tomorrow"; on credits it is false and the balance rides along so the panel
    // can offer the top-up instead.
    return meter.credits
      ? json(
          { error: meter.held ? 'AI credits are on hold while a payment issue is resolved. Open your credit wallet for details.' : outOfCreditsText(), retryAfterDay: false, credits: { balance: meter.balance == null ? meter.balance : Number(meter.balance), needed: meter.needed, held: meter.held === true } },
          429,
        )
      : json({ error: refusalText('chat_turns', meter.cap), retryAfterDay: true }, 429)
  }
  usage.spendId = meter.spendId

  try {
  // ── THE REFLEX READ ───────────────────────────────────────────────────────
  //
  // What the reader is asking for, judged by Jev before the model runs: a
  // collection change forces the first step to raise the real consent card,
  // and a walk to a list or deck takes `escort` out of view. On every leg, from
  // the reader's latest words, but only the leg carrying those words may force.
  // AFTER the meter — this is a Gateway call, and nothing reaches the
  // Gateway unpaid — and under a hard deadline. On a timeout, an error, a low-confidence answer or `DECKE_JEV`
  // off, it is `NO_REFLEX`, which is this function exactly as it was.
  //
  // Not the classifier turn the deep tier's comment below rejects: that was an
  // LLM turn in front of every message. This is a typed evaluation — no
  // output tokens, ~$0.00004 and ~0.3 s measured — whose answers only ever act
  // above a threshold chosen on a labelled set. See `decke/jev.ts`.
  const reflex = await runAiUsage(usage, () => readReflex(messages, route, { key, signal: request.signal }))
  let capReached = await meteredCapReached(usage)
  let capLineWritten = false

  // ── WHAT THEY HAVE ALREADY REFUSED ────────────────────────────────────────
  //
  // Derived from the replayed conversation, before anything else uses it. The
  // reader watched the same `deck_strategy` dialog on three consecutive turns
  // having declined it every time, and wrote in the chat that this was the
  // problem. A matching call is now refused without a dialog. See
  // `decke/declined.ts` for why the tool is not simply taken away instead.
  //
  // Only an explicit denial replayed by the browser counts; ordinary prose is
  // never interpreted as a tool-family refusal.
  const declined = declinedCalls(messages)

  // Where this instance is reachable, for the API hop a tool makes. Derived
  // from the request rather than hardcoded, so a preview deployment talks to
  // ITSELF instead of to production — which matters most when the thing being
  // verified is a preview deployment.
  const host = request.headers.get('host') ?? undefined

  // THE TURN'S ABORT SIGNAL, threaded everywhere that can outlive the reader.
  //
  // Aborts are routine here, not exceptional: the client aborts the previous
  // stream on every new send, and there is a stop button. When the response
  // socket dies, this function's pump loop returns but `execute` below keeps
  // running — and Vercel then freezes the instance. Anything still in flight at
  // that moment is in flight for ever: a pooled connection stays checked out, a
  // model call keeps billing.
  const abortSignal = request.signal

  // Built once and shared by both tool sets. The database handle inside it is
  // LAZY — nothing is checked out until a tool actually queries, and it is
  // released when that call returns.
  // ── THE SELF-HOP, AND WHAT GUARDS IT ──────────────────────────────────────
  //
  // Writes go through deckpal-api rather than straight to Postgres, so the
  // write logic stays single-sourced (SPEC §3). Which means this function calls
  // its OWN DEPLOYMENT over the public hostname — and anything guarding that
  // hostname guards us.
  //
  // Measured on a protected Vercel preview: `log_cards` came back "NOT SENT …
  // applied 0 … STOPPED: Protected deployment", the mutation ledger never
  // moved, and the approval flow it was verifying could not be tested end to
  // end. The bypass header can be put on a browser's requests and on curl's; it
  // cannot be put on a fetch the server makes to itself unless the server
  // forwards it, which is this.
  //
  // Forwarded ONLY if the incoming request carried it — so it is present
  // exactly when the platform put it there, and absent in production where
  // there is nothing to bypass. It is a deployment-access token, not a user
  // credential: it grants nothing beyond reaching a deployment that is already
  // answering this very request.
  //
  // A PERSON IN A BROWSER SENDS NEITHER OF THOSE. They reach a protected
  // preview through Vercel SSO, which leaves a `_vercel_jwt` cookie — so this
  // used to find nothing, forward nothing, and fail every self-hop. See
  // `selfHopHeadersFor`, which handles both and is tested.
  const selfHop = selfHopHeadersFor(request.headers)

  const toolCtx = {
    pool: chatPool(),
    userId: user.id,
    jwt: user.token,
    apiBase: apiBaseFor(host),
    signal: abortSignal,
    ...(selfHop ? { selfHopHeaders: selfHop } : {}),
  }

  /**
   * Tool-call lifecycle, onto the stream, as a transient part.
   *
   * WHY THIS EXISTS: work is currently indistinguishable from theatre. The
   * `thinking` state is driven by request latency, so a fabricated answer and a
   * researched one look exactly the same while they are being produced. The
   * reader has no way to tell "he is reading my collection" from "he is
   * composing a sentence about my collection".
   *
   * EMITTED HERE, never by the model. A chip the model could ask for would be a
   * second surface to fabricate on — "Checking your collection…" with no lookup
   * behind it is strictly worse than no chip at all, because it manufactures
   * evidence. These come from the adapter's own execute wrapper, so every chip
   * corresponds 1:1 to a real invocation of a real handler by construction.
   *
   * TRANSIENT, like the animation commands: progress is about a moment, and a
   * finished turn should not carry "Checking your collection…" in its history
   * for ever, nor re-bill it on the next turn.
   */
  // Tool-call lifecycle events, collected for the turn-end guards: the 'error'
  // phase count feeds the flailing guard, and {name,title} feed its summary.
  // Declared in `serve` scope (before `emitToolEvent`) so the sink here can push
  // to it; read inside `execute` by the guard block. One per request.
  const guardEvents = []
  const improvementEvents = []
  const emitToolEvent = (writer) => (event) => {
    guardEvents.push(event)
    improvementEvents.push({ ...event, at: new Date().toISOString() })
    try {
      writer.write({ type: 'data-decke-tool', data: event, transient: true })
    } catch {
      // A closed stream is the ordinary end of an aborted turn. A chip that
      // cannot be delivered must never take the tool call down with it.
    }
  }

  /**
   * The structured preview of a HELD write, onto the stream, keyed to its call.
   *
   * SAME RULE AND SAME WORDS AS THE CHIPS, and it matters more here: this is a
   * consent dialog, and a row on it the model could ask for would be a
   * fabricated authorisation. These come from the adapter's `onInputAvailable`,
   * which runs the real handler with `dry_run` FORCED, so every row corresponds
   * 1:1 to a real invocation by construction.
   *
   * NO CHIP accompanies it. A chip says work happened for the reader; this work
   * happened for the dialog, and a chip would put "Log collection changes —
   * would apply 3" in the transcript beside a change nobody has agreed to.
   *
   * TRANSIENT, like the chips and the animation commands: it is a question
   * being asked now, not a fact the transcript should re-bill on every
   * subsequent turn. The client keys it by `toolCallId` — never by arrival
   * order, because the SDK signs and enqueues the approval request CONCURRENTLY
   * with this dry run still running (`ai/dist/index.js:8228-8271` enqueues the
   * chunk before it awaits the callback). What does hold is that the await
   * blocks the stream from closing until this is written, and the browser does
   * not open the card until the leg's stream has closed.
   */
  const emitApprovalPreview = (writer) => (preview) => {
    try {
      writer.write({ type: 'data-decke-approval-preview', data: preview, transient: true })
    } catch {
      // A closed stream is the ordinary end of an aborted turn. A preview that
      // cannot be delivered must never take the held call down with it — the
      // card falls back to the plain dialog and the write is still approvable.
    }
  }

  const choice = MODELS.chat
  const stream = createUIMessageStream({
    execute: async ({ writer }) => runAiUsage(usage, async () => {
      let result
      let improvementError = null
      try {
      // EXPLICIT PROVIDER, EXPLICIT KEY.
      //
      // Passing the key as a `headers` entry does nothing: the gateway provider
      // reads `apiKey` (or falls back to the ambient `AI_GATEWAY_API_KEY`), so a
      // header named anything else is silently ignored and the call goes out on
      // whatever key happens to be in the environment. That is not a cosmetic
      // bug — this deployment has two keys with different billing, and the
      // failure mode is spending the wrong one while believing otherwise.
      const gateway = createGateway({ apiKey: key })

      if (capReached) {
        writer.write({ type: 'text-delta', id: 'metered-cap', delta: meteredCapText() })
        capLineWritten = true
        return
      }

      // ONE PER TURN, shared by every tool in it. What a data tool returns on
      // step one is what `showScreen` may draw on step three — evidence is a
      // property of the turn, not of a call.
      const grounding = createGrounding()
      // Finished tool outputs are evidence even when they came from an earlier
      // turn. This is the grounding used by sanitizeScreen/showDeck, not merely
      // the audit set below.
      for (const output of replayedToolOutputs(messages)) grounding.observe(output)
      // The same evidence, as a Set, for the ungrounded-id guard below. Built by
      // TAPPING `grounding.observe` through a structural proxy that delegates
      // every method to the real grounding and harvests ids into this Set using
      // the one `CARD_ID` regex `turnGuards.ts` owns. `grounding.ts` does not
      // expose its ids, and the ownership of this pass does not extend to
      // editing it, so the proxy is the seam.
      const observedIds = new Set()
      // ── SEED FROM THE REPLAYED CONVERSATION (cross-leg blindness) ──────────
      //
      // Without this, a card id that appeared in an EARLIER leg's tool result —
      // and so is legitimately in the reader's context — is absent from this
      // turn's `observedIds`, and `ungroundedCardIds` would flag it as invented
      // when the model names it back. The reader typed it to ask about it; the
      // model answered using it; the guard corrected a detail grounded two legs
      // ago. Seeding from the incoming messages closes that: anything the
      // conversation already carried is observed before any tool runs.
      //
      // Serialized cheaply — the text and tool parts of each message flattened
      // to strings — and run through the one `harvestObservedIds` regex, so what
      // counts as "observed" here cannot disagree with what the turn's own tool
      // results will add.
      for (const id of seedObservedIds(replayedText(messages))) observedIds.add(id)
      const groundingForTools = {
        observe: (text) => {
          grounding.observe(text)
          for (const id of harvestObservedIds(text)) observedIds.add(id)
        },
        seen: (id) => grounding.seen(id),
        size: () => grounding.size(),
      }
      // What `repairToolCall` below mended, so the tool can say so in its own
      // result rather than being silently corrected. Per request, like the
      // grounding beside it.
      const repairs = new RepairLog()
      // Whether a guard (including the circles guard above) already wrote this
      // turn. AT MOST ONE guard step per turn — never stacked.
      let guardFired = false

      const allDeckeTools = {
        // `emitToolEvent` here too, so a panel becomes a row like every data
        // lookup already does. Without it `showScreen` and `express` were
        // absent from the transcript entirely — and, worse, absent from the
        // compacted evidence the client replays into the next leg, so a turn
        // that drew a panel and then flew somewhere came back not knowing the
        // panel existed and narrated its contents a second time.
        ...buildTools(writer, groundingForTools, repairs, emitToolEvent(writer), {
          checkDeck: (input) => checkDeck(toolCtx, input),
          db: chatPool(),
          userId: user.id,
          conversationId,
        }),
        // READS AND WRITES, because the approval round-trip now exists.
        //
        // `include: () => true` is not "no filter" — every write is still
        // gated by the adapter's `needsApproval`, which the SDK ENFORCES by
        // not running the tool. What changes here is only whether the model
        // can ask. Before the client could carry an approval, a write tool
        // would have stalled the turn: the SDK holds the call, nothing
        // executes, and nobody is listening for the request.
        ...buildDataTools({
          ...toolCtx,
          include: () => true,
          // Chat-only split intent: log_cards means APPLY (server-owned
          // dry_run:false after signed approval); preview_card_changes is the
          // read-only hypothetical path. Shared MCP/default schemas stay as-is.
          conversationalLogging: true,
          onEvent: emitToolEvent(writer),
          // ONLY HERE. The research worker below gets no
          // `onApprovalPreview`, because there is no reader watching a dialog
          // for them — and with nobody listening the adapter runs no preview at
          // all, so a sub-agent pays nothing for a card it cannot show.
          onApprovalPreview: emitApprovalPreview(writer),
          // Computed from THEIR sentence, not from the tool call and not from
          // anything Deck-E wrote. He names a printing on essentially every row
          // whether or not one was asked for, so his word cannot be the witness
          // to his own guess. See `printingSaid.ts` for the measurement.
          readerNamedPrinting: readerNamedPrinting(latestUserText(messages)),
          // ── THE PASTE CHANNEL ──────────────────────────────────────────────
          //
          // The reader's pasted PTCG Live battle log, extracted from the
          // replayed conversation so the model never has to re-emit a ~3,000-
          // token log into a 1,200-token output budget. `extractPastedLog` walks
          // the same `messages` array this request parsed; the adapter
          // substitutes it for a `@pasted` sentinel or a truncated prefix. See
          // `decke/pastedLog.ts` for the heuristic and its bounds.
          pastedLog: () => extractPastedLog(messages),
          // ── AND WHAT THEY HAVE ALREADY SAID NO TO ────────────────────────
          //
          // Read from the replayed history, the only place it can come from:
          // the browser re-POSTs the whole conversation each leg and the server
          // keeps nothing between requests.
          //
          // Exact denied calls are refused without reopening the same dialog.
          declined,
          // ── AND WHAT HAS BEEN DOWN ALL CONVERSATION ──────────────────────
          //
          // A tool that failed in `CIRCUIT_BUDGET` distinct earlier turns is
          // not called again; the adapter returns an honest non-result and an
          // `error` chip saying the call was not made. `retryRequested` is the
          // reader's own "try again", the only thing that closes the circuit.
          failing,
          retryRequested,
          // Log-only, for the one line a tripped breaker writes.
          conversationId,
          grounding: groundingForTools,
        }),
        // Web research stays a separate tool because its search model and
        // metering differ from the conversational agent.
        ...buildDeepTools({
          ctx: toolCtx,
          gateway,
          charge: async (toolName, toolCallId, args) =>
            meterTurn(user.id, {
              tier: 'deep_calls',
              toolCallId, args,
              reason: `deep:${toolName}`,
            }),
          // What the meter already refused in this turn — no repeated charge.
          refusals: deepRefusals,
          onEvent: emitToolEvent(writer),
        }),
      }

      // THE MODEL SEES A WINDOW; EVERYTHING ELSE SEES THE WHOLE. Declines,
      // failures, what he already said, the paste and the charge hash above all
      // read the full validated history, so trimming changes what he is billed
      // to re-read and nothing about how he behaves. The reader's current turn,
      // approvals included, is never cut. See `decke/wireBounds.ts`.
      const preparedMessages = await convertToModelMessages(stripPriorCommands(windowForModel(messages).messages))
      // Named rather than inlined because a corrective leg (the after-turn
      // audit, below) reuses it byte for byte: same prefix, same cache.
      const systemPrompt = buildSystemPrompt({
        route,
        signedIn: true,
        // MIRRORS `LANDMARK_CAP` in `apps/web/src/character/host/useDeckeChat.ts`,
        // which explains why the cap exists (prompt size, re-billed per leg)
        // and what it costs. Bounded again here — count AND each string —
        // because the browser chooses what to send and this is the side that
        // pays for it. Change one, change both (`LANDMARKS_MAX`).
        landmarks,
        // GENERATED FROM THE TOOLS HE IS ACTUALLY HOLDING (`allDeckeTools`).
        // Hand-writing this list is how the previous prompt came to spend
        // every turn offering to look things up with no tool that could look.
        dataTools: dataToolSummary({ include: () => true, conversationalLogging: true }),
      })
      result = streamText({
        model: observeUsageModel(gateway(choice.id), meter),
        providerOptions: chatProviderOptions(choice),
        // `instructions`, not `system` — `system` is deprecated in ai@7 and
        // `instructions` is the field that accepts a SystemModelMessage, which
        // is where a prompt-cache breakpoint can attach. Our prompt carries the
        // whole animation vocabulary on every turn, so caching is load-bearing.
        instructions: cachedInstructions(choice, systemPrompt),
        // AWAITED: `convertToModelMessages` is async in ai@7 and returns a
        // Promise<ModelMessage[]>. Passing it unawaited fails deep inside
        // `standardizePrompt` as "messages.some is not a function" — which
        // names neither this call nor the missing await.
        messages: preparedMessages,
        // THE BODY AND THE DATA, in one set.
        //
        // `buildTools` is the cosmetic ones — express, showScreen, and the
        // rest the browser runs. `buildDataTools` is the read half of the same
        // 23 tools the MCP server exposes, through the other adapter onto the
        // same definitions. Until this line, every factual claim Deck-E made
        // was the model's training data, because there was nothing else for it
        // to be.
        //
        // READS AND WRITES, now that the approval round-trip exists: every
        // write is still gated by the adapter's `needsApproval` — the SDK
        // holds the call until the client carries back an approval, HMAC-signed
        // at issuance (see APPROVALS ARE SIGNED below) — so a write tool
        // reachable from a conversational model still cannot run by accident.
        //
        // The context is built PER TOOL CALL, not here — the database handle is
        // lazy and the connection is held for one call and released. Nothing in
        // this stream ever holds a connection, which is the rule that lets this
        // function keep the property it was created for.
        tools: allDeckeTools,
        // Bounded: each step re-bills the entire prompt, so an unbounded loop on
        // a per-user paid feature is a billing incident waiting to happen. Four
        // covers "fly there, see what happened, react".
        //
        // RAISED FROM 12 TO 24 for a complete gather → draft → check → fix →
        // show deck workflow. Four was sized for a loop with six
        // cosmetic tools, where a step could only ever be "move" or "speak".
        // A turn that reads now legitimately needs several: look the set up,
        // check what they own of it, then answer. Four made "what am I missing
        // from Pitch Black, and what's it worth" unanswerable in one turn.
        //
        // Note this governs SERVER-side steps only. Navigation legs are
        // governed by the browser's MAX_LEGS, because a client tool has no
        // server `execute` and therefore ENDS the server turn — raising this
        // number does nothing at all for a journey.
        stopWhen: [
          stepCountIs(MAX_STEPS),
          ({ steps }) => spokeAndSettled(steps),
          // ── THE CIRCUIT BREAKER (c) ──────────────────────────────────────────
          //
          // The flailing guard used to be a POST-MORTEM only: it summarised the
          // turn's failures AFTER the loop had already burned to the step
          // cap. The mine asked for a circuit breaker, and this is it — stop
          // issuing further steps once the error budget across `guardEvents` is
          // exceeded, so a turn that has already failed 5 times does not spend
          // its remaining 7 steps failing the same way. `errorBudgetExceeded`
          // is the same predicate the closing-step NOTE uses, so the breaker and
          // the note agree on what "too many" means. The `onFinish` note below
          // then explains what happened.
          () => errorBudgetExceeded(guardEvents.map((e) => e.phase)),
          async () => {
            capReached = await meteredCapReached(usage)
            return capReached
          },
        ],
        // ── WHAT HE CAN SEE, PER STEP ─────────────────────────────────────
        //
        // Every tool is visible from step zero. The old first-step write
        // narrowing did not replicate, hid `add_battle_log` exactly when a
        // pasted log required it, and changed Anthropic's cached tools prefix
        // between steps. Signed approval still gates every write; visibility
        // grants no authority. `decke/focus.ts` records the evidence.
        //
        // AND WHAT HAS BECOME IMPOSSIBLE. Once the research tier's own limit has
        // refused once this turn — a spent daily cap, a held wallet — its tool
        // leaves `activeTools` for the rest of it. This file's own
        // measurement is why that is worth doing: with a tool absent from
        // `activeTools`, "a prompt begging the model to call it produced no
        // call". A decline is never removed this way (the reader can change
        // their mind mid-turn); a spent cap cannot be talked around.
        //
        // AND WHAT THE REFLEX READ SETTLED. `escort` leaves view when the reader
        // is going somewhere it cannot reach. And when they plainly asked to
        // change their collection, step one MUST call `log_cards` — the call
        // that raises the signed consent card, and cannot write without it.
        // Forcing it forces the question, never the answer.
        prepareStep: ({ stepNumber }) => ({
          activeTools: focusedTools(allDeckeTools, stepNumber, (n) => deepRefusals.unavailable(n) || reflex.hide.includes(n)),
          ...(stepNumber === 0 && reflex.force
            ? { toolChoice: isAnthropic(choice) ? 'auto' : { type: 'tool', toolName: reflex.force } }
            : {}),
        }),
        // ── A CAPTION THAT IS TOO LONG IS NOT A LOST TURN ─────────────────
        //
        // Measured on a real gate run against production: `showScreen` failed
        // schema validation FIVE TIMES in one turn, and the model — told only
        // that something had gone wrong — spent five of its twelve steps
        // shortening the panel's TITLE while the actual fault, a text block over
        // the 280-character cap, went untouched in every retry. The reader got
        // no panel and no explanation.
        //
        // Surfacing the validation message (further down this file) was the
        // first half of the fix and did not stop the loop: "expected string to
        // have <=280 characters" over a schema with several capped strings says
        // WHAT broke and not WHERE.
        //
        // A validation failure never reaches `execute`, so the repeat ledger in
        // `decke/repeat.ts` cannot see it either — this is the one thrash class
        // everything else in this pass leaves standing.
        //
        // DETERMINISTIC, NOT A SECOND MODEL CALL. The usual implementation of
        // this hook asks a model to fix its own arguments, which costs latency
        // and money on the exact turn that has already wasted both. This mends
        // one class of fault mechanically — a string past its documented
        // maximum — because that is the class that occurred, it has exactly one
        // correct fix, and trimming a caption cannot change what the call MEANS.
        // Anything else returns null and takes the ordinary error path.
        //
        // AND IT IS NOT SILENT. `tools.ts` states the rule twice: "a model that
        // is silently corrected learns nothing and repeats the mistake." Every
        // repair is recorded and the tool reports it in its own result, naming
        // the exact field — which is strictly more than the failure gave it,
        // and costs no step.
        repairToolCall: async ({ toolCall, inputSchema, error }) => {
          if (error?.name === 'NoSuchToolError') return null
          // ── ONLY TOOLS THAT REPORT THE TRIM MAY BE TRIMMED ────────────────
          //
          // The hook fires for EVERY tool, and left unrestricted it would clamp
          // `deck_strategy.markdown` (40k), `add_battle_log.log` (50k) and every
          // other capped string — silently, because only `showScreen` drains the
          // repair log. A 45,000-character strategy guide cut mid-word at 40,000,
          // stored, and reported as saved in full is exactly the silent
          // correction `tools.ts` forbids twice, and it would be OUR edit to the
          // reader's own words.
          //
          // So the allowlist is the tools that both (a) render rather than store,
          // and (b) tell the model what was trimmed. Adding a name here without
          // draining `repairs` in that tool's result re-opens the hole.
          if (!REPAIRABLE.has(toolCall.toolName)) return null
          let parsed
          try {
            parsed = JSON.parse(toolCall.input)
          } catch {
            // Malformed JSON is not a length problem and guessing at it would
            // be inventing arguments.
            return null
          }
          const schema = await inputSchema({ toolName: toolCall.toolName })
          const { value, repairs: made } = clampStrings(parsed, schema)
          if (made.length === 0) return null
          for (const r of made) repairs.note(toolCall.toolCallId, r)
          console.warn(
            `[deck-e] repaired ${toolCall.toolName}: ` +
              made.map((r) => `${r.path} ${r.was}→${r.now} chars`).join(', '),
          )
          return { ...toolCall, input: JSON.stringify(value) }
        },
        // ── APPROVALS ARE SIGNED, SO THEY CANNOT BE FORGED ────────────────
        //
        // The SDK holds a write until an approval arrives. Until this line,
        // nothing proved that approval corresponded to a request the SERVER
        // had actually issued: the client is hand-rolled and the whole
        // conversation is replayed on every leg, so a caller could simply
        // append `state:'approval-responded', approval:{approved:true}` to a
        // tool call and the write would execute.
        //
        // Read in the SDK's own source rather than assumed: signature
        // verification runs only `if (toolApprovalSecret != null)`
        // (`ai/dist/index.js:5164`). Without a secret there is no check at all
        // — the approval is taken at face value.
        //
        // With one, the server HMACs each request at issuance over
        // (approvalId, toolCallId, toolName, input) and verifies it on replay,
        // so a forged approval, a replayed one for a different call, or one
        // whose ARGUMENTS were edited after approval all fail closed.
        //
        // That last case is the one worth naming: without signing, a client
        // could approve "add 1 card" and send back "add 4000" against the same
        // approval. The input is inside the signature.
        //
        // Unset means unsigned rather than broken, and that is deliberate —
        // this must not take Deck-E down on a deployment that has not set it —
        // but it is declared in DEPLOYMENT.md and warned about at boot, per
        // B11, because "the control is off and nothing says so" is the failure
        // that contract exists for.
        ...(process.env.DECKE_APPROVAL_SECRET
          ? { experimental_toolApprovalSecret: process.env.DECKE_APPROVAL_SECRET }
          : {}),
        maxOutputTokens: budgetFor(choice),
        // A sub-agent that ignores the signal bills for up to five minutes
        // after the user gave up. This is the same signal every tool call and
        // every outbound API fetch carries, so one abort stops the whole turn
        // rather than only the visible part of it.
        abortSignal,
        onError: ({ error }) => {
          usage.failed = true;
          // Surfaced rather than swallowed: a silent empty turn is
          // indistinguishable from a broken feature.
          //
          // A 429 is called out by name because it is the one failure that
          // looks like a code bug and is not. The Gateway returns a BARE 429 —
          // no `retry-after`, no `x-ratelimit-*` headers — with the message
          // "Free tier requests on this model are rate-limited", when the key
          // has no paid credits attached. Every model answers this way, so a
          // fallback to another model does not help and retrying just burns
          // the budget. Observed 2026-08-21 on a fresh key while an older key
          // on a credited team answered the same request normally.
          const message = String(error?.message ?? error)
          if (/rate.?limit/i.test(message)) {
            console.error(
              '[deck-e] gateway rate limit — DECKE_VERCEL_AI_GATEWAY_KEY has no paid credits. ' +
                'This is a billing state, not a bug; retrying will not clear it.',
            )
            return
          }
          console.error('[deck-e] stream error', safeUsageCode(error))
        },
      })

      // Shared by the turn's stream and a corrective leg's; see the comment at
      // the first use below.
      const surfaceError = (error) => {
        console.warn('[deck-e] stream/tool error surfaced to the client:', safeUsageCode(error))
        return 'The model request could not finish. Please try again.'
      }

      // STANDALONE `toUIMessageStream({ stream })`, not `result.toUIMessageStream()`.
      //
      // The method form is deprecated in ai@7 and does not produce a valid UI
      // message stream here — it surfaces as `AI_TypeValidationError` with
      // "expected array, received undefined" at `choices`, which reads like a
      // Gateway protocol problem and is not. Every doc example and both local
      // Vercel skills still show the method form.
      writer.merge(
        stripToolSyntax(
          toUIMessageStream({
            stream: result.fullStream,
            sendReasoning: false,
            // ── SAY WHAT WENT WRONG, AND WRITE IT DOWN ───────────────────
            //
            // The SDK's default is `() => "An error occurred."`, which is a
            // sound default for a browser and a terrible one here, because it
            // is also what a rejected TOOL CALL reports. Caught on a real gate
            // run against production: `showScreen` failed schema validation
            // FIVE TIMES in one turn, and the model — told only that something
            // had gone wrong — spent five of its twelve steps shortening the
            // panel's TITLE while the actual fault, a text block over the
            // 280-character cap, went untouched in every retry. The reader saw
            // no panel, no error and no explanation, and nothing anywhere in
            // this repo logged it.
            //
            // The message is a validation complaint about the model's own
            // arguments — "expected string to have <=280 characters" — not a
            // stack trace and not anything about the account, so returning it
            // is safe. It goes to the reader's browser, where the transcript
            // now renders it as a failed row rather than as silence.
            onError: surfaceError,
          }),
        ),
      )

      // ── A TURN THAT SPENT EVERYTHING AND SAID NOTHING ────────────────────
      //
      // Found by gate 23, on a real run: twelve tool calls, ZERO text deltas,
      // stream closed `finishReason: "tool-calls"` against the step cap above.
      // The reader waits about half a minute and gets an empty bubble — no
      // answer, no error, nothing to act on. It is the same defect the deep
      // tier already handles: `deep.ts` detects exactly this condition and
      // reports it as incomplete. The conversational path did not.
      //
      // THE DISCRIMINATOR IS THE STEP COUNT, and getting it wrong would break
      // the feature. A turn ending on tool calls with no text is the NORMAL
      // shape of a navigation handoff: `goTo` and `flyTo` have no server
      // `execute`, so the SDK finishes the step and the browser runs them —
      // and a following leg carries the words. Speaking here would talk over
      // him mid-journey. Only a turn that reached the CAP has genuinely run
      // out of room, which is why this reads `steps.length` and not
      // `finishReason` alone.
      //
      // It is written as a text delta rather than an error part on purpose:
      // this is something to say to the reader, and it belongs in his voice in
      // the transcript rather than in a failure surface. What it must never do
      // is claim an answer it does not have.
      // ── WHY THIS LEG STOPPED ───────────────────────────────────────────────
      //
      // `finishReason` is returned on every call and used to be read here, used
      // for control flow, and discarded — so a reply that ended mid-word could
      // not be told apart from one that simply finished. Migration 046 gives it
      // a column; this is what fills it.
      //
      // WRITTEN HERE RATHER THAN IN `onFinish`, and that is the whole fix. The
      // first attempt used `streamText`'s `onFinish` callback, which races the
      // close of the merged UI stream: the write landed on a closed writer, the
      // catch swallowed it, and every turn recorded NULL. Verified against
      // production — two turns on the build that shipped it, both NULL, which
      // is exactly what "declared but never exercised" looks like when the
      // declaration is a callback nobody watched fire.
      //
      // `execute` is still running at this point — it is already awaiting
      // `result.steps` below for the empty-turn guard — so the writer is
      // provably open. Awaiting the promise form makes the ordering ours
      // instead of the SDK's.
      //
      // Transient, like the chips: a fact about a moment, and it must not enter
      // message history where the model would read its own stop reason back as
      // context next turn.
      try {
        const finishReason = await result.finishReason
        writer.write({
          type: 'data-decke-finish',
          data: { finishReason: String(finishReason ?? 'unknown').slice(0, 40) },
          transient: true,
        })
      } catch {
        // An aborted turn has no finish reason and needs no diagnostic. This
        // must never take the turn down with it.
      }

      try {
        capReached = capReached || await meteredCapReached(usage)
        const steps = await result.steps
        // Only when the cap actually cut him off: a reply that finished on its
        // own ('stop') on the step that crossed the cap is complete, and telling
        // the reader it was not would be false.
        if (capReached && !capLineWritten && steps.at(-1)?.finishReason !== 'stop') {
          writer.write({ type: 'text-delta', id: 'metered-cap', delta: meteredCapText() })
          capLineWritten = true
          guardFired = true
        }
        const spoke = steps.some((s) => (s.text ?? '').trim().length > 0)
        if (!capReached && !spoke && steps.length >= MAX_STEPS) {
          console.warn(
            `[deck-e] turn exhausted its ${MAX_STEPS}-step budget without answering; ` +
              'the reader was told rather than left with an empty bubble.',
          )
          writer.write({
            type: 'text-delta',
            id: 'step-budget-exhausted',
            delta:
              'I went round in circles on that one and ran out of room before I could ' +
              'answer — I never got to the reply. I can continue from a narrower angle.',
          })
          // The circles guard COUNTS toward the one-guard-per-turn budget — if it
          // wrote, no turn-guard below may fire. Never stack nudges.
          guardFired = true
        }
      } catch {
        // A turn that failed hard has its own error path. This is only here to
        // catch the SILENT case, and it must not manufacture a second failure.
      }

      // ── TURN-END GUARDS: the four control-flow gaps the prompt could not close
      //
      // MINE FINDING (owner's 28-conversation history):
      //   (a) EMPTY ANSWERS — 13 of 28 turns: data tools ran, ZERO answer text,
      //       finishReason 'tool-calls'/null at 1–11 steps. The circles guard
      //       above fires only at the 24-step cap, so a shorter empty turn
      //       went untouched. Quotes: "You didn't fucking show me it at all";
      //       "you told me you weee escorting me. You didn't actually DO it".
      //   (b) TRUNCATION — answers cut mid-sentence on finishReason 'length'
      //       ("Here's your Mewtwo (Base").
      //   (c) FLAILING — 12–24 tool calls, 5–12 errors across DIFFERENT tools/
      //       args, so the per-tool repeat ledger and empty-run counter never
      //       fired. Quote: "He's doing tons of tool calls for absolutely zero
      //       reason."
      //   (d) PHANTOM ACTIONS / UNGROUNDED IDS — the answer said "I'm creating
      //       the list now" / "I just wiped it clean and rebuilt it" / "pulling
      //       both up" while NO write or navigation tool was called (5 of 28
      //       turns, the angriest quotes); or named a card id no tool returned
      //       ("search returned me02-013, answer said me02-125").
      //
      // This codebase has twice measured prompt-only fixes at zero, so these are
      // detectors + a text-delta injection, not prompt rules. See
      // `decke/turnGuards.ts` for the pure logic pinned by its own test.
      //
      // ONE GUARD PER TURN. The first match in the fixed priority order below
      // writes and the rest are skipped; the circles guard above has already
      // claimed the turn if it fired. The meter/credits refusal returns before
      // the stream (see `meterTurn`), so this block is never reached on a
      // refused turn — the "never inject when the meter refused" rule holds by
      // construction.
      //
      // MECHANISM: the note is written as a `text-delta`, the SAME injection
      // the circles guard uses — the proven, minimal writer.write this file
      // already has. A second full model step was considered and rejected for
      // this pass as non-minimal and untestable in a Vercel function; the
      // detectors carry the decision logic and the note is the spec's verbatim
      // nudge text. See `notes.md` for the trade.
      try {
        if (guardFired) {
          // The circles guard already wrote this turn. Never stack.
        } else {
          const steps = await result.steps
          const answerText = steps.map((s) => (s.text ?? '')).join('\n')
          const calledToolNames = []
          for (const s of steps) for (const c of (s.toolCalls ?? [])) calledToolNames.push(c.toolName)
          const phases = guardEvents.map((e) => e.phase)
          // THE TOOLS THAT ACTUALLY REACHED A RESULT, by name. This is the
          // definition `turnGuards.ts` states for `completedToolNames` — a
          // completed `guardEvent` — and the empty-answer guard's held-write
          // carve-out is meaningless without it. It shipped in #138 with the
          // call site passing three of five arguments, so `completedToolNames`
          // defaulted to `[]`, every called tool read as PENDING, and the guard
          // returned false on every reachable call. A guard that cannot fire is
          // this repository's most repeated defect; `chatWiring.test.ts` now
          // pins the argument list.
          const completedToolNames = guardEvents
            .filter((e) => e.phase === 'ok' || e.phase === 'partial' || e.phase === 'error' || e.phase === 'declined')
            .map((e) => e.name)
          // The per-step shape the promise detector needs: it has to know
          // whether anything RAN after the last thing said, which only the step
          // order can answer. See `promisedWithoutActing`.
          const turnSteps = steps.map((s) => ({
            text: s.text ?? '',
            toolNames: (s.toolCalls ?? []).map((c) => c.toolName),
          }))
          // `result.finishReason` is an already-settled promise by this point;
          // awaiting it again is cheap and keeps this block self-contained.
          const finishReason = await result.finishReason.catch(() => undefined)
          const turnTroubled =
            needsContinuation(String(finishReason ?? '')) || shouldFireFlailing(phases, answerText)
          const earlierTurnToolNames = turnToolNames(messages)
          const latestUserMessage = messages.filter((message) => message?.role === 'user').at(-1)
          const latestUserIndex = latestUserMessage ? messages.lastIndexOf(latestUserMessage) : -1
          const declinedThisTurn = [...declinedCalls(messages.slice(latestUserIndex + 1))]
            .some((key) => key.startsWith('add_battle_log\u0000'))
          const approvalCallIds = new Set(
            steps.flatMap((step) => (step.content ?? [])
              .filter((content) => content.type === 'tool-approval-request')
              .map((content) => content.toolCallId)),
          )
          const approvalRequestedFor = steps.flatMap((step) => (step.toolCalls ?? [])
            .filter((call) => approvalCallIds.has(call.toolCallId))
            .map((call) => call.toolName))

          // THE NOTE IS READER-FACING. A text-delta renders in the transcript
          // as Deck-E's own words (exactly like the circles guard's line above)
          // — so every note is an honest first-person admission the reader can
          // act on, never an instruction addressed at the model. It also lands
          // in the replayed history, where the model reads its own admission on
          // the next leg — the corrective signal rides the same sentence.
          // (Orchestrator correction 2026-08-29: the first cut of these strings
          // was written TO the model and would have rendered as gibberish.)
          let note = null
          let corrective = null
          let pasteBackstop = false
          if (needsContinuation(String(finishReason ?? ''))) {
            // (b) TRUNCATION — cut off mid-sentence.
            note = ' …I got cut off mid-sentence there, before I finished the thought.'
          } else if (shouldFireFlailing(phases, answerText)) {
            // (c) FLAILING — too many errors across the turn AND the turn did
            // not recover into a substantive answer. `errorBudgetExceeded`
            // alone told a turn that flailed and then answered well that it had
            // flailed, which is a correction for something it fixed. The bare
            // predicate stays in `stopWhen`, where it must trip mid-flight
            // before any answer exists.
            const chips = guardEvents
              .filter((e) => e.phase === 'error')
              .map((e) => ({ name: e.name, title: e.title }))
            note =
              `\n\nI kept hitting walls there. ${summarizeFailures(chips)} ` +
              'I need to take a different route from here.'
          } else if (
            needsAnswerNudge(answerText, calledToolNames, CLIENT_SET, completedToolNames, SERVER_SET)
          ) {
            // (a) EMPTY ANSWER — tools ran, no client tool, nothing said.
            // ALL FIVE ARGUMENTS. The held-write and panel carve-outs are the
            // whole of this guard's precision and both of them read the last
            // two; see `completedToolNames` above for what happened without.
            note =
              'I looked things up and then never actually answered you — that\'s on me. ' +
              'The findings are still in this conversation.'
          } else {
            // (d) PHANTOM ACTIONS / PROMISES / UNGROUNDED IDS — only meaningful
            // AFTER the model produced text, which is why this branch is last:
            // (a) above already owned the empty-text turn.
            const phantoms = phantomClaims(answerText, calledToolNames)
            // (d2) A PROMISE THE TURN THEN ENDED ON. Ranked below (d) because
            // claiming an action already happened is the worse of the two, and
            // above the ungrounded-id caution because a promise nobody kept is
            // the whole reader-visible turn rather than one detail in it.
            const promised = promisedWithoutActing(turnSteps, CLIENT_SET, completedToolNames)
            const ungrounded = ungroundedCardIds(answerText, observedIds)
            // (d0) THE AFTER-TURN AUDIT. Jev reads the reply against the
            // reader's message; a claimed change no tool made gets ONE
            // corrective leg that raises the real consent card, and any other
            // claimed action the admission below. "Performed" is every tool
            // this TURN touched — an approved write runs at the start of this
            // request, before any step. Null (off, slow, unsure) is exactly the
            // chain below. See `decke/audit.ts`.
            const audit = calledToolNames.some((n) => CLIENT_SET.has(n))
              ? null
              : await auditTurn({
                  message: latestUserText(messages),
                  reply: answerText,
                  toolsRun: [...calledToolNames, ...guardEvents.map((e) => e.name), ...turnToolNames(messages)],
                  key,
                  signal: abortSignal,
                })
            const fixable = audit?.phantom ? CORRECTIVE_TOOLS[audit.phantom] : undefined
            if (fixable && steps.length < MAX_STEPS) {
              corrective = fixable
            } else if (phantoms.length > 0 || audit?.phantom) {
              note =
                '\n\nOne correction: I talked about doing that just now, but I never actually ran it — ' +
                'nothing has changed.'
            } else if (promised) {
              note =
                '\n\nAnd then I stopped: I said I was about to go and do that, and I never ran anything — ' +
                'so nothing came back and nothing changed.'
            } else if (ungrounded.length > 0) {
              note =
                `\n\nA caution: I named ${ungrounded.join(', ')} without looking it up this turn — ` +
                'don\'t trust that detail until it is verified.'
            }
          }

          // ── A PASTED LOG MUST REACH ITS CONSENT CARD ─────────────────────
          //
          // Production had two first legs where a real Live log was pasted and
          // `add_battle_log` was never called. This is deliberately below the
          // ordinary audit: it is a backstop only when no other corrective leg
          // won, and only on the first HTTP leg. Approval and browser-tool
          // continuations replay a tool part after the latest user message, so
          // `turnToolNames` is the existing boundary rather than a new flag.
          if (
            pasteBackstopNeeded({
              pastedInLatestUserMessage: extractPastedLog(latestUserMessage ? [latestUserMessage] : []) !== null,
              firstLegOfTurn: earlierTurnToolNames.length === 0,
              calledToolNames,
              approvalRequestedFor,
              declinedThisTurn,
              clientToolRan: [...calledToolNames, ...earlierTurnToolNames].some((name) => CLIENT_SET.has(name)),
              correctiveChosen: corrective !== null,
              turnTroubled,
            }) &&
            !capReached &&
            steps.length + 3 <= MAX_STEPS
          ) {
            corrective = 'add_battle_log'
            pasteBackstop = true
            // The logging card is the one useful recovery. Do not stack an
            // empty-answer or caution note immediately above its own bridge.
            note = null
          }

          if (note) {
            guardFired = true
            writer.write({ type: 'text-delta', id: 'turn-guard', delta: note })
          }

          // ── THE CORRECTIVE LEG ────────────────────────────────────────────
          //
          // The same tools and prompt prefix, with the corrective tool pinned.
          // An audit correction gets one step; a pasted log gets three so it can
          // rank decks and then apply against the best match. Nothing is written
          // until the reader confirms: the pinned tool holds its change for the
          // signed card. Both ride inside this request's flat charge and the
          // MAX_STEPS check above.
          if (corrective) {
            guardFired = true
            writer.write({
              type: 'text-delta',
              id: 'turn-guard',
              delta: pasteBackstop ? PASTE_BACKSTOP_LINE : CORRECTION_LINE,
            })
            const leg = streamText({
              model: observeUsageModel(gateway(choice.id), meter),
              providerOptions: chatProviderOptions(choice),
              instructions: cachedInstructions(
                choice,
                `${systemPrompt}\n\n${pasteBackstop ? pasteBackstopInstruction() : correctiveInstruction(corrective)}`,
              ),
              // EVERY step's messages, not `result.response.messages`: in ai@7 that is the
              // FINAL step only, so the correction ran without the turn's earlier tool
              // calls and results (measured 2026-09-28, scripts/decke-replay-probe.mjs).
              messages: [...preparedMessages, ...(await result.steps).flatMap((step) => step.response.messages)],
              tools: correctiveApplyTools(allDeckeTools, corrective),
              toolChoice: isAnthropic(choice) ? 'auto' : { type: 'tool', toolName: corrective },
              stopWhen: pasteBackstop ? stepCountIs(3) : stepCountIs(1),
              ...(process.env.DECKE_APPROVAL_SECRET
                ? { experimental_toolApprovalSecret: process.env.DECKE_APPROVAL_SECRET }
                : {}),
              maxOutputTokens: budgetFor(choice),
              abortSignal,
              onError: ({ error }) => {
                console.error('[deck-e] corrective leg error', safeUsageCode(error))
              },
            })
            writer.merge(stripToolSyntax(toUIMessageStream({ stream: leg.fullStream, sendReasoning: false, onError: surfaceError })))
            const asked = (await leg.steps.catch(() => [])).some((st) =>
              (st.content ?? []).some((c) => c.type === 'tool-approval-request'),
            )
            if (!asked) writer.write({ type: 'text-delta', id: 'turn-guard', delta: CORRECTION_FAILED_LINE })
          }
        }
      } catch {
        // A guard must never manufacture a second failure on a turn that may
        // already have one. The detection is best-effort; the turn stands.
      }
      } catch (error) {
        usage.failed = true
        improvementError = { code: safeUsageCode(error) }
        throw error
      } finally {
        try {
          await meter.refund()
        } finally {
          await finishAiRequest(usage, 'completed', meter.spent)
          if (typeof conversationId === 'string' && Number.isSafeInteger(seq) && seq >= 0) {
            const payload = await improvementPayload(messages, result, improvementEvents, improvementError)
            await recordImprovementWithDeadline(chatPool(), {
              userId: user.id,
              conversationId,
              seq,
              requestId: usage.id,
              leg: 0,
              payload,
            })
          }
        }
      }
    }),
  })

  // ── THE BALANCE RIDES ON A HEADER ────────────────────────────────────────
  //
  // A header rather than a stream part, and the reason is that the browser must
  // be able to read it on a turn that produced NOTHING — an aborted stream, a
  // turn the reader stopped. A part only exists if the stream got far enough to
  // emit one, which is exactly the turn where "how much is left" is least
  // certain and most worth knowing.
  //
  // `-1` means credit charging is off. The client renders nothing for it rather than
  // guessing a balance, because a made-up number on a screen about money is
  // worse than no number.
  return createUIMessageStreamResponse({
    stream,
    headers: {
      'x-decke-credits':
        meter.credits && (typeof meter.balance === 'string' && /^-?\d+(?:\.\d+)?$/.test(meter.balance) || Number.isFinite(meter.balance)) ? String(meter.balance) : '-1',
      // The threshold too, so the panel does not carry a second opinion about
      // what "low" means. The server prices the work; it is the only thing that
      // knows whether what is left still buys the expensive one.
      'x-decke-credits-low': String(quote.policy.lowBalance),
    },
  })
  } catch (error) {
    await meter.refund()
    throw error
  }
}

async function improvementPayload(messages, result, events, error) {
  const steps = result ? await result.steps.catch(() => []) : []
  const finishReason = result ? await result.finishReason.catch(() => null) : null
  const filter = createNarrationFilter()
  const rawAnswer = steps.map((step) => step.text ?? '').join('')
  const answered = filter.push(rawAnswer) + filter.end()
  const results = new Map()
  for (const step of steps) {
    for (const toolResult of step.toolResults ?? []) {
      results.set(toolResult.toolCallId, toolResult.output)
    }
  }
  const eventByCall = new Map()
  for (const event of events) {
    const current = eventByCall.get(event.id) ?? {}
    eventByCall.set(event.id, {
      started_at: current.started_at ?? event.at,
      finished_at: event.phase === 'start' || event.phase === 'progress' ? current.finished_at : event.at,
      phase: event.phase,
    })
  }
  const toolCalls = []
  for (const step of steps) {
    for (const call of step.toolCalls ?? []) {
      const timing = eventByCall.get(call.toolCallId) ?? {}
      toolCalls.push({
        id: String(call.toolCallId),
        name: String(call.toolName),
        args: call.input ?? call.args ?? null,
        output: results.has(call.toolCallId) ? results.get(call.toolCallId) : null,
        phase: timing.phase ?? (results.has(call.toolCallId) ? 'ok' : 'pending'),
        ...(approvalFor(messages, call.toolCallId) ?? {}),
        ...(timing.started_at ? { started_at: timing.started_at } : {}),
        ...(timing.finished_at ? { finished_at: timing.finished_at } : {}),
      })
    }
  }
  return {
    asked: latestUserText(messages),
    answered,
    finish_reason: finishReason == null ? null : String(finishReason).slice(0, 80),
    error,
    tool_calls: toolCalls,
  }
}

function approvalFor(messages, toolCallId) {
  for (const message of messages) {
    for (const part of Array.isArray(message?.parts) ? message.parts : []) {
      if (part?.toolCallId !== toolCallId) continue
      const approved = part.approval?.approved ?? part.approved
      if (typeof approved !== 'boolean') continue
      return {
        approval: {
          approved,
          ...(typeof part.approval?.reason === 'string' ? { reason: part.approval.reason } : {}),
        },
      }
    }
  }
  return null
}

async function recordImprovementWithDeadline(db, record) {
  let timer
  try {
    await Promise.race([
      autoShareAndRecordLeg(db, record),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), 1_500) }),
    ])
  } catch {
    // Collection is observational. It must never turn a completed reply into
    // a failed chat response.
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The reader's OWN latest message, as plain text.
 *
 * Assistant turns are skipped deliberately: Deck-E says "Normal" constantly,
 * and letting his words count as the reader naming a printing would restore the
 * exact defect `readerNamedPrinting` exists to close.
 */
function latestUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'user') continue
    const parts = Array.isArray(m.parts) ? m.parts : []
    return parts
      .filter((p) => p?.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join(' ')
  }
  return ''
}

/**
 * The replayed conversation flattened to strings, for cross-leg id seeding.
 *
 * Walks every message's `parts` and collects the string content a card id could
 * be hiding in: text parts (user and assistant), tool-call `input` serialised,
 * and tool-result `output` / `state` strings. The point is not a faithful
 * transcript — it is a CHEAP sweep for ids the conversation already carried, so
 * `seedObservedIds` can mark them observed before this turn's tools run. See the
 * seeding block beside `observedIds` and `decke/turnGuards.ts`'s
 * `seedObservedIds`.
 */
function replayedText(messages) {
  if (!Array.isArray(messages)) return []
  const out = []
  for (const m of messages) {
    const parts = m?.parts
    if (!Array.isArray(parts)) continue
    for (const p of parts) {
      if (!p || typeof p !== 'object') continue
      if (p.type === 'text' && typeof p.text === 'string') {
        out.push(p.text)
        continue
      }
      // Tool parts: the input (may carry ids the reader/model typed) and any
      // output / state string (tool results are where ids come from).
      if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
        if (p.input && typeof p.input === 'object') {
          try {
            out.push(JSON.stringify(p.input))
          } catch {
            /* non-serialisable input is not a seeding concern */
          }
        }
        if (typeof p.output === 'string') out.push(p.output)
        if (typeof p.state === 'string') out.push(p.state)
        if (typeof p.result === 'string') out.push(p.result)
      }
    }
  }
  return out
}

/**
 * Only completed tool results may ground cards shown from prior turns.
 *
 * Recent turns replay full `output-available` parts, which only a tool can
 * produce. The compacted lookup record of an older turn is NOT accepted, even
 * though it is marked: it travels as an ordinary text part, and the model sees
 * that format in its own history, so a reply that merely starts with the
 * marker would ground ids no tool ever returned (Astra, PR #270). A deck needs
 * no help here — `showDeck` grounds the printings its own check resolves — and
 * a card grid from a long-gone turn is re-searched.
 */
function replayedToolOutputs(messages) {
  if (!Array.isArray(messages)) return []
  const out = []
  for (const message of messages) {
    if (!Array.isArray(message?.parts)) continue
    for (const part of message.parts) {
      if (
        typeof part?.type !== 'string' ||
        !part.type.startsWith('tool-') ||
        part.state !== 'output-available'
      ) continue
      if (typeof part.output === 'string') out.push(part.output)
      else if (part.output !== undefined) {
        try {
          out.push(JSON.stringify(part.output))
        } catch {
          /* malformed replay evidence is ignored, never fatal */
        }
      }
    }
  }
  return out
}

/**
 * Drop `express` tool calls from history before replaying it to the model.
 *
 * The transient data part never enters history, but the TOOL CALL that produced
 * it does — and it is both a token cost on every later turn and a worked example
 * of command syntax sitting in the model's own context, which is exactly the
 * thing most likely to end up echoed as prose. The animation has already
 * happened; the model does not need to remember how it asked.
 */
function stripPriorCommands(messages) {
  return messages.map((m) => {
    if (!Array.isArray(m.parts)) return m
    const parts = m.parts.filter(
      (p) => !(typeof p?.type === 'string' && p.type.startsWith('tool-express')),
    )
    return parts.length === m.parts.length ? m : { ...m, parts }
  })
}


/**
 * Tool syntax that reached the reader as prose, removed.
 *
 * Nothing left here but the warning, and that is the point. The algorithm moved
 * to `decke/narration.ts` first, because it needed testing: the original held
 * from the LAST `<` rather than the first, so given `<express><comm` it
 * released the opening tag and then carefully guarded the fragment after it.
 * Nine tests, every one fed in FRAGMENTS, because the measured failure arrived
 * split across deltas and a whole-string test would have passed while
 * production kept leaking.
 *
 * The STREAM WIRING stayed behind, and that half went on being untestable — a
 * Vercel function is untyped, unimportable, and driven only by a deployment.
 * It is also where the ordering lives: when the held tail is released, and
 * which text block it belongs to. An orphan-delta bug was found there by
 * review, not by a test, because no test could reach it. So it moved too, and
 * this file keeps only the one thing that is genuinely local to it — a
 * `console.warn` that goes to Vercel's log.
 */
function stripToolSyntax(stream) {
  return stripToolSyntaxImpl(stream, () => {
    console.warn(
      '[deck-e] stripped tool syntax from visible text — the model narrated its own ' +
        'plumbing instead of calling the tool, so the action did NOT happen',
    )
  })
}

/**
 * THE RUNTIME HANDS US NODE'S `(req, res)`, NOT A WEB `Request`.
 *
 * This file was written as `(request) => Response` and deployed that way, and
 * every request died on `request.headers.get is not a function` — thrown inside
 * `userFromRequest`, which runs before the body is ever read. That detail sent
 * the first two diagnoses the wrong way: a malformed body came back 500 instead
 * of 400, which reads exactly like a module that failed to load, when in fact the
 * module loaded fine and the handler crashed on its first line of real work.
 *
 * `images.mjs` takes `(req, res)`; `index.mjs` and `mcp.mjs` export Express apps,
 * which are also `(req, res)`. Every function in this project that has ever
 * worked uses the Node signature. This one now does too.
 *
 * The web-standard shape is kept above rather than rewritten, because the AI SDK
 * produces a `Response` and streaming it is the point. So the boundary adapts:
 * a `Request` in, and the response body pumped out chunk by chunk — flushed per
 * chunk, since an SSE stream that arrives in one buffer at the end is not a
 * stream.
 */
export default async function handler(req, res) {
  try {
    const host = req.headers.host ?? 'localhost'
    const url = `https://${host}${req.url ?? '/'}`
    const method = req.method ?? 'GET'
    // CAPPED WHILE IT ARRIVES (SEC-04). This buffered the whole body with no
    // limit, which was the first half of the unbounded-conversation finding.
    // Refused here, before auth, because nothing about a body this size is
    // worth verifying a token for.
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBodyCapped(req)
    if (body === null) {
      res.statusCode = 413
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'That message is too long for Deck-E to read in one go.', code: 'body_too_large' }))
      return
    }
    // ONE CONTROLLER PER REQUEST, aborted when the socket dies.
    //
    // Node tells us the client went away; the AI SDK and the tool layer both
    // take an `AbortSignal`; nothing was connecting the two. Without this,
    // pressing stop left the model streaming to nobody — billing the whole
    // time — and left any tool call holding its pooled connection on an
    // instance about to be frozen.
    //
    // Guarded on `writableEnded` so a NORMAL completion, which also emits
    // 'close', does not fire an abort that downstream code would read as "the
    // reader gave up".
    const ac = new AbortController()
    const onClose = () => {
      if (!res.writableEnded) ac.abort()
    }
    res.on('close', onClose)

    const out = await serve(
      new Request(url, { method, headers: req.headers, body, signal: ac.signal }),
    )

    res.statusCode = out.status
    out.headers.forEach((value, name) => res.setHeader(name, value))
    if (!out.body) {
      res.end()
      return
    }
    const reader = out.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(Buffer.from(value))
        if (typeof res.flush === 'function') res.flush()
      }
    } finally {
      res.end()
    }
  } catch (err) {
    // Surfaced, not swallowed: an unhandled throw here is an opaque
    // FUNCTION_INVOCATION_FAILED with no stack in the response, which is what
    // made this bug take three deploys to find.
    console.error('[decke] /api/chat failed:', safeUsageCode(err))
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'deck-e could not answer that' }))
    } else {
      res.end()
    }
  }
}
