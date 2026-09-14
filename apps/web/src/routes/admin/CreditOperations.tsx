import { useState } from 'react'
import { StatTile, Field, EmptyState, DataTable, DataTableToolbar } from '../../components/ui'
import { api } from '../../lib/api'
import { dollars } from '../../lib/creditMath'
import { Panel, useAdminQuery, LoadState, selectClass, fmtDate } from './shared'
export function CreditOperations() {
  const [days, setDays] = useState('30'), [status, setStatus] = useState(''), [user, setUser] = useState(''), [filter, setFilter] = useState(''), [offset, setOffset] = useState(0), [pageSize, setPageSize] = useState(25)
  const summary = useAdminQuery(['credit-summary', days], signal => api.adminCreditSummary(Number(days), signal), 'credits.read')
  const params = new URLSearchParams({ status, user: filter, offset: String(offset), limit: String(pageSize) })
  const orders = useAdminQuery(['credit-orders', params.toString()], signal => api.adminCreditOrders(params.toString(), signal), 'credits.read')
  return <div className="space-y-[20px]"><Panel title="Credit activity"><label className="mb-[16px] block max-w-[220px] text-[14px] font-semibold text-text-secondary">Reporting window<select aria-label="Reporting window" className={selectClass + ' mt-[6px]'} value={days} onChange={e => setDays(e.target.value)}>{[7,30,90].map(d => <option key={d} value={d}>Last {d} days</option>)}</select></label><LoadState loading={summary.isLoading} error={summary.error} retry={summary.refetch} />
    {summary.data && <><div className="grid grid-cols-2 gap-[12px] xl:grid-cols-4"><StatTile variant="boxed" label="Credits spent" value={summary.data.creditsSpent.toLocaleString()} /><StatTile variant="boxed" label="Credits granted" value={summary.data.creditsGranted.toLocaleString()} /><StatTile variant="boxed" label="Gross pack sales" value={dollars(summary.data.grossSalesCents)} /><StatTile variant="boxed" label="Refunds on these purchases" value={dollars(summary.data.refundedCents)} /></div><p className="mt-[16px] text-[14px] text-text-muted">{summary.data.paidOrders} paid orders in this window. Current state: {summary.data.pendingOrders} pending orders · {summary.data.heldWallets} held wallets · {summary.data.debtWallets} wallets owing {summary.data.totalDebt} credits.</p><p className="mt-[8px] text-[14px] text-text-muted">Estimated provider cost for priced usage: {dollars(summary.data.estimatedProviderMicroUsd / 10000)}. This is an estimate, not actual provider billing or realized profit. {summary.data.unpricedSpends} historical spends lack a pricing snapshot.</p></>}
    </Panel><Panel title="Credit orders">
      <DataTable label="Credit orders" rows={orders.data?.orders ?? []} getRowId={order => order.id}
        loading={orders.isPending} refreshing={orders.isFetching && !orders.isPending} error={orders.error?.message} onRetry={() => void orders.refetch()}
        empty={<EmptyState icon="lists" title="No matching orders" body="Credit purchases will appear here." />}
        pagination={{ offset, pageSize, total: orders.data?.total ?? 0, onOffsetChange: setOffset, onPageSizeChange: setPageSize }}
        toolbar={<DataTableToolbar label="Filter credit orders" onSubmit={() => { setFilter(user.trim()); setOffset(0) }} submitLabel="Filter orders" onReset={() => { setUser(''); setFilter(''); setStatus(''); setOffset(0) }} resetDisabled={!user && !filter && !status}>
          <Field label="User ID" value={user} onChange={e => setUser(e.target.value)} maxLength={100} placeholder="Exact user ID" />
          <label className="text-[14px] font-semibold text-text-secondary">Order status<select aria-label="Order status" className={selectClass + ' mt-[6px]'} value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}><option value="">All statuses</option>{['pending','paid','expired','refunded','disputed'].map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        </DataTableToolbar>}
        columns={[
          { id: 'order', header: 'Order / pack', className: 'min-w-[200px] max-w-[280px] break-words', cell: order => <><strong>{order.packName}</strong><p className="mt-[4px] break-all text-[12px] text-text-muted">{order.id}</p></> },
          { id: 'user', header: 'User', className: 'min-w-[180px] max-w-[240px] break-all', cell: order => <>{order.username ?? order.userId}{order.username && <p className="mt-[4px] text-[12px] text-text-muted">{order.userId}</p>}</> },
          { id: 'status', header: 'Status', className: 'min-w-[110px]', cell: order => order.status },
          { id: 'credits', header: 'Credits', align: 'right', cell: order => order.credits.toLocaleString() },
          { id: 'price', header: 'Price', align: 'right', className: 'whitespace-nowrap', cell: order => dollars(order.priceCents) },
          { id: 'date', header: 'Created', className: 'min-w-[170px]', cell: order => fmtDate(order.createdAt) },
          { id: 'refund', header: 'Refund / dispute', className: 'min-w-[200px] max-w-[280px] break-words', cell: order => order.refundedCents > 0 || order.disputeStatus ? <>{dollars(order.refundedCents)} refunded · {order.reversedCredits} credits reversed{order.disputeStatus && <p className="mt-[4px]">Dispute: {order.disputeStatus}</p>}</> : '—' },
        ]} />
    </Panel>
  </div>
}
