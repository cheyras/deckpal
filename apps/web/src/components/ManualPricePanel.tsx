import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type FamilyPriceSuggestion, type Variant } from '../lib/api'
import { currencyMinorUnit, formatMinor, priceAge } from '../lib/manualPrice'

const CONDITIONS: FamilyPriceSuggestion['condition'][] = ['NM', 'LP', 'MP', 'HP', 'DMG']

function malaysiaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function ManualPricePanel({ cardId, variants }: { cardId: string; variants: Variant[] }) {
  const queryClient = useQueryClient()
  const prices = useQuery({
    queryKey: ['family-manual-prices', cardId],
    queryFn: ({ signal }) => api.familyManualPrices(cardId, signal),
    retry: false,
  })
  const [open, setOpen] = useState(false)
  const [variantId, setVariantId] = useState(variants[0]?.variantId ?? 0)
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('JPY')
  const [sourceName, setSourceName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [condition, setCondition] = useState<FamilyPriceSuggestion['condition']>('NM')
  const [observedOn, setObservedOn] = useState(malaysiaToday())
  const [notes, setNotes] = useState('')
  const propose = useMutation({
    mutationFn: () => api.proposeFamilyPrice({
      cardVariantId: variantId,
      amountMinor: Math.round(Number(amount) * 10 ** currencyMinorUnit(currency)),
      currencyCode: currency,
      sourceName,
      sourceUrl: sourceUrl || null,
      condition,
      observedOn,
      notes: notes || null,
    }),
    onSuccess: async () => {
      setOpen(false)
      setAmount('')
      setSourceName('')
      setSourceUrl('')
      setNotes('')
      await queryClient.invalidateQueries({ queryKey: ['family-price-suggestions'] })
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (variantId && Number(amount) > 0 && sourceName.trim()) propose.mutate()
  }

  // A signed-in account without an active family receives 403; keep the public
  // card page clean instead of presenting a family control that cannot work.
  if (prices.isError) return null

  return (
    <section className="mt-[20px] rounded-[16px] border border-border-default bg-surface-secondary p-[15px]">
      <div className="flex items-center justify-between gap-[12px]">
        <div><h3 className="text-[16px] font-bold text-text-primary">Harga keluarga</h3><p className="text-[12px] text-text-muted">Manual dan berasingan daripada harga pasaran automatik.</p></div>
        <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-full border border-border-default px-[12px] py-[7px] text-[12px] font-bold text-text-primary">{open ? 'Tutup' : 'Cadang harga'}</button>
      </div>

      <div className="mt-[12px] space-y-[8px]">
        {prices.data?.prices.map((price) => {
          const age = priceAge(price.observedOn)
          return (
            <div key={price.id} className="rounded-[12px] bg-surface-primary p-[11px] text-[13px]">
              <div className="flex items-center justify-between gap-[10px]"><span className="font-bold text-text-primary">{formatMinor(price.amountMinor, price.currencyCode)}</span><span className={`rounded-full px-[8px] py-[3px] text-[10px] font-bold ${age.state === 'stale' ? 'bg-status-warning/15 text-status-warning' : 'bg-change-positive/15 text-change-positive'}`}>{age.label}</span></div>
              <p className="mt-[3px] text-text-secondary">{price.variantName ?? 'Printing'} · {price.condition} · {price.sourceName}</p>
              <p className="text-[11px] text-text-muted">Dilihat {price.observedOn} · diluluskan keluarga</p>
              {price.sourceUrl && <a href={price.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-[4px] inline-block text-link">Buka sumber</a>}
            </div>
          )
        })}
        {!prices.isLoading && prices.data?.prices.length === 0 && <p className="py-[8px] text-[12px] text-text-muted">Belum ada harga manual yang diluluskan.</p>}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-[14px] grid gap-[10px] border-t border-border-default pt-[14px] sm:grid-cols-2">
          <Field label="Printing"><select value={variantId} onChange={(e) => setVariantId(Number(e.target.value))} required className={INPUT}>{variants.map((v) => <option key={v.variantId} value={v.variantId}>{v.displayName}</option>)}</select></Field>
          <Field label="Harga"><div className="flex gap-[6px]"><select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${INPUT} w-[86px]`}><option>JPY</option><option>USD</option><option>EUR</option></select><input type="number" min="0.01" step={currency === 'JPY' ? '1' : '0.01'} value={amount} onChange={(e) => setAmount(e.target.value)} required className={`${INPUT} min-w-0 flex-1`} /></div></Field>
          <Field label="Sumber"><input value={sourceName} maxLength={80} onChange={(e) => setSourceName(e.target.value)} required placeholder="Yuyu-tei / Cardrush / kedai" className={INPUT} /></Field>
          <Field label="Keadaan"><select value={condition} onChange={(e) => setCondition(e.target.value as FamilyPriceSuggestion['condition'])} className={INPUT}>{CONDITIONS.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Tarikh dilihat"><input type="date" max={malaysiaToday()} value={observedOn} onChange={(e) => setObservedOn(e.target.value)} required className={INPUT} /></Field>
          <Field label="Pautan sumber (pilihan)"><input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className={INPUT} /></Field>
          <Field label="Nota (pilihan)"><input value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} className={INPUT} /></Field>
          <div className="flex items-end"><button disabled={propose.isPending} className="h-[40px] w-full rounded-full bg-action-primary px-[14px] text-[13px] font-bold text-action-primary-text disabled:opacity-50">{propose.isPending ? 'Menghantar…' : 'Hantar untuk kelulusan admin'}</button></div>
          {propose.error && <p className="sm:col-span-2 text-[12px] text-status-danger">{propose.error instanceof Error ? propose.error.message : 'Cadangan tidak berjaya.'}</p>}
        </form>
      )}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-[11px] font-semibold text-text-muted">{label}{children}</label> }
const INPUT = 'mt-[4px] block h-[38px] w-full rounded-[9px] border border-border-default bg-surface-primary px-[9px] text-[13px] text-text-primary'
