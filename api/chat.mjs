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
const MAX_STEPS = 12
import { createGateway } from '@ai-sdk/gateway'

// Everything imported here comes from `apps/api/dist` — COMPILED output, not
// source. `apps/web` builds a browser bundle and its `.ts` files are never
// emitted as Node-importable JS, so the character's own directory is the wrong
// home for anything a serverless function has to load. These modules live in
// `apps/api/src/decke/` for that reason, and because a system prompt and a tool
// allowlist are server concerns in the first place.
import { verifySupabaseJwt, createSupabaseJwksProvider } from '../apps/api/dist/auth.js'
import { buildSystemPrompt } from '../apps/api/dist/decke/prompt.js'
import { buildTools } from '../apps/api/dist/decke/tools.js'
import { MODELS, budgetFor } from '../apps/api/dist/decke/models.js'
import { isDeckeEntitled } from '../apps/api/dist/decke/entitlement.js'
import { capFor, chargeSql, refusalText, verdictFrom } from '../apps/api/dist/decke/meter.js'
import { buildDataTools, dataToolSummary } from '../apps/api/dist/decke/adapters/aisdk.js'
import { apiBaseFor } from '../apps/api/dist/decke/ctx.js'
import { buildDeepTools } from '../apps/api/dist/decke/deep.js'
import { stripToolSyntax as stripToolSyntaxImpl } from '../apps/api/dist/decke/narration.js'
import { focusedTools } from '../apps/api/dist/decke/focus.js'
import { createGrounding } from '../apps/api/dist/decke/grounding.js'
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
async function charge(userId, tier) {
  const cap = capFor(tier)
  if (cap <= 0) return { allowed: false, used: 0, cap }

  /**
   * Race against a deadline, and CLEAR THE TIMER when the race settles.
   *
   * Both halves matter and they pull opposite ways. A timer left running keeps
   * this function alive for the full five seconds after a meter that answered
   * in ninety milliseconds — on a serverless platform billed by wall clock, on
   * the hot path of every single turn. And `unref()`ing it instead is the bug
   * CI just caught one layer down in `rls.ts`: an unref'd timer does not hold
   * the loop open, so the case the timer EXISTS for — something that never
   * settles — is exactly the case where the process can exit with the race
   * pending.
   *
   * Clearing on settle is the version that is right in both directions.
   */
  const withDeadline = (promise, what) => {
    let timer
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`meter: ${what} timed out`)), METER_TIMEOUT_MS)
    })
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
  }

  let client
  try {
    client = await withDeadline(chatPool().connect(), 'pool connect')
    const res = await withDeadline(client.query(chargeSql(tier), [userId, cap]), 'query')
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
    const raw = String(err?.code ?? err?.name ?? '')
    const code = /^[A-Za-z0-9_]{1,32}$/.test(raw) ? raw : 'unrecognised'
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
  if (!isDeckeEntitled(user.id)) {
    return json({ error: 'deck-e is not available on this account' }, 403)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'malformed body' }, 400)
  }

  const { messages, route = '/', landmarks = [] } = body ?? {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'messages must be a non-empty array' }, 400)
  }

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
  const meter = await charge(user.id, 'chat_turns')
  if (!meter.allowed) {
    // A SPOKEN REFUSAL, not a 500. The browser turns this status into his own
    // words in the transcript, so a budget reads as a budget rather than as a
    // malfunction. 429 and not 403: the account is entitled, it has simply
    // spent today's allowance, and those are different sentences.
    return json({ error: refusalText('chat_turns', meter.cap), retryAfterDay: true }, 429)
  }

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
  const bypass = request.headers.get('x-vercel-protection-bypass')

  const toolCtx = {
    pool: chatPool(),
    userId: user.id,
    jwt: user.token,
    apiBase: apiBaseFor(host),
    signal: abortSignal,
    ...(bypass ? { selfHopHeaders: { 'x-vercel-protection-bypass': bypass } } : {}),
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
  const emitToolEvent = (writer) => (event) => {
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
    execute: async ({ writer }) => {
      // EXPLICIT PROVIDER, EXPLICIT KEY.
      //
      // Passing the key as a `headers` entry does nothing: the gateway provider
      // reads `apiKey` (or falls back to the ambient `AI_GATEWAY_API_KEY`), so a
      // header named anything else is silently ignored and the call goes out on
      // whatever key happens to be in the environment. That is not a cosmetic
      // bug — this deployment has two keys with different billing, and the
      // failure mode is spending the wrong one while believing otherwise.
      const gateway = createGateway({ apiKey: key })

      // ONE PER TURN, shared by every tool in it. What a data tool returns on
      // step one is what `showScreen` may draw on step three — evidence is a
      // property of the turn, not of a call.
      const grounding = createGrounding()

      const allDeckeTools = {
        ...buildTools(writer, grounding),
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
          onEvent: emitToolEvent(writer),
          // ONLY HERE. The deep tier's sub-agents below get no
          // `onApprovalPreview`, because there is no reader watching a dialog
          // for them — and with nobody listening the adapter runs no preview at
          // all, so a sub-agent pays nothing for a card it cannot show.
          onApprovalPreview: emitApprovalPreview(writer),
          grounding,
        }),
        // THE DEEP TIER. Four sub-agents, each with its own model, step
        // budget and tool subset — see `decke/deep.ts`.
        //
        // Tools rather than a router: a classifier turn in front of every
        // message taxes the 90% that do not need one, and a misroute is
        // INVISIBLE — the answer still arrives, quietly worse, and nothing
        // says a cheap model answered a question that needed an expensive
        // one. A tool call, by contrast, appears in the log.
        //
        // Each charges `deep_calls`, which is capped separately and far
        // tighter than conversation because it is ~250x the price.
        ...buildDeepTools({
          ctx: toolCtx,
          gateway,
          charge: async () => charge(user.id, 'deep_calls'),
          onEvent: emitToolEvent(writer),
        }),
      }

      const result = streamText({
        model: gateway(choice.id),
        // `instructions`, not `system` — `system` is deprecated in ai@7 and
        // `instructions` is the field that accepts a SystemModelMessage, which
        // is where a prompt-cache breakpoint can attach. Our prompt carries the
        // whole animation vocabulary on every turn, so caching is load-bearing.
        instructions: buildSystemPrompt({
          route: typeof route === 'string' ? route : '/',
          signedIn: true,
          // MIRRORS `LANDMARK_CAP` in `apps/web/src/character/host/useDeckeChat.ts`,
          // which explains why the cap exists (prompt size, re-billed per leg)
          // and what it costs. Sliced again here because the browser chooses
          // what to send and this is the side that pays for it. Change one,
          // change both.
          landmarks: Array.isArray(landmarks) ? landmarks.slice(0, 40) : [],
          // GENERATED FROM THE TOOLS HE IS ACTUALLY HOLDING, three lines below.
          // Hand-writing this list is how the previous prompt came to spend
          // every turn offering to look things up with no tool that could look.
          dataTools: dataToolSummary({ include: () => true }),
        }),
        // AWAITED: `convertToModelMessages` is async in ai@7 and returns a
        // Promise<ModelMessage[]>. Passing it unawaited fails deep inside
        // `standardizePrompt` as "messages.some is not a function" — which
        // names neither this call nor the missing await.
        messages: await convertToModelMessages(stripPriorCommands(messages)),
        // THE BODY AND THE DATA, in one set.
        //
        // `buildTools` is the six cosmetic ones — express, showScreen, and the
        // four the browser runs. `buildDataTools` is the read half of the same
        // 23 tools the MCP server exposes, through the other adapter onto the
        // same definitions. Until this line, every factual claim Deck-E made
        // was the model's training data, because there was nothing else for it
        // to be.
        //
        // READ-ONLY, by the adapter's default: the write half is gated on an
        // approval round-trip that does not exist yet, and a write tool
        // reachable from a conversational model before then is a tool that gets
        // called by accident.
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
        // The second condition is "he has SPOKEN AND MOVED", and it took three
        // attempts to get right. Recording all three, because each looked
        // correct and the first two shipped a worse bug than the one they fixed.
        //
        // The bug: a tool call opens another step, and in that step a model that
        // has already answered answers again — measured, near-verbatim:
        //   [step 1] "Yeah, scalpers grabbing whole cases is the worst…"
        //   [step 2] "Yeah, scalpers grabbing whole cases is the worst…"
        //
        //   1. `hasToolCall('express')` — SILENCED HIM. He does not reliably
        //      speak before he moves; when `express` comes first, stopping there
        //      ends the turn with zero text. All five probe turns went silent
        //      while their states still fired correctly.
        //   2. A "you are done" note in the tool result — UNRELIABLE, and it
        //      silenced him too when worded as "stop here". Reworded to only
        //      forbid repeating, it fixed one run and the duplication returned
        //      on the next. A prompt is not an enforcement mechanism; this file
        //      says so about `click`, and it is just as true here.
        //   3. This: stop when the SAME step produced both visible text and an
        //      `express` call. That is precisely "he said his piece and reacted",
        //      which is a finished turn. A step that only moves him leaves the
        //      loop open so he can still speak.
        //
        // Client tools are unaffected either way: the browser fulfils `flyTo`,
        // `goTo` and friends and answers with `addToolOutput`, which opens a
        // fresh request rather than continuing this one.
        //
        // RAISED FROM 4 TO 12 (spec §8.5). Four was sized for a loop with six
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
          ({ steps }) => {
            const last = steps[steps.length - 1]
            if (!last) return false
            // ── SPOKE AT ANY POINT, not "spoke in this step" ────────────────
            //
            // This used to read `last.text`, which meant the turn only ended if
            // one single step contained BOTH the words and the gesture. With
            // four steps that was nearly always true and the flaw never showed.
            // With twelve, and with real lookups in between, the ordinary shape
            // is: step 1 reads, step 2 answers in words, step 3 draws the
            // panel — and no step ever has both, so the loop ran on.
            //
            // Measured against the deployed preview: "show me my 5 most
            // valuable cards" called `showScreen` THREE TIMES, the second and
            // third with the title wrapped in newlines, each re-billing the
            // whole prompt to redraw a panel that was already correct.
            //
            // A turn is finished when he has SAID something and is no longer
            // fetching. Both halves stated over the whole turn, which is what
            // "he said his piece and reacted" always meant.
            const spoke = steps.some((s) => (s.text ?? '').trim().length > 0)
            // `showScreen` counts as acting for exactly the same reason
            // `express` does: the step produced something the user can see, so
            // the turn is finished. Left out, a step that spoke AND drew a panel
            // failed the test, the loop opened another step, and he said his
            // closing line a second time — measured on the probe:
            //   [step 1] "Nice pulls! That 91 looks chase-y. Add 'em to the collection?"
            //   [step 2] "Say the word and I'll stash these in your collection."
            const ACTS = new Set(['express', 'showScreen'])
            // AND HE IS NO LONGER FETCHING. Not "his last step acted" — his last
            // step acted AND NOTHING ELSE. If it also called a data tool he is
            // mid-lookup, and stopping there would end the turn holding a result
            // he has not reported, which is a silent half-answer and strictly
            // worse than one extra step.
            const lastCalls = (last.toolCalls ?? []).map((c) => c.toolName)
            const settled = lastCalls.length > 0 && lastCalls.every((n) => ACTS.has(n))
            return spoke && settled
          },
        ],
        // ── WHAT HE CAN SEE, PER STEP ─────────────────────────────────────
        //
        // Not a smaller tool set — the same tools, narrowed on the first step.
        // Bisected against the live model on the prompt that broke it ("add
        // 4000 Charizards", which should fire a reaction): with all 34 tools he
        // narrated the command as visible text 5/5 and called `express` 0/5;
        // with the write tools out of view, 1/5 and 1/5.
        //
        // And ten tools was WORSE than twenty-three, so this is not "fewer is
        // better" — it is that eleven ways to mutate a collection should not be
        // crowding the first decision, which is "what is this person asking
        // for". `decke/focus.ts` has the numbers.
        //
        // Everything comes back on step two, so a capability is delayed by one
        // step and never removed.
        prepareStep: ({ stepNumber }) => ({
          activeTools: focusedTools(allDeckeTools, stepNumber),
        }),
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
          console.error('[deck-e] stream error', error)
        },
      })

      // STANDALONE `toUIMessageStream({ stream })`, not `result.toUIMessageStream()`.
      //
      // The method form is deprecated in ai@7 and does not produce a valid UI
      // message stream here — it surfaces as `AI_TypeValidationError` with
      // "expected array, received undefined" at `choices`, which reads like a
      // Gateway protocol problem and is not. Every doc example and both local
      // Vercel skills still show the method form.
      writer.merge(
        stripToolSyntax(toUIMessageStream({ stream: result.fullStream, sendReasoning: false })),
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
      try {
        const steps = await result.steps
        const spoke = steps.some((s) => (s.text ?? '').trim().length > 0)
        if (!spoke && steps.length >= MAX_STEPS) {
          console.warn(
            `[deck-e] turn exhausted its ${MAX_STEPS}-step budget without answering; ` +
              'the reader was told rather than left with an empty bubble.',
          )
          writer.write({
            type: 'text-delta',
            id: 'step-budget-exhausted',
            delta:
              'I went round in circles on that one and ran out of room before I could ' +
              'answer — I never got to the reply. Ask me again, or narrow it down a bit?',
          })
        }
      } catch {
        // A turn that failed hard has its own error path. This is only here to
        // catch the SILENT case, and it must not manufacture a second failure.
      }
    },
  })

  return createUIMessageStreamResponse({ stream })
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

/** Collect a Node request body into a buffer. */
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
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
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
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
    console.error('[decke] /api/chat failed:', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'deck-e could not answer that' }))
    } else {
      res.end()
    }
  }
}
