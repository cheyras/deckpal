import { useReducer, useRef } from 'react'
import { Icon } from '../../../components/Icon'
import { feedbackReducer, initialFeedbackState, type FeedbackVote } from './feedbackState'

type FeedbackValue = { vote: FeedbackVote | null; comment: string; share: boolean }

export function ReplyFeedback({ seq, busy, latest, approvalPending, onSave }: { seq?: number; busy: boolean; latest: boolean; approvalPending: boolean; onSave: (seq: number, value: FeedbackValue) => Promise<void> }) {
  if (seq === undefined || (busy && latest && !approvalPending)) return null
  return <Feedback onSave={(value) => onSave(seq, value)} />
}

export function TranscriptFeedback({ conversationId, seq, initialVote, comment, onSave }: { conversationId: string; seq: number; initialVote: FeedbackVote | null; comment?: string | null; onSave: (conversationId: string, seq: number, value: FeedbackValue) => Promise<void> }) {
  return (
    <div className="flex items-center gap-[8px]">
      <Feedback initialVote={initialVote} onSave={(value) => onSave(conversationId, seq, value)} />
      {comment ? <span className="text-[11px] leading-[16px] text-text-muted">{comment}</span> : null}
    </div>
  )
}

export function Feedback({ initialVote = null, onSave }: { initialVote?: FeedbackVote | null; onSave: (value: FeedbackValue) => Promise<void> }) {
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

  return (
    <div className="decke-shift self-start text-[11.5px] text-text-body">
      <div className="flex items-center gap-[4px]">
        <button type="button" aria-label="Good reply" aria-pressed={state.vote === 1} onClick={() => vote(1)} className="flex h-[29px] w-[29px] items-center justify-center rounded-[7px] border border-border-default text-text-body outline-none transition-colors hover:border-action-primary hover:bg-action-primary/[0.08] hover:text-text-primary focus-visible:ring-2 focus-visible:ring-action-primary/45 aria-pressed:border-action-primary aria-pressed:bg-action-primary/[0.12] aria-pressed:text-action-primary">
          <Icon name="thumbs-up" size={16} fill={state.vote === 1 ? 'currentColor' : 'none'} />
        </button>
        <button type="button" aria-label="Bad reply" aria-pressed={state.vote === -1} onClick={() => vote(-1)} className="flex h-[29px] w-[29px] items-center justify-center rounded-[7px] border border-border-default text-text-body outline-none transition-colors hover:border-action-primary hover:bg-action-primary/[0.08] hover:text-text-primary focus-visible:ring-2 focus-visible:ring-action-primary/45 aria-pressed:border-action-primary aria-pressed:bg-action-primary/[0.12] aria-pressed:text-action-primary">
          <Icon name="thumbs-down" size={16} fill={state.vote === -1 ? 'currentColor' : 'none'} />
        </button>
        {state.thanked && !state.open ? <span className="ml-[3px]" aria-live="polite">Thanks</span> : null}
      </div>
      {state.open ? (
        <div className="mt-[6px] w-[min(330px,calc(100vw-44px))] rounded-[10px] border border-border-subtle bg-surface-secondary p-[9px]">
          <label className="block text-[11px] font-medium text-text-body" htmlFor="decke-feedback-comment">Anything else? <span className="font-normal text-text-muted">Optional</span></label>
          <textarea id="decke-feedback-comment" maxLength={500} rows={2} value={state.comment} onChange={(event) => dispatch({ type: 'comment', comment: event.target.value })} className="mt-[4px] w-full resize-none rounded-[7px] border border-border-default bg-surface-primary px-[7px] py-[5px] text-[12px] text-text-body outline-none focus:border-action-primary" />
          <label className="mt-[6px] flex items-start gap-[6px] leading-[16px] text-text-body">
            <input type="checkbox" checked={state.share} onChange={(event) => dispatch({ type: 'share', share: event.target.checked })} className="mt-[2px]" />
            Share this chat with your feedback
          </label>
          {state.error ? <p className="mt-[5px] text-error" role="alert">{state.error}</p> : null}
          <div className="mt-[7px] flex gap-[6px]">
            <button type="button" onClick={send} disabled={state.saving} className="rounded-[7px] bg-action-primary px-[9px] py-[3px] font-semibold text-action-primary-text disabled:opacity-60">Send</button>
            <button type="button" onClick={() => dispatch({ type: 'skip' })} disabled={state.saving} className="rounded-[7px] px-[7px] py-[3px] font-semibold text-text-muted hover:text-text-primary disabled:opacity-60">Skip</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
