# R2 — Deck-E agent backend: models, latency, streaming protocol, tool-call surfacing

Scope: `apps/api/src/decke/**`, `api/chat.mjs`, `apps/web/src/character/host/{useDeckeChat,runtime,uiTools,DeckeChat}.ts(x)`, `DECKE-AGENT-SPEC.md`, `DEPLOYMENT.md`, `vercel.json`, `apps/api/src/decke/__tests__/**`, `scripts/decke-gates.mjs`, `scripts/decke-signed-probe.mjs`. All line numbers are from the repo at the time of writing (`ai@7.0.66`, `@ai-sdk/gateway@4.0.52`).

---

## 1. Request lifecycle — precise trace

**Client send** (`apps/web/src/character/host/useDeckeChat.ts:171-479`, wire building in `streamLeg` at `useDeckeChat.ts:525-681`):

1. `send(text)` aborts any in-flight turn (`abortRef.current?.abort()`, `useDeckeChat.ts:188`), creates a fresh `AbortController`, sets `decke.setState('thinking')` (`useDeckeChat.ts:195`), and appends the user message to `wire`.
2. `streamLeg` does `POST /api/chat` (`useDeckeChat.ts:550-562`) with body `{ messages, route: window.location.pathname, landmarks: collectLandmarks() }`. `landmarks` is capped client-side at `LANDMARK_CAP = 40` (`useDeckeChat.ts:768`) and re-capped server-side at 40 (`api/chat.mjs:463`).
3. Response is read as raw SSE (`res.body.getReader()`, `useDeckeChat.ts:570`), manually split on `\n`, `data:` lines JSON-parsed per line (`useDeckeChat.ts:576-602`) — this is a hand-rolled reader, not `@ai-sdk/react`'s `useChat` (rationale documented at `useDeckeChat.ts:1-41`: this is a Vite SPA and the `data-decke` transient parts need bespoke handling).
4. A turn may take multiple **legs**: a client-tool call (`flyTo`/`highlight`/`goTo`/`scrollToMe`/`click`) has no server `execute`, so it ends the server-side stream (`finishReason: "tool-calls"`), the browser runs the tool via `runUiTool` (`uiTools.ts:196-285`) **after the leg's stream finishes** (`useDeckeChat.ts:396-419`, sequential `await runUiTool` inside a `for` loop, not parallel), then POSTs a new leg with the tool's `{ok, reason}` result appended. `legBudget()` bounds the total legs (`approval.ts`, referenced `useDeckeChat.ts:46-48, 239`).
5. An approval request (`tool-approval-request` chunk) pauses the whole turn on a `Promise` parked in `resolverRef` (`useDeckeChat.ts:153-224`) until the reader clicks Approve/Deny in `DeckeChat.tsx:595-645`.

**HTTP entry point** (`api/chat.mjs`, its own Vercel function, NOT the Express app — see file header `api/chat.mjs:1-38` for why):

6. `handler(req, res)` (`api/chat.mjs:745-802`) takes Node's `(req, res)`, not a web `Request` — this was the bug fixed in commit `751f380`/PR-visible comment at `api/chat.mjs:726-744`. It builds an `AbortController` wired to the socket's `close` event (`api/chat.mjs:762-766`), reads the whole body into a buffer (`readBody`, `api/chat.mjs:719-723` — **this itself is a full-body buffer, not a stream, but request bodies are small JSON so this isn't a latency factor**), constructs a web `Request`, calls `serve(request)`, then pumps the *response* body chunk-by-chunk with `res.write(...)` + `res.flush?.()` (`api/chat.mjs:778-785`).
7. `serve()` (`api/chat.mjs:261-668`): method check → gateway-key check (503 if unset) → JWT verify (`userFromRequest`, 401) → **server-side entitlement check** `isDeckeEntitled(user.id)` (403, before body parsing — `api/chat.mjs:284-286`) → body parse (400 on malformed) → **the meter** (`charge(user.id, 'chat_turns')`, 429 on cap) → build `toolCtx` → construct `createUIMessageStream({ execute })`.

**The meter — one blocking DB round trip before the model is ever called** (`api/chat.mjs:175-252`, `apps/api/src/decke/meter.ts:1-48`):

8. One `pool.connect()` + one `chargeSql()` query against Postgres, guarded by a `Promise.race` deadline of `DECKE_METER_TIMEOUT_MS` (default 5000 ms, `api/chat.mjs:156`). Measured cost, stated directly in `meter.ts:24-30`: **~90 ms** (DB is in a different AWS region from the function), against a **593 ms median TTFT** for the chat model — i.e. **the meter alone adds roughly 15% to first-token latency on every single turn**, unavoidably, because the charge must happen before spend. Fails open on DB unavailability (serves unmetered, logs loudly), fails closed on entitlement (a separate, non-DB check).

**Inside `execute` — the model call and tool loop** (`api/chat.mjs:396-665`):

9. `createGateway({ apiKey: key })` (`api/chat.mjs:407`) — one dedicated Gateway credential (`DECKE_VERCEL_AI_GATEWAY_KEY`), separate from the marketing-image key.
10. `streamText({ model: gateway(choice.id), instructions: buildSystemPrompt(...), messages: await convertToModelMessages(stripPriorCommands(messages)), tools: allDeckeTools, stopWhen: [...], prepareStep: ..., maxOutputTokens: budgetFor(choice), abortSignal, onError })` (`api/chat.mjs:449-652`).
    - `tools` = 7 cosmetic tools (`buildTools`, `decke/tools.ts`) + 23 data tools (`buildDataTools`, `adapters/aisdk.ts`, `include: () => true` so **writes are reachable**, gated by `needsApproval`) + 4 deep tools (`buildDeepTools`, `decke/deep.ts`) = **34 tools total**.
    - `stopWhen` = `stepCountIs(12)` **or** a custom predicate requiring the model to have spoken text at some point in the turn AND the last step's only tool calls be `express`/`showScreen` (`api/chat.mjs:534-573`) — i.e. up to 12 sequential model calls (each a full re-billing of the whole prompt) per server turn.
    - `prepareStep` narrows `activeTools` on step 0 only (`focus.ts:94-101`) — everything is visible from step 1 onward.
11. The result is piped: `writer.merge(stripToolSyntax(toUIMessageStream({ stream: result.fullStream, sendReasoning: false })))` (`api/chat.mjs:661-663`) — `stripToolSyntax` is the narration-leak filter (`narration.ts`), a `TransformStream` that holds back partial `<tag`-looking text until it can decide whether to strip it (`narration.ts:259-311`).
12. `createUIMessageStreamResponse({ stream })` returns a `Response` whose `.body` is the `ReadableStream` that `api/chat.mjs`'s handler then pumps to `res` (step 6).

**Wire event types** (from `wire.test.ts`, `useDeckeChat.ts:586-673`, `tools.ts`, `aisdk.ts`, `narration.ts`) — every `data:` line is one JSON object with a `type`:

| `type` | Emitted by | Shape | Client handling |
|---|---|---|---|
| `text-start` / `text-delta` / `text-end` | model text stream (or narration-filter's synthetic tail, id `'narration'`) | `{type, id, delta?}` | `onText` appends `delta` to `saidSoFar` and the visible bubble (`useDeckeChat.ts:603-605`) |
| `data-decke` | server `express` tool's `execute` (`tools.ts:277`), **transient** | `{type:'data-decke', data:{commands:[...]}, transient:true}` | `onCommands` → `apply()` drives the 3D engine (`useDeckeChat.ts:606-607, 829-865`); never enters history |
| `data-decke-screen` | server `showScreen` tool's `execute` (`tools.ts:414`), **transient** | `{type:'data-decke-screen', data:{screen}, transient:true}` | `onScreen` attaches a `ScreenSpec` to the current message (`useDeckeChat.ts:618-620`) |
| `data-decke-tool` | `emitToolEvent` wrapper around **every** data/deep tool's `execute` (`api/chat.mjs:387-394`, `adapters/aisdk.ts:338-366`, `deep.ts:259-283`), **transient** | `{type:'data-decke-tool', data:{phase:'start'\|'ok'\|'error', id, name, title, summary?}, transient:true}` | `onToolChip` upserts a chip on the message keyed by `id` (`useDeckeChat.ts:621-628, 263-278`) |
| `tool-input-available` | SDK, for **every** tool call once its arguments are fully parsed — server-executed or client-executed alike | `{type:'tool-input-available', toolCallId, toolName, input}` — **no `state` field** (pinned by `wire.test.ts:155-173`) | If `isClientTool(toolName)`: queued into `out.pending` for the browser to run after the leg ends (`useDeckeChat.ts:654-673`). If not: just remembers name/title/input for a possible later approval request (`useDeckeChat.ts:642-653`) — **no visible action**, since server tools already announce via `data-decke-tool` |
| `tool-approval-request` | SDK, when a `needsApproval` tool is called | `{type:'tool-approval-request', approvalId, toolCallId, signature?}` | Collected into `out.approvals`, pauses the turn for a human decision (`useDeckeChat.ts:629-641`) |
| `error` | SDK, a value on an otherwise-200 stream | `{type:'error', errorText? / error?}` | `onHttpError`-style handling via `outcome.error`; ends the leg loop (`useDeckeChat.ts:608-617`) |
| (HTTP-level) 401/403/429/503 | `api/chat.mjs` pre-stream guards | JSON body `{error, retryAfterDay?}` | `onHttpError(status)` maps to a canned spoken sentence (`useDeckeChat.ts:280-294`) |

---

## 2. Model table

All model choices live in `apps/api/src/decke/models.ts:55-303`, keyed by `Job` (`chat`/`write`/`vision`/`analysis`/`research`). Every entry was measured against the live Gateway on 2026-08-21/22, not read off a pricing sheet (file header, `models.ts:1-15`). Hard constraint: US frontier labs only.

| Job | id (`models.ts:` line) | fallback | effort | maxOutputTokens (real budget via `budgetFor`, `models.ts:305-317`) | Used where | Notes |
|---|---|---|---|---|---|---|
| `chat` | `spacexai/grok-4.20-non-reasoning` (`models.ts:138`) | `google/gemini-2.5-flash` (`models.ts:179`) | none (non-reasoning) | 1200 (no `effort` ⇒ no ×2.5 reserve) | The **only** model for ordinary conversation, all navigation, and every turn's driving loop — `api/chat.mjs:396,449` | Chosen 2026-08-22 over `grok-4.1-fast-non-reasoning` specifically to fix `flyTo` reliability (0/5 → 5/5). Costs 7.49× more per turn ($0.01153 vs $0.00154) and is **slower in every measured scenario**: median TTFT **1148 ms** vs the prior model's **811 ms** (`models.ts:129-131`, `models.ts:159-167` table). The earlier "593 ms" and "663 ms" TTFT figures in the file are from *older* bake-offs of the *replaced* model on a smaller (6- or 10-tool) loop — they no longer describe what ships. |
| `write` | `openai/gpt-5-mini` (`models.ts:193`) | `anthropic/claude-haiku-4.5` | `low` | 1500 → 3750 | Same 34-tool set as `chat` for the actual write execution (write tools are reachable from step 1 via `focus.ts`'s `CONVERSATIONAL_WRITE = 'log_cards'`) — **but this `write` `ModelChoice` entry is not actually wired into `api/chat.mjs`'s single `streamText` call**, which always uses `MODELS.chat`. It is unused dead configuration for the conversational path (see §3 buffering note). |
| `vision` | `spacexai/grok-4.1-fast-non-reasoning` (`models.ts:223`) | `amazon/nova-lite` | none | 400 | Card-scan flow, not the chat path | Not part of this trace |
| `analysis` | `anthropic/claude-sonnet-5` (`models.ts:261`) | `openai/gpt-5.1-thinking` | `high` | 3000 → 7500 | `plan_deck`, `analyze_collection`, `write_strategy_guide` sub-agents (`deep.ts:307,335,422`) | `escalate: 'anthropic/claude-opus-5'` — only when `deepest: true`, which the tool schemas forbid the model from setting on its own initiative (`deep.ts:301-304`). Real-world cost for a full `plan_deck`: **$0.50–$1** per call (`models.ts:255-258`). |
| `research` | `openai/o3-deep-research` (`models.ts:299`) | `openai/gpt-5.1-thinking` | none | 2500 | `research_meta` sub-agent (`deep.ts:369-402`) — the **only** live-web path | This is a deep-research model that does its own provider-side browsing; the code has **zero visibility or control** into what it searches (see §6). No tools are given to this sub-agent at all (deliberately, `deep.ts:385-387`). |

**Reasoning-effort caveat, stated explicitly in the code** (`deep.ts:146-165`, spec §14 "not built" list): `effort` on a `ModelChoice` **only** widens the `maxOutputTokens` reserve (×2.5 via `RESERVE`, `models.ts:313`). **No code anywhere sends a provider-specific reasoning-effort parameter** (no `reasoningEffort`, no `thinking.budgetTokens`) to the Gateway. So the `analysis` tier's `effort: 'high'` does not actually ask Claude Sonnet 5 to think harder — it only reserves more output tokens against the (separately real) risk of a reasoning model spending its whole budget on hidden reasoning and returning empty content (`models.ts:305-311`).

---

## 3. Latency budget — stage by stage, with the buffering points named

| Stage | Cost | Evidence | Streams incrementally? |
|---|---|---|---|
| Body read (`readBody`) | Small — request JSON only | `api/chat.mjs:719-723` | N/A (whole-body read, but body is tiny) |
| JWT verify | Local (JWKS-cached), sub-ms to low-ms | `api/chat.mjs:95-107` | N/A |
| Entitlement check | In-process, env-var lookup | `entitlement.ts` | N/A |
| **Meter (chargeSql)** | **~90 ms, unavoidable, sequential before the model call** | `meter.ts:24-30`, `api/chat.mjs:156,175-252` | No — one blocking round trip |
| Chat model TTFT | **~1148 ms median** (current `MODELS.chat`) | `models.ts:129-131` | Yes, once the first token starts |
| Each subsequent step (up to 12) | Another full model call, re-billing the whole prompt+history+landmarks+tool defs every time | `api/chat.mjs:493-534` (`stepCountIs(12)`) | Yes per-step, but each step is a fresh request with its own TTFT |
| **A "deep" tool call** (`plan_deck`/`analyze_collection`/`write_strategy_guide`/`research_meta`) | **20 s (measured example, Opus) up to `DECKE_DEEP_BUDGET_MS` = 210,000 ms (3.5 min) hard ceiling** | `models.ts:236`, `deep.ts:79-82`, `DEPLOYMENT.md:202` | **No.** See below — this is the single biggest buffering point in the whole system. |
| **`research_meta` specifically** | Same 210 s ceiling, running `openai/o3-deep-research`, a model class known for multi-minute live-research turns | `deep.ts:369-402` | No |
| Function hard ceiling | `maxDuration: 300` (`vercel.json`, `api/chat.mjs` function config) | `vercel.json:39-42` | — |

### The buffering point that explains "it just hung"

`runSubAgent` (`deep.ts:109-190`) calls `streamText(...)` for the sub-agent and does:

```ts
for await (const delta of result.textStream) {
  text += delta;
}
```

(`deep.ts:172-174`). **Every delta the sub-agent produces is accumulated into a local string and never forwarded to the parent stream.** The only signal the outer turn/reader gets for the *entire duration* of a deep-tool call is:

1. One `data-decke-tool` chip with `phase: 'start'` the instant `execute` begins (`deep.ts:261`, `adapters/aisdk.ts:340`).
2. **Nothing else** until the sub-agent finishes or times out (up to 210 s), at which point a single `data-decke-tool` chip with `phase: 'ok'`/`'error'` and the SDK's own top-level text stream resumes.

This is a genuine, structural full-buffer: a tool whose own model is itself streaming has that stream **thrown away** and re-serialized as one blob at the very end. For `research_meta` against `o3-deep-research`, this is the direct mechanism behind "it sat in this state long enough that I doubted it was working" — the chip says "Research the current meta…" and then, correctly, nothing changes on screen for up to several minutes.

### Why chips "get dumped all at once"

Multiple tool calls made by the **same model step** (parallel tool use, on by default in the AI SDK — confirmed in `wire.test.ts:188-212`, where a single mocked step emits `goTo` then `express` and both `tool-input-available`/`data-decke-tool` chunks land in the same short read window) all announce their `phase: 'start'` chip within the same step, before any of them have run. For a "research-y" question the chat model (`grok-4.20-non-reasoning`) plausibly decides in one step to call several tools together (e.g. a data lookup plus `research_meta`) — all of their start-chips appear together, which is exactly "he just get dumped all at once … apparently the tools he intends to use." Nothing in the architecture staggers or defers the announcement of a parallel batch; `data-decke-tool` fires the instant each tool's own `execute` wrapper begins (`adapters/aisdk.ts:338-344`), and for tools invoked in parallel that instant is nearly simultaneous.

### Other buffering / flush considerations

- `res.flush?.()` in `api/chat.mjs:784` is a no-op unless something (e.g. compression middleware) attaches a `.flush` method to the Node response — on stock Vercel Node functions this is almost certainly `undefined`, meaning chunk delivery relies on ordinary `res.write()` behavior rather than a forced flush. Not confirmed to cause a problem, but it's the one place in the pump loop that silently degrades to a no-op if the assumption is wrong.
- `narration.ts`'s `stripToolSyntax` (`narration.ts:259-311`) holds text back only as far as the last `<` that could start a tool tag (`holdFrom`, `narration.ts:145-171`) — bounded, small, and not a real latency contributor for ordinary prose (confirmed by the file's own design notes).
- Each of the up to 12 server-side steps *and* each client-tool "leg" re-sends the **entire prompt** (system prompt with the full 34-tool schema + all 40 landmarks + full message history) — `useDeckeChat.ts:743-767` estimates ~600 tokens of landmarks per leg alone, up to ~3600 tokens across a 6-leg worst case. This is a real, compounding TTFT cost on multi-leg journeys, separate from the deep-tool buffering above.

---

## 4. Tool-chip semantics — exact mechanism, quoted

**Server side**, the chip is emitted by the *adapter's own execute wrapper*, never by the model (`adapters/aisdk.ts:51-64`, comment block):

> "EMITTED FROM HERE, not from the model. A chip the model could ask for would be a second surface to fabricate on … Every chip corresponds 1:1 to a real invocation of a real handler, by construction, because this is the only code that emits one."

The actual emission (`adapters/aisdk.ts:338-366`):
```ts
execute: async (args: unknown, { toolCallId }) => {
  const chip = { id: toolCallId, name: def.name, title: def.title };
  opts.onEvent?.({ phase: 'start', ...chip });
  try {
    ...
    opts.onEvent?.({ phase: result.isError ? 'error' : 'ok', ...chip, summary: summarise(result) });
    return text;
  } catch (err) {
    opts.onEvent?.({ phase: 'error', ...chip, summary: message });
    return `That did not work: ${message}`;
  }
},
```
`onEvent` is `emitToolEvent(writer)` from `api/chat.mjs:387-394`, which writes `{ type: 'data-decke-tool', data: event, transient: true }` onto the UI message stream.

**Client side**, `onToolChip` upserts by id (`useDeckeChat.ts:263-278`):
```ts
onToolChip: (chip) => {
  setMessages((m) =>
    m.map((x) =>
      x.id === replyId
        ? { ...x, tools: [...(x.tools ?? []).filter((c) => c.id !== chip.id), chip] }
        : x,
    ),
  )
},
```
Rendered in `DeckeChat.tsx:519-540` as a `<ul>` of pill chips, text `${t.title}…` while `phase === 'start'`, else `t.title`, with `t.summary` in a `title` tooltip attribute.

**Why they "just get dumped all at once"**: as established in §3, this is a direct, faithful rendering of the *server's own* tool-call timing — the chip mechanism itself is correct and progressive per event; the "dumped" appearance is the model choosing to call several tools in one parallel batch (all `start` events land together) and then a deep tool's `ok`/`error` not arriving for a long time afterward (buffered, §3). There is no batching bug in the transport or the renderer — the batching is upstream, in the model's own tool-call planning and in the deep-tool's swallowed internal stream.

---

## 5. Narration — what exists, what it does NOT do

`decke/narration.ts` is a **leak filter**, not a narration/interstitial system. Its entire job (file header, `narration.ts:1-69`) is to catch cases where the model writes its own tool-call syntax as visible prose (e.g. `<express><commands>...`) instead of actually calling the tool, and strip that malformed text out of what the reader sees before it reaches the bubble. It:

- Operates as a `TransformStream` over `text-delta` parts only (`narration.ts:259-311`).
- Has no concept of "between tool calls" — it does not run at tool-call boundaries, does not know when a tool starts or finishes, and never itself emits any user-facing text of its own except the rare synthetic "tail" flush described in its header (`narration.ts:244-257`), which is a bug-avoidance mechanism, not a feature.
- Never reaches the client as a distinct signal — its *product* is simply "the same `text-delta` stream, with fewer bytes in it." The client cannot tell narration-filtering happened at all except via `console.warn` on the server (`api/chat.mjs:709-716`).

**There is no interstitial-narration system anywhere in this codebase.** The model is never prompted to say something short before or between tool calls, and there is no server-side scaffolding that would inject such text. The closest existing analogue is:
- The tool chip's `title` (e.g. "Search cards…"), which is a static label from the tool definition, not model-generated narration (`adapters/aisdk.ts:80,339`, `tools.ts:399`).
- The prompt's own restraint rule ("silence is a valid emission", referenced in `models.ts:113-120`) which actively discourages extra chatter, and the `express` tool's `done` message explicitly tells the model **not** to describe its own actions in words (`tools.ts:307-309`, `tools.ts:425-427` for `showScreen`).

**What would be needed to add "okay, I've looked at your collection, now let me do some research"-style narration**, based on what the wire protocol can already carry:
1. A new event type (or reuse of `text-delta` under a dedicated block id) emitted between steps of the *same* `streamText` call — the SDK's `prepareStep` (already used in `focus.ts`) fires between steps and could be a hook point to inject a short spoken line, but nothing writes to `writer` from inside `prepareStep` today.
2. For the deep-tool case specifically (the one that actually needs it, since it's the one that goes silent for up to 210 s), the sub-agent's own `for await (const delta of result.textStream)` loop in `deep.ts:172-174` would need to forward *something* (even a heartbeat, even the sub-agent's own streamed prose) back through `opts.onEvent` or a new writer channel, rather than silently accumulating into `text`.
3. The model would need an explicit prompt contract for when a short spoken beat is appropriate (current prompt actively discourages narrating actions — this would need to be a distinct, bounded exception, likely server-composed rather than model-composed to avoid becoming "a second fabrication surface" per the codebase's own stated design principle for chips (`DECKE-AGENT-SPEC.md:576-577`).

---

## 6. Web search — what exists and what the user is told

**No `web_search` (or any) server-tool type is declared anywhere in `apps/api/src/decke/`** (confirmed by grep — zero hits for `web_search`/`webSearch` in the decke source). The only live-web capability is the `research_meta` deep tool (`deep.ts:351-403`), which:

- Delegates entirely to `openai/o3-deep-research` (`models.ts:299`), a model that does its **own provider-side browsing** — the application code has no visibility into, or control over, what URLs it fetches or what it searches.
- Is explicitly *not* given the Gateway's `include_domains`/`allowed_domains` injection control, because `models.ts:280-289` records that `@ai-sdk/gateway`'s `gatewayTools.exaSearch` (which would expose that control) is not actually exported at runtime by the pinned SDK version, and the owner chose to stay on the US-frontier-labs allowlist rather than switch to Perplexity/Exa, which would have exposed it.
- Holds **zero tools** itself (`maxSteps: 1`, no `tools` key, `deep.ts:388-391`) — a deliberate control so nothing it reads can become an action, not a capability limitation to relax casually.
- Is announced to the user as exactly one opaque chip: `{name: 'research_meta', title: 'Research the current meta'}` (`deep.ts:352-353`), `start` then (after up to 210 s) `ok`/`error` with a 110-character summary (`deep.ts:275`). **There is no sub-event for "searching for X", no list of sources found progressively, and no citation surfacing until the whole call returns** — the returned text is expected to contain citations (the sub-agent's own instructions demand "CITE YOUR SOURCES with URLs", `deep.ts:377-378`), but those only appear in the final answer text, never as a distinct visual/chip signal during the search.

**To "show when he's searching the web"** would require either (a) surfacing intermediate state from `o3-deep-research`'s own reasoning/search-progress if the Gateway/OpenAI API exposes it as streamable events (not currently consumed — `runSubAgent` only reads `result.textStream`, discarding any other stream part types), or (b) switching to a first-party `web_search_20260209` tool (per current Claude/OpenAI server-tool APIs) which emits a distinct `web_search_tool_result` content block per search — but this is currently unused anywhere in this codebase, and adopting it for Claude models would be a provider change from the current `o3-deep-research` choice.

---

## 7. Back-navigation suspects — every path that could trigger history navigation

**No explicit `history.back()`, `history.pushState`, `history.replaceState`, or `popstate` handling exists anywhere in `apps/web/src`** (confirmed by repo-wide grep — zero hits). The relevant navigation surface is entirely TanStack Router's `useNavigate()`.

The one and only navigation call in the whole Deck-E path:

```ts
// DeckeHost.tsx:143-144
const navigate = useNavigate()
const chat = useDeckeChat(live, (to) => navigate({ to }), () => setTravelling(true))
```

This is invoked from `goTo`'s client-side handler (`uiTools.ts:261-277`, `ctx.navigate(route)` at line 274) with **no `replace: true` option passed**. TanStack Router's default `navigate()` **pushes** a new history entry rather than replacing the current one. Concretely:

- Every page Deck-E takes the user to via `goTo` becomes its own entry in browser history, indistinguishable from a page the user navigated to themselves.
- A multi-leg journey (§2.2 of the spec, `useDeckeChat.ts` leg loop) can push several such entries in quick succession during one long response.
- If the user presses the browser/mouse "back" button during or shortly after a long Deck-E response, it will step back through **pages Deck-E visited**, not necessarily back to where the user was before opening the chat — this reads exactly as "a spurious back-navigation / browser hiccup during a long response," with no code defect required to produce it; it's a direct consequence of using push-navigation for an agent-driven, possibly multi-hop journey.
- A secondary contributor: aborting a turn (`stop()`, `abortRef.current?.abort()`) happens at the fetch/stream level only — it does **not** and cannot un-navigate a `goTo` that already committed on a prior leg (`useDeckeChat.ts:404` checks `ac.signal.aborted` only *after* each `runUiTool` completes, so a navigation that has already fired when the user hits Stop stays fired).

No other candidate path was found: `runUiTool`'s `click` handler does real DOM `el.click()` (`uiTools.ts:252`) which could, in principle, trigger an in-app router `<Link>`'s own navigation — but that is still forward push-navigation via the same router, not a "back" action, and is guarded to same-origin, allowlisted routes (`uiTools.ts:160-177`).

---

## 8. Test / gate inventory — what constrains changes here

**Unit tests** (`apps/api/src/decke/__tests__/`, all `node --test`, no browser, no live model):

| File | What it pins |
|---|---|
| `wire.test.ts` | The exact SSE wire shape the SDK emits for tool calls (`tool-input-available` has **no** `state` field; server- and client-executed tools announce identically; approval request/response round-trips through `convertToModelMessages`) — this is the file that caught the original "browser tools never ran" defect |
| `aisdk.test.ts` | `buildDataTools` default is read-only-only; annotation-based (not name-based) filtering; `dataToolSummary` matches the actual tool set; `clampToolText` truncation behavior and announcement; `safeToolError` never leaks driver/DB error text |
| `narration.test.ts` / `narrationStream.test.ts` | The tag-stripping regex behavior (fragment-safe across streamed deltas) and the stream-transform wiring (`stripToolSyntax`) |
| `approval.test.ts` | Approval signing/replay semantics |
| `tools.test.ts` | The 7 cosmetic tools (`buildTools`), `validateCommand`, route allowlist |
| `prompt.test.ts` | System prompt construction |
| `screens.test.ts` | `showScreen` payload sanitisation and grounding enforcement |
| `grounding.test.ts` | Card-id grounding regex and partitioning |
| `meter.test.ts`, `entitlement.test.ts`, `rls.test.ts` | Metering SQL/verdict logic, entitlement set logic, RLS session watchdog behavior |

None of these unit tests exercise real network timing, real model latency, or the browser — by design (`decke-gates.mjs` header explicitly calls this out: "every unit test in this repo passed the whole time" while the actual browser-side tool execution was completely broken for months).

**Browser gates** (`scripts/decke-gates.mjs`, 2562 lines, Playwright-driven against a real deployment): asserts *evidence*, not model self-report — e.g. `page.url()` for a claimed navigation, a `tool-` part in the actual network request body for a claimed lookup. This is the file most likely to catch any regression from changes to the streaming/tool-chip protocol, and the natural place to add an assertion like "chips for a parallel tool batch must not all read `start` for more than N seconds" if that becomes a fixed requirement.

**`scripts/decke-signed-probe.mjs`** (151 lines): a fast, non-browser probe specifically for the signed-approval round trip against a live deployment (asserts that stripping the approval signature causes the turn to fail with a 2-chunk `start`→`error`, vs. 19 chunks when signed correctly) — useful as a template for a similarly narrow probe of chip/timing behavior.

**CI**: `.github/workflows/ci.yml` runs `node --test` (the unit tests above) on every push; the Playwright gates and the signed probe are **not** part of CI (documented as deliberately excluded — Playwright is a verification tool an operator runs, not a CI dependency, `decke-gates.mjs:33-46`).

---

## 9. Concrete levers — ranked, with effort/risk

1. **Stream the deep-tool's own text back to the client, live, instead of buffering it into one blob.** (High impact, medium effort/risk.) `deep.ts:172-174`'s `for await` loop already has every delta; forwarding it through a new transient event (or reusing `data-decke-tool` with a `progress` phase carrying delta text) turns the single 210-second silence into a genuinely streaming sub-answer. Risk: the sub-agent's raw prose is not written in Deck-E's voice (`deep.ts:216-220` — deliberately, "these sub-agents produce a document that Deck-E then talks about") so surfacing it raw would need UI treatment distinct from his own speech bubble (e.g. inside the existing chip's expanded/tooltip state, or a dedicated "research panel" mid-stream).

2. **Add a short model-authored or server-composed narration beat when a deep tool starts**, distinct from the existing static chip title. (Medium impact, medium effort.) E.g. compose a fixed sentence per deep-tool name server-side ("Let me look into that — this can take a minute...") emitted once as a real `text-delta` on `start`, so at minimum the multi-minute wait is explicitly explained rather than silently implied by a chip alone. Lower-risk than #1 because it doesn't touch the sub-agent's own stream — just adds one deterministic sentence at the point `onEvent({phase:'start'})` already fires (`deep.ts:261`).

3. **Stagger the reveal of parallel tool-call chips instead of showing every `start` at once.** (Low-medium impact, low-medium effort.) Since the parallel-batch "dump" is a UI-timing artifact of the model's own step, the client could hold newly-arrived `start` chips for a short beat (e.g. append with a tiny stagger) purely for perceived pacing — cosmetic and reversible, no protocol change needed (`useDeckeChat.ts:263-278` is the only place to touch).

4. **Lower `DECKE_DEEP_BUDGET_MS` for `research_meta` specifically, or set a realistic user-facing expectation before it's called** (Low effort, low risk). 210 s is a shared ceiling across four very different deep tools; `research_meta`'s own live-web latency profile is likely the worst of the four and could reasonably get its own (possibly shorter, possibly just better-messaged) budget, paired with lever #2.

5. **Consider whether `MODELS.chat`'s 2026-08-22 model swap traded away too much latency for the `flyTo` fix.** (High impact if reverted, but reopens a real correctness regression — high risk.) The current model (`grok-4.20-non-reasoning`) is measurably slower (1148 ms vs 811 ms TTFT) and 7.49× costlier than its predecessor for every ordinary turn, not just research-y ones — this is baseline TTFT that affects *every* conversation, and is worth re-litigating only alongside a fix for the `flyTo` defect it was chosen to solve (owner call, not a code fix).

6. **Wire an actual reasoning-effort parameter for the `analysis`/`research` tiers**, since today `effort` only widens the token reserve and does nothing to the model's actual reasoning depth (`deep.ts:146-165`). (Medium effort — needs a live per-vendor probe per the code's own stated caution — low risk if done narrowly.) Not obviously a latency *win* (more real reasoning could mean slower, not faster) but closes a gap between what the field name implies and what it does, and could be tuned deliberately for a latency/quality tradeoff instead of the current accidental default.

7. **Confirm `res.flush` in `api/chat.mjs:784` is actually doing something on the deployed runtime**, and if it's a no-op, evaluate whether chunk delivery needs an explicit flush mechanism. (Low effort to check, low risk.) Not evidenced as an active problem, but it's the one silent-degrade point in the whole pump loop and worth a direct check (e.g. log `typeof res.flush` in production once) before ruling it out as a contributor to "no updates for a long time."

8. **Add `replace: true` semantics (or explicit history management) to Deck-E-driven navigation**, or otherwise mark Deck-E-initiated history entries so a user's physical back-press can distinguish "back to where I was" from "back through what he showed me." (Low-medium effort, low risk.) Directly addresses §7's back-navigation complaint; the fix is entirely in `DeckeHost.tsx:144`'s `navigate({ to })` call and/or `uiTools.ts:274`.
