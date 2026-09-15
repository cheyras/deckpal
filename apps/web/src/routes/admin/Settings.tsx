import { CostObservations } from './CostObservations'
import { useState } from 'react'
import { Button, Field, FormAlert, EmptyState, DataTable, DataTableToolbar, type DataTableSort } from '../../components/ui'
import { Sheet } from '../../components/ui/Sheet'
import { api } from '../../lib/api'
import { useAccess } from '../../lib/access'
import type { AppDefaults, CreditSettings, CreditPack } from '../../lib/adminTypes'
import { decimalUnits, creditPrice, creditCount, dollars } from '../../lib/creditMath'
import { Panel, LoadState, useAdminQuery, useAdminSave, selectClass, fmtDate } from './shared'

function DefaultsForm({ data }: { data: { settings: AppDefaults; revision: number; updatedAt: string } }) {
  const [settings, setSettings] = useState(data.settings)
  const state = useAdminSave(), canWrite = useAccess().permissions.includes('settings.write')
  return <Panel title="App defaults"><form onSubmit={e => { e.preventDefault(); void state.save(() => api.adminSaveSettings(settings, data.revision)) }} className="space-y-[16px]">
    <p className="text-text-muted">Applies to accounts without an explicit choice. Existing personal preferences stay in place.</p>
    <div className="grid gap-[16px] sm:grid-cols-2"><label className="text-[14px] font-semibold text-text-secondary">Visual style<select aria-label="Visual style" className={selectClass + ' mt-[6px]'} disabled={!canWrite} value={settings.skin} onChange={e => setSettings({ ...settings, skin: e.target.value as AppDefaults['skin'] })}><option value="premium">Premium</option><option value="classic">Classic</option></select></label><label className="text-[14px] font-semibold text-text-secondary">Top bar<select aria-label="Top bar" className={selectClass + ' mt-[6px]'} disabled={!canWrite} value={settings.topbar} onChange={e => setSettings({ ...settings, topbar: e.target.value as AppDefaults['topbar'] })}><option value="flat">Flat</option><option value="cover">Translucent cover</option></select></label></div>
    <p className="text-[13px] text-text-muted">Revision {data.revision} · {fmtDate(data.updatedAt)}</p>{state.error && <><FormAlert kind="error">{state.error}</FormAlert><Button variant="ghost" onClick={() => window.location.reload()}>Discard draft and reload latest</Button></>}{state.success && <FormAlert kind="success">{state.success}</FormAlert>}{canWrite && <Button type="submit" loading={state.busy}>Save app defaults</Button>}
  </form></Panel>
}
function EconomyForm({ data }: { data: CreditSettings }) {
  const [draft, setDraft] = useState({ enabled: data.policy.enabled, denomination: String(data.policy.microUsdPerCredit / 1e6), markup: String(data.policy.markupBps / 100), chatTurn: String(data.policy.estimatedMicroUsd.chatTurn / 1e6), analysis: String(data.policy.estimatedMicroUsd.analysis / 1e6), planDeck: String(data.policy.estimatedMicroUsd.planDeck / 1e6), lowBalance: String(data.policy.lowBalance) })
  const state = useAdminSave(), access = useAccess(), canWrite = access.permissions.includes('credits.manage')
  const denomination = decimalUnits(draft.denomination, 6), markup = decimalUnits(draft.markup, 2)
  const estimates = { chatTurn: decimalUnits(draft.chatTurn, 6), analysis: decimalUnits(draft.analysis, 6), planDeck: decimalUnits(draft.planDeck, 6) }
  const valid = denomination !== null && denomination > 0 && markup !== null && Object.values(estimates).every(v => v !== null) && /^\d+$/.test(draft.lowBalance) && Number.isSafeInteger(Number(draft.lowBalance))
  const fields = [
    { key: 'denomination', label: 'USD value per credit', hint: 'For example, 0.01 means one credit represents one cent of marked-up estimated usage.' },
    { key: 'markup', label: 'Provider-cost markup (%)', hint: '25 means estimated provider cost plus 25%. This is markup, not a guaranteed profit margin.' },
    { key: 'chatTurn', label: 'Estimated provider cost: chat turn (USD)', hint: 'Flat estimated cost per turn, not a token-by-token settlement.' },
    { key: 'analysis', label: 'Estimated provider cost: analysis (USD)', hint: 'Charged in addition to a chat turn when this operation starts.' },
    { key: 'planDeck', label: 'Estimated provider cost: deck plan (USD)', hint: 'Charged in addition to a chat turn when this operation starts.' },
    { key: 'lowBalance', label: 'Low-balance warning (credits)', hint: 'Whole credits remaining before the low-balance message.' },
  ] as const
  return <Panel title="AI credit economy">{access.actorCapabilities.canReadSharedConversations && <CostObservations canWrite={canWrite} onUse={(operation, microUsd) => setDraft(current => ({ ...current, [operation]: String(microUsd / 1e6) }))} />}<form className="space-y-[20px]" onSubmit={e => { e.preventDefault(); if (valid) void state.save(() => api.adminSaveCreditSettings({ enabled: draft.enabled, microUsdPerCredit: denomination!, markupBps: markup!, estimatedMicroUsd: { chatTurn: estimates.chatTurn!, analysis: estimates.analysis!, planDeck: estimates.planDeck! }, lowBalance: Number(draft.lowBalance) }, data.revision)) }}>
    <p className="text-text-muted">Set what a credit means for future AI usage. Credit-pack sale prices are configured independently below.</p>
    <label className="flex items-center gap-[10px] text-text-primary"><input type="checkbox" checked={draft.enabled} disabled={!canWrite} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />Charge AI usage in credits</label>
    <div className="grid gap-x-[20px] md:grid-cols-2">{fields.map(field => <Field key={field.key} label={field.label} hint={field.hint} value={draft[field.key]} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })} inputMode="decimal" required disabled={!canWrite} />)}</div>
    <div className="rounded-[12px] border border-border-default bg-surface-tertiary p-[16px]" aria-live="polite"><h3 className="font-semibold text-text-primary">Estimated usage preview</h3><p className="mt-[8px] text-[14px] text-text-muted">Estimated USD cost × (1 + markup) ÷ USD per credit, rounded up to a whole credit, minimum 1.</p><dl className="mt-[12px] grid gap-[12px] sm:grid-cols-3">{Object.entries(estimates).map(([key, cost]) => <div key={key}><dt className="text-[14px] text-text-muted">{({ chatTurn: 'Chat turn', analysis: 'Analysis', planDeck: 'Deck plan' } as Record<string, string>)[key]}</dt><dd className="mt-[4px] font-semibold text-text-primary">{valid ? creditCount(creditPrice(cost!, denomination!, markup!)) : '—'}</dd></div>)}</dl></div>
    <p className="text-[14px] text-text-muted">Saving creates a new pricing revision for later work. Existing credit counts, past charges, and pending purchase terms stay unchanged. Work is charged when it starts; provider work already started is not automatically refunded.</p>
    <FormAlert kind="info">{data.estimateNotice ?? 'Usage prices use your saved provider estimates. Review these estimates regularly; they do not measure actual provider billing.'}</FormAlert>
    <p className="text-[13px] text-text-muted">Revision {data.revision} · {fmtDate(data.updatedAt)}</p>
    {!valid && <FormAlert kind="error">Enter nonnegative decimal values (up to six USD decimal places, two markup decimal places) and a positive credit value.</FormAlert>}
    {state.error && <><FormAlert kind="error">{state.error}</FormAlert><Button variant="ghost" onClick={() => window.location.reload()}>Discard draft and reload latest</Button></>}{state.success && <FormAlert kind="success">{state.success}</FormAlert>}{canWrite && <Button type="submit" loading={state.busy} disabled={!valid}>Save credit economy</Button>}
  </form></Panel>
}
function PackEditor({ pack, close }: { pack: CreditPack | null; close: () => void }) {
  const [name, setName] = useState(pack?.name ?? ''), [credits, setCredits] = useState(String(pack?.credits ?? '')), [price, setPrice] = useState(pack ? (pack.priceCents / 100).toFixed(2) : ''), [active, setActive] = useState(pack?.active ?? false)
  const state = useAdminSave(), cents = decimalUnits(price, 2)
  const valid = /^\d+$/.test(credits) && Number.isSafeInteger(Number(credits)) && Number(credits) > 0 && cents !== null && cents > 0
  return <Sheet title={pack ? 'Edit credit pack' : 'Create credit pack'} onClose={() => { if (state.busy) return false; close() }}><form className="space-y-[16px]" onSubmit={e => { e.preventDefault(); if (valid) void state.save(() => api.adminSaveCreditPack(pack?.id ?? null, { name: name.trim(), credits: Number(credits), priceCents: cents!, currency: 'usd', active, ...(pack ? { expectedRevision: pack.revision } : {}) }), close) }}>
    <Field label="Pack name" required maxLength={80} value={name} onChange={e => setName(e.target.value)} /><Field label="Credits in pack" inputMode="numeric" value={credits} required onChange={e => setCredits(e.target.value)} /><Field label="Sale price (USD)" inputMode="decimal" value={price} required onChange={e => setPrice(e.target.value)} hint="The customer pays this price. The usage markup is not added to it." /><label className="flex gap-[10px] text-text-primary"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Available for new purchases</label><p className="text-[14px] text-text-muted">Changes affect new checkouts. Pending orders retain their original price and credit quantity.</p>{state.error && <><FormAlert kind="error">{state.error}</FormAlert><Button variant="ghost" onClick={() => window.location.reload()}>Discard draft and reload latest</Button></>}<Button type="submit" loading={state.busy} disabled={!valid}>Save credit pack</Button>
  </form></Sheet>
}
function CreditPackTable({ packs, loading, refreshing, error, retry, edit }: { packs: CreditPack[]; loading: boolean; refreshing: boolean; error?: string; retry: () => void; edit: (pack: CreditPack) => void }) {
  const canManage = useAccess().permissions.includes('credits.manage')
  const [search, setSearch] = useState(''), [status, setStatus] = useState('all'), [offset, setOffset] = useState(0), [pageSize, setPageSize] = useState(25), [sort, setSort] = useState<DataTableSort>({ columnId: 'name', direction: 'asc' })
  const filtered = packs.filter(pack => pack.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (status === 'all' || pack.active === (status === 'active'))).sort((a, b) => {
    const order = sort.columnId === 'credits' ? a.credits - b.credits : sort.columnId === 'price' ? a.priceCents - b.priceCents : a.name.localeCompare(b.name)
    return (sort.direction === 'asc' ? 1 : -1) * (order || a.id.localeCompare(b.id))
  })
  return <DataTable label="Credit packs" rows={filtered.slice(offset, offset + pageSize)} getRowId={pack => pack.id} loading={loading} refreshing={refreshing} error={error} onRetry={retry}
    empty={<EmptyState icon="lists" title="No matching credit packs" body="Try fewer filters, or create a credit pack." />}
    sort={sort} onSortChange={next => { setSort(next); setOffset(0) }} pagination={{ offset, pageSize, total: filtered.length, onOffsetChange: setOffset, onPageSizeChange: setPageSize }}
    toolbar={<DataTableToolbar label="Filter credit packs" search={{ label: 'Search packs', value: search, onChange: value => { setSearch(value); setOffset(0) }, placeholder: 'Pack name' }} onReset={() => { setSearch(''); setStatus('all'); setOffset(0) }} resetDisabled={!search && status === 'all'}><label className="text-[14px] font-semibold text-text-secondary">Pack status<select aria-label="Pack status" className={selectClass + ' mt-[6px]'} value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}><option value="all">All packs</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label></DataTableToolbar>}
    columns={[
      { id: 'name', header: 'Pack', sortable: true, className: 'min-w-[180px] max-w-[260px] break-words', cell: pack => <strong>{pack.name}</strong> },
      { id: 'credits', header: 'Credits', sortable: true, align: 'right', cell: pack => pack.credits.toLocaleString() },
      { id: 'price', header: 'Sale price', sortable: true, align: 'right', className: 'whitespace-nowrap', cell: pack => dollars(pack.priceCents) },
      { id: 'status', header: 'Status', cell: pack => pack.active ? 'Active' : 'Inactive' },
      ...(canManage ? [{ id: 'actions', header: 'Actions', cell: (pack: CreditPack) => <Button variant="ghost" size="sm" aria-label={'Edit ' + pack.name} onClick={() => edit(pack)}>Edit</Button> }] : []),
    ]} />
}
export function AdminSettings() {
  const access = useAccess()
  const defaults = useAdminQuery(['settings'], signal => api.adminSettings(signal), 'settings.read')
  const economy = useAdminQuery(['credit-settings'], signal => api.adminCreditSettings(signal), 'credits.read')
  const packs = useAdminQuery(['packs'], signal => api.adminCreditPacks(signal), 'credits.read')
  const payment = useAdminQuery(['payment-status'], signal => api.adminCreditPaymentStatus(signal), 'credits.read')
  const [editing, setEditing] = useState<{ pack: CreditPack | null } | null>(null)
  return <section className="space-y-[24px]"><h2 className="font-display text-[24px] text-text-primary">Settings</h2>
    {access.permissions.includes('settings.read') && <><LoadState loading={defaults.isLoading} error={defaults.error} retry={defaults.refetch} />{defaults.data && <DefaultsForm key={defaults.data.revision} data={defaults.data} />}</>}
    {access.permissions.includes('credits.read') && <><LoadState loading={economy.isLoading} error={economy.error} retry={economy.refetch} />{economy.data && <EconomyForm key={economy.data.revision} data={economy.data} />}
      <Panel title="Credit packs"><p className="mb-[16px] text-text-muted">Sell whole credits at an explicit USD price. No packs are offered until you create and activate them.</p><CreditPackTable packs={packs.data?.packs ?? []} loading={packs.isPending} refreshing={packs.isFetching && !packs.isPending} error={packs.error?.message} retry={() => void packs.refetch()} edit={pack => setEditing({ pack })} />{access.permissions.includes('credits.manage') && <Button className="mt-[16px]" onClick={() => setEditing({ pack: null })}>Create credit pack</Button>}</Panel>
      <Panel title="Payment readiness"><LoadState loading={payment.isLoading} error={payment.error} retry={payment.refetch} />{payment.data && <><p className="font-semibold text-text-primary">{payment.data.ready ? 'Ready for credit purchases' : 'Credit purchases unavailable'}</p><p className="mt-[8px] text-text-muted">{payment.data.reason ?? 'Payment configuration and required webhook subscriptions are present.'}</p><p className="mt-[8px] text-[13px] text-text-muted">Checked {fmtDate(payment.data.checkedAt)}</p><details className="my-[12px] text-[14px] text-text-muted"><summary className="cursor-pointer text-link">Required payment events</summary><ul className="mt-[8px] break-all">{payment.data.requiredEvents.map(event => <li key={event}>{event}</li>)}</ul></details></>}<Button variant="ghost" onClick={() => void payment.refetch()}>Check payment readiness</Button></Panel>
    </>}
    {access.permissions.includes('credits.manage') && editing && <PackEditor pack={editing.pack} close={() => setEditing(null)} />}
  </section>
}
