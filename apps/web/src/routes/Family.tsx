import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'
import { selectedFamilyMember, sortFamilyMembers } from './familyState'

export function Family() {
  const queryClient = useQueryClient()
  const familyMe = useQuery({ queryKey: ['family', 'me'], queryFn: ({ signal }) => api.familyMe(signal) })
  const members = useQuery({
    queryKey: ['family', 'members'],
    queryFn: ({ signal }) => api.familyMembers(signal),
    enabled: familyMe.data?.family?.status === 'active',
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sorted = useMemo(() => sortFamilyMembers(members.data?.members ?? []), [members.data?.members])
  const selected = selectedFamilyMember(sorted, selectedId)

  useEffect(() => {
    if (!selectedId && sorted[0]) setSelectedId(sorted[0].userId)
  }, [selectedId, sorted])

  const collection = useQuery({
    queryKey: ['family', 'collection', selected?.userId],
    queryFn: ({ signal }) => api.familyCollection(selected!.userId, undefined, signal),
    enabled: !!selected,
  })

  const activate = useMutation({
    mutationFn: () => api.activateFamilyInvitation(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['family'] })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const bootstrap = useMutation({
    mutationFn: () => api.bootstrapFamily('Keluarga Saya'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['family'] })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })

  if (familyMe.isLoading) return <Page><p className="text-text-muted">Memuatkan keluarga…</p></Page>
  if (familyMe.error) return <Page><ErrorText error={familyMe.error} /></Page>

  const family = familyMe.data?.family
  if (!family) {
    return (
      <Page>
        <Panel>
          <h2 className="text-[22px] font-bold text-text-primary">Mulakan koleksi keluarga</h2>
          <p className="mt-[8px] text-text-secondary">Admin menyediakan keluarga sekali sahaja. Ahli lain masuk melalui e-mel jemputan.</p>
          <button className={PRIMARY} onClick={() => bootstrap.mutate()} disabled={bootstrap.isPending}>
            {bootstrap.isPending ? 'Menyediakan…' : 'Sediakan keluarga'}
          </button>
          {bootstrap.error && <ErrorText error={bootstrap.error} />}
        </Panel>
      </Page>
    )
  }

  if (family.status === 'invited') {
    return (
      <Page>
        <Panel>
          <h2 className="text-[22px] font-bold text-text-primary">Jemputan keluarga diterima</h2>
          <p className="mt-[8px] text-text-secondary">Aktifkan keahlian untuk melihat koleksi keluarga.</p>
          <button className={PRIMARY} onClick={() => activate.mutate()} disabled={activate.isPending}>
            {activate.isPending ? 'Mengaktifkan…' : 'Aktifkan akaun keluarga'}
          </button>
          {activate.error && <ErrorText error={activate.error} />}
        </Panel>
      </Page>
    )
  }

  if (family.status !== 'active') {
    return <Page><Panel><p className="text-text-secondary">Akaun keluarga ini telah dinyahaktifkan. Hubungi admin keluarga.</p></Panel></Page>
  }

  return (
    <Page>
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[12px]">
        <div>
          <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-text-muted">Keluarga</p>
          <h1 className="text-[32px] font-extrabold text-text-primary">{family.familyName}</h1>
          <p className="mt-[4px] text-text-secondary">Semua ahli boleh melihat koleksi; hanya pemilik boleh mengubah koleksinya.</p>
        </div>
        {family.role === 'admin' && <Link to="/family/admin" className={SECONDARY}>Urus keluarga</Link>}
      </div>

      <div className="grid gap-[18px] lg:grid-cols-[260px_1fr]">
        <Panel>
          <h2 className="mb-[12px] text-[16px] font-bold text-text-primary">Ahli keluarga</h2>
          {members.isLoading && <p className="text-text-muted">Memuatkan ahli…</p>}
          <div className="space-y-[8px]">
            {sorted.map((member) => (
              <button
                key={member.userId}
                onClick={() => setSelectedId(member.userId)}
                className={`w-full rounded-[14px] border px-[12px] py-[10px] text-left ${selected?.userId === member.userId ? 'border-action-primary bg-surface-tertiary' : 'border-border-default bg-surface-primary'}`}
              >
                <span className="block font-bold text-text-primary">{member.displayName ?? member.username}</span>
                <span className="text-[12px] text-text-muted">{member.role === 'admin' ? 'Admin' : 'Ahli'} · {member.totalQuantity} kad</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="mb-[16px]">
            <h2 className="text-[22px] font-bold text-text-primary">
              {selected?.userId === familyMe.data?.userId ? 'Koleksi anda' : `Koleksi ${selected?.displayName ?? selected?.username ?? ''}`}
            </h2>
            {selected?.userId !== familyMe.data?.userId && <p className="text-[13px] text-text-muted">Paparan sahaja</p>}
          </div>
          {collection.isLoading && <p className="text-text-muted">Memuatkan koleksi…</p>}
          {collection.error && <ErrorText error={collection.error} />}
          {collection.data?.items.length === 0 && <p className="text-text-muted">Belum ada kad dalam koleksi ini.</p>}
          <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-5">
            {collection.data?.items.map((item) => (
              <article key={item.id} className="rounded-[14px] border border-border-default bg-surface-primary p-[8px]">
                <img src={item.images.low} alt={item.cardName} className="aspect-[0.716] w-full rounded-[9px] object-cover" loading="lazy" />
                <h3 className="mt-[8px] truncate text-[13px] font-bold text-text-primary">{item.cardName}</h3>
                <p className="truncate text-[11px] text-text-muted">{item.setName} · #{item.number}</p>
                <p className="mt-[3px] text-[12px] font-semibold text-text-secondary">Kuantiti {item.quantity}{item.condition ? ` · ${item.condition}` : ''}</p>
              </article>
            ))}
          </div>
        </Panel>
      </div>
    </Page>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1280px] px-[16px] py-[28px] sm:px-[24px]">{children}</div>
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-[20px] border border-border-default bg-surface-raised p-[18px] shadow-sm">{children}</section>
}

function ErrorText({ error }: { error: unknown }) {
  return <p className="mt-[10px] text-[14px] text-status-danger">{error instanceof Error ? error.message : 'Sesuatu tidak berjaya.'}</p>
}

const PRIMARY = 'mt-[18px] rounded-full bg-action-primary px-[18px] py-[10px] font-bold text-action-primary-text disabled:opacity-50'
const SECONDARY = 'rounded-full border border-border-default bg-surface-raised px-[16px] py-[9px] font-bold text-text-primary hover:bg-surface-tertiary'
