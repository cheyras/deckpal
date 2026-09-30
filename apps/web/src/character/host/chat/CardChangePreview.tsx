import { useId, useState, type JSX } from 'react'
import { CardImage } from '../../../components/CardImage'
import { CARD_ASPECT_RATIO_CSS } from '../../../lib/cardGeometry'
import type { CardArtMap } from './useCardArt'
import { dryRunChange, type DryRunItem } from './dryRun'

type CardItem = Extract<DryRunItem, { kind: 'card' }>

function Thumb({ item, art, compact = false }: { item: CardItem; art: CardArtMap; compact?: boolean }): JSX.Element {
  const found = art[item.cardId]
  const name = found?.name ?? item.label ?? item.cardId
  const change = dryRunChange(item)
  return (
    <li className={compact ? 'relative w-[42px] shrink-0' : 'flex min-w-0 items-center gap-[8px]'}>
      <div className={compact ? 'w-[42px]' : 'w-[36px] shrink-0'}>
        {found ? (
          <CardImage low={found.front} high={found.frontLarge ?? found.front} alt={name} radius={4} />
        ) : (
          <div className="flex w-full items-center justify-center rounded-[4px] border border-dashed border-border-default bg-surface-primary" style={{ aspectRatio: CARD_ASPECT_RATIO_CSS }} role="img" aria-label={name}>
            <span className="px-[2px] text-center text-[8px] leading-[10px] text-text-muted">{name}</span>
          </div>
        )}
      </div>
      {compact ? (
        <span className={['absolute -bottom-[4px] -right-[4px] rounded-full px-[5px] py-[1px] text-[10px] font-bold tabular-nums shadow-sm', change.down ? 'bg-error text-white' : 'bg-success text-white'].join(' ')}>
          {change.text}
        </span>
      ) : (
        <><span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">{name}</span><span className={['rounded-[6px] px-[6px] py-[1px] text-[11px] font-semibold tabular-nums', change.down ? 'bg-halo-error text-error' : 'bg-halo-success text-success'].join(' ')}>{change.text}</span></>
      )}
    </li>
  )
}

export function CardChangePreview({ items, art }: { items: DryRunItem[]; art: CardArtMap }): JSX.Element | null {
  const cards = items.filter((item): item is CardItem => item.kind === 'card')
  const target = items.find((item): item is Extract<DryRunItem, { kind: 'deck' | 'list' }> => item.kind === 'deck' || item.kind === 'list')
  const [expanded, setExpanded] = useState(false)
  const regionId = useId()
  if (!target || cards.length === 0) return null
  const shown = cards.slice(0, 6)
  const added = cards.filter((item) => !dryRunChange(item).down)
  const removed = cards.filter((item) => dryRunChange(item).down)
  return (
    <section className="mt-[10px] rounded-[8px] border border-border-default/50 bg-surface-primary/55 p-[9px]" data-decke-card-change-preview>
      <ul className="flex items-end gap-[7px]" aria-label={`${cards.length} cards in this change`}>
        {shown.map((item, i) => <Thumb key={`${item.cardId}-${i}`} item={item} art={art} compact />)}
        {cards.length > shown.length ? <li className="flex h-[59px] min-w-[42px] items-center justify-center rounded-[6px] bg-surface-secondary px-[6px] text-[11px] font-semibold text-text-secondary">+{cards.length - shown.length} more</li> : null}
      </ul>
      <button type="button" className="mt-[10px] text-[12px] font-medium text-action-primary motion-safe:transition-colors hover:text-action-primary-hover" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'Show less' : target.created ? `Show all ${cards.length} cards` : 'Show full diff'}
      </button>
      {expanded ? (
        <div id={regionId} className="mt-[8px] max-h-[min(38svh,304px)] overflow-y-auto overscroll-contain" tabIndex={0}>
          {target.created ? (
            <ul className="grid grid-cols-2 gap-[7px]">{cards.map((item, i) => <Thumb key={`${item.cardId}-${i}`} item={item} art={art} />)}</ul>
          ) : (
            <div className="flex flex-col gap-[10px]">
              {added.length > 0 ? <section><h4 className="mb-[5px] text-[11px] font-semibold text-success">Added</h4><ul className="grid grid-cols-2 gap-[7px]">{added.map((item, i) => <Thumb key={`${item.cardId}-${i}`} item={item} art={art} />)}</ul></section> : null}
              {removed.length > 0 ? <section><h4 className="mb-[5px] text-[11px] font-semibold text-error">Removed</h4><ul className="grid grid-cols-2 gap-[7px]">{removed.map((item, i) => <Thumb key={`${item.cardId}-${i}`} item={item} art={art} />)}</ul></section> : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

export function StrategyGuidePreview({ markdown }: { markdown: string }): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  if (!markdown.trim()) return null
  return <section className="mt-[10px] rounded-[8px] border border-border-default/50 bg-surface-primary/55 p-[9px]" data-decke-strategy-preview><div id={id} className={['whitespace-pre-wrap text-[12px] leading-[18px] text-text-secondary', expanded ? '' : 'line-clamp-4'].join(' ')}>{markdown}</div><button type="button" className="mt-[7px] text-[12px] font-medium text-action-primary" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show less' : 'Show full guide'}</button></section>
}
