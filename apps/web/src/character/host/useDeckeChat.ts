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
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  ABANDONED_REASON,
  DECLINED_REASON,
  MAX_LEGS,
  type PendingApproval,
  type Verdict,
  approvalReplayPart,
  legBudget,
  mayAskApproval,
  pendingApprovalFromChunk,
} from './approval'
import { messageText, messageTools, type ChatMessage } from './DeckeChat'
import type { ScreenSpec } from './DeckeScreen'
import type { DeckEInstance } from './runtime'
import { CLIENT_TOOLS, isClientTool, isPressable, runUiTool, type UiToolResult } from './uiTools'
import { runJourney, type JourneyResult, type JourneyStep } from './journey'
import { api } from '../../lib/api'
import {
  initialChoices,
  runAccept,
  transportFromThrown,
  type ApprovalPreview,
  type HeldItem,
  type RowChoice,
} from './chat/approvalCardState'

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

/** A UI message part as `/api/chat` wants it back. */
type WirePart = Record<string, unknown>
type WireMessage = { role: 'user' | 'assistant'; parts: WirePart[] }

/**
 * The approval round trip lives in `./approval.ts`.
 *
 * Re-exported here because `DeckeChat.tsx` has always imported the type from
 * this module and the move is not its business. `approval.ts`'s header records
 * why capture and replay are over there: the hook imports `../../lib/supabase`,
 * which touches `import.meta.env` at module scope, so this file cannot be
 * imported at all under `node --import tsx --test` — which is why two bugs in
 * that round trip shipped with a green suite.
 */
export type { PendingApproval } from './approval'

/** One tool call's progress, as a chip. */
/**
 * One real tool invocation, as the reader sees it.
 *
 * MIRRORS `ToolEvent` in `apps/api/src/decke/adapters/aisdk.ts`, which is the
 * only thing that emits these — deliberately, and its own comment says why:
 * *"a chip the model could ask for would be a second surface to fabricate on."*
 * Every field here comes from a real handler's real result.
 *
 * `progress` and `partial` are new, and `partial` is the important one. A deep
 * tool that ran out of time used to return its half-finished text and resolve
 * `ok` — which is how the owner came to read *"The analyze tool timed out
 * before it could finish reading your full collection…"* on camera and call it
 * *"a great response."* He did not notice it had failed. `partial` is what the
 * server now sends instead, and it must never be rendered as a success.
 */
export type ToolChip = {
  id: string
  name: string
  title: string
  phase: 'start' | 'progress' | 'ok' | 'partial' | 'error'
  /** The first line of the real result. */
  summary?: string
  /** The newest server-composed beat for a call still running. */
  note?: string
  /** Which step of a multi-step sub-agent this beat came from. */
  step?: number
  /** Why a `partial` is partial. */
  reason?: 'timeout' | 'truncated'
}

/** Everything one request's stream produced. */
type LegOutcome = {
  text: string
  pending: PendingTool[]
  approvals: PendingApproval[]
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
  /** True while a journey step owns the transition; see `onSteppingRef`. */
  onStepping?: (on: boolean) => void,
  /** Fired as each turn begins, so the host can reset per-turn navigation state. */
  onTurnStart?: () => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  /**
   * `busy` and `send`, reachable from a callback declared above `send`.
   *
   * Not a style choice: `retry` has to be able to call `send`, `send` closes
   * over a great deal of turn state, and hoisting one above the other would
   * mean reordering half this hook. Refs keep the declaration order readable
   * and the values current.
   */
  const busyRef = useRef(false)
  busyRef.current = busy
  const sendRef = useRef<((text: string) => Promise<void>) | null>(null)
  /** The current turn's row writer, so the approval handler — declared above
   *  `send` — can record a corrected write where the reader is looking. */
  const emitChipRef = useRef<((chip: ToolChip) => void) | null>(null)
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
  /**
   * Held true for the whole of a journey.
   *
   * The route watcher in `DeckeHost` tidies up after a navigation — it clears
   * the highlight and re-parks him beside the conversation — which is exactly
   * right when a PERSON navigates and exactly wrong between his own hops. A
   * journey's `goTo` would otherwise have him ring something, get un-rung, and
   * be pulled back to the composer before the next step could point at
   * anything. That is the distinction the watcher was written around, and this
   * is the flag it was waiting for.
   */
  const onSteppingRef = useRef(onStepping)
  onSteppingRef.current = onStepping
  const onTurnStartRef = useRef(onTurnStart)
  onTurnStartRef.current = onTurnStart

  // ── The approval gate ──────────────────────────────────────────────────────
  //
  // When the SDK holds a write, the turn stops here and waits for a person.
  // `asking` is what the UI renders; `resolver` is the turn's continuation,
  // parked until someone answers.
  //
  // A PROMISE PARKED IN A REF is the right shape because the decision is not
  // React state that the turn polls — the turn is inside an `await` and needs
  // to be woken exactly once, with an answer.
  const [asking, setAsking] = useState<PendingApproval[] | null>(null)
  const askingRef = useRef<PendingApproval[] | null>(null)
  askingRef.current = asking
  const resolverRef = useRef<((answers: Map<string, Verdict>) => void) | null>(null)
  /**
   * The dry-run rows for each held call, keyed by `toolCallId`.
   *
   * SURVIVES THE LEG BOUNDARY, which is why it is a ref: the preview arrives on
   * the stream and the question is asked after the stream closes.
   */
  const previewsRef = useRef(new Map<string, ApprovalPreview>())
  /** What the reader has decided, per row index. Owned here rather than in the
   *  panel, because a half-answered approval is not a thing to leave riding on
   *  whether a component happens to stay mounted. */
  const [approvalChoices, setApprovalChoices] = useState<Map<number, RowChoice>>(new Map())
  const choicesRef = useRef(approvalChoices)
  choicesRef.current = approvalChoices
  const [approvalBusy, setApprovalBusy] = useState(false)
  /** Set the moment Accept is pressed, so a Stop landing mid-commit cannot
   *  settle a denial while the batch is on its way. */
  const answeredRef = useRef(false)
  const committingRef = useRef(false)

  /**
   * Settle everything being asked with one verdict, once, and clear the prompt.
   *
   * A VERDICT RATHER THAN A BOOLEAN, because a denial now carries a REASON and
   * the reason is load-bearing: `convertToModelMessages` turns a denied
   * approval part directly into `tool-result {type:'execution-denied', reason}`,
   * so what is written here is what he is told happened. On the edited path
   * that reason is built from the real response to a real write, which is the
   * only thing keeping his account of it true.
   */
  /**
   * What a held call is told when it was never put in front of anyone.
   *
   * A denial rather than an approval, because the reader did not see it — and
   * with a reason that says exactly that, so his account of the turn is true
   * and the model knows it may ask again rather than assuming a refusal.
   */
  const UNSEEN_REASON_VERDICT: Verdict = {
    approved: false,
    reason:
      'this change was not shown to the reader, so it was not run — ask about it on its own',
  }

  const settleAll = useCallback((verdict: Verdict, forId?: string) => {
    const resolve = resolverRef.current
    const list = askingRef.current ?? []
    resolverRef.current = null
    askingRef.current = null
    setAsking(null)
    setApprovalChoices(new Map())
    // ── ONE VERDICT PER CALL, NOT ONE VERDICT FOR ALL OF THEM ─────────────
    //
    // This used to map every pending approval to the same verdict, and the card
    // only ever renders `asking[0]`. Nothing stops the model emitting two write
    // calls in one step — parallel tool calls are ordinary SDK behaviour, and
    // "add these cards and save a note on the deck" is a perfectly natural turn
    // that produces two held writes. Then one press of "Go ahead" approved a
    // second write whose arguments were never shown anywhere.
    //
    // The edited path was worse: it committed a correction for call[0] and then
    // denied BOTH with call[0]'s narrative, so the model was told "the reader
    // corrected this before it ran, batch X has already landed" about an
    // entirely different call. A fabricated account, on the write path,
    // delivered through the mechanism built to prevent fabricated accounts.
    //
    // `forId` names the one call the verdict actually belongs to. Everything
    // else is denied with a reason that says what is true: it was never shown.
    resolve?.(
      new Map(
        list.map((a) => [
          a.approvalId,
          !forId || a.approvalId === forId ? verdict : UNSEEN_REASON_VERDICT,
        ]),
      ),
    )
  }, [])

  /**
   * Ask the same question again, after something in the answer failed.
   *
   * IT RE-RUNS THE TURN, not the tool, and the difference is worth being
   * straight about. A tool call happened inside a model turn on the server;
   * there is no handle here that could re-invoke just that call, and inventing
   * one would mean a second execution path for writes. What this does is put
   * the reader's own question back — which does try that lookup again, because
   * the model will reach for the same tool, and it does it through the one path
   * that already has approval, metering and grounding attached.
   *
   * The failed turn stays in the transcript. Removing it would hide that the
   * first attempt happened, and "it worked the second time" is exactly the sort
   * of thing worth being able to see.
   */
  const retry = useCallback(() => {
    const lastAsked = [...currentRef.current].reverse().find((m) => m.role === 'user')
    const text = lastAsked ? messageText(lastAsked) : ''
    if (!text || busyRef.current) return
    void sendRef.current?.(text)
  }, [])

  /**
   * Ask the held question the moment he arrives — or give up out loud.
   *
   * THE TIMEOUT IS NOT DEFENSIVE NOISE. A load can genuinely fail, and a queued
   * question with no ceiling is a thinking row that spins for the life of the
   * page: the dead end this pass exists to remove, wearing a friendly face. If
   * he has not arrived by then, the question is answered by the app rather than
   * by him, and the reader is told they can try again.
   */
  useEffect(() => {
    const text = queuedRef.current
    if (!text) return
    if (decke) {
      // NOT cleared here. `send` reads it to know the question is already on
      // the transcript — clearing it first made every queued message post
      // twice, once by the queue and once by the send that flushed it.
      void sendRef.current?.(text)
      return
    }
    const t = window.setTimeout(() => {
      if (!queuedRef.current) return
      queuedRef.current = null
      setBusy(false)
      setMessages((m) => [
        ...m,
        {
          id: nextId(),
          role: 'assistant',
          parts: [
            {
              kind: 'text',
              id: nextId(),
              text: "I couldn't finish waking up, so I never got that. Try me again?",
            },
          ],
        },
      ])
    }, 45_000)
    return () => window.clearTimeout(t)
  }, [decke, messages.length])

  /**
   * Yes.
   *
   * TWO PATHS, and which one runs is decided by what the reader actually chose
   * — never by reconstructing it, because a reconstruction that goes wrong
   * fails toward auto-approving a row they struck out.
   *
   * **Unedited** is today's path down to the byte: the held call settles
   * `approved: true`, the SDK replays the original input with its original
   * signature, and `log_cards` executes on the server with everything it
   * already does. Every existing security property survives untouched, which
   * is the whole reason the common case was kept on it.
   *
   * **Edited** never touches the held call's arguments — it cannot, because the
   * SDK signs over them and that binding is itself the fix for a shipped bug.
   * The corrected batch is committed from here, and only THEN is the held call
   * settled `approved: false` with a reason built from the real response.
   *
   * That ordering is the risk to own. Commit-then-settle is the only sequence
   * that keeps the transcript honest; invert it, or lose the leg carrying the
   * denial, and he claims a corrected write that may not have landed. It is
   * pinned by a test rather than by this comment.
   */
  const approve = useCallback(async () => {
    const a = askingRef.current?.[0]
    if (!a || committingRef.current) return
    const preview = previewsRef.current.get(a.toolCallId)
    // No preview, or one the server marked un-editable: this is the plain
    // dialog, and the plain dialog's yes is the signed path. The card and this
    // handler have to agree about that, or one of them is lying to the reader.
    if (!preview?.editable) {
      answeredRef.current = true
      settleAll({ approved: true }, a.approvalId)
      return
    }
    committingRef.current = true
    answeredRef.current = true
    setApprovalBusy(true)
    try {
      await runAccept(
        {
          toolCallId: a.toolCallId,
          held: ((a.input as { items?: HeldItem[] }).items ?? []) as HeldItem[],
          preview,
          choices: choicesRef.current,
        },
        {
          commit: async (r) => {
            try {
              // A DEADLINE, because everything is frozen while this is in
              // flight: `busy` is true, the composer refuses input, both card
              // buttons are disabled, and Stop deliberately does not settle
              // once Accept has been pressed. A stalled connection therefore
              // parks the whole chat with no way out but a reload — the exact
              // defect this pass fixed on the close path, waiting on the
              // least-exercised path in the feature.
              //
              // A timeout classifies as "never received", which is what feeds
              // the retry-once-then-report-`unconfirmed` machinery. That
              // matters more than the timeout: a request that timed out MAY
              // have landed, and the one thing this must never do is assert a
              // negative nobody observed.
              const body = await api.collectionBatch(r.items, {
                source: r.source,
                note: r.note,
                idempotencyKey: r.idempotencyKey,
                signal: AbortSignal.timeout(15_000),
              })
              return { received: true, ok: true, body } as const
            } catch (err) {
              return transportFromThrown(err)
            }
          },
          settle: (v) => settleAll(v, a.approvalId),
          record: (text) =>
            emitChipRef.current?.({
              id: `${a.toolCallId}-corrected`,
              name: 'collection_batch',
              title: 'Applied your correction',
              phase: 'ok',
              summary: text.slice(0, 200),
            }),
        },
      )
    } catch (err) {
      // A CARD BUG MUST NOT LOOK LIKE A DEAD BUTTON. `runAccept` throws when
      // its own cross-checks disagree — the reader's choices and the
      // reconstructed batch describing different things — and refusing to send
      // anything is the correct response to that. But with no catch it was an
      // unhandled rejection: the reader pressed Accept, nothing happened, and
      // the only evidence was in a console they are not looking at.
      console.error('[decke] approval accept refused:', err)
      settleAll(
        {
          approved: false,
          reason:
            'the reader pressed accept, but the preview and their edits disagreed, so nothing was run',
        },
        a.approvalId,
      )
    } finally {
      committingRef.current = false
      setApprovalBusy(false)
    }
  }, [settleAll])

  const deny = useCallback(() => {
    answeredRef.current = true
    settleAll({ approved: false, reason: DECLINED_REASON }, askingRef.current?.[0]?.approvalId)
  }, [settleAll])

  /** One row's answer, from the card. */
  const onApprovalChoice = useCallback((index: number, choice: RowChoice) => {
    setApprovalChoices((m) => new Map(m).set(index, choice))
  }, [])

  /**
   * A question asked before he had finished arriving.
   *
   * A REAL DEFECT, and one this pass created. `send` has always begun `if
   * (!decke) return` — harmless while the runtime was fetched on an idle timer,
   * because by the time anyone could type he was long since in memory. Now he
   * loads on intent, and the whole point of the tap-and-wait trade is that
   * there is a window, several seconds long on a phone, in which the composer
   * is on screen and accepting text. Typing into it and pressing send did
   * NOTHING AT ALL: no message, no error, no acknowledgment. The question
   * simply evaporated.
   *
   * So it is held instead. The message appears in the transcript immediately —
   * within a frame of the press, which is the acknowledgment that was missing —
   * and the turn starts the moment he is ready.
   */
  const queuedRef = useRef<string | null>(null)

  const send = useCallback(
    async (text: string) => {
      if (!decke) {
        queuedRef.current = text
        // Shown NOW, not when the turn starts. The person pressed send; the
        // transcript has to say so.
        setMessages((m) => [
          ...m,
          { id: nextId(), role: 'user', parts: [{ kind: 'text', id: nextId(), text }] },
        ])
        setBusy(true)
        return
      }
      // A QUEUED MESSAGE IS ALREADY ON THE TRANSCRIPT. Adding it again would
      // show the question twice — and, worse, send it twice as history.
      const alreadyShown = queuedRef.current === text
      queuedRef.current = null
      const userMsg: ChatMessage | null = alreadyShown
        ? null
        : { id: nextId(), role: 'user', parts: [{ kind: 'text', id: nextId(), text }] }
      const replyId = nextId()
      // CAPTURED BEFORE the setState, not read from the ref afterwards. The ref
      // only catches up on the next render, so reading it later in this same
      // function is a race whose two outcomes are "history is right" and
      // "history contains this turn twice".
      const priorWire = messagesToWire(currentRef.current)
      setMessages((m) => [
        ...m,
        ...(userMsg ? [userMsg] : []),
        { id: replyId, role: 'assistant', parts: [] },
      ])
      setBusy(true)

      // One turn at a time. A second send while the first is streaming would
      // interleave two command streams into one body — the exact race the
      // engine's own turn queue exists to prevent, arriving from a layer above
      // it where that queue cannot see it.
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac

      // A NEW TURN NAVIGATES FRESH. The first hop of THIS turn pushes so one
      // Back returns to the page they asked from; the rest replace.
      onTurnStartRef.current?.()

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

      /**
       * Put the question to the reader and wait.
       *
       * ABORT RESOLVES IT, as a denial. Without that, pressing stop while an
       * approval is on screen leaves this promise parked for ever and the turn
       * never reaches its `finally` — so `thinking` never clears and he rocks
       * in place until the page is reloaded. An abandoned question is a "no".
       */
      const askApproval = (list: PendingApproval[]): Promise<Map<string, Verdict>> =>
        new Promise((resolve) => {
          answeredRef.current = false
          const p0 = previewsRef.current.get(list[0]?.toolCallId ?? '')
          setApprovalChoices(p0 ? initialChoices(p0) : new Map())
          resolverRef.current = resolve
          askingRef.current = list
          setAsking(list)
          ac.signal.addEventListener(
            'abort',
            () => {
              // NOT WHILE A COMMIT IS IN FLIGHT. The edited path writes and
              // then settles; a Stop landing between the two would settle a
              // denial while the batch was on its way, and he would report
              // "nothing was written" about a write that landed a moment later.
              // `answeredRef` is set synchronously the instant Accept is
              // pressed, which is before any await.
              if (answeredRef.current) return
              if (resolverRef.current === resolve) {
                settleAll({ approved: false, reason: ABANDONED_REASON })
              }
            },
            { once: true },
          )
        })
      /**
       * His words, appended to the text part he is currently speaking.
       *
       * A NEW PART IF SOMETHING HAPPENED SINCE HE LAST SPOKE. That is the whole
       * value of the ordered list: if the last part is text he is still in the
       * same sentence and it grows; if a tool row landed in between, the
       * sentence after it is a new part and renders below the row. The
       * transcript then reads in the order things actually occurred, rather
       * than putting every row above every word because that is how the arrays
       * happened to be laid out.
       */
      const appendText = (chunk: string) => {
        saidSoFar += chunk
        setMessages((m) =>
          m.map((x) => {
            if (x.id !== replyId) return x
            const last = x.parts[x.parts.length - 1]
            if (last?.kind === 'text') {
              return {
                ...x,
                parts: [...x.parts.slice(0, -1), { ...last, text: last.text + chunk }],
              }
            }
            return { ...x, parts: [...x.parts, { kind: 'text' as const, id: nextId(), text: chunk }] }
          }),
        )
      }

      /** Replace his words entirely — for a failure that speaks instead of him. */
      const sayInstead = (why: string) => {
        setMessages((m) =>
          m.map((x) =>
            x.id === replyId
              ? { ...x, parts: [...x.parts.filter((p) => p.kind !== 'text'), { kind: 'text' as const, id: nextId(), text: why }] }
              : x,
          ),
        )
      }

      /**
       * Put one row on the reply, or update the row already there.
       *
       * ONE WRITER for two sources — the server's execute wrapper and the
       * browser's own UI tools — because a reader should not be able to tell
       * which side of the wire a row came from, and because two writers would
       * be two chances to get the update-in-place rule wrong.
       */
      const emitToolChip = (chip: ToolChip) => {
        setMessages((m) =>
          m.map((x) => {
            if (x.id !== replyId) return x
            const at = x.parts.findIndex((p) => p.kind === 'tool' && p.chip.id === chip.id)
            if (at >= 0) {
              const next = [...x.parts]
              next[at] = { kind: 'tool', id: next[at].id, chip }
              return { ...x, parts: next }
            }
            return { ...x, parts: [...x.parts, { kind: 'tool' as const, id: nextId(), chip }] }
          }),
        )
      }

      emitChipRef.current = emitToolChip

      // NOT APPENDED IF IT IS ALREADY THERE. A queued question was put on the
      // transcript when it was queued, so `priorWire` — built from the
      // transcript — already carries it. Appending unconditionally sent the
      // same question as two consecutive user messages, which is exactly what
      // the comment beside `alreadyShown` claims is prevented.
      const wire: WireMessage[] = alreadyShown
        ? [...priorWire]
        : [...priorWire, { role: 'user', parts: [{ type: 'text', text }] }]

      try {
        // `approvalReplays` is read on EVERY iteration, so committing to a
        // replay below extends this bound by exactly the one leg needed to POST
        // it. That is the fix for the dropped-consent bug: the leg that carries
        // an answer is granted at the moment the answer is taken, never assumed
        // to be spare.
        let approvalReplays = 0
        for (let leg = 0; leg < legBudget(approvalReplays); leg++) {
          const outcome = await streamLeg(wire, ac.signal, {
            onText: (chunk) => {
              if (!saidSoFar) {
                // The talk overlay latches on the FIRST token and is released in
                // the `finally` below — never on a `done` part, which an aborted
                // stream never sends. A latch with no guaranteed release is how
                // he ends up mouthing silently for the life of the page.
                decke.setOverlay('talk', 1)
                // ── HE CHANGES WHEN THE ANSWER ARRIVES ─────────────────────
                //
                // The owner was cut off mid-sentence at the exact moment
                // Deck-E stopped thinking and started talking — "I honestly
                // would have loved him to—" — and when asked to recall it:
                // *"I think i was about to say I would have liked him to do a
                // different emotion state or something."* Recorded as a
                // PROBABLE requirement rather than a certain one, and a close
                // relative of his other note that he "can kind of show a
                // different emotion for a sec and then go back to thinking".
                //
                // The first token is the transition. Without a beat here he
                // slides out of a minute of the same rocking loop straight
                // into speech, and nothing marks the moment the waiting ended
                // — which is the moment that most wants marking.
                //
                // `once`, not sustained: this is punctuation on an event, not
                // a mood to be left holding. `curious` because the honest
                // reading of "I have something for you" is interest rather
                // than delight — `happy` would celebrate answers that are
                // sometimes bad news, and a character who is pleased about a
                // timeout is the failure this pass spent its time on.
                //
                // It does NOT set `movedRef`: this is the app punctuating a
                // transition, not the model choosing a state, and claiming
                // otherwise would stop the turn boundary restoring `idle`.
                try {
                  decke.setState('curious', { mode: 'once' })
                } catch {
                  /* an unknown state must never take a turn down */
                }
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
              setMessages((m) =>
                m.map((x) =>
                  x.id === replyId
                    ? { ...x, parts: [...x.parts, { kind: 'screen' as const, id: nextId(), spec: screen }] }
                    : x,
                ),
              )
            },
            onToolChip: (chip) => {
              // Held on the MESSAGE, like the screen, so the record of what he
              // did stays attached to the turn that did it. Keyed by tool call
              // id so `start` is REPLACED by `ok` rather than accumulating —
              // "Checking your collection…" then "Read 604 cards" is one chip
              // changing, not two chips.
              // UPDATED IN PLACE. The old code filtered the chip out and
              // pushed it back on, which moved it to the end on every phase
              // change — so the order visibly shifted between frames, and the
              // one call that FAILED ended up last, where it read as the most
              // recent thing rather than the broken one. `start` → `progress`
              // → `ok` is one row changing, in the position it first appeared.
              emitToolChip(chip)
            },
            onApprovalPreview: (preview) => {
              // A REF, not state, and keyed by `toolCallId` rather than by
              // arrival order. The card opens after the leg has closed, so a
              // value held in state would not necessarily have committed yet —
              // and a turn can hold more than one call, so position is not an
              // identity.
              previewsRef.current.set(preview.toolCallId, preview)
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
              sayInstead(why)
              decke.setState('alert_error', { mode: 'once' })
              movedRef.current = true
            },
          })

          if (outcome.refused) return
          if (outcome.error) {
            // Said out loud, in his voice, rather than swallowed. The reader gets
            // a reply and the character reacts, which is what distinguishes a
            // failure from a silence.
            if (!saidSoFar) sayInstead('My brain glitched on that one — try me again?')
            decke.setState('alert_error', { mode: 'once' })
            movedRef.current = true
            console.error('[decke] stream error:', outcome.error)
            return
          }

          // ── He is asking permission ───────────────────────────────────────
          //
          // The SDK is holding one or more calls: their `execute` has NOT run
          // and will not until an approval goes back. So the turn pauses here
          // and the decision becomes the reader's.
          //
          // This is a real control rather than a prompt instruction, which is
          // the whole point — this codebase records twice, in the same words,
          // that "a prompt is not an enforcement mechanism."
          if (outcome.approvals.length) {
            if (ac.signal.aborted) return
            // ── DO NOT ASK WHAT YOU CANNOT ANSWER ────────────────────────────
            //
            // Checked BEFORE the dialog, not after. Asking and then discarding
            // the reply is the worst available outcome: the reader has given
            // consent, believes it was acted on, and nothing tells them
            // otherwise. If there is no leg left to carry the answer, say so
            // instead — an unmade change the reader knows about is a nuisance;
            // one they do not is a broken promise.
            if (!mayAskApproval(approvalReplays)) {
              appendText(
                // NOT "nothing was changed" — an earlier approval in this same
                // turn may already have committed, and saying otherwise would be
                // the mirror of the defect this whole area exists to prevent:
                // misreporting what happened to their collection. This says what
                // is true of the change actually dropped.
                " — I ran out of room to make that last change, so I left it. Ask me again and I'll go straight to it.",
              )
              console.warn('[decke] approval replay budget exhausted; the write was NOT applied')
              break
            }
            const answers = await askApproval(outcome.approvals)
            if (ac.signal.aborted) return

            const parts: WirePart[] = []
            if (outcome.text.trim()) parts.push({ type: 'text', text: outcome.text })
            for (const a of outcome.approvals) {
              // THE REASON RIDES WITH THE DENIAL, and it is not decoration.
              // `convertToModelMessages` turns a denied approval part directly
              // into `tool-result {type:'execution-denied', reason}`, so this
              // string is what he is told happened — and on the edited path it
              // was built from the real response to a real write. Dropping it
              // would leave him to guess, in front of the reader, on the write
              // path.
              const v = answers.get(a.approvalId)
              const approved = v?.approved === true
              parts.push(approvalReplayPart(a, approved, approved ? undefined : v?.reason))
            }
            // ── NOTHING MAY BE APPENDED AFTER THIS ────────────────────────────
            //
            // `collectToolApprovals` requires the LAST message of the replayed
            // conversation to be the one carrying the approval response
            // (`ai/src/generate-text/collect-tool-approvals.ts:33`). If anything
            // follows it — a stray user turn, an injected context note — the
            // approved tool is SILENTLY SKIPPED: no error, no execution, and a
            // dangling tool_use that some providers then reject outright.
            //
            // That is vercel/ai#17033, still open. We are clear of it because
            // this pushes last and immediately continues to the next leg, which
            // POSTs straight away. It is an accident of ordering rather than a
            // guarantee, so: if you ever add anything between this push and the
            // request, put it BEFORE the approval message, not after.
            wire.push({ role: 'assistant', parts })
            approvalReplays++
            continue
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
            // ── A JOURNEY IS NOT AN ORDINARY CLIENT TOOL ────────────────────
            //
            // It runs through the same boundary — same allowlist, same
            // `runUiTool` for every individual step — but the sequencer needs
            // three things this loop's context does not carry: somewhere to
            // speak that is not the transcript, a flag that stops the route
            // watcher tidying up between his own hops, and the TURN's abort
            // signal, so that Stop halts the walk and the turn together rather
            // than leaving a character mid-stride on a page nobody is talking
            // about any more.
            //
            // Its result goes back on the wire exactly like any other tool's,
            // which is what lets a fail-stop hand control back to the model
            // with somewhere to start: which step, which verb, which target,
            // and why.
            const result: UiToolResult | JourneyResult =
              call.name === 'journey'
                ? await runJourney(
                    {
                      decke,
                      navigate: navigateRef.current,
                      say: (text) => appendText(text),
                      setStepping: (on) => onSteppingRef.current?.(on),
                    },
                    ((call.input as { steps?: JourneyStep[] }).steps ?? []),
                    ac.signal,
                  )
                : await runUiTool(
                    { decke, navigate: navigateRef.current },
                    call.name,
                    call.input,
                  )
            if (ac.signal.aborted) return
            // ── A ROW FOR WHAT HE DID TO THE PAGE ──────────────────────────
            //
            // Chips have only ever come from the server's execute wrapper, for
            // the 23 data tools. `flyTo`, `highlight`, `goTo`, `scrollToMe` and
            // `click` have no server `execute` at all — they run HERE — so no
            // row was ever emitted for any movement, and the transcript held no
            // record whatsoever of a journey. He could cross the app, outline
            // something and press it, and the conversation would show only his
            // words about it. Which is exactly the witness this codebase says
            // is under suspicion.
            //
            // EMITTED AFTER `runUiTool` RETURNS, from its real result, which is
            // what makes the row obey X2 the same way a server chip does. It is
            // not "he asked to fly" — it is "he flew, and here is what came
            // back". A step that never ran emits nothing, because this line is
            // only reached by a step that ran.
            //
            // `runUiTool` already returns sayable text for the interesting
            // cases: `pressed <label>`, `we are already on that page`, `there
            // is nothing like that on this page`. That is the summary; there is
            // nothing to compose.
            emitToolChip({
              id: call.id,
              name: call.name,
              title: uiToolTitle(call.name, call.input),
              // A JOURNEY THAT STOPPED HALF WAY IS `partial`, NOT `error`.
              // Some of it genuinely happened — he really did cross two pages
              // before the third landmark failed to appear — and calling that a
              // failure discards work the reader watched him do. Calling it a
              // success is the lie this pass exists to remove. `partial` is the
              // phase that is neither, and it renders loudly with its reason.
              phase: journeyPhase(result),
              summary: journeySummary(result),
              ...(isJourneyResult(result) && !result.ok ? { reason: 'truncated' as const } : {}),
            })
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

          if (leg === legBudget(approvalReplays) - 1) {
            // ── OUT OF LEGS, WITH WORK IN HAND ──────────────────────────────
            //
            // The comment here used to say "say so rather than stopping
            // mid-journey with no explanation" and then only `console.warn`ed,
            // which is a claim the code did not honour. The reader saw nothing.
            //
            // It then ACQUIRED A SECOND CLAIM IT DID NOT HONOUR. A ternary here
            // chose different wording for an exhausted approval — and this line
            // is below `if (!outcome.pending.length) break`, which the approvals
            // branch can never fall through to, because it always `continue`s or
            // `break`s. `outcome.approvals.length` was therefore always 0, the
            // approval half of that ternary was unreachable, and the comment
            // above it described a fix that did not exist for the path it named.
            // The real dropped-consent bug it purported to cover was live the
            // whole time; it is guarded now at the point of asking, above, where
            // there is still a decision to make.
            //
            // So this is only ever the unfinished-journey case, and it says so.
            appendText(' — I ran out of steps there. Ask me again and I can pick it up.')
            console.warn('[decke] leg budget exhausted with work still outstanding')
          }
        }
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') {
          // THROUGH `sayInstead`, and this was silently broken.
          //
          // It wrote `{ ...x, text }` — a field a message no longer HAS, since
          // a turn became an ordered part list. So the object gained a stray
          // property nothing renders, and the failure the branch exists to
          // announce announced nothing: the request never connected, `busy`
          // went false, and the transcript held the reader's question and no
          // reply at all. A question answered by silence is the dead end this
          // pass exists to remove, and it was introduced BY this pass.
          //
          // Caught by unplugging the network in a browser rather than by
          // reading the code, which is the only way this class of thing is ever
          // caught: it typechecks, it runs, and it does nothing.
          sayInstead(
            'I could not reach my brain just then — check your connection and ask me again?',
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

  /**
   * The chat was closed. End the turn honestly rather than leaving it parked.
   *
   * ── THE HANG, WHICH WAS VERIFIED, NOT SUSPECTED ─────────────────────────
   *
   * Closing the panel used to be `setChatOpen(false)` and nothing else. It did
   * not stop the turn and it did not settle a pending approval — and the
   * listener that WOULD settle one fires on the AbortController, which closing
   * never triggered. So a reader who closed the chat while he was asking
   * permission left a promise parked for the life of the page: `busy` stayed
   * true, `thinking` stayed sustained, and the only way out was a reload.
   *
   * ── WHY CLOSING STOPS THE TURN, RATHER THAN LETTING IT RUN ──────────────
   *
   * The alternative is a turn that continues invisibly, and it is worse than it
   * sounds: a turn can NAVIGATE. Letting one run under a closed panel means the
   * page moving under someone who has just said they are done, with no surface
   * left to explain why. Stopping is also what `stop()` already means, and
   * having one meaning is worth more than salvaging the occasional answer.
   *
   * The abort settles any pending approval as a denial through the listener in
   * `askApproval`, which is the correct reading of an abandoned question.
   *
   * ── AND IT SAYS SO ──────────────────────────────────────────────────────
   *
   * The transcript survives a close, so re-opening shows a turn that stopped
   * mid-sentence. Without a note that reads as him trailing off; with one it
   * reads as what happened. Only when he was genuinely mid-turn — closing an
   * idle chat should leave no trace at all.
   */
  const close = useCallback(() => {
    if (!busyRef.current) return
    // ── A QUEUED QUESTION IS DROPPED, NOT DEFERRED ────────────────────────
    //
    // The abort below cannot reach one: a queued message has no turn yet, so
    // `abortRef` is null and aborting is a no-op — and the flush effect keys on
    // the runtime arriving, not on the panel being open. So without this, the
    // sequence "tap, type, send while he is waking, close" ends with the
    // download finishing and the turn firing behind a closed panel. A turn can
    // NAVIGATE, so that is the page moving under someone who has just said they
    // are done — which is the exact failure closing was changed to prevent,
    // reintroduced by the queue added in the same pass.
    //
    // It also made the transcript contradict itself: "(stopped when you closed
    // the chat)" followed, seconds later, by an answer to the stopped question.
    queuedRef.current = null
    setBusy(false)
    abortRef.current?.abort()
    setMessages((m) => [
      ...m,
      {
        id: nextId(),
        role: 'assistant',
        parts: [{ kind: 'text', id: nextId(), text: '_(stopped when you closed the chat)_' }],
      },
    ])
  }, [])

  sendRef.current = send

  return {
    messages,
    busy,
    send,
    stop,
    close,
    retry,
    asking,
    approve,
    deny,
    approvalPreview: (id: string) => previewsRef.current.get(id) ?? null,
    approvalChoices,
    onApprovalChoice,
    approvalBusy,
  }
}

type LegHandlers = {
  onText: (chunk: string) => void
  onApprovalPreview: (preview: ApprovalPreview) => void
  onCommands: (commands: WireCommand[]) => void
  onScreen: (screen: ScreenSpec) => void
  onToolChip: (chip: ToolChip) => void
  onHttpError: (status: number) => void
}

/**
 * A readable name for a tool, when the server has not supplied its title.
 *
 * An approval request carries only ids, and no chip is emitted for a call the
 * SDK is holding — its `execute` never ran, and emitting one would be a chip
 * for work that has not happened. So the reader would otherwise be asked to
 * authorise `call_a7f3`.
 *
 * `log_cards` becomes "Log cards". Crude, and better than an id: the reader is
 * being asked to permit something, and the one thing that must be legible is
 * WHAT.
 */
/**
 * What a movement row is called.
 *
 * The five browser-side tools are the ones a reader can SEE happen, so their
 * rows are named for the effect rather than for the function: "Went to /decks"
 * beats "goTo". Where the target is a plain part of the input — a route — it is
 * included, because a row that says only "Went to a page" is a row that has
 * told you nothing.
 *
 * A SELECTOR IS NEVER PUT IN A TITLE. Landmarks are attribute selectors and
 * they read as machinery; the interesting half of a movement is in the result,
 * which `runUiTool` already returns in words ("pressed Deck Builder") and which
 * the row shows beside the title.
 */
/** Is this a journey's result rather than an ordinary tool's? */
function isJourneyResult(r: UiToolResult | JourneyResult): r is JourneyResult {
  return typeof (r as JourneyResult).planned === 'number'
}

/**
 * What phase a finished tool call renders as.
 *
 * The interesting case is a journey that stopped part way. It is not an error —
 * he really did cross two pages before the third landmark failed to appear, and
 * calling that a failure throws away work the reader watched happen. It is not
 * a success either. `partial` is the phase for exactly that, and it renders
 * with weight and with its reason rather than quietly.
 */
function journeyPhase(r: UiToolResult | JourneyResult): 'ok' | 'partial' | 'error' {
  if (!isJourneyResult(r)) return r.ok ? 'ok' : 'error'
  if (r.ok) return 'ok'
  // A JOURNEY THE READER STOPPED IS NOT A FAILURE. Taking over is a deliberate
  // act and the sequencer is built to yield to it — rendering a loud red row
  // with a retry link for "you clicked" tells someone their own gesture broke
  // something. It is `partial` however far he got, including not at all.
  if (r.failure?.why === 'cancelled') return 'partial'
  return r.ran.length > 0 ? 'partial' : 'error'
}

/**
 * The row's summary, built from what ACTUALLY RAN.
 *
 * Never from the plan. A journey of six steps that stopped at the third says
 * "3 of 6", and the three it names are the three that completed — a step after
 * a failure contributes nothing at all, because the sequencer only records a
 * step once it is done.
 */
function journeySummary(r: UiToolResult | JourneyResult): string | undefined {
  if (!isJourneyResult(r)) return r.reason
  const where = `${r.ran.length} of ${r.planned} steps`
  if (r.ok) return `Walked you through — ${where}.`
  const why = r.failure?.reason ?? 'it stopped'
  return `${where[0].toUpperCase()}${where.slice(1)}, then ${why}.`
}

function uiToolTitle(name: string, input: Record<string, unknown>): string {
  const route = typeof input.route === 'string' ? input.route : null
  switch (name) {
    case 'goTo':
      return route ? `Went to ${route}` : 'Went to another page'
    case 'flyTo':
      return 'Flew over to it'
    case 'highlight':
      return 'Outlined it'
    case 'click':
      return 'Pressed it'
    case 'scrollToMe':
      return 'Scrolled to himself'
    case 'journey':
      return 'Walked you there'
    default:
      return titleFor(name)
  }
}

function titleFor(name: string): string {
  if (!name) return 'Make that change'
  const words = name.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
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
  const out: LegOutcome = {
    text: '',
    pending: [],
    approvals: [],
    screen: null,
    error: null,
    refused: false,
  }

  // A tool-approval request carries only ids. The NAME arrived earlier, on
  // that call's `tool-input-available` chunk, so it is remembered here —
  // otherwise the reader is asked to approve 'call_a7f3'.
  const approvalNames = new Map<string, string>()
  const approvalTitles = new Map<string, string>()
  // The ARGUMENTS too. Answering an approval replays the whole tool call, so
  // without these the replayed part is not a valid call and cannot be resumed.
  const approvalInputs = new Map<string, Record<string, unknown>>()

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
        approvalId?: string
        signature?: string
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
      } else if (part.type === 'data-decke-approval-preview' && part.data) {
        // THE DRY RUN'S REAL ROWS, keyed to the call the SDK is holding.
        //
        // It arrives on the stream BEFORE the stream closes, and the card is
        // not opened until after — which is the ordering invariant the whole
        // design rests on, and which is a property of this file rather than of
        // the SDK: signing genuinely races ahead of the awaited callback under
        // `streamText`. It survives only because the question is asked once the
        // leg has finished draining.
        handlers.onApprovalPreview(part.data as unknown as ApprovalPreview)
      } else if (part.type === 'data-decke-tool' && part.data) {
        // A tool-call chip. Emitted by the SERVER's execute wrapper, never by
        // the model, so it corresponds 1:1 to a real invocation of a real
        // handler. That is the whole point: work has been indistinguishable
        // from theatre, because `thinking` is driven by request latency and a
        // fabricated answer looks exactly like a researched one while it is
        // being produced.
        handlers.onToolChip(part.data as unknown as ToolChip)
      } else if (part.type === 'tool-approval-request' && typeof part.approvalId === 'string') {
        // HE IS ASKING PERMISSION, and the SDK is holding the call. Nothing has
        // run: the tool's `execute` is genuinely not invoked until an approval
        // goes back. Collected rather than answered here, because the answer is
        // the reader's and this loop is still draining a stream.
        out.approvals.push(
          pendingApprovalFromChunk(
            { approvalId: part.approvalId, toolCallId: part.toolCallId, signature: part.signature },
            approvalNames,
            approvalTitles,
            approvalInputs,
          ),
        )
      } else if (
        part.type === 'tool-input-available' &&
        typeof part.toolCallId === 'string' &&
        !isClientTool(part.toolName)
      ) {
        // A SERVER tool announcing itself. Not ours to run — but the approval
        // request that may follow carries only ids, so this is where the name
        // is learned. Kept even when no approval follows; the map is per-leg
        // and costs nothing.
        approvalNames.set(part.toolCallId, String(part.toolName ?? ''))
        approvalTitles.set(part.toolCallId, titleFor(String(part.toolName ?? '')))
        approvalInputs.set(part.toolCallId, (part.input ?? {}) as Record<string, unknown>)
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

/**
 * The transcript, as the server wants it back.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY A TURN'S LOOKUPS ARE REPLAYED, COMPACTED (spec §2.3)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This used to keep text and nothing else. So turn N+1 had no record that turn
 * N had read 604 cards — only its own prose about them. Which re-creates the
 * original pathology in a new form: he asserts from his own earlier sentences
 * rather than from data, and a sentence is exactly the thing that can drift.
 * "You've got 70 of them" becomes "you've got most of them" becomes a number
 * nobody looked up.
 *
 * Three options were on the table and the owner chose this one:
 *
 *   replay everything     truthful, and the input bill grows without bound on
 *                         a long conversation — colliding with the per-turn
 *                         input budget the tool ceiling exists to defend
 *   re-read per turn      always fresh, never stale, and costs a tool call and
 *                         a round trip on every follow-up question
 *   replay COMPACTED      what a lookup FOUND, in one line, not its 200 rows
 *
 * The compact form is the chip's own summary — the first line of the real tool
 * result, produced by the server's execute wrapper. So the record cannot
 * describe a lookup that did not happen: there is no chip without an
 * invocation.
 *
 * MARKED AS A RECORD, not folded into his speech. Appending "I read 604 cards"
 * to his words would put sentences in his mouth he never said, and the next
 * turn would replay them as if he had. It is a separate part, prefixed, and
 * plainly not dialogue.
 */
const TOOL_RECORD_PREFIX = '[lookups on that turn, for your own reference —'

function messagesToWire(msgs: ChatMessage[]): WireMessage[] {
  return msgs
    .filter((m) => messageText(m).trim().length > 0 || messageTools(m).length > 0)
    .map((m) => {
      const parts: WirePart[] = []
      const text = messageText(m)
      if (text.trim().length > 0) parts.push({ type: 'text', text })
      // A PARTIAL RESULT IS STILL EVIDENCE, AND IT IS LABELLED AS PARTIAL.
      //
      // Both halves matter. Dropping it would lose the record that turn N read
      // anything at all, leaving turn N+1 with only prose about it — and prose
      // is exactly the thing that drifts, which is why this record exists.
      // Including it unlabelled is worse: he would carry a reading that stopped
      // half way through the collection forward as a complete one, and quote
      // its figure again with more confidence than the first time.
      const done = messageTools(m).filter(
        (t) => (t.phase === 'ok' || t.phase === 'partial') && t.summary,
      )
      if (done.length) {
        parts.push({
          type: 'text',
          text:
            `${TOOL_RECORD_PREFIX} you actually ran these, so the figures in them are real ` +
            `and yours are not a guess]\n` +
            done
              .map((t) =>
                t.phase === 'partial'
                  ? `${t.name}: ${t.summary} [INCOMPLETE — this one ran out of ` +
                    `${t.reason === 'truncated' ? 'room' : 'time'} and did not finish. ` +
                    `Do not present its figures as a full answer.]`
                  : `${t.name}: ${t.summary}`,
              )
              .join('\n'),
        })
      }
      // A turn that produced only tool records and no speech still has to be a
      // valid message; the filter above lets it through, so guard the shape.
      return { role: m.role, parts: parts.length ? parts : [{ type: 'text', text }] }
    })
}

/**
 * How many landmarks one turn's prompt may carry.
 *
 * THE CAP EXISTS BECAUSE THE LIST IS PROMPT, NOT DATA. Every landmark is a
 * selector plus a label rendered into the system prompt of every leg of every
 * turn, and a journey is up to `legBudget(MAX_APPROVAL_REPLAYS)` full requests,
 * each re-billing the whole prompt. At roughly 15 tokens a landmark, 40 is about
 * 600 tokens a turn, and up to ~3,600 across the six-leg worst case — a turn
 * that journeys AND spends both reserved approval legs. This figure said ~2,400
 * for a four-leg journey until the approval reserve was added; a cost estimate
 * that is not updated with the budget it estimates is a number someone will
 * later trust. Stated here so the next person can re-weigh it against a real
 * bill rather than guess.
 *
 * WHAT HAPPENS WHEN IT IS HIT: the surplus is dropped, silently, and Deck-E is
 * simply never told those parts of the page exist. He does not get a truncation
 * marker and there is nothing sensible he could do with one. That is why the
 * ORDER below matters more than the number — the landmarks that survive have to
 * be the ones the reader is most plausibly asking about.
 *
 * It was 24, in DOM order, which is how the spec's own worst case (§9.1) fails:
 * a series page with twenty-plus set rows plus a header spends the whole budget
 * on rows above the fold and never mentions the rest, and if the reader has
 * scrolled, every landmark he is told about is off-screen.
 *
 * MIRRORED in `api/chat.mjs`, which slices the array again server-side because
 * the browser is not a trusted source of prompt size. Change one, change both.
 */
const LANDMARK_CAP = 40

/**
 * What he can be told about, on this page, right now.
 *
 * An allowlist by construction: only elements the app has deliberately marked
 * are visible to the model, so a card whose NAME is a CSS selector cannot make
 * itself a navigation target. `data-decke-label` is the human name he uses when
 * talking about it.
 *
 * Ordered before it is cut, in three passes, most significant first:
 *
 *  1. **On screen beats off screen.** "This" and "that" mean what the reader can
 *     see. Measured with `getBoundingClientRect()` against the viewport, which
 *     also drops anything collapsed to zero size — a landmark inside a closed
 *     disclosure is in the DOM and is not on the page in any sense the reader
 *     would recognise.
 *  2. **Containers beat items.** Declared, via an optional
 *     `data-decke-rank="container"`, and NOT inferred from nesting or DOM
 *     position: guessing "this element contains another landmark, so it is a
 *     container" gets a set row wrong the day someone marks a card inside one,
 *     and every heuristic of that shape is a silent behaviour change hiding in
 *     a markup change. Unmarked means `"item"`, so the default is the cautious
 *     one and a page that has never heard of ranking still sorts by 2 and 3.
 *  3. **DOM order.** The stable tiebreak, so the same page produces the same
 *     list twice running — a list that reshuffles between legs of one journey
 *     would have him aiming at a different thing than he just said he would.
 *
 * The RETURN SHAPE is unchanged and deliberately so: `{selector, label}` is what
 * `buildSystemPrompt` consumes, and rank/visibility are inputs to the sort, not
 * something the model is told about.
 */
function collectLandmarks(): { selector: string; label: string }[] {
  type Ranked = {
    selector: string
    label: string
    onScreen: boolean
    rank: number
    order: number
    clickable: boolean
  }
  const found: Ranked[] = []
  const vh = window.innerHeight
  const vw = window.innerWidth
  let order = 0
  for (const el of document.querySelectorAll<HTMLElement>('[data-decke-landmark]')) {
    const selector = el.dataset.deckeLandmark
    const label = el.dataset.deckeLabel
    if (!selector || !label) continue
    const r = el.getBoundingClientRect()
    const onScreen =
      r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
    found.push({
      selector,
      label,
      onScreen,
      rank: el.dataset.deckeRank === 'container' ? 0 : 1,
      order: order++,
      // ASKED OF THE CODE THAT WILL LATER REFUSE OR ALLOW THE PRESS, not of the
      // attribute. `isPressable` is `resolveClickTarget`'s own predicate: the
      // marking, plus the element actually being a control, plus — for an
      // anchor — same origin and a route on the allowlist. Checking only the
      // attribute would promise a press the runtime then refuses, and he
      // announces the plan before executing it, so the reader would watch him
      // say he was going to press something and then not.
      clickable: isPressable(el),
    })
  }
  found.sort(
    (a, b) =>
      Number(b.onScreen) - Number(a.onScreen) || a.rank - b.rank || a.order - b.order,
  )
  return found
    .slice(0, LANDMARK_CAP)
    // `clickable` omitted rather than sent as `false`, because it rides in the
    // prompt on every leg and forty `clickable: false` fields is prompt spent
    // saying nothing. Absent already means "not pressable" on the other side.
    .map(({ selector, label, clickable }) => (clickable ? { selector, label, clickable } : { selector, label }))
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
