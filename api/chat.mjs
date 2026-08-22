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

  let client
  try {
    client = await Promise.race([
      chatPool().connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('meter: pool connect timed out')), METER_TIMEOUT_MS),
      ),
    ])
    const res = await Promise.race([
      client.query(chargeSql(tier), [userId, cap]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('meter: query timed out')), METER_TIMEOUT_MS),
      ),
    ])
    return verdictFrom(res.rows, cap)
  } catch (err) {
    console.error(
      `[deck-e] METER UNAVAILABLE — serving ${tier} unmetered for this request. ` +
        `Accounting fails open on purpose; entitlement does not. Cause:`,
      err?.message ?? err,
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

      const result = streamText({
        model: gateway(choice.id),
        // `instructions`, not `system` — `system` is deprecated in ai@7 and
        // `instructions` is the field that accepts a SystemModelMessage, which
        // is where a prompt-cache breakpoint can attach. Our prompt carries the
        // whole animation vocabulary on every turn, so caching is load-bearing.
        instructions: buildSystemPrompt({
          route: typeof route === 'string' ? route : '/',
          signedIn: true,
          landmarks: Array.isArray(landmarks) ? landmarks.slice(0, 24) : [],
        }),
        // AWAITED: `convertToModelMessages` is async in ai@7 and returns a
        // Promise<ModelMessage[]>. Passing it unawaited fails deep inside
        // `standardizePrompt` as "messages.some is not a function" — which
        // names neither this call nor the missing await.
        messages: await convertToModelMessages(stripPriorCommands(messages)),
        tools: buildTools(writer),
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
        stopWhen: [
          stepCountIs(4),
          ({ steps }) => {
            const last = steps[steps.length - 1]
            if (!last) return false
            const spoke = (last.text ?? '').trim().length > 0
            // `showScreen` counts as acting for exactly the same reason
            // `express` does: the step produced something the user can see, so
            // the turn is finished. Left out, a step that spoke AND drew a panel
            // failed the test, the loop opened another step, and he said his
            // closing line a second time — measured on the probe:
            //   [step 1] "Nice pulls! That 91 looks chase-y. Add 'em to the collection?"
            //   [step 2] "Say the word and I'll stash these in your collection."
            const ACTS = new Set(['express', 'showScreen'])
            const moved = (last.toolCalls ?? []).some((c) => ACTS.has(c.toolName))
            return spoke && moved
          },
        ],
        maxOutputTokens: budgetFor(choice),
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
      writer.merge(toUIMessageStream({ stream: result.fullStream, sendReasoning: false }))
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
    const out = await serve(new Request(url, { method, headers: req.headers, body }))

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
