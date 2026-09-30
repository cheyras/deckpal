import { useReducer, useRef, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { Button } from '../../../components/ui/Button'
import { feedbackReducer, initialFeedbackState, type FeedbackVote } from './feedbackState'

type FeedbackValue = { vote: FeedbackVote | null; comment: string; share: boolean }

export function ReplyFeedback({ seq, busy, latest, approvalPending, onSave, onOpenComment, onCloseComment }: { seq?: number; busy: boolean; latest: boolean; approvalPending: boolean; onSave: (seq: number, value: FeedbackValue) => Promise<void>; onOpenComment?: (seq: number, vote: FeedbackVote) => void; onCloseComment?: (seq: number) => void }) {
  if (seq === undefined || (busy && latest && !approvalPending)) return null
  return (
    <Feedback
      onSave={(value) => onSave(seq, value)}
      onOpenComment={onOpenComment ? (vote) => onOpenComment(seq, vote) : undefined}
      onCloseComment={onCloseComment ? () => onCloseComment(seq) : undefined}
    />
  )
}

export function TranscriptFeedback({ conversationId, seq, initialVote, comment, onSave }: { conversationId: string; seq: number; initialVote: FeedbackVote | null; comment?: string | null; onSave: (conversationId: string, seq: number, value: FeedbackValue) => Promise<void> }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-[8px]">
      <Feedback initialVote={initialVote} onSave={(value) => onSave(conversationId, seq, value)} />
      {comment ? <span className="text-[11px] leading-[16px] text-text-muted">{comment}</span> : null}
    </div>
  )
}

/**
 * The thumbs, under a reply.
 *
 * In the live chat a vote hands the "anything else?" question to
 * `onOpenComment`, which docks it as a card above the composer — the approval
 * card's slot, so he stands on it and it is full width on a phone. Inline, the
 * question used to open as a narrow box beside him that ran off a 390px screen
 * and scrolled the panel sideways (owner, 2026-09-29). History has no composer,
 * so there it still opens in place, at the width of the transcript.
 */
export function Feedback({ initialVote = null, onSave, onOpenComment, onCloseComment }: { initialVote?: FeedbackVote | null; onSave: (value: FeedbackValue) => Promise<void>; onOpenComment?: (vote: FeedbackVote) => void; onCloseComment?: () => void }) {
  const [state, dispatch] = useReducer(feedbackReducer, undefined, () => ({ ...initialFeedbackState(), vote: initialVote }))
  const writes = useRef<Promise<unknown>>(Promise.resolve())
  const persist = (value: { vote: FeedbackVote | null; comment: string; share: boolean }) => {
    const request = writes.current.then(() => onSave(value))
    writes.current = request.catch(() => undefined)
    return request
  }

  const vote = (next: FeedbackVote) => {
    const previous = state
    const clearing = state.vote === next
    dispatch({ type: 'vote', vote: next })
    void persist({ vote: clearing ? null : next, comment: '', share: false }).catch(() =>
      dispatch({ type: 'failed', previous }),
    )
    if (!onOpenComment) return
    // Docked: the question lives in the card, so the thumbs say thanks at once;
    // taking the vote back takes the card away with it, or its Send would put
    // the vote back (Opus, PR #271).
    if (clearing) onCloseComment?.()
    else {
      onOpenComment(next)
      dispatch({ type: 'skip' })
    }
  }

  const send = () => {
    if (state.vote === null || state.saving) return
    const previous = state
    dispatch({ type: 'saving' })
    void persist({ vote: state.vote, comment: state.comment.trim(), share: state.share }).then(
      () => dispatch({ type: 'saved' }),
      () => dispatch({ type: 'failed', previous }),
    )
  }

  const inlineForm = state.open && !onOpenComment
  return (
    <div className={`decke-shift self-start text-[11.5px] text-text-body${inlineForm ? ' w-full' : ''}`}>
      <div className="flex items-center gap-[4px]">
        <button type="button" aria-label="Good reply" aria-pressed={state.vote === 1} onClick={() => vote(1)} className="flex h-[29px] w-[29px] items-center justify-center rounded-[7px] border border-border-default text-text-body outline-none transition-colors hover:border-action-primary hover:bg-action-primary/[0.08] hover:text-text-primary focus-visible:ring-2 focus-visible:ring-action-primary/45 aria-pressed:border-action-primary aria-pressed:bg-action-primary/[0.12] aria-pressed:text-action-primary">
          <Icon name="thumbs-up" size={16} fill={state.vote === 1 ? 'currentColor' : 'none'} />
        </button>
        <button type="button" aria-label="Bad reply" aria-pressed={state.vote === -1} onClick={() => vote(-1)} className="flex h-[29px] w-[29px] items-center justify-center rounded-[7px] border border-border-default text-text-body outline-none transition-colors hover:border-action-primary hover:bg-action-primary/[0.08] hover:text-text-primary focus-visible:ring-2 focus-visible:ring-action-primary/45 aria-pressed:border-action-primary aria-pressed:bg-action-primary/[0.12] aria-pressed:text-action-primary">
          <Icon name="thumbs-down" size={16} fill={state.vote === -1 ? 'currentColor' : 'none'} />
        </button>
        {state.thanked && !state.open ? <span className="ml-[3px]" aria-live="polite">Thanks</span> : null}
        {state.error && onOpenComment ? <span className="ml-[3px] text-error" role="alert">{state.error}</span> : null}
      </div>
      {inlineForm ? (
        <FeedbackForm
          className="mt-[8px] w-full max-w-[520px] p-[12px]"
          comment={state.comment}
          share={state.share}
          saving={state.saving}
          error={state.error}
          onComment={(comment) => dispatch({ type: 'comment', comment })}
          onShare={(share) => dispatch({ type: 'share', share })}
          onSend={send}
          onSkip={() => dispatch({ type: 'skip' })}
        />
      ) : null}
    </div>
  )
}

/**
 * "Anything else?" — one form, two homes: docked above the composer in the
 * live chat (`FeedbackCard`) and in place under a reply in History. Same card,
 * type sizes and buttons as the approval card, so it reads as part of the chat
 * rather than a one-off box.
 */
function FeedbackForm({ className, comment, share, saving, error, onComment, onShare, onSend, onSkip }: {
  className: string; comment: string; share: boolean; saving: boolean; error: string | null
  onComment: (comment: string) => void; onShare: (share: boolean) => void; onSend: () => void; onSkip: () => void
}) {
  const id = useRef(`decke-feedback-${Math.random().toString(36).slice(2)}`).current
  return (
    <div className={`decke-feedback-form ${className}`} role="group" aria-label="Tell us more about this reply">
      <label className="block text-[14.5px] font-semibold leading-[21px] text-text-primary" htmlFor={id}>
        Anything else? <span className="font-normal text-text-muted">Optional</span>
      </label>
      <textarea
        id={id}
        maxLength={500}
        rows={2}
        value={comment}
        onChange={(event) => onComment(event.target.value)}
        className="mt-[8px] w-full resize-none rounded-[10px] border border-border-default bg-surface-primary px-[10px] py-[8px] text-[14px] leading-[21px] text-text-primary outline-none placeholder:text-text-muted focus:border-action-primary"
      />
      <label className="mt-[10px] flex items-start gap-[8px] text-[13px] leading-[19px] text-text-secondary">
        <input type="checkbox" checked={share} onChange={(event) => onShare(event.target.checked)} className="mt-[2px] h-[16px] w-[16px] shrink-0" />
        Share this chat with your feedback
      </label>
      {error ? <p className="mt-[8px] text-[13px] text-error" role="alert">{error}</p> : null}
      <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
        <Button variant="ghost" size="sm" onClick={onSkip} disabled={saving}>Skip</Button>
        <Button variant="primary" size="sm" onClick={onSend} disabled={saving}>Send</Button>
      </div>
    </div>
  )
}

/** The docked "anything else?" card: the vote is already saved; this adds the comment. */
export function FeedbackCard({ onSend, onSkip }: {
  onSend: (comment: string, share: boolean) => Promise<void>; onSkip: () => void
}) {
  const [comment, setComment] = useState('')
  const [share, setShare] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = () => {
    if (saving) return
    setSaving(true)
    setError(null)
    onSend(comment.trim(), share).catch(() => {
      setSaving(false)
      setError('Could not save feedback.')
    })
  }
  return (
    <FeedbackForm
      className="pointer-events-auto mx-[16px] mb-[10px] shrink-0 p-[14px]"
      comment={comment}
      share={share}
      saving={saving}
      error={error}
      onComment={(next) => { setComment(next.slice(0, 500)); setError(null) }}
      onShare={(next) => { setShare(next); setError(null) }}
      onSend={send}
      onSkip={onSkip}
    />
  )
}
