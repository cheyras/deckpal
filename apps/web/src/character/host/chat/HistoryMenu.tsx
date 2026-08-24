/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CHAT HISTORY DROPDOWN.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * *"To the right of the chat page title, I'd like a dropdown that has a chat
 * history saved. A few reasons: first it's just helpful. But second, I think
 * fixing things and improving the agent will be greatly helped by having a full
 * record of all my chats, which tools were called. Should probably have each
 * chat transcript record say what was the latest PR it's immediately after so we
 * can easily spot regressions."*
 *
 * Two audiences in one control, and they want different things from the same
 * row. A reader wants the sentence they typed and roughly when. A maintainer
 * wants a build number he can compare down a column and a way to see, at a
 * glance, which conversations straddle a deploy. So the row is a title and a
 * time on the left, and a monospace build stamp hard against the right edge —
 * one column of numbers, in tabular figures, which is what makes `#78` and `#77`
 * comparable without reading either of them as words.
 *
 * ── WHY IT IS NOT A `role="menu"` ────────────────────────────────────────────
 *
 * Because it is not a menu. A menu's items are commands and a menu owns arrow
 * keys, home/end and typeahead; a row here is a destination with a second,
 * destructive control inside it, and `menuitem` children may not contain other
 * focusable elements. Faking the role would buy the word "menu" in a screen
 * reader and cost every keyboard behaviour it promises.
 *
 * What this is, precisely, is a DISCLOSURE: a button with `aria-expanded` and
 * `aria-controls` over a labelled list. That is honest, Tab already walks it in
 * DOM order, and Escape closes it. The pattern is the same one `KebabMenu` uses
 * for dismissal (`mousedown` + `keydown` on the document), deliberately reused
 * rather than reinvented.
 *
 * ── POSITIONED BY MEASUREMENT, NOT BY HOPE ───────────────────────────────────
 *
 * `absolute left-0` under the trigger falls off the right edge of a 390px
 * screen, because the trigger sits ~110px in and the panel wants ~340. So the
 * offset is computed from the trigger's real rect and clamped to the viewport.
 *
 * ABSOLUTE, NOT FIXED, and that is the load-bearing word: the chat panel plays a
 * `transform` animation on open, and a transformed ancestor silently makes
 * `position: fixed` resolve against the ancestor instead of the viewport. An
 * absolute offset cannot be wrong for that reason.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { api, type DeckeConversationSummary } from '../../../lib/api'
import {
  buildStamp,
  conversationMeta,
  conversationTitle,
  errorLine,
  groupConversations,
  type BuildStamp,
} from './historyState'

/** How wide the sheet wants to be, and how much air it keeps at a screen edge. */
const PANEL_W = 344
const EDGE = 12

export type HistoryMenuProps = {
  /** The conversation the reader is currently READING, if any. Marked in the list. */
  viewingId: string | null
  /**
   * The conversation being recorded RIGHT NOW.
   *
   * The live chat is in this list — turns are filed as they happen — so without
   * it the row you are sitting in looks like any other. It could not be
   * inferred: newest `updatedAt` is wrong with two tabs open, and matching on
   * title is wrong the moment two conversations start the same way.
   *
   * Its row does not open. A read-only record of the chat already on screen
   * behind the menu is a strange trip to make somebody take, and "you are here"
   * is the whole of what it has to say.
   */
  liveId: string | null
  /** Start a fresh conversation — clears the transcript and rotates the id. */
  onNewChat: () => void
  onOpenConversation: (id: string) => void
  /**
   * A conversation was deleted. The viewer, if it is showing that one, has to
   * stop — a transcript whose row is gone is a transcript of nothing.
   */
  onDeleted: (id: string) => void
}

/**
 * Every state the list can be in, as data.
 *
 * Exported because `/dev/chat-ui` photographs all four with labelled fixtures,
 * and a gallery that can only show whatever the network happened to return is a
 * gallery of one state — which is precisely how the empty and failed states of
 * every other surface in this codebase went unlooked-at until somebody hit them.
 */
export type HistoryLoad =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; items: DeckeConversationSummary[] }
  | { state: 'failed'; message: string }

/**
 * The stamp, as it appears in a list row and in the viewer's head.
 *
 * `tabular-nums` is not decoration. A column of proportional digits does not
 * line up, and the entire value of putting a number on every row is that the
 * eye can run down them and stop where one differs.
 *
 * A SPAN IS TINTED AND NOTHING ELSE IS. `#77→78` means the conversation
 * outlived a deploy, which is the one row in a list of forty worth opening when
 * something started going wrong. It gets the brand's own quiet ring rather than
 * a warning colour: it is interesting, not broken.
 */
export function BuildStampChip({ stamp, className }: { stamp: BuildStamp; className?: string }) {
  return (
    <span
      title={stamp.title}
      className={[
        'shrink-0 whitespace-nowrap rounded-[6px] border px-[5px] py-[1px]',
        'font-mono text-[11px] leading-[16px] tabular-nums',
        stamp.kind === 'spanned'
          ? 'border-action-primary/40 bg-action-primary/[0.10] text-action-primary'
          : stamp.kind === 'one'
            ? 'border-surface-tertiary text-text-secondary'
            : // NOTHING WAS RECORDED, and the row says exactly that. Never `#0`,
              // never "unknown build": a dash holds the column and asserts
              // nothing, and the title sentence explains it to anyone who asks.
              'border-transparent text-text-muted',
        className ?? '',
      ].join(' ')}
    >
      {stamp.text}
    </span>
  )
}

export function HistoryMenu({ viewingId, liveId, onNewChat, onOpenConversation, onDeleted }: HistoryMenuProps) {
  const [open, setOpen] = useState(false)
  const [load, setLoad] = useState<HistoryLoad>({ state: 'idle' })
  /** The row whose delete has been asked for but not confirmed. */
  const [confirming, setConfirming] = useState<string | null>(null)
  /** The row whose delete is actually in flight. */
  const [deleting, setDeleting] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [dx, setDx] = useState(0)

  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const now = useRef(new Date())

  const fetchList = useCallback((signal?: AbortSignal) => {
    setLoad({ state: 'loading' })
    api
      .deckeHistoryList(signal)
      .then((r) => {
        if (signal?.aborted) return
        // The clock is re-read on every load, not captured at mount. A panel
        // left open across midnight would otherwise file this morning's chat
        // under "Yesterday".
        now.current = new Date()
        setLoad({ state: 'ready', items: r.conversations })
      })
      .catch((e: unknown) => {
        if (signal?.aborted) return
        setLoad({ state: 'failed', message: errorLine(e) })
      })
  }, [])

  // ALWAYS REFETCHED ON OPEN, never cached across opens. The list changes every
  // time a turn finishes — including turns taken since this panel was last
  // looked at — so a cached list is a list that is wrong exactly when somebody
  // opens it to check what just happened.
  useEffect(() => {
    if (!open) return
    const ac = new AbortController()
    setConfirming(null)
    setRowError(null)
    fetchList(ac.signal)
    return () => ac.abort()
  }, [open, fetchList])

  // Where the sheet can actually sit. Measured before paint so it never appears
  // in the wrong place for a frame, and re-measured on resize because a rotated
  // phone is a different clamp.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect()
      if (!r) return
      const w = Math.min(PANEL_W, window.innerWidth - EDGE * 2)
      const wanted = Math.min(Math.max(EDGE, r.left), window.innerWidth - w - EDGE)
      setDx(wanted - r.left)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  // Dismissal, the same two listeners `KebabMenu` uses. `stopPropagation` on
  // Escape matters here and does not there: the chat panel has its own
  // window-level Escape handler that closes the WHOLE chat, and pressing Escape
  // to shut a dropdown must not also throw away the conversation behind it.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDoc)
    // CAPTURE PHASE, because the panel's own handler is on `window` and would
    // otherwise run first and close everything.
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const remove = (id: string) => {
    setDeleting(id)
    setRowError(null)
    api
      .deckeHistoryDelete(id)
      .then(() => {
        // ── THE ROW GOES AFTER THE SERVER SAYS SO, NOT BEFORE ──────────────
        // An optimistic removal is a claim that a write succeeded before it
        // has, which is the exact species of untruth this whole pass exists to
        // remove. The wait is one round trip and the row says "Deleting…"
        // through it.
        setLoad((prev) =>
          prev.state === 'ready' ? { state: 'ready', items: prev.items.filter((c) => c.id !== id) } : prev,
        )
        setConfirming(null)
        onDeleted(id)
      })
      .catch((e: unknown) => setRowError({ id, message: errorLine(e) }))
      .finally(() => setDeleting(null))
  }

  const w = `min(${PANEL_W}px, calc(100vw - ${EDGE * 2}px))`

  return (
    <div ref={wrapRef} className="pointer-events-auto relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={[
          'flex items-center gap-[5px] rounded-full border px-[9px] py-[3px]',
          'text-[12px] font-semibold leading-[17px] motion-safe:transition-colors',
          open
            ? 'border-border-default bg-surface-secondary text-text-primary'
            : 'border-transparent text-text-secondary hover:bg-surface-secondary hover:text-text-primary',
        ].join(' ')}
      >
        <Icon name="history" size={14} className="shrink-0" />
        History
        <Icon
          name="chevron-down"
          size={13}
          className={['shrink-0 text-icon-muted', open ? 'rotate-180' : ''].join(' ')}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          style={{ left: dx, width: w }}
          className={[
            'absolute top-full z-[20] mt-[6px] overflow-hidden rounded-[14px]',
            'border border-border-default bg-surface-primary shadow-lg',
            'motion-safe:animate-[decke-chat-in_160ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]',
          ].join(' ')}
        >
          <HistorySheet
            load={load}
            now={now.current}
            viewingId={viewingId}
            liveId={liveId}
            onNewChat={() => {
              setOpen(false)
              onNewChat()
            }}
            confirming={confirming}
            deleting={deleting}
            rowError={rowError}
            onRetryList={() => fetchList()}
            onOpen={(id) => {
              setOpen(false)
              onOpenConversation(id)
            }}
            onAskDelete={(id) => {
              setRowError(null)
              setConfirming(id)
            }}
            onCancelDelete={() => setConfirming(null)}
            onConfirmDelete={remove}
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * ── THE SHEET, WITH NO NETWORK IN IT ─────────────────────────────────────────
 *
 * Split from `HistoryMenu` so that every state it can be in is a VALUE somebody
 * can hand it. `/dev/chat-ui` photographs all four with labelled fixtures, and a
 * gallery that can only show whatever the network happened to return is a
 * gallery of one state — which is exactly how the empty and failed halves of
 * other surfaces in this codebase went unlooked-at until somebody hit them.
 *
 * Fully controlled, including the per-row delete state: the confirm and the
 * failed-delete are the two states hardest to reach by hand and the two most
 * worth a second look.
 */
export function HistorySheet({
  load,
  now,
  viewingId,
  liveId,
  onNewChat,
  confirming,
  deleting,
  rowError,
  onOpen,
  onRetryList,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  load: HistoryLoad
  now: Date
  viewingId: string | null
  /** The live conversation, marked and not openable. See `HistoryMenuProps`. */
  liveId: string | null
  /** Start a fresh conversation. Absent in fixtures that photograph the list alone. */
  onNewChat?: () => void
  confirming: string | null
  deleting: string | null
  rowError: { id: string; message: string } | null
  onOpen: (id: string) => void
  onRetryList: () => void
  onAskDelete: (id: string) => void
  onCancelDelete: () => void
  onConfirmDelete: (id: string) => void
}) {
  return (
    <>
      {/*
        THE HEAD SAYS WHAT THE COLUMN OF NUMBERS IS.

        Without it the build stamp is an unexplained `#78` on every row, and
        an unexplained number is one a reader learns to ignore. One line,
        said once, at the top — not a tooltip on forty rows.
      */}
      <div className="flex items-baseline gap-[8px] border-b border-surface-tertiary px-[13px] py-[8px]">
        <span className="text-[12px] font-bold text-text-primary">Chat history</span>
        <span className="text-[11px] leading-[16px] text-text-muted">the build each ran on</span>
      </div>

      {/*
        ── NEW CHAT, AT THE TOP, WHERE A NEW CHAT GOES ────────────────────────
        A conversation had no boundary before this: the id was minted once per
        tab and the transcript was never cleared, so a long session filed days
        of unrelated exchanges as one row. This is the boundary — and it lives
        here rather than in the header because it is the same subject as the
        list it sits above: which conversation you are in.

        It clears the transcript AND rotates the id together. Doing either
        alone makes the history stop describing what is on screen.
      */}
      {onNewChat ? (
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-[7px] border-b border-surface-tertiary px-[13px] py-[9px] text-left text-[12.5px] font-medium text-text-body hover:bg-surface-secondary"
        >
          <Icon name="plus" size={13} className="shrink-0 text-icon-default" />
          New chat
        </button>
      ) : null}

      <div className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain">
        {load.state === 'loading' || load.state === 'idle' ? (
          <p className="px-[13px] py-[18px] text-center text-[12px] text-text-muted">Reading your history…</p>
        ) : load.state === 'failed' ? (
          /*
            A FAILURE OFFERS THE ONE THING THAT MIGHT WORK, and says what
            actually went wrong rather than "an error occurred". The retry
            is real — it re-runs the same request — so the button is not a
            decoration promising something it cannot do.
          */
          <div className="px-[13px] py-[14px]">
            <p className="text-[12px] leading-[18px] text-text-body">Couldn’t load your history.</p>
            <p className="mt-[2px] text-[11px] leading-[16px] text-text-muted">{load.message}</p>
            <button
              type="button"
              onClick={onRetryList}
              className="mt-[8px] rounded-[7px] border border-border-default px-[9px] py-[2px] text-[11.5px] font-semibold leading-[16px] text-text-body hover:bg-surface-secondary hover:text-text-primary"
            >
              Try again
            </button>
          </div>
        ) : load.items.length === 0 ? (
          /*
            EMPTY IS NOT AN ERROR AND MUST NOT LOOK LIKE ONE. It also says
            what will be here, because "no conversations" alone reads as a
            feature that does not work yet.
          */
          <div className="px-[13px] py-[16px]">
            <p className="text-[12px] leading-[18px] text-text-body">No chats recorded yet.</p>
            <p className="mt-[2px] text-[11px] leading-[16px] text-text-muted">
              Every exchange is filed here as it happens, with the tools he ran and the build he ran them on.
            </p>
          </div>
        ) : (
          groupConversations(load.items, now).map((group, gi) => (
            <div key={`${group.label}-${gi}`}>
              <div className="sticky top-0 z-[1] bg-surface-primary px-[13px] pb-[4px] pt-[9px] text-[10.5px] font-semibold uppercase tracking-[0.05em] text-text-muted">
                {group.label}
              </div>
              <ul>
                {group.items.map((c) => (
                  <HistoryRow
                    key={c.id}
                    c={c}
                    now={now}
                    viewing={c.id === viewingId}
                    live={c.id === liveId}
                    confirming={confirming === c.id}
                    deleting={deleting === c.id}
                    error={rowError?.id === c.id ? rowError.message : null}
                    onOpen={() => onOpen(c.id)}
                    onAskDelete={() => onAskDelete(c.id)}
                    onCancelDelete={onCancelDelete}
                    onConfirmDelete={() => onConfirmDelete(c.id)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </>
  )
}

/**
 * One conversation.
 *
 * TWO CONTROLS, NEVER NESTED. The row cannot be a single `<button>` because it
 * carries a delete, and a button inside a button is invalid markup that browsers
 * resolve by silently dropping one of them. So it is a flex row holding an open
 * control that takes all the free width and a delete beside it.
 *
 * ── DELETING TAKES TWO PRESSES AND THERE IS NO UNDO ──────────────────────────
 *
 * The RLS on `decke_turn` grants delete and deliberately does not grant update:
 * you may withdraw your own words, you may not revise them. There is no soft
 * delete and no recovery, so this must not offer one — a toast saying "Undo"
 * that cannot undo is worse than no toast.
 *
 * What it offers instead is the second press: the ✕ swaps the row's trailing
 * edge for the word "Delete" in the danger colour beside a "Cancel", so the
 * destructive press is a different press in a different place with a different
 * word on it. Nothing is removed from the list until the server has said it is
 * gone.
 */
function HistoryRow({
  c,
  now,
  viewing,
  live,
  confirming,
  deleting,
  error,
  onOpen,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  c: DeckeConversationSummary
  now: Date
  viewing: boolean
  /** This is the chat the reader is in right now. Marked, and not openable. */
  live: boolean
  confirming: boolean
  deleting: boolean
  error: string | null
  onOpen: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}) {
  const stamp = buildStamp(c.buildPrMin, c.buildPrMax)
  return (
    <li className={['group/row px-[7px]', viewing ? 'bg-surface-secondary' : ''].join(' ')}>
      <div className="flex items-start gap-[4px]">
      <button
        type="button"
        onClick={onOpen}
        // THE LIVE ROW DOES NOT OPEN. It is the conversation on screen behind
        // this menu; a read-only record of it would be a strange trip to make
        // somebody take, and they would have to find their way back from it.
        // Disabled rather than hidden — it is genuinely in the list, and hiding
        // it would make the list disagree with the history it is showing.
        disabled={live && !viewing}
        // `aria-current` rather than a visual-only highlight: the row the reader
        // is already looking at is a fact assistive tech needs too. `page` for
        // the live one, because that is what it is — the thing currently open.
        aria-current={viewing ? 'true' : live ? 'page' : undefined}
        className={[
          'flex min-w-0 flex-1 flex-col rounded-[9px] px-[6px] py-[7px] text-left',
          live && !viewing ? 'cursor-default' : 'hover:bg-surface-secondary',
        ].join(' ')}
      >
        {/*
          ── THE TITLE GETS THE WHOLE LINE, AND THE STAMP GETS THE NEXT ONE ───

          The stamp used to sit beside the title, which put a 66px chip in the
          middle of a 344px sheet and cut *"how many pitch black cards am I
          missing?"* down to *"…am I mi…"* — photographed at 390px. The reader's
          half of this feature is FINDING A CONVERSATION AGAIN, and the sentence
          they typed is the only thing that does that job.

          Moving it down a line costs nothing that matters. The stamp is still a
          right-aligned column of tabular figures — which is the entire reason
          it is legible down a list — and it now sits with the other facts about
          the conversation, which is what it is. The trailing edge of line one is
          left to the delete, so the two controls never share a row either.
        */}
        <span
          className={[
            'block truncate text-[12.5px] leading-[18px]',
            viewing ? 'font-semibold text-text-primary' : 'text-text-body',
          ].join(' ')}
        >
          {conversationTitle(c.title)}
        </span>
        <span className="mt-[1px] flex w-full items-center gap-[8px] text-[11px] leading-[16px] text-text-muted">
          <span className="truncate">
            {conversationMeta(c, now)}
            {viewing ? <span className="text-action-primary"> · reading</span> : null}
            {/*
              "now" rather than "current" or "live": it is the shortest true
              word, and it sits inside a title that is already carrying the
              reader's own sentence. `viewing` wins when both are true — you
              cannot be reading a record of it and sitting in it at once, but if
              the two ever disagree the one describing THIS SCREEN is the honest
              answer.
            */}
            {!viewing && live ? <span className="text-text-muted"> · now</span> : null}
          </span>
          {/* A spacer rather than `ml-auto` on the chip, so the meta text
              truncates instead of shoving the stamp out of its column. */}
          <span className="min-w-[8px] flex-1" aria-hidden="true" />
          <BuildStampChip stamp={stamp} />
        </span>
      </button>

      {confirming ? (
        <span className="flex shrink-0 items-center gap-[4px] self-center pr-[3px]">
          <button
            type="button"
            onClick={onConfirmDelete}
            disabled={deleting}
            className="rounded-[7px] border border-error/45 px-[7px] py-[2px] text-[11px] font-semibold leading-[16px] text-error hover:bg-error/[0.12] disabled:opacity-60"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button
            type="button"
            onClick={onCancelDelete}
            disabled={deleting}
            className="rounded-[7px] px-[6px] py-[2px] text-[11px] font-semibold leading-[16px] text-text-muted hover:text-text-primary disabled:opacity-60"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={onAskDelete}
          aria-label={`Delete “${conversationTitle(c.title)}”`}
          /*
            ── ALWAYS VISIBLE, AND THAT IS A REVERSAL ────────────────────────

            This was a hover-reveal — `[@media(hover:hover)]:opacity-0` plus a
            `group-hover` — which is the standard pattern for a delete in a list
            and is what I built first. It is gone, for two reasons, and the
            second is the one that decided it.

            **It could not be verified.** Two of my own instruments disagreed
            about it in the same session: a DOM query on the touch profile
            reported every ✕ at opacity 1, and the photograph of that same page
            showed exactly one of them. One of those readings was wrong and I
            could not tell which — and a destructive control whose visibility I
            cannot state with confidence is a control I should not ship behind a
            condition. `Emulation.setEmulatedMedia` will not force the `hover`
            feature either, so there is no instrument here that settles it.

            **And obscurity was never the safety.** The thing that stops an
            accidental delete is the second press — a different button, in a
            different place, with the word "Delete" on it. Hiding the first
            press buys tidiness and costs discoverability on every device that
            reports no hover, which is every phone. Given that the protection
            lives elsewhere, the tidiness is not worth an unverifiable branch.

            So it rests at the panel's muted icon colour, the same weight as the
            chevrons and glyphs around it, and only turns red under a pointer or
            a focus ring — which is a state change nobody can misread, because
            it happens on the element you are already pointing at.
          */
          className={[
            'mt-[7px] flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full',
            'text-icon-muted motion-safe:transition-colors',
            'hover:bg-surface-secondary hover:text-error focus-visible:text-error',
          ].join(' ')}
        >
          <Icon name="close" size={13} />
        </button>
      )}
      </div>

      {/*
        A FAILED DELETE LEAVES THE ROW AND SAYS WHY, in flow rather than floating
        over the row it is about. `role="alert"` because the reader pressed a
        destructive button and is entitled to be told it did not happen.
      */}
      {error ? (
        <p role="alert" className="px-[6px] pb-[7px] text-[10.5px] leading-[15px] text-error">
          Not deleted — {error}
        </p>
      ) : null}
    </li>
  )
}
