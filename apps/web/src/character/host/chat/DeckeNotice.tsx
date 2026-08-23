/**
 * ══════════════════════════════════════════════════════════════════════════════
 * A NOTICE THAT LOOKS LIKE IT CAME FROM THIS PRODUCT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * *"Let's think about the design of these errors. They just don't feel like
 * anything else in the app really. They're not like rounded."*
 *
 * Two different things wore that complaint and both are fixed:
 *
 *  1. **The tool row's failure block** was `rounded-r-[6px] border-l-2` — a flat
 *     left edge with an accent bar, the documentation-site callout. Fixed in
 *     `ToolRow.tsx`, where that argument is written down.
 *  2. **A refusal had no design at all.** `useDeckeChat`'s `onHttpError` calls
 *     `sayInstead`, which writes his sentence into the transcript as an ORDINARY
 *     ASSISTANT BUBBLE. So "I'm not switched on for this deployment yet" and
 *     "I've done as much as I can for you today" arrived looking exactly like an
 *     answer to a question — which is the one thing they are not. A reader who
 *     scrolls back cannot tell his reply from his refusal.
 *
 * This is the second one. It is deliberately NOT loud: a refusal is not a
 * failure, it is a boundary, and this app already knows how to say "this block
 * is a different kind of thing" without shouting — a card with the composer's
 * own 14px radius, its own surface, and a hairline border.
 *
 * ── ONE COMPONENT, THREE TONES, AND NO FOURTH ────────────────────────────────
 *
 *   `neutral` — a boundary. "Not switched on here." Nothing is wrong.
 *   `limit`   — a resource ran out. The one that carries an action.
 *   `error`   — something broke. The only tone that borrows the error colour,
 *               and it still does not fill the card with it.
 *
 * There is no `success` tone and there must not be one. Nothing in this panel
 * succeeds by announcing itself in a box; a real result is a real answer, and a
 * green congratulation card would be the manufactured optimism X2 forbids.
 *
 * ── EVERY STRING ARRIVES AS A PROP ───────────────────────────────────────────
 *
 * X2. This composes nothing. The sentences come from `creditState.ts` (written,
 * tested) or from the caller's own constant; there is no template here that
 * could be filled with model prose and rendered as a system statement.
 */
import type { JSX, ReactNode } from 'react'
import { Icon } from '../../../components/Icon'
import { Button } from '../../../components/ui/Button'

export type NoticeTone = 'neutral' | 'limit' | 'error'

const TONE_ICON: Record<NoticeTone, 'alert' | 'sparkle'> = {
  neutral: 'alert',
  limit: 'sparkle',
  error: 'alert',
}

const TONE_CARD: Record<NoticeTone, string> = {
  // The composer's own card, so a notice sitting above the composer reads as a
  // sibling of it rather than as something that landed on top.
  neutral: 'border-border-default',
  limit: 'border-action-primary-strong/35',
  error: 'border-error/35',
}

const TONE_MARK: Record<NoticeTone, string> = {
  neutral: 'text-icon-muted',
  limit: 'text-action-primary-strong',
  error: 'text-error',
}

export function DeckeNotice({
  tone = 'neutral',
  title,
  detail,
  action,
  onAction,
  children,
}: {
  tone?: NoticeTone
  /** The sentence. His, in the first person, wherever he is the one saying it. */
  title: string
  /** One more sentence, or nothing. Never a second paragraph. */
  detail?: string
  /** The label of the single action, or nothing. There is never a second one. */
  action?: string
  onAction?: () => void
  children?: ReactNode
}): JSX.Element {
  return (
    <div
      // `role="status"`, NOT `alert`. An alert interrupts, and none of these
      // interrupt: the reader has just pressed something and this is the answer.
      // The approval card is the one control in this panel that is an alert, and
      // it says so itself.
      role="status"
      className={[
        'decke-composer-card pointer-events-auto flex flex-col gap-[10px] p-[14px]',
        TONE_CARD[tone],
      ].join(' ')}
    >
      <div className="flex items-start gap-[10px]">
        <Icon name={TONE_ICON[tone]} size={16} className={['mt-[2px] shrink-0', TONE_MARK[tone]].join(' ')} />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium leading-[20px] text-text-primary">{title}</p>
          {detail ? (
            <p className="mt-[3px] text-[12.5px] leading-[18px] text-text-secondary">{detail}</p>
          ) : null}
        </div>
      </div>
      {action && onAction ? (
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button variant="primary" size="sm" onClick={onAction}>
            {action}
          </Button>
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  )
}

/**
 * The header's balance chip.
 *
 * *"Nothing shown normally; once it is getting low, surface it in the header and
 * keep it there."*
 *
 * KEPT, NOT FLASHED. A toast about a resource is either missed or dismissed, and
 * either way the reader finds out about the balance at zero. A quiet number that
 * stays in the chrome is a fact about the session rather than an event, which is
 * what it is.
 *
 * It is a BUTTON when there is somewhere to go, and a plain `<span>` when there
 * is not — never a button that does nothing, which is the same lie in miniature
 * as a composer that accepts a question it cannot answer.
 */
export function CreditChip({
  label,
  spent,
  onTopUp,
}: {
  label: string
  /** Nothing left. Reads in the error colour rather than the accent. */
  spent?: boolean
  onTopUp?: () => void
}): JSX.Element | null {
  if (!label) return null
  const skin = [
    'whitespace-nowrap rounded-full border px-[10px] py-[3px]',
    'text-[11.5px] font-medium leading-[16px] tabular-nums',
    spent ? 'border-error/40 text-error' : 'border-border-default text-text-secondary',
  ].join(' ')
  if (!onTopUp) return <span className={skin}>{label}</span>
  return (
    <button
      type="button"
      onClick={onTopUp}
      className={[
        'pointer-events-auto motion-safe:transition-colors hover:text-text-primary',
        skin,
      ].join(' ')}
    >
      {label}
    </button>
  )
}
