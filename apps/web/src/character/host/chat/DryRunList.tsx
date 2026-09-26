/**
 * The operations a held write would perform, drawn as rows on the approval card.
 *
 * The read-only sibling of `ApprovalCard`'s editable rows: the same thumbnail
 * box and the same green/red change chip, without the stepper, because a deck
 * reconcile is approved or declined whole. `dryRun.ts` carries the grammar and
 * why nothing it cannot read is ever dropped.
 */
import type { JSX } from 'react'
import { CardImage } from '../../../components/CardImage'
import { CARD_ASPECT_RATIO_CSS } from '../../../lib/cardGeometry'
import type { CardArtMap } from './useCardArt'
import { dryRunChange, dryRunDeckLine, type DryRunItem } from './dryRun'

export function DryRunList({ items, art }: { items: DryRunItem[]; art: CardArtMap }): JSX.Element | null {
  if (items.length === 0) return null
  // One plain line is what every other held write sends — keep it a sentence
  // rather than a one-item list.
  if (items.length === 1 && items[0]!.kind === 'text') {
    return <p className="mt-[6px] text-[12.5px] leading-[18px] text-text-secondary">{items[0]!.text}</p>
  }
  return (
    <ul className="mt-[10px] flex flex-col gap-[6px]" data-decke-dry-run>
      {items.map((it, i) => {
        if (it.kind === 'deck') {
          return (
            <li key={i} className="text-[12.5px] font-medium leading-[18px] text-text-primary">
              {dryRunDeckLine(it)}
            </li>
          )
        }
        if (it.kind === 'text') {
          return (
            <li key={i} className={['text-[12.5px] leading-[18px]', it.more ? 'text-text-muted' : 'text-text-secondary'].join(' ')}>
              {it.text}
            </li>
          )
        }
        const found = art[it.cardId]
        const change = dryRunChange(it)
        return (
          <li key={i} className="flex items-center gap-[10px]">
            <div className="w-[28px] shrink-0" aria-hidden="true">
              {found ? (
                <CardImage low={found.front} high={found.frontLarge ?? found.front} alt="" radius={3} />
              ) : (
                <div
                  className="w-full rounded-[3px] border border-dashed border-border-default bg-surface-primary"
                  style={{ aspectRatio: CARD_ASPECT_RATIO_CSS }}
                />
              )}
            </div>
            {/* The catalogue's name for the id the tool printed; the id itself
                until the catalogue answers, and for good if it cannot. */}
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[19px] text-text-primary">
              {found?.name ?? it.cardId}
            </span>
            <span
              className={[
                'shrink-0 rounded-[7px] px-[8px] py-[2px] text-[12.5px] font-semibold leading-[18px] tabular-nums',
                change.down ? 'bg-halo-error text-error' : 'bg-halo-success text-success',
              ].join(' ')}
            >
              {change.text}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
