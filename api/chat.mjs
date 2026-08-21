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
 * everything else into Express. This function never opens a database
 * connection. Reads and writes are ordinary short REST calls to the Express
 * API, carrying the user's own JWT — so Deck-E has exactly the permissions the
 * signed-in user has, enforced by the same RLS policies, and no service-role
 * credential exists anywhere on this path.
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

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const key = gatewayKey()
  if (!key) {
    // Observable rather than silent: the client shows Deck-E as unavailable and
    // `/api/health` reports the same fact. B11, rule 2.
    return json({ error: 'deck-e is not configured on this deployment' }, 503)
  }

  const user = await userFromRequest(request)
  if (!user) return json({ error: 'sign in to talk to deck-e' }, 401)

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
