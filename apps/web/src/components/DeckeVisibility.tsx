/**
 * The way back, and the way out.
 *
 * A dismissal with no restore is a trap, and a restore nobody can find is the
 * same trap with extra steps. So the toggle lives beside the other account
 * settings, where a person looking for "how do I turn this off" looks — and it
 * states what the choice actually costs, because "hide the assistant" and "hide
 * the assistant on this device" are different promises and only one of them is
 * true.
 *
 * See `character/deckePreference.ts` for why this is per-device and what the
 * measured cost of not having it at all is.
 */
import { useEffect, useState } from 'react'
import { deckeHidden, onDeckeVisibilityChange, setDeckeHidden } from '../character/deckePreference'
import { Icon } from './Icon'

export function DeckeVisibility() {
  const [hidden, setHidden] = useState(deckeHidden)
  // Another tab, or the control that will eventually live in his own panel.
  useEffect(() => onDeckeVisibilityChange(() => setHidden(deckeHidden())), [])

  return (
    <section className="rounded-2xl bg-surface-secondary p-[20px]">
      <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Deck-E</div>

      <div className="mt-[10px] flex flex-wrap items-center justify-between gap-[12px]">
        <div className="min-w-[220px] flex-1">
          <p className="text-[14px] text-text-body">
            {hidden
              ? 'Deck-E is hidden. He will not appear on any page, and nothing of him is downloaded.'
              : 'Deck-E sits in the corner of every page. He only loads when you open him.'}
          </p>
          <p className="mt-[4px] text-[12px] text-text-muted">
            This is remembered on this device only — signing in elsewhere shows him again.
          </p>
        </div>

        <button
          type="button"
          // `aria-pressed` rather than a checkbox role: this is a control that
          // toggles a state, and the label already says which state it moves to.
          aria-pressed={hidden}
          onClick={() => setDeckeHidden(!hidden)}
          className="inline-flex shrink-0 items-center gap-[6px] rounded-full bg-surface-tertiary px-[14px] py-[8px] text-[14px] font-semibold text-text-primary hover:bg-action-default-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-primary"
        >
          <Icon name={hidden ? 'sparkle' : 'close'} size={16} className="text-action-primary" />
          {hidden ? 'Bring Deck-E back' : 'Hide Deck-E'}
        </button>
      </div>
    </section>
  )
}
