/**
 * The browser half of the conversation.
 *
 * Deliberately a hand-rolled reader rather than `@ai-sdk/react`'s `useChat`.
 * Two reasons, and the second is the load-bearing one:
 *
 *  1. This app is a Vite SPA, not Next.js. `useChat` works here, but it brings
 *     a transport abstraction whose whole job is talking to a route we already
 *     control end to end.
 *  2. The interesting part of this stream is NOT the text. It is the
 *     `data-decke` parts carrying animation commands, which must reach the
 *     engine the instant they arrive and must never touch the transcript. A
 *     reader we own makes that split explicit and impossible to get wrong by
 *     upgrade.
 *
 * The wire format is the AI SDK's UI message stream: SSE, one JSON object per
 * `data:` line, each with a `type`.
 *
 * ── THE GUARD THAT NEVER MATCHED ─────────────────────────────────────────────
 *
 * Until this file was fixed, Deck-E's browser-side tools had never run. Not
 * once, for anyone. The collector required `part.state === 'input-available'`,
 * and `state` is not a field on the WIRE at all — it is a field on a UI MESSAGE
 * PART (`ai/dist/index.js:11147`), which is a different thing that happens to
 * share the vocabulary. The stream chunk is
 * `{type:'tool-input-available', toolCallId, toolName, input}` with no `state`
 * (`ai/dist/index.js:7693`), so the guard was `undefined === 'input-available'`
 * on every chunk and `pending` never filled. `flyTo`/`goTo`/`highlight` emitted,
 * were dropped here, and he narrated journeys that never happened.
 *
 * Two things follow, and both are in the guard below:
 *
 *  - The name comes from `part.toolName`, NOT from slicing the type. Slicing
 *    `'tool-input-available'` at `'tool-'` yields the string
 *    `"input-available"` — a tool name that does not exist, dispatched to
 *    `runUiTool`, answered "I do not know how to do that".
 *  - SERVER-EXECUTED tools emit this chunk too. `express` and `showScreen` have
 *    a server `execute` and already ran by the time we see them. Without the
 *    `CLIENT_TOOLS` filter they would be re-run in the browser, fail, and post a
 *    tool output that CONTRADICTS the one the server already produced.
 */
import { useCallback, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { ChatMessage } from './DeckeChat'
import type { ScreenSpec } from './DeckeScreen'
import type { DeckEInstance } from './runtime'
import { CLIENT_TOOLS, isClientTool, runUiTool, type UiToolResult } from './uiTools'

/** A command as the server's `express` tool emits it. Mirrors `decke/tools.ts`. */
type WireCommand = {
  op: 'state' | 'cardArt' | 'facing' | 'idle' | 'clearHighlight'
  value?: string
  mode?: 'sustain' | 'once'
  durationMs?: number
  cards?: string[]
  autoClose?: boolean
  slot?: string
  card?: string
}

/**
 * How many times he may hand the browser work and come back for more, per turn.
 *
 * NOT `stopWhen`. A client tool has no server `execute`, so it ENDS the server
 * turn (`finishReason: "tool-calls"`); the loop is stream closes → browser runs
 * tools → browser POSTs a follow-up. Raising the server's step budget does
 * nothing for this; only this constant does.
 *
 * Four, because a real journey is: navigate → (page settles) → fly to the row →
 * click it → say what he found. Each leg is a FULL request re-billing the entire
 * prompt and history, so this is a spend ceiling as much as a loop guard, and a
 * model that has not arrived in four legs is not going to on the fifth.
 */
const MAX_LEGS = 4

let seq = 0
const nextId = () => `m${++seq}`

/** A browser-side tool the model asked for, captured mid-stream. */
type PendingTool = { id: string; name: string; input: Record<string, unknown> }

/** A UI message part as `/api/chat` wants it back. */
type WirePart = Record<string, unknown>
type WireMessage = { role: 'user' | 'assistant'; parts: WirePart[] }

/** Everything one request's stream produced. */
type LegOutcome = {
  text: string
  pending: PendingTool[]
  screen: ScreenSpec | null
  /** A failure that arrived as a VALUE on a 200 stream. */
  error: string | null
  /**
   * The request itself was refused, and the reader has already been told why.
   *
   * Separate from `error` because the two need different endings: a refusal has
   * already replaced his reply with a specific sentence ("you need to be signed
   * in"), and overwriting that with the generic "my brain glitched" would throw
   * away the only useful part of it.
   */
  refused: boolean
}

export function useDeckeChat(
  decke: DeckEInstance | null,
  navigate: (to: string) => void,
  onTravel?: () => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // The transcript as the server wants it, in a ref so `send` cannot close over
  // a stale array between renders.
  const currentRef = useRef<ChatMessage[]>([])
  currentRef.current = messages
  // Did the MODEL set a state this turn? If not, the turn boundary has to leave
  // `thinking` itself — see the `finally` below.
  const movedRef = useRef(false)
  // HELD IN REFS so `send` keeps a stable identity. `DeckeHost` passes both as
  // fresh arrow functions on every render; naming them as dependencies would
  // hand `DeckeChat` a new `onSend` every frame, which is a re-render treadmill
  // waiting for the first effect that ever depends on it.
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const onTravelRef = useRef(onTravel)
  onTravelRef.current = onTravel

  const send = useCallback(
    async (text: string) => {
      if (!decke) return
      const userMsg: ChatMessage = { id: nextId(), role: 'user', text }
      const replyId = nextId()
      // CAPTURED BEFORE the setState, not read from the ref afterwards. The ref
      // only catches up on the next render, so reading it later in this same
      // function is a race whose two outcomes are "history is right" and
      // "history contains this turn twice".
      const priorWire = messagesToWire(currentRef.current)
      setMessages((m) => [...m, userMsg, { id: replyId, role: 'assistant', text: '' }])
      setBusy(true)

      // One turn at a time. A second send while the first is streaming would
      // interleave two command streams into one body — the exact race the
      // engine's own turn queue exists to prevent, arriving from a layer above
      // it where that queue cannot see it.
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac

      // ENGINE-DRIVEN, not model-driven: the app knows a request started before
      // the model could possibly say so, and knows it sooner. `thinking` is
      // sustained, so the turn boundary below is responsible for leaving it.
      decke.setState('thinking')
      movedRef.current = false

      // What he has actually said this turn, across every leg. Distinct from the
      // user's `text` — conflating the two is how the follow-up request came to
      // replay the READER's words back as the assistant's own.
      let saidSoFar = ''
      let travelAnnounced = false
      const appendText = (chunk: string) => {
        saidSoFar += chunk
        setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, text: x.text + chunk } : x)))
      }

      const wire: WireMessage[] = [...priorWire, { role: 'user', parts: [{ type: 'text', text }] }]

      try {
        for (let leg = 0; leg < MAX_LEGS; leg++) {
          const outcome = await streamLeg(wire, ac.signal, {
            onText: (chunk) => {
              if (!saidSoFar) {
                // The talk overlay latches on the FIRST token and is released in
                // the `finally` below — never on a `done` part, which an aborted
                // stream never sends. A latch with no guaranteed release is how
                // he ends up mouthing silently for the life of the page.
                decke.setOverlay('talk', 1)
              }
              appendText(chunk)
            },
            onCommands: (commands) => {
              apply(decke, commands)
              movedRef.current = true
            },
            onScreen: (screen) => {
              // Attached to the reply being streamed, so it stays with its turn.
              // The server has already dropped any block it could not render and
              // `DeckeScreen` returns null for a kind it does not know, so this
              // needs no validation of its own — and must not invent one, or the
              // two layers drift and a block passes one and vanishes at the other.
              setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, screen } : x)))
            },
            onHttpError: (status) => {
              const why =
                status === 503
                  ? "I'm not switched on for this deployment yet."
                  : status === 401
                    ? 'You need to be signed in for me to help.'
                    : status === 403
                      ? "I'm not available on this account yet."
                      : status === 429
                        ? "I've done as much as I can for you today — try me again tomorrow."
                        : 'Something went wrong reaching my brain.'
              setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, text: why } : x)))
              decke.setState('alert_error', { mode: 'once' })
              movedRef.current = true
            },
          })

          if (outcome.refused) return
          if (outcome.error) {
            // Said out loud, in his voice, rather than swallowed. The reader gets
            // a reply and the character reacts, which is what distinguishes a
            // failure from a silence.
            setMessages((m) =>
              m.map((x) =>
                x.id === replyId && !x.text
                  ? { ...x, text: 'My brain glitched on that one — try me again?' }
                  : x,
              ),
            )
            decke.setState('alert_error', { mode: 'once' })
            movedRef.current = true
            console.error('[decke] stream error:', outcome.error)
            return
          }

          if (!outcome.pending.length) break
          if (ac.signal.aborted) return

          // ── The tools he asked the browser to run ─────────────────────────
          //
          // Executed AFTER the stream, not during it: starting a flight
          // mid-sentence has him moving before he has finished saying where he
          // is going, and the words are what tell the reader why the page is
          // about to change.
          //
          // Their results go back as a follow-up turn, which is the whole reason
          // these are tools rather than fire-and-forget commands — "there is
          // nothing like that on this page" is something he has to be able to
          // say, and "I am there now, and here is what it says" is the leg after.
          //
          // Told ONCE, on the first leg that moves him: the transcript should
          // already be out of the way when he starts, and re-announcing on every
          // leg would re-minimise a panel that is already minimised.
          if (!travelAnnounced && outcome.pending.some((c) => c.name !== 'scrollToMe')) {
            travelAnnounced = true
            onTravelRef.current?.()
          }

          const parts: WirePart[] = []
          if (outcome.text.trim()) parts.push({ type: 'text', text: outcome.text })
          for (const call of outcome.pending) {
            const result = await runUiTool(
              { decke, navigate: navigateRef.current },
              call.name,
              call.input,
            )
            if (ac.signal.aborted) return
            // The wire shape matters: `convertToModelMessages` on the server
            // needs the assistant's tool CALL and the tool's OUTPUT as parts of
            // the same conversation, or the model sees a result for something it
            // never asked for. `state` IS a field here — on a UI message part,
            // which is the thing this is. It is not a field on the stream chunk
            // that delivered the call, and confusing the two is what broke this
            // file for its whole life.
            parts.push({
              type: `tool-${call.name}`,
              toolCallId: call.id,
              state: 'output-available',
              input: call.input,
              output: result satisfies UiToolResult,
            })
          }
          wire.push({ role: 'assistant', parts })

          if (leg === MAX_LEGS - 1) {
            // Out of legs with work still outstanding. Say so rather than
            // stopping mid-journey with no explanation — the page has already
            // changed under the reader, and silence reads as a crash.
            console.warn('[decke] leg budget exhausted with tools still pending')
          }
        }
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') {
          setMessages((m) =>
            m.map((x) => (x.id === replyId ? { ...x, text: 'I lost my train of thought there.' } : x)),
          )
          decke.setState('alert_error', { mode: 'once' })
        }
      } finally {
        // TURN BOUNDARY. All three must happen on every exit path including an
        // abort: an un-released `talk` overlay chatters forever, a channel
        // override left pinned permanently deforms him, and `thinking` is a
        // SUSTAINED state, so if nothing replaced it he loops in it forever.
        //
        // That last one is easy to miss because `talk` masks it. The overlay is
        // additive on top of the body pose, so while he is speaking he looks
        // right; the moment the overlay releases he is still rocking in
        // `thinking`. It only shows on a turn where the model set no state of
        // its own — which the prompt explicitly encourages ("silence is a valid
        // emission"), so it is the common case, not the rare one.
        //
        // ONLY IF THIS TURN IS STILL THE LIVE ONE. `busy` is React state, so two
        // sends dispatched in the same frame both pass the guard above; the
        // second aborts the first, and the first then arrives here and tears
        // down the overlay and overrides the second has already set. Comparing
        // the controller identifies whose turn this cleanup belongs to.
        if (abortRef.current === ac) {
          if (!movedRef.current) decke.setState('idle')
          decke.setOverlay(null)
          decke.clearOverrides()
          setBusy(false)
        }
      }
    },
    [decke],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return { messages, busy, send, stop }
}

type LegHandlers = {
  onText: (chunk: string) => void
  onCommands: (commands: WireCommand[]) => void
  onScreen: (screen: ScreenSpec) => void
  onHttpError: (status: number) => void
}

/**
 * One request, read to the end.
 *
 * EVERY leg goes through here, including the follow-up ones. The follow-up used
 * to have its own reader that understood only `text-delta`, so a tool call in a
 * follow-up turn — which is exactly what a multi-leg journey is made of — was
 * parsed, matched nothing, and vanished. One reader means a leg cannot quietly
 * be less capable than the leg before it.
 *
 * `route` and `landmarks` are collected FRESH per leg, deliberately: after a
 * `goTo` the page is a different page, and sending the previous page's landmarks
 * would have him aiming at things that are no longer on screen.
 */
async function streamLeg(
  wire: WireMessage[],
  signal: AbortSignal,
  handlers: LegHandlers,
): Promise<LegOutcome> {
  const out: LegOutcome = { text: '', pending: [], screen: null, error: null, refused: false }

  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const res = await fetch('/api/chat', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      messages: wire,
      route: window.location.pathname,
      landmarks: collectLandmarks(),
    }),
  })

  if (!res.ok || !res.body) {
    handlers.onHttpError(res.status)
    out.refused = true
    return out
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // SSE frames are newline-delimited; the tail may be a partial line, so
    // it stays in the buffer until its newline arrives. Splitting eagerly
    // is how half a JSON object gets parsed and thrown away.
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let part: {
        type?: string
        delta?: string
        errorText?: string
        error?: unknown
        data?: { commands?: WireCommand[]; screen?: ScreenSpec }
        toolCallId?: string
        toolName?: string
        input?: unknown
      }
      try {
        part = JSON.parse(payload)
      } catch {
        continue
      }
      if (part.type === 'text-delta' && typeof part.delta === 'string') {
        out.text += part.delta
        handlers.onText(part.delta)
      } else if (part.type === 'data-decke' && part.data?.commands) {
        handlers.onCommands(part.data.commands)
      } else if (part.type === 'error') {
        // AN ERROR PART IS NOT A THROWN EXCEPTION. The request already
        // returned 200 and the stream is well-formed; the failure arrives
        // as a value on it. With no branch here it matched nothing, was
        // dropped, and the stream ended `done` — so the catch outside never
        // ran either and a dead turn was indistinguishable from a turn he
        // chose not to answer. This is the same trap that cost an
        // afternoon server-side, one layer out.
        out.error = String(part.errorText ?? part.error ?? 'unknown')
        break
      } else if (part.type === 'data-decke-screen' && part.data?.screen) {
        out.screen = part.data.screen
        handlers.onScreen(part.data.screen)
      } else if (
        part.type === 'tool-input-available' &&
        typeof part.toolCallId === 'string' &&
        isClientTool(part.toolName)
      ) {
        // A tool with no server-side `execute` arrives here for the BROWSER to
        // run. Collected rather than run inline: the stream is still open, and
        // starting a flight mid-sentence would have him moving before he has
        // finished saying where he is going.
        //
        // FILTERED to `CLIENT_TOOLS`. Server-executed tools emit this same chunk
        // after they have already run; forwarding one here re-runs it in a place
        // that cannot do it, and posts a second, contradicting output for a call
        // the server has already answered.
        out.pending.push({
          id: part.toolCallId,
          name: part.toolName as (typeof CLIENT_TOOLS)[number],
          input: (part.input ?? {}) as Record<string, unknown>,
        })
      }
    }
    // The `break` above leaves the LINE loop; this leaves the read loop.
    // Without it the reader keeps draining a stream whose turn has already
    // failed.
    if (out.error) break
  }
  return out
}

function messagesToWire(msgs: ChatMessage[]): WireMessage[] {
  return msgs
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.role, parts: [{ type: 'text', text: m.text }] }))
}

/**
 * What he can be told about, on this page, right now.
 *
 * An allowlist by construction: only elements the app has deliberately marked
 * are visible to the model, so a card whose NAME is a CSS selector cannot make
 * itself a navigation target. `data-decke-label` is the human name he uses when
 * talking about it.
 */
function collectLandmarks(): { selector: string; label: string }[] {
  const out: { selector: string; label: string }[] = []
  for (const el of document.querySelectorAll<HTMLElement>('[data-decke-landmark]')) {
    const selector = el.dataset.deckeLandmark
    const label = el.dataset.deckeLabel
    if (selector && label) out.push({ selector, label })
  }
  return out.slice(0, 24)
}

/** Commands arrive validated by the server; this is the last mile into the engine. */
function apply(decke: DeckEInstance, commands: WireCommand[]) {
  for (const c of commands) {
    try {
      switch (c.op) {
        case 'state':
          if (!c.value) break
          if (c.value === 'card_stash' && c.cards?.length) {
            // COUNT, not art, and deliberately so until PR 5.
            //
            // The point of this animation is the user's OWN cards going into
            // the box, which needs a catalog lookup that belongs with the scan
            // work. Passing an array of nulls would render the model's baked-in
            // placeholder Pokemon — cards that do not exist — and present them
            // as the user's collection, which is worse than generic card backs.
            decke.setStashCount(Math.min(c.cards.length, 48))
          }
          decke.setState(c.value, { mode: c.mode, durationMs: c.durationMs })
          break
        case 'facing':
          decke.setFacing(c.value === 'left' ? 1 : -1)
          break
        case 'idle':
          decke.setState('idle')
          break
        case 'clearHighlight':
          decke.clearHighlight()
          break
        case 'cardArt':
          // Resolving art is a catalog lookup the engine owns; nothing to do
          // here until PR 5 wires the card source through.
          break
      }
    } catch {
      // One malformed command must not take the rest of the reaction with it.
    }
  }
}
