import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { api, type PaymentHistoryKind } from '../../lib/api'
import { formatMinorAmount, paymentStatusText } from '../../lib/paymentHistory'
import { isCloudMode } from '../../lib/supabase'

const KINDS: ReadonlyArray<readonly [PaymentHistoryKind, string]> = [['support', 'Support'], ['credits', 'AI credits']]

export function PaymentHistory() {
  const [selection, setSelection] = useState({ kind: 'support' as PaymentHistoryKind, generation: 0 })
  const requested = useRef(selection)
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([])
  const queryClient = useQueryClient()
  const selectKind = (next: PaymentHistoryKind) => {
    if (next === requested.current.kind) return
    const previous = requested.current
    const current = { kind: next, generation: previous.generation + 1 }
    requested.current = current
    // State changes before cancellation settles, so two same-tick selections are
    // ordered by the user's last request. A generation always restarts pagination.
    setSelection(current)
    void queryClient.cancelQueries({ queryKey: ['billing-history', previous.kind, previous.generation], exact: true })
  }
  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = (index + 1) % KINDS.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = (index - 1 + KINDS.length) % KINDS.length
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = KINDS.length - 1
    if (target === undefined) return
    event.preventDefault()
    selectKind(KINDS[target]![0])
    radioRefs.current[target]?.focus()
  }
  const { kind, generation } = selection
  const query = useInfiniteQuery({
    queryKey: ['billing-history', kind, generation], enabled: isCloudMode, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api.billingHistory(kind, pageParam, signal),
    getNextPageParam: page => page.nextCursor ?? undefined, retry: 1,
  })
  const items = useMemo(() => {
    const byId = new Map<string, NonNullable<typeof query.data>['pages'][number]['items'][number]>()
    for (const page of query.data?.pages ?? []) for (const item of page.items) if (!byId.has(item.id)) byId.set(item.id, item)
    return [...byId.values()]
  }, [query.data])
  if (!isCloudMode) return null
  const first = query.data?.pages[0]
  return (
    <section aria-labelledby="payment-history-heading" className="rounded-2xl bg-surface-secondary p-[20px]">
      <h2 id="payment-history-heading" className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Payment history</h2>
      <div role="radiogroup" aria-label="Payment type" className="mt-[12px] grid grid-cols-2 gap-[8px]">
        {KINDS.map(([value, label], index) => (
          <button key={value} ref={node => { radioRefs.current[index] = node }} type="button" role="radio" aria-checked={kind === value} tabIndex={kind === value ? 0 : -1} onClick={() => selectKind(value)} onKeyDown={event => selectFromKeyboard(event, index)} className={`min-h-[44px] rounded-xl px-[12px] text-[14px] font-semibold ${kind === value ? 'bg-action-primary text-white' : 'bg-surface-tertiary text-text-primary'}`}>{label}</button>
        ))}
      </div>
      <p className="mt-[12px] text-[13px] leading-[1.5] text-text-muted">{first?.coverage ?? 'Shows the current billing account only. Payments on older replaced or deleted billing accounts may be missing.'}</p>
      <div aria-live="polite" className="mt-[14px]">
        {query.isPending ? <p className="text-[14px] text-text-secondary">Loading payment history…</p> : query.isError && !first ? (
          <div><p className="text-[14px] text-error">Payment history could not be loaded.</p><button type="button" onClick={() => void query.refetch()} className="mt-[8px] min-h-[44px] rounded-xl bg-surface-tertiary px-[16px] font-semibold">Retry</button></div>
        ) : items.length === 0 ? <p className="text-[14px] text-text-secondary">No payments found for this billing account.</p> : (
          <ul className="divide-y divide-border-subtle">{items.map(item => (
            <li key={item.id} className="grid min-w-0 gap-[5px] py-[12px] sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0"><div className="font-semibold text-text-primary">{item.type}</div><time dateTime={item.createdAt} className="text-[13px] text-text-muted">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.createdAt))}</time></div>
              <div className="min-w-0 sm:text-right"><div className="font-bold text-text-primary">{formatMinorAmount(item.amountMinor, item.currency)}</div><div className="text-[13px] text-text-secondary">{paymentStatusText({ ...item, refundedMinor: 0, disputed: false })}</div>{item.refundedMinor > 0 && <div className="text-[13px] text-text-secondary">Refunded {formatMinorAmount(item.refundedMinor, item.currency)}</div>}{item.disputed && <div className="text-[13px] font-semibold text-warning">Disputed</div>}{item.receiptUrl && <a href={item.receiptUrl} target="_blank" rel="noopener noreferrer" aria-label={`View receipt for ${formatMinorAmount(item.amountMinor, item.currency)} on ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.createdAt))} (opens in a new tab)`} className="inline-flex min-h-[44px] items-center text-[14px] font-semibold text-action-primary underline">View receipt <span className="sr-only">(opens in a new tab)</span></a>}</div>
            </li>
          ))}</ul>
        )}
      </div>
      {query.isFetchNextPageError && <p role="alert" className="mt-[8px] text-[13px] text-error">More payments could not be loaded. Your existing results are still shown.</p>}
      {query.hasNextPage && <button type="button" disabled={query.isFetchingNextPage} onClick={() => { if (!query.isFetchingNextPage) void query.fetchNextPage() }} className="mt-[10px] min-h-[44px] rounded-xl bg-surface-tertiary px-[16px] font-semibold disabled:opacity-60">{query.isFetchingNextPage ? 'Loading…' : query.isFetchNextPageError ? 'Retry load more' : 'Load more'}</button>}
    </section>
  )
}
