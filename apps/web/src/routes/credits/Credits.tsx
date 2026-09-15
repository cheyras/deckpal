import { useEffect, useState } from 'react'
import { Link, useSearch } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Content, FormAlert, EmptyState, StatTile } from '../../components/ui'
import { Sheet } from '../../components/ui/Sheet'
import { api } from '../../lib/api'
import { useAccess } from '../../lib/access'
import type { CreditPack } from '../../lib/adminTypes'
import { dollars, creditCount } from '../../lib/creditMath'
import { Panel, LoadState, Paging, fmtDate } from '../admin/shared'

export function useWallet(enabled = true) {
  const access = useAccess()
  const query = useQuery({ queryKey: ['credits', access.identity, 'wallet'], queryFn: ({ signal }) => api.creditWallet(signal),
    enabled: enabled && access.ready && !access.error && !!access.identity, staleTime: 10_000, gcTime: 0, retry: false, refetchOnWindowFocus: true })
  useEffect(() => {
    const refresh = () => { if (enabled && access.ready && !access.error && access.identity) void query.refetch() }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [enabled, access.ready, access.error, access.identity, query.refetch])
  return query
}
export function CreditProfileCard() {
  const wallet = useWallet()
  const access = useAccess()
  return <Panel title="AI credits"><p className="text-text-muted">Your balance pays for Deck-E usage. Voluntary support payments are separate.</p><LoadState loading={wallet.isLoading} error={wallet.error} retry={wallet.refetch} />{wallet.data && <p className="my-[12px] text-[24px] font-bold text-text-primary">{creditCount(wallet.data.balance)}</p>}<div className="mt-[12px] flex flex-wrap gap-[16px]"><Link to="/credits" className="font-semibold text-link">Open credit wallet →</Link>{access.permissions.includes('admin.access') && <Link to="/admin" className="font-semibold text-link">Administration →</Link>}</div></Panel>
}
function BuyPack({ pack, debt, close }: { pack: CreditPack; debt: number; close: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [idempotencyKey] = useState(() => crypto.randomUUID())
  const buy = async () => {
    setBusy(true); setError('')
    try {
      const result = await api.creditCheckout(pack.id, idempotencyKey)
      const url = new URL(result.url)
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('The payment provider returned an invalid checkout address.')
      window.location.assign(url.href)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start checkout.'); setBusy(false) }
  }
  return <Sheet title="Buy AI credits" onClose={() => { if (!busy) close() }}><div className="space-y-[16px]"><h3 className="text-[22px] font-semibold text-text-primary">{pack.name}</h3><p className="text-text-body">{pack.credits.toLocaleString()} credits for {dollars(pack.priceCents)}</p><p className="text-[14px] text-text-muted">Continue to secure hosted checkout. Credits appear only after payment is verified.</p>{debt > 0 && <p className="text-[14px] text-text-body">{Math.min(debt, pack.credits)} credits will repay your refund debt. This purchase adds {Math.max(0, pack.credits - debt)} spendable credits.</p>}{error && <FormAlert kind="error">{error}</FormAlert>}<Button loading={busy} onClick={() => void buy()}>Continue to checkout</Button></div></Sheet>
}
export function Credits() {
  const wallet = useWallet(), access = useAccess(), client = useQueryClient()
  const [offset, setOffset] = useState(0), [pack, setPack] = useState<CreditPack | null>(null)
  const search = useSearch({ strict: false }) as { order?: string; checkout?: string; cancelled?: string }
  const orderId = search.order
  const order = useQuery({ queryKey: ['credits', access.identity, 'order', orderId], queryFn: ({ signal }) => api.creditOrder(orderId!, signal), enabled: !!orderId && access.ready && !access.error && !!access.identity, gcTime: 0, retry: false,
    refetchInterval: query => query.state.data && !['pending', 'created', 'checkout_pending'].includes(query.state.data.status) ? false : 3000 })
  const events = useQuery({ queryKey: ['credits', access.identity, 'events', offset], queryFn: ({ signal }) => api.creditEvents(offset, signal), enabled: access.ready && !access.error && !!access.identity, gcTime: 0, retry: false, staleTime: 0 })
  useEffect(() => { if (order.data?.status === 'fulfilled' || order.data?.status === 'paid') void client.invalidateQueries({ queryKey: ['credits', access.identity] }) }, [order.data?.status, access.identity, client])
  return <Content><div className="space-y-[24px] pb-[40px]"><header><Link to="/profile" className="text-link">← Profile</Link><h1 className="mt-[16px] font-display text-[32px] text-text-primary">AI credits</h1><p className="mt-[8px] text-text-muted">Your Deck-E wallet, usage prices, and credit statement.</p></header>
    {(search.checkout === 'cancelled' || search.cancelled === '1') && <FormAlert kind="info">Checkout was closed. Your balance changes only after payment verification.</FormAlert>}
    {orderId && <Panel title="Purchase status"><LoadState loading={order.isLoading} error={order.error} retry={order.refetch} />{order.data && <><p className="text-text-primary">{['fulfilled', 'paid'].includes(order.data.status) ? 'Payment verified. Your wallet and any refund debt have been updated.' : ['pending', 'created', 'checkout_pending'].includes(order.data.status) ? 'Waiting for payment confirmation. You can leave this page and return later.' : order.data.status === 'refunded' ? 'Refund recorded for this purchase.' : order.data.status === 'disputed' ? 'This payment is under dispute review.' : order.data.status === 'expired' ? 'This checkout has expired.' : 'Order status: ' + order.data.status}</p><p className="mt-[8px] text-text-muted">{order.data.credits} credits · {dollars(order.data.priceCents)}</p></>}<Button className="mt-[12px]" variant="ghost" onClick={() => void order.refetch()}>Refresh purchase status</Button></Panel>}
    <LoadState loading={wallet.isLoading} error={wallet.error} retry={wallet.refetch} />
    {wallet.data && <><div className="grid gap-[16px] sm:grid-cols-2"><StatTile label="Available balance" value={creditCount(wallet.data.balance)} /><StatTile label="Usage charging" value={wallet.data.enabled ? 'Enabled' : 'Disabled'} /></div>
      {wallet.data.debt > 0 && <FormAlert kind="info">Refund debt: {wallet.data.debt} credits. Incoming credits repay this before increasing your available balance.</FormAlert>}{wallet.data.purchaseHold && <FormAlert kind="info">Purchases are on hold while a refund or payment dispute is reviewed. Contact the app owner for help.</FormAlert>}
      <Panel title="Usage prices"><dl className="grid gap-[16px] sm:grid-cols-3">{Object.entries(wallet.data.prices).map(([key, price]) => <div key={key}><dt className="text-text-muted">{({ chatTurn: 'Chat turn', analysis: 'Analysis', planDeck: 'Deck plan' } as Record<string, string>)[key]}</dt><dd className="mt-[4px] text-[22px] font-semibold text-text-primary">{creditCount(price)}</dd></div>)}</dl><p className="mt-[16px] text-[14px] text-text-muted">Analysis and deck planning are additional operations. Credits are charged when work starts.</p><details className="mt-[12px] text-[14px] text-text-muted"><summary className="cursor-pointer text-link">How usage is priced</summary><p className="mt-[8px]">The displayed prices apply when you start new work. A pricing change does not change work already quoted or past charges. Work cancelled before a provider is contacted is refunded. Once provider work begins, failed or cancelled work is not automatically refunded.</p></details></Panel>
      <Panel title="Buy credits">{!wallet.data.purchasesEnabled && <FormAlert kind="info">{wallet.data.purchaseUnavailableReason ?? 'Credit purchases are not available on this deployment.'}</FormAlert>}<div className="grid gap-[16px] md:grid-cols-2">{wallet.data.packs.map(p => <div key={p.id} className="rounded-[12px] border border-border-default bg-surface-tertiary p-[16px]"><h3 className="break-words font-semibold text-text-primary">{p.name}</h3><p className="my-[12px] text-text-body">{p.credits.toLocaleString()} credits · {dollars(p.priceCents)}</p><Button disabled={!wallet.data!.purchasesEnabled} onClick={() => setPack(p)}>Buy {p.name}</Button></div>)}</div></Panel>
    </>}
    <Panel title="Credit statement"><LoadState loading={events.isLoading} error={events.error} retry={events.refetch} />{events.data && <>{events.data.events.length ? <ol className="divide-y divide-border-default">{events.data.events.map(event => <li key={event.id} className="flex flex-wrap justify-between gap-[12px] py-[14px]"><div className="min-w-0"><p className="break-words font-semibold text-text-primary">{event.kind.replaceAll('_', ' ')}</p><p className="mt-[4px] break-words text-[14px] text-text-muted">{event.reason}</p><time dateTime={event.createdAt} title={event.createdAt} className="text-[12px] text-text-muted">{fmtDate(event.createdAt)}</time>{event.pricingRevision != null && <details className="mt-[4px] text-[12px] text-text-muted"><summary className="cursor-pointer">Pricing details</summary>Pricing revision {event.pricingRevision}</details>}{!!event.debtDelta && <p className="mt-[6px] text-[14px] text-text-body">{event.debtDelta < 0 ? -event.debtDelta + " credits repaid refund debt" : event.debtDelta + " credits added to refund debt"}</p>}</div><strong className="text-text-primary">{event.delta > 0 ? '+' : ''}{event.delta} credits</strong></li>)}</ol> : <EmptyState icon="lists" title="No credit activity yet" body="Purchases, usage, and adjustments will appear here." />}<Paging total={events.data.total} offset={offset} setOffset={setOffset} /></>}</Panel>
    {pack && <BuyPack pack={pack} debt={wallet.data?.debt ?? 0} close={() => setPack(null)} />}
  </div></Content>
}
