---
date: "2026-08-21"
title: "Deck-E's brain: its own function, and the schema keyword that cost an afternoon"
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["agents","data","decks"]
supersedes: []
---
## 2026-08-21 — Deck-E's brain: its own function, and the schema keyword that cost an afternoon
**Decided by:** Claude Opus 5 on behalf of @cheyras.
**Decision:** `POST /api/chat` is a standalone Vercel function (`api/chat.mjs`),
not a route on the Express app. Animation commands reach the browser as
TRANSIENT data parts emitted from inside a tool's `execute`. Consequential UI
actions are client-side tools. `navigate` is allowlisted at the tool layer.
Model routing lives in `apps/api/src/decke/models.ts` with every rejection
recorded next to its evidence.

**Why the separate function:** `apps/api/src/index.ts:119` holds one pooled
Postgres connection for the life of every request and reclaims it at 30 s, on
the written assumption that "No endpoint in this API streams or long-polls." A
streaming chat route inside Express would cap concurrent Deck-E users at the
pool max (12, contract B2) and sever every conversation at thirty seconds — and
because the RLS path is `SUPABASE_MODE`-gated, none of it reproduces locally. A
production-only failure. Vercel gives filesystem routes precedence over
`vercel.json` rewrites, so the new file claims the path with no config change.

**Why commands are transient data parts:** the model calls a tool and the TOOL
writes the commands. There is no inline syntax to leak, no parser to half-parse,
and no stripping pass to get wrong — the brief's "commands must never be
visible" becomes structurally impossible rather than defended against. Verified
under five adversarial turns: no `{"op":` shaped text ever reached the text
channel.

### The bug that ate the afternoon, and the measurement error under it

`grok-4.1-fast` accepts `minLength` only at the TOP level of a tool's parameter
object. Nested deeper — a string inside an array inside an array item, which is
exactly what `z.string().min(1)` produced for the `cards` field — xAI rejects
the ENTIRE request. It arrives as an `error` part on an HTTP 200, the tool is
never called, and nothing in the message names the offending field. Bisected
against the live API: baseline PASS, `+ minLength` FAIL, `+ additionalProperties`
PASS, both FAIL. `maxLength`, `pattern` and numeric bounds are fine at any
depth. `grok-4.1-fast-non-reasoning` and `-reasoning` both fail;
`grok-4.20-non-reasoning` passes, so it is a 4.1-fast family defect.

**The real lesson is the measurement, not the keyword.** Hours went into blaming
`z.union`/`anyOf`, tool descriptions, the em-dash in a description, the writer
object and the UI-stream wrapper — all wrong, and all "confirmed" by tests that
drained the stream with `for await (const _ of result.fullStream) {}`. **An
`error` part is not a thrown exception**, so that loop reports success on a
stream that carried nothing but an error. Every "20/20 passing" result was a
false pass, and each one was then used to rule out the actual cause. What broke
the deadlock was capturing the real HTTP request with a `fetch` interceptor and
diffing a passing call against a failing one: byte-identical url, headers and
body, which proved the difference had to be in the harness rather than the
payload.

Two rules worth keeping: **assert a positive** (non-empty text, or a real tool
call) rather than only catching exceptions; and **go to the wire early** — the
capture took two minutes and disproved a theory that had already cost dozens of
calls.

### Three fixes for one duplicate-reply bug

A tool call opens another step, and in that step a model that has already
answered answers again, near-verbatim. Two obvious fixes both shipped a worse
bug: `hasToolCall('express')` as a stop condition SILENCED him (he does not
reliably speak before he moves, so stopping on the call ends the turn with zero
text — all five probe turns went silent), and a "you are done" note in the tool
result was unreliable, fixing one run and regressing the next. The working fix
is a stop condition on "this step produced BOTH visible text AND an `express`
call" — precisely a finished turn, while a step that only moves him leaves the
loop open so he can still speak.

### Other things measured

- **`claude-haiku-4.5` is NOT a safe fallback for this tool.** In both trials it
  emitted `{"op":"nod_yes"}` — `nod_yes` is a `value`, not an `op`, and is not in
  the `op` enum. Systematic, so `validateCommand` would drop the first half of
  every reaction. The fallback is `google/gemini-2.5-flash`, one of only two
  models measured to produce clean arguments (1784 ms TTFT against grok's 593 —
  a real regression, but a fallback runs when the primary is down, where
  correct-and-slower beats fast-and-wrong).
- **Nothing but grok rejected the envelope.** nova-lite, haiku-4.5, gpt-5-mini,
  gpt-4.1-mini and both Geminis all accept it; `gpt-5-nano` accepts it and then
  spends its entire token budget on hidden reasoning, returning nothing.
- **The Gateway key must go through `createGateway({ apiKey })`.** Passing it as
  a `headers` entry is silently ignored and the call goes out on the ambient
  `AI_GATEWAY_API_KEY` — with two keys on different billing, that means spending
  the wrong one while believing otherwise.
- `convertToModelMessages` is **async** in ai@7; unawaited it fails deep inside
  `standardizePrompt` as "messages.some is not a function".
- `@ai-sdk/gateway` must match what `ai` pins (4.0.52). Installing 4.0.59
  alongside it produces "Unsupported gateway protocol version".
- A free-tier Gateway key authenticates, lists all 350 models, and then returns
  a bare 429 on every one of them — no `retry-after`, no `x-ratelimit-*`. Model
  fallback does not help; it is a billing state, not an outage.

**Implications:** `DECKE_VERCEL_AI_GATEWAY_KEY` is declared in `DEPLOYMENT.md`
and `.env.example`, warned about at boot, and reported on `GET /health` as
`deckeGate` (B11). `ai` moved from root devDependencies to a real dependency of
`deckpal-api`. The command schema is flat with an `op` enum plus
`validateCommand`; a union is the stronger contract and is now known to work on
grok, so it is worth revisiting — `gpt-5-mini` and `gpt-4.1-mini` both "stuff
every optional field", which a union prevents by construction.

---

