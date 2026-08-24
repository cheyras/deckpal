/**
 * ══════════════════════════════════════════════════════════════════════════════
 * A PAST CONVERSATION, READ BACK.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── THE ONE FAILURE THIS SURFACE MUST NOT HAVE ───────────────────────────────
 *
 * Somebody typing into a transcript they are only reading. Everything here is
 * arranged against that, and the strongest measure is the one that costs a
 * feature rather than adding a warning: **there is no composer.** The box is not
 * greyed and it is not disabled — it is gone, and in its place is a bar that
 * says what this is and how to get back.
 *
 * That is the same ruling the owner already made about the spent-credit state,
 * quoted in `DeckeChat`: an input that is still there takes a question, swallows
 * it, and explains afterwards. A control that is gone cannot lie about what it
 * will do. It is the right answer twice for the same reason, so it is the same
 * answer.
 *
 * Three more, in descending order of how much work they do:
 *
 *  • The head band is pinned above the scroll and says *Saved chat · read only*
 *    in the panel's own quiet type. It never scrolls away.
 *  • It opens at the TOP. A live transcript is bottom-anchored because the
 *    newest line is the one you want; a record is a document and you read it
 *    from the beginning. The difference is felt before it is noticed.
 *  • Escape and the exit bar both return to the live chat, and the live
 *    conversation is not touched by any of this — it is still in the hook,
 *    still mid-turn if it was mid-turn, and comes back exactly as it was.
 *
 * ── IT REUSES THE REAL COMPONENTS, WHICH IS THE POINT ────────────────────────
 *
 * `ToolRow`, `ChatMarkdown` and the bubble classes are the ones the live
 * transcript uses, not copies of them. A second rendering of a tool row would
 * drift from the first within a release and the history would stop being a
 * record of anything — it would be a record of what a different component
 * thought the first one looked like.
 *
 * The one thing this adds is `recorded: true` on every row, which is a fact
 * about provenance rather than a style: nothing here is still running, and
 * nothing here can be retried. See `ToolRowData.recorded`.
 *
 * ── THE BUILD STAMP IS THE FEATURE ───────────────────────────────────────────
 *
 * *"Should probably have each chat transcript record say what was the latest PR
 * it's immediately after so we can easily spot regressions."*
 *
 * Every turn carries its own `#78` in its meta line, and — the part the data
 * gives away for free — when the stamp CHANGES between two turns, a ruled line
 * says `Deployed #78` across the column. A regression hunt is then a matter of
 * scrolling to that rule and reading the turn above it and the turn below it.
 * That is the whole feature in one horizontal line.
 */

import { useEffect, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { api, type DeckeConversation } from '../../../lib/api'
import { ChatMarkdown } from './ChatMarkdown'
import { ToolRow } from './ToolRow'
import { BuildStampChip } from './HistoryMenu'
import {
  buildStamp,
  conversationTitle,
  deployMarkers,
  errorLine,
  fullWhen,
  historyToolRows,
  isGone,
  shortSha,
  turnStamp,
  whenLabel,
} from './historyState'

/**
 * Every state a record can be in, as data.
 *
 * Exported for the same reason `HistoryLoad` is: `/dev/chat-ui` photographs all
 * four with labelled fixtures. "Deleted in another tab" and "the request failed"
 * are the two states nobody reaches by accident and the two most worth looking
 * at, because both of them are how a perfectly working feature gets reported as
 * broken.
 */
export type TranscriptLoad =
  | { state: 'loading' }
  | { state: 'ready'; conversation: DeckeConversation }
  | { state: 'gone' }
  | { state: 'failed'; message: string }

/**
 * The head band and the scroller, together; the exit bar is its own export.
 *
 * They are split that way because `DeckeChat` has one more thing to put between
 * them: a held approval. If he stopped mid-turn to ask permission to write, that
 * question does not stop being live because the reader wandered into the
 * archive, and it must not be hidden behind a record — so the panel keeps the
 * approval card mounted between this and the exit. Returning one fragment would
 * have made that impossible.
 */
export function TranscriptPane({ id, onBack }: { id: string; onBack: () => void }) {
  const [load, setLoad] = useState<TranscriptLoad>({ state: 'loading' })
  // Bumped by "Try again". A counter rather than a callback because the fetch
  // lives in an effect keyed on the id, and a retry is the same fetch again.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    setLoad({ state: 'loading' })
    api
      .deckeHistoryOne(id, ac.signal)
      .then((c) => {
        if (!ac.signal.aborted) setLoad({ state: 'ready', conversation: c })
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        const message = errorLine(e)
        // DELETED IS NOT BROKEN. Opening a conversation that another tab
        // removed a second ago is an ordinary thing to do and must not look
        // like a fault.
        //
        // `isGone`, not `looksDeleted`: the status is the fact and the server's
        // prose is only the fallback. Matching the sentence was the only option
        // before `lib/api.ts` carried a status, and it is a coupling to a string
        // somebody will reword — the day they do, a deleted conversation starts
        // reporting "something went wrong" with a retry that can never succeed.
        setLoad(isGone(e) ? { state: 'gone' } : { state: 'failed', message })
      })
    return () => ac.abort()
  }, [id, attempt])

  return (
    <>
      <TranscriptHead load={load} onBack={onBack} />
      {/*
        THE SCROLLER IS THE PANE AND THE MEASURE IS INSIDE IT — the same split
        the live transcript makes, for the same reason: a scrollbar drawn down
        the middle of a 1,600px pane beside a 760px column is the detail that
        reads as unfinished without the reader being able to name why.

        NO `mt-auto` AND NO FADE MASK. Both belong to a conversation that grows
        from the bottom. A record does not grow, so it starts at the top and
        ends where it ends.
      */}
      <div className="pointer-events-auto flex w-full min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col px-[16px]">
          <TranscriptBody load={load} onRetry={() => setAttempt((n) => n + 1)} />
        </div>
      </div>
    </>
  )
}

/**
 * ── THE BAND THAT SAYS WHAT YOU ARE LOOKING AT ───────────────────────────────
 *
 * Pinned above the scroller rather than scrolled with it, because the sentence
 * "this is not the live chat" has to be true at every scroll offset, not only at
 * the top. It is also where the conversation's build RANGE lives, so a
 * maintainer can see `#77→78` before reading a word.
 */
export function TranscriptHead({ load, onBack }: { load: TranscriptLoad; onBack: () => void }) {
  const c = load.state === 'ready' ? load.conversation : null
  const prs = c ? c.turns.map((t) => t.buildPr).filter((p): p is number => p != null) : []
  const stamp = prs.length ? buildStamp(Math.min(...prs), Math.max(...prs)) : buildStamp(null, null)
  const sha = c ? shortSha(c.turns[c.turns.length - 1]?.buildSha ?? null) : null

  return (
    <div className="pointer-events-auto shrink-0 border-b border-surface-tertiary bg-surface-secondary/40">
      <div className="mx-auto flex w-full max-w-[760px] items-start gap-[10px] px-[16px] py-[9px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to the live chat"
          className="-ml-[6px] mt-[1px] flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-icon-default motion-safe:transition-colors hover:bg-surface-secondary hover:text-icon-hover"
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase leading-[14px] tracking-[0.07em] text-text-muted">
            Saved chat · read only
          </p>
          <p className="truncate text-[13.5px] font-semibold leading-[19px] text-text-primary">
            {c ? conversationTitle(c.title) : load.state === 'gone' ? 'Deleted' : 'Opening…'}
          </p>
          {c ? (
            <p className="mt-[1px] text-[11px] leading-[16px] text-text-muted">
              {c.turns.length} turn{c.turns.length === 1 ? '' : 's'} · {fullWhen(c.startedAt)}
              {sha ? (
                <>
                  {' · '}
                  {/* SELECTABLE ON PURPOSE. The maintainer's next move after
                      finding a bad turn is `git show <sha>`, and a sha he has to
                      retype from a screenshot is a sha he will not use. */}
                  <span className="select-all font-mono text-[10.5px] tabular-nums">{sha}</span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        {c ? <BuildStampChip stamp={stamp} className="mt-[12px]" /> : null}
      </div>
    </div>
  )
}

/** The record itself. Scrolls; opens at the top. */
export function TranscriptBody({ load, onRetry }: { load: TranscriptLoad; onRetry: () => void }) {
  if (load.state === 'loading') {
    return <Centered>Opening the record…</Centered>
  }
  if (load.state === 'gone') {
    return (
      <Centered>
        <span className="text-text-body">This conversation was deleted.</span>
        <br />
        {/* NO "RESTORE". The RLS grants delete and deliberately withholds
            update — there is nothing to restore and offering it would be a
            button that cannot do its job. */}
        Nothing is kept once it is removed.
      </Centered>
    )
  }
  if (load.state === 'failed') {
    return (
      <Centered>
        <span className="text-text-body">Couldn’t open this conversation.</span>
        <br />
        {load.message}
        <br />
        <button
          type="button"
          onClick={onRetry}
          className="mt-[10px] rounded-[7px] border border-border-default px-[10px] py-[3px] text-[12px] font-semibold text-text-body hover:bg-surface-secondary hover:text-text-primary"
        >
          Try again
        </button>
      </Centered>
    )
  }

  const { turns } = load.conversation
  if (turns.length === 0) {
    return <Centered>No turns were recorded in this conversation.</Centered>
  }
  const markers = deployMarkers(turns)

  return (
    <ul className="flex flex-col gap-[18px] pb-[8px] pt-[14px]">
      {turns.map((t, i) => {
        const rows = historyToolRows(t)
        const stamp = turnStamp(t.buildPr)
        return (
          <li key={t.seq} className="flex flex-col gap-[8px]">
            {markers[i] ? <DeployRule label={markers[i] as string} /> : null}

            {/*
              THE META LINE LEADS THE TURN, not trails it. The maintainer's
              question is "which build was this on" and he asks it BEFORE
              reading the turn, not after — the same reason a commit's header is
              above its diff.
            */}
            <div className="flex items-center gap-[8px] text-[10.5px] leading-[15px] text-text-muted">
              <span className="font-semibold uppercase tracking-[0.05em]">Turn {t.seq + 1}</span>
              <span aria-hidden="true">·</span>
              <span>{whenLabel(t.at, new Date())}</span>
              <span className="h-px flex-1 bg-surface-tertiary" aria-hidden="true" />
              <BuildStampChip stamp={stamp} />
            </div>

            {t.asked ? (
              <div className="flex justify-end">
                <div className="decke-bubble rounded-[14px] bg-action-primary px-[12px] py-[8px] text-[14px] leading-[21px] text-action-primary-text">
                  <ChatMarkdown text={t.asked} tone="transcript" />
                </div>
              </div>
            ) : null}

            {/*
              ROWS BEFORE THE REPLY, AND THE RECORD IS WHY.

              The live transcript renders parts in occurrence order, so a lookup
              that happened between two sentences appears between them. The
              record cannot do that: `tools` is one array and `answered` is one
              string, so the interleaving was never stored. Grouping them ahead
              of the reply is a presentation choice made once, said out loud
              here and in the end-of-record line, rather than an invented
              sequence dressed as the real one — see `ToolRow`'s note (d) on why
              faking order is not available at any price.
            */}
            {rows.length ? (
              <ul className="decke-shift w-full">
                {rows.map((r) => (
                  <ToolRow key={r.id} data={r} />
                ))}
              </ul>
            ) : null}

            {t.answered ? (
              <div className="decke-bubble decke-shift self-start rounded-[14px] bg-surface-secondary px-[12px] py-[8px] text-[14px] leading-[21px] text-text-body">
                <ChatMarkdown text={t.answered} tone="transcript" />
              </div>
            ) : null}
          </li>
        )
      })}

      {/*
        THE END OF THE RECORD, said plainly, and the one caveat with it.

        A transcript that just stops leaves the reader wondering whether it
        loaded fully. And the caveat belongs here rather than in the head,
        where it would be a disclaimer over every conversation before anyone had
        read a line of one.
      */}
      <li className="pt-[2px] text-[10.5px] leading-[16px] text-text-muted">
        <span className="mb-[6px] block h-px w-full bg-surface-tertiary" aria-hidden="true" />
        End of record. Tool rows are grouped before each reply — the record keeps what ran, not where it
        interrupted him.
      </li>
    </ul>
  )
}

/**
 * ── WHERE THE COMPOSER WAS ───────────────────────────────────────────────────
 *
 * The exit sits in the composer's slot on purpose. "You cannot type here" is
 * best said exactly where typing would have happened, and it puts the way back
 * at the bottom of the panel where the thumb already is on a phone — pinned
 * outside the scroll, so it is reachable from any point in a long record.
 *
 * It borrows `.decke-composer-card` and `.decke-composer` from the real
 * composer: the same card, the same left clearance so it never starts
 * underneath him, and therefore the same floor to the panel. A different shape
 * here would read as a different app.
 */
export function TranscriptExit({ onBack }: { onBack: () => void }) {
  return (
    <div
      className="pointer-events-auto shrink-0 px-[16px]"
      style={{ paddingBottom: 'max(40px, env(safe-area-inset-bottom))' }}
    >
      <div className="decke-composer decke-composer-card flex items-center gap-[10px] p-[8px] pl-[14px]">
        <p className="min-w-0 flex-1 text-[12px] leading-[17px] text-text-muted">
          You’re reading a saved chat. Nothing here is live.
        </p>
        <button
          type="button"
          onClick={onBack}
          className={[
            'shrink-0 whitespace-nowrap rounded-[10px] bg-action-primary px-[12px] py-[7px]',
            'text-[12.5px] font-semibold leading-[18px] text-action-primary-text',
            'motion-safe:transition-colors hover:bg-action-primary-hover',
          ].join(' ')}
        >
          Back to chat
        </button>
      </div>
    </div>
  )
}

/**
 * The moment a deploy landed, mid-conversation.
 *
 * Ruled across the column because it is a boundary in TIME that happened to
 * everything below it, not a property of the next turn. It is the only element
 * on this surface that is allowed to interrupt the reading flow, and it earns
 * that: the turn above it and the turn below it ran on different code, which is
 * the single fact a regression hunt is looking for.
 */
function DeployRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[8px] pt-[4px]">
      <span className="h-px flex-1 bg-action-primary/25" aria-hidden="true" />
      <span className="whitespace-nowrap rounded-full border border-action-primary/35 bg-action-primary/[0.10] px-[8px] py-[1px] font-mono text-[10.5px] font-semibold leading-[15px] tabular-nums text-action-primary">
        {label}
      </span>
      <span className="h-px flex-1 bg-action-primary/25" aria-hidden="true" />
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-[20px] py-[40px]">
      <p className="max-w-[40ch] text-center text-[12.5px] leading-[19px] text-text-muted">{children}</p>
    </div>
  )
}
