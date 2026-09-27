import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type CardRow } from '../lib/api'
import { useOwnedCounts } from '../lib/collectionWrites'
import { fmtPrice, fmtNumber } from '../lib/format'
import { useOnline } from '../lib/useOnline'
import { useSignedIn } from '../lib/session'
import { CounterBox } from './ui/CounterBox'
import { DataTable, type DataTableColumn } from './ui/DataTable'
import { variantMeta } from '../lib/variantStyle'
import { CardLink } from './CardLink'
import { type GridReveal } from './GridView'
import { VariantChip } from './VariantChip'

function RowCounters({ card, setId }: { card: { cardId: string; name: string }; setId: string }) {
  const online = useOnline()
  const owned = useOwnedCounts(setId)
  const { data } = useQuery({
    queryKey: ['card', card.cardId],
    queryFn: ({ signal }) => api.card(card.cardId, signal),
  })
  const standard = (data?.variants ?? [])
    .filter((variant) => variant.tier === 'standard')
    .map((variant) => ({ variant, meta: variantMeta(variant), qty: owned.shown(variant.variantId, variant.quantity) }))
    .sort((a, b) => a.meta.order - b.meta.order)
  if (standard.length === 0) return null
  return <div className="flex items-center justify-end gap-[4px]" title={online ? undefined : 'Offline — reconnect to change your collection'}>
    {standard.map(({ variant, meta, qty }) => <CounterBox key={variant.variantId}
      label={variant.displayName} color={meta.color} fill={meta.fill} dark={meta.dark} qty={qty}
      disabled={!online}
      onInc={() => owned.set({ setId, card, variant }, qty + 1)}
      onDec={() => owned.set({ setId, card, variant }, qty - 1)} />)}
  </div>
}

export function TableView({ cards, seriesSlug, setId, reveal, activeCard }: {
  cards: CardRow[]
  seriesSlug: string
  setId: string
  reveal?: GridReveal | null
  activeCard?: string
}) {
  const signedIn = useSignedIn()
  const tableRef = useRef<HTMLDivElement>(null)
  const scrollToIndexRef = useRef<((index: number, align?: 'start' | 'center') => void) | null>(null)
  const focusedRowRef = useRef<number | null>(null)
  const previousActiveCardRef = useRef<string | undefined>(activeCard)

  useEffect(() => {
    if (!reveal) return
    const index = cards.findIndex((card) => card.cardId === reveal.cardId)
    if (index < 0) return
    const mounted = [...(tableRef.current?.querySelectorAll<HTMLElement>('[data-decke-card]') ?? [])]
      .find((node) => node.dataset.deckeCard === reveal.cardId)
    if (mounted) {
      const box = mounted.getBoundingClientRect()
      const center = box.top + box.height / 2
      if (center > innerHeight * .3 && center < innerHeight * .7) return
    }
    scrollToIndexRef.current?.(index, 'center')
  }, [cards, reveal])

  useEffect(() => {
    const wasOpen = previousActiveCardRef.current
    previousActiveCardRef.current = activeCard
    if (!wasOpen || activeCard || focusedRowRef.current === null) return
    const index = focusedRowRef.current
    if (cards[index]?.cardId !== wasOpen) return
    // The focused row stays mounted while a sheet is open. If a resize moved it
    // off screen, bring it back before returning focus to its link.
    const frame = requestAnimationFrame(() => {
      const link = tableRef.current?.querySelector<HTMLElement>(`tr[data-index="${index}"] [data-decke-card]`)
      if (!link) return
      const box = link.getBoundingClientRect()
      if (box.bottom <= 0 || box.top >= innerHeight) scrollToIndexRef.current?.(index, 'center')
      requestAnimationFrame(() => link.focus({ preventScroll: true }))
    })
    return () => cancelAnimationFrame(frame)
  }, [activeCard, cards])

  const columns: DataTableColumn<CardRow>[] = [
    { id: 'image', header: 'Card', headerClassName: 'w-[64px]', className: 'w-[64px] !p-[8px]',
      cell: card => <img src={card.images.low} alt="" loading="lazy" decoding="async"
        className="h-[52px] w-[38px] rounded-[3px] object-cover" /> },
    { id: 'number', header: '#', headerClassName: 'w-[72px]', className: 'w-[72px] whitespace-nowrap',
      cell: card => <span className="text-text-muted">{fmtNumber(card.number)}</span> },
    { id: 'name', header: 'Name', className: 'min-w-[160px]',
      cell: card => <CardLink card={card} seriesSlug={card.seriesSlug ?? seriesSlug} setId={card.setId ?? setId}
        onFocus={() => { focusedRowRef.current = cards.indexOf(card) }}
        className="font-display block rounded-[4px] font-medium text-text-primary underline-offset-[3px] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-action-primary">
        {card.name}
      </CardLink> },
    { id: 'variant', header: 'Variant', headerClassName: 'w-[170px]', className: 'w-[170px]',
      cell: card => card.variant
        ? <VariantChip variant={card.variant} className="text-text-body" />
        : card.variantCount > 1 ? <span className="text-text-muted">{card.variantCount} variants</span> : null },
    { id: 'price', header: 'Price', align: 'right', headerClassName: 'w-[100px]', className: 'w-[100px] font-medium text-change-positive',
      cell: card => fmtPrice(card.price) },
    ...(signedIn === true ? [{ id: 'quantity', header: 'Quantity', align: 'right' as const,
      headerClassName: 'w-[180px]', className: 'w-[180px]',
      cell: (card: CardRow) => {
        const set = card.setId ?? setId
        return set ? <RowCounters card={{ cardId: `${set}-${card.number}`, name: card.name }} setId={set} /> : null
      } }] : []),
  ]

  return <div ref={tableRef}>
    <DataTable label="Cards in table view" rows={cards} columns={columns}
      getRowId={(card) => (card as CardRow & { itemId?: string }).itemId ?? card.cardId}
      tableClassName="table-fixed min-w-[850px]"
      virtual={{ estimateSize: 69, overscan: 12, scrollToIndexRef }}
      onRowClick={(_card, event) => {
        if ((event.target as HTMLElement).closest('a, button, input, select, textarea')) return
        event.currentTarget.querySelector<HTMLAnchorElement>('[data-decke-card]')?.click()
      }} />
  </div>
}
