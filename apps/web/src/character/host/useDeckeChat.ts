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
 */
import { useCallback, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { ChatMessage } from './DeckeChat'
import type { ScreenSpec } from './DeckeScreen'
import type { DeckEInstance } from './runtime'
import { runUiTool, type UiToolResult } from './uiTools'

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

let seq = 0
const nextId = () => `m${++seq}`

/** A browser-side tool the model asked for, captured mid-stream. */
type PendingTool = { id: string; name: string; input: Record<string, unknown> }

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

  const send = useCallback(
    async (text: string) => {
      if (!decke) return
      const userMsg: ChatMessage = { id: nextId(), role: 'user', text }
      const replyId = nextId()
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
      // the model could possibly say so, and knows it sooner. `thinking` holds
      // until the first token arrives.
      decke.setState('thinking')

      let spoke = false
      const pending: PendingTool[] = []
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        const res = await fetch('/api/chat', {
          method: 'POST',
          signal: ac.signal,
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            messages: [
              ...messagesToWire(currentRef.current),
              { role: 'user', parts: [{ type: 'text', text }] },
            ],
            route: window.location.pathname,
            landmarks: collectLandmarks(),
          }),
        })

        if (!res.ok || !res.body) {
          const why =
            res.status === 503
              ? "I'm not switched on for this deployment yet."
              : res.status === 401
                ? 'You need to be signed in for me to help.'
                : 'Something went wrong reaching my brain.'
          setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, text: why } : x)))
          decke.setState('alert_error', { mode: 'once' })
          return
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
              data?: { commands?: WireCommand[]; screen?: ScreenSpec }
              state?: string
              toolCallId?: string
              input?: unknown
            }
            try {
              part = JSON.parse(payload)
            } catch {
              continue
            }
            if (part.type === 'text-delta' && typeof part.delta === 'string') {
              if (!spoke) {
                spoke = true
                // The talk overlay latches on the FIRST token and is released in
                // the `finally` below — never on a `done` part, which an aborted
                // stream never sends. A latch with no guaranteed release is how
                // he ends up mouthing silently for the life of the page.
                decke.setOverlay('talk', 1)
              }
              const chunk = part.delta
              setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, text: x.text + chunk } : x)))
            } else if (part.type === 'data-decke' && part.data?.commands) {
              apply(decke, part.data.commands)
            } else if (part.type === 'data-decke-screen' && part.data?.screen) {
              // Attached to the reply being streamed, so it stays with its turn.
              // The server has already dropped any block it could not render and
              // `DeckeScreen` returns null for a kind it does not know, so this
              // needs no validation of its own — and must not invent one, or the
              // two layers drift and a block passes one and vanishes at the other.
              const screen = part.data.screen as ScreenSpec
              setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, screen } : x)))
            } else if (
              typeof part.type === 'string' &&
              part.type.startsWith('tool-') &&
              part.state === 'input-available' &&
              part.toolCallId
            ) {
              // A tool with no server-side `execute` arrives here for the
              // BROWSER to run. Collected rather than run inline: the stream is
              // still open, and starting a flight mid-sentence would have him
              // moving before he has finished saying where he is going.
              pending.push({
                id: part.toolCallId,
                name: part.type.slice('tool-'.length),
                input: (part.input ?? {}) as Record<string, unknown>,
              })
            }
          }
        }

        // ── The tools he asked the browser to run ────────────────────────────
        //
        // Executed AFTER the stream, not during it: starting a flight
        // mid-sentence has him moving before he has finished saying where he is
        // going, and the words are what tell the reader why the page is about
        // to change.
        //
        // Their results go back as a follow-up turn, which is the whole reason
        // these are tools rather than fire-and-forget commands — "there is
        // nothing like that on this page" is something he has to be able to say.
        // ONE follow-up round, deliberately: each round re-bills the entire
        // system prompt, and a model that needs three attempts to point at
        // something is not going to find it on the fourth.
        if (pending.length && !ac.signal.aborted) {
          const results: { call: PendingTool; result: UiToolResult }[] = []
          // Tell the host BEFORE running them: the transcript should already be
          // out of the way when he starts moving, not a beat behind him.
          if (pending.some((c) => c.name !== 'scrollToMe')) onTravel?.()
          for (const call of pending) {
            results.push({ call, result: await runUiTool({ decke, navigate }, call.name, call.input) })
          }
          const followUp = await sendToolResults(currentRef.current, text, results, ac.signal)
          if (followUp) {
            setMessages((m) =>
              m.map((x) => (x.id === replyId ? { ...x, text: (x.text + ' ' + followUp).trim() } : x)),
            )
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
        // TURN BOUNDARY. Both of these must happen on every exit path including
        // an abort: an un-released `talk` overlay chatters forever, and a
        // channel override left pinned permanently deforms him.
        decke.setOverlay(null)
        decke.clearOverrides()
        setBusy(false)
      }
    },
    [decke],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return { messages, busy, send, stop }
}

/**
 * Send the browser-side tool results back and read whatever he says about them.
 *
 * The wire shape matters: `convertToModelMessages` on the server needs the
 * assistant's tool CALL and the tool's OUTPUT as parts of the same conversation,
 * or the model sees a result for something it never asked for. So the assistant
 * turn is replayed carrying `state: 'output-available'` parts with both the
 * input it sent and the output it got back.
 *
 * Returns only the new text, or null. Errors are swallowed on purpose — the
 * primary turn already said something useful, and a failed footnote should not
 * replace it with an apology.
 */
async function sendToolResults(
  history: ChatMessage[],
  saidSoFar: string,
  results: { call: PendingTool; result: UiToolResult }[],
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const assistantParts: unknown[] = []
    if (saidSoFar.trim()) assistantParts.push({ type: 'text', text: saidSoFar })
    for (const { call, result } of results) {
      assistantParts.push({
        type: `tool-${call.name}`,
        toolCallId: call.id,
        state: 'output-available',
        input: call.input,
        output: result,
      })
    }
    const res = await fetch('/api/chat', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages: [...messagesToWire(history), { role: 'assistant', parts: assistantParts }],
        route: window.location.pathname,
        landmarks: collectLandmarks(),
      }),
    })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let out = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const part = JSON.parse(payload)
          if (part.type === 'text-delta' && typeof part.delta === 'string') out += part.delta
        } catch {
          /* a partial frame; the next chunk completes it */
        }
      }
    }
    return out.trim() || null
  } catch {
    return null
  }
}

function messagesToWire(msgs: ChatMessage[]) {
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
