import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type FamilyPriceSuggestion } from '../lib/api'
import { formatMinor, priceAge } from '../lib/manualPrice'
import { canOpenFamilyAdmin } from './familyState'

export function PriceApprovalAdmin() {
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ['family', 'me'], queryFn: ({ signal }) => api.familyMe(signal) })
  const allowed = canOpenFamilyAdmin(me.data?.family)
  const inbox = useQuery({
    queryKey: ['family-price-suggestions', 'pending'],
    queryFn: ({ signal }) => api.familyPriceSuggestions('pending', signal),
    enabled: allowed,
  })
  const decision = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'approve' | 'reject'; note: string }) => api.decideFamilyPrice(id, action, note || null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['family-price-suggestions'] })
      await queryClient.invalidateQueries({ queryKey: ['family-manual-prices'] })
    },
  })

  if (me.isLoading) return <Page><p className="text-text-muted">Memuatkan…</p></Page>
  if (!allowed) return <Page><p className="text-text-secondary">Halaman ini hanya untuk admin keluarga.</p></Page>

  return (
    <Page>
      <div className="mb-[22px] flex items-center justify-between gap-[12px]">
        <div><p className="text-[13px] font-bold uppercase tracking-[0.12em] text-text-muted">Admin</p><h1 className="text-[30px] font-extrabold text-text-primary">Kelulusan harga</h1></div>
        <Link to="/family/admin" className={SECONDARY}>Kembali</Link>
      </div>
      <p className="mb-[18px] max-w-[680px] text-[14px] text-text-secondary">Semak sumber dan keadaan kad sebelum meluluskan. Kelulusan baharu bagi printing, keadaan dan mata wang yang sama akan menggantikan harga lama dalam sejarah.</p>

      <div className="space-y-[12px]">
        {inbox.data?.suggestions.map((item) => (
          <ApprovalRow key={item.id} item={item} pending={decision.isPending} onDecide={(action, note) => {
            if (action === 'approve' && !window.confirm('Luluskan harga ini? Harga diluluskan lama untuk skop yang sama akan ditanda sebagai diganti.')) return
            decision.mutate({ id: item.id, action, note })
          }} />
        ))}
        {!inbox.isLoading && inbox.data?.suggestions.length === 0 && <div className="rounded-[18px] border border-border-default bg-surface-raised p-[28px] text-center text-text-muted">Tiada cadangan menunggu kelulusan.</div>}
        {decision.error && <p className="text-[13px] text-status-danger">{decision.error instanceof Error ? decision.error.message : 'Keputusan tidak berjaya.'}</p>}
      </div>
    </Page>
  )
}

function ApprovalRow({ item, pending, onDecide }: { item: FamilyPriceSuggestion; pending: boolean; onDecide: (action: 'approve' | 'reject', note: string) => void }) {
  const [note, setNote] = useState('')
  const age = priceAge(item.observedOn)
  return (
    <article className="rounded-[18px] border border-border-default bg-surface-raised p-[16px]">
      <div className="flex flex-col justify-between gap-[12px] sm:flex-row">
        <div>
          <h2 className="text-[17px] font-bold text-text-primary">{item.cardName} · {item.setName} #{item.cardNumber}</h2>
          <p className="mt-[3px] text-[13px] text-text-secondary">{item.variantName ?? 'Printing'} · {item.condition} · dicadang oleh {item.proposerName}</p>
          <p className="mt-[8px] text-[22px] font-extrabold text-change-positive">{formatMinor(item.amountMinor, item.currencyCode)}</p>
          <p className="text-[12px] text-text-muted">{item.sourceName} · {item.observedOn} ({age.label})</p>
          {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-[4px] inline-block text-[13px] text-link">Semak sumber</a>}
          {item.notes && <p className="mt-[6px] text-[13px] text-text-secondary">Nota: {item.notes}</p>}
        </div>
        <div className="w-full sm:w-[260px]">
          <textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Sebab / nota keputusan (pilihan)" className="h-[76px] w-full resize-none rounded-[10px] border border-border-default bg-surface-primary p-[9px] text-[13px] text-text-primary" />
          <div className="mt-[8px] flex gap-[8px]"><button disabled={pending} onClick={() => onDecide('reject', note)} className={DANGER}>Tolak</button><button disabled={pending} onClick={() => onDecide('approve', note)} className={PRIMARY}>Luluskan</button></div>
        </div>
      </div>
    </article>
  )
}

function Page({ children }: { children: React.ReactNode }) { return <div className="mx-auto max-w-[980px] px-[16px] py-[28px] sm:px-[24px]">{children}</div> }
const PRIMARY = 'flex-1 rounded-full bg-action-primary px-[14px] py-[9px] text-[12px] font-bold text-action-primary-text disabled:opacity-50'
const SECONDARY = 'rounded-full border border-border-default bg-surface-raised px-[14px] py-[8px] text-[13px] font-bold text-text-primary'
const DANGER = 'flex-1 rounded-full border border-status-danger px-[14px] py-[9px] text-[12px] font-bold text-status-danger disabled:opacity-50'
