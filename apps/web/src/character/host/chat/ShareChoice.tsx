import { useReducer } from 'react'

export type ShareChoiceStatus = 'open' | 'sharing' | 'declining' | 'shared' | 'declined'
export type ShareChoiceAction = { type: 'choose'; share: boolean } | { type: 'settled'; share: boolean } | { type: 'retry' }

/** A settled choice ignores every later click, including a stale double-click. */
export function shareChoiceReducer(status: ShareChoiceStatus, action: ShareChoiceAction): ShareChoiceStatus {
  if (action.type === 'retry') return status === 'sharing' || status === 'declining' ? 'open' : status
  if (status !== 'open' && action.type === 'choose') return status
  if (action.type === 'choose') return action.share ? 'sharing' : 'declining'
  if (status !== 'sharing' && status !== 'declining') return status
  return action.share ? 'shared' : 'declined'
}

export function ShareChoice({ onChoose }: { onChoose: (share: boolean, shareAll?: boolean) => Promise<void> }) {
  const [status, dispatch] = useReducer(shareChoiceReducer, 'open')
  const choose = (share: boolean, shareAll = false) => {
    if (status !== 'open') return
    dispatch({ type: 'choose', share })
    void onChoose(share, shareAll).then(
      () => dispatch({ type: 'settled', share }),
      () => dispatch({ type: 'retry' }),
    )
  }

  if (status === 'shared' || status === 'declined') {
    return (
      <p className="text-[11.5px] leading-[17px] text-text-muted" aria-live="polite">
        {status === 'shared' ? 'Shared — thank you' : 'Not shared'}
      </p>
    )
  }

  const waiting = status !== 'open'
  return (
    <div data-decke-consent className="decke-shift max-w-full self-start">
      <div className="flex flex-wrap gap-[6px]">
        <button type="button" disabled={waiting} onClick={() => choose(true)} className="rounded-[8px] bg-action-primary px-[10px] py-[5px] text-[12px] font-semibold text-action-primary-text disabled:opacity-60">
          Share this chat
        </button>
        <button type="button" disabled={waiting} onClick={() => choose(true, true)} className="rounded-[8px] border border-border-default px-[10px] py-[5px] text-[12px] font-semibold text-text-body hover:bg-surface-secondary disabled:opacity-60">
          Share all my chats
        </button>
        <button type="button" disabled={waiting} onClick={() => choose(false)} className="rounded-[8px] border border-border-default px-[10px] py-[5px] text-[12px] font-semibold text-text-body hover:bg-surface-secondary disabled:opacity-60">
          No thanks
        </button>
      </div>
      <p className="mt-[5px] text-[10.5px] leading-[15px] text-text-muted">
        Names are removed where we can · the DeckPal team can read it for 180 days · <a href="/privacy#deck-e" className="underline underline-offset-2">What’s shared</a>
      </p>
      <p className="mt-[2px] text-[10.5px] leading-[15px] text-text-muted">You can turn off sharing all chats in Profile.</p>
    </div>
  )
}
