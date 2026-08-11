import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { api, type ListDetailResponse, type ListItem } from '../lib/api'
import { Content, Spinner, ErrorState, BackPill, ProgressBar } from '../components/ui'
import { GridView } from '../components/GridView'
import { TableView } from '../components/TableView'
import { BinderView } from '../components/BinderView'
import { SearchBox, ViewToggle } from '../components/FilterControls'
import { AddCardModal, ConfirmModal, ListFormModal } from '../components/ListModals'
import { Icon } from '../components/Icon'
import { fmtUsd, fmtDate } from '../lib/format'
import { type ListSearch, type ListSortKey, LIST_SEARCH_DEFAULTS } from './listSearch'

const KIND_LABEL = { dynamic: 'Dynamic List', static: 'Static List', pokedex_binder: 'Pokédex Binder' } as const
const SORTS: { key: ListSortKey; label: string }[] = [
  { key: 'custom', label: 'Custom' },
  { key: 'number', label: 'Number' },
  { key: 'name', label: 'Name' },
  { key: 'rarity', label: 'Rarity' },
  { key: 'price', label: 'Price' },
  { key: 'artist', label: 'Artist' },
  { key: 'released', label: 'Released' },
]

function comparators(sort: ListSortKey): (a: ListItem, b: ListItem) => number {
  const num = (s: string | null | undefined) => (s == null ? Number.POSITIVE_INFINITY : Number(s))
  switch (sort) {
    case 'name':
      return (a, b) => (a.name ?? '').localeCompare(b.name ?? '')
    case 'number':
      return (a, b) => (a.numberSort ?? '').localeCompare(b.numberSort ?? '', undefined, { numeric: true })
    case 'price':
      return (a, b) => num(b.price?.market != null ? String(b.price.market) : null) - num(a.price?.market != null ? String(a.price.market) : null)
    case 'rarity':
      return (a, b) => (a.rarity ?? '').localeCompare(b.rarity ?? '')
    case 'artist':
      return (a, b) => (a.artist ?? '').localeCompare(b.artist ?? '')
    default:
      return (a, b) => a.position - b.position // custom / released fallback
  }
}

// ── Progress cluster for dynamic / binder lists ───────────────────────────────
function ListProgress({ owned, total, pct, copies }: { owned: number; total: number; pct: number; copies: number }) {
  return (
    <div className="flex items-end gap-[16px]">
      <div className="min-w-[220px] flex-1">
        <div className="mb-[6px] text-[10px] font-bold leading-[15px] text-text-muted">
          <span className="text-[15px] font-extrabold text-text-primary">{owned}</span>/{total} owned
          <span className="ml-[8px] text-text-muted">({copies} copies)</span>
        </div>
        <ProgressBar pct={pct} milestones={[25, 50, 75]} milestonePassed={(m) => pct >= m} />
      </div>
      <span className="text-[15px] font-extrabold leading-none text-text-primary">{pct}%</span>
    </div>
  )
}

// ── Reorder rows (static / custom) ────────────────────────────────────────────
function ReorderRows({ items, onMove, onRemove }: { items: ListItem[]; onMove: (from: number, to: number) => void; onRemove: (item: ListItem) => void }) {
  return (
    <div className="flex flex-col gap-[8px]">
      {items.map((it, i) => (
        <div key={it.itemId} className="flex items-center gap-[12px] rounded-lg bg-surface-tertiary p-[8px]">
          <div className="flex flex-col">
            <button disabled={i === 0} onClick={() => onMove(i, i - 1)} className="text-icon-default disabled:opacity-30" aria-label="Move up">
              <Icon name="chevron-left" size={16} className="rotate-90" />
            </button>
            <button disabled={i === items.length - 1} onClick={() => onMove(i, i + 1)} className="text-icon-default disabled:opacity-30" aria-label="Move down">
              <Icon name="chevron-right" size={16} className="rotate-90" />
            </button>
          </div>
          <span className="w-[24px] text-center text-[13px] font-bold text-text-muted">{i + 1}</span>
          {it.images.low && <img src={it.images.low} alt="" className="h-[56px] w-[40px] rounded object-cover" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-text-primary">{it.name}</div>
            <div className="text-[12px] text-text-muted">
              {it.setName} · {it.variant?.displayName}
              {it.staticQuantity != null && <span className="ml-[6px] font-bold text-text-secondary">×{it.staticQuantity}</span>}
            </div>
          </div>
          <button onClick={() => onRemove(it)} aria-label={`Remove ${it.name}`} className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-action-danger text-action-danger-text hover:bg-action-danger-hover">
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function ListDetail() {
  const { id } = useParams({ from: '/lists/$id' })
  const search = useSearch({ from: '/lists/$id' }) as ListSearch
  const navigate = useNavigate({ from: '/lists/$id' })
  const qc = useQueryClient()
  const key = ['list', id] as const

  const patch = (p: Partial<ListSearch>) => navigate({ search: { ...search, ...p } as never, resetScroll: false })

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.list(id, signal),
    placeholderData: keepPreviousData,
  })

  const [showAdd, setShowAdd] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)

  const list = data?.list
  const items = useMemo(() => data?.items ?? [], [data])

  // Ownership counts (dynamic only)
  const counts = useMemo(() => {
    let have = 0, need = 0, dupes = 0
    for (const c of items) {
      // /lists is signed-in-only, so ownership is always present here — the
      // field is optional because CardRow is shared with the public catalog.
      if (!c.ownership) continue
      if (c.ownership.have) have++
      if (c.ownership.need) need++
      if (c.ownership.dupe) dupes++
    }
    return { have, need, dupes }
  }, [items])

  const view = useMemo(() => {
    let out = items
    if (search.own !== 'all' && list?.kind === 'dynamic') {
      out = out.filter((c) =>
        search.own === 'have' ? c.ownership?.have : search.own === 'need' ? c.ownership?.need : c.ownership?.dupe,
      )
    }
    if (search.q.trim()) {
      const t = search.q.trim().toLowerCase()
      out = out.filter((c) => (c.name ?? '').toLowerCase().includes(t) || (c.number ?? '').toLowerCase().includes(t))
    }
    if (search.sort !== 'custom') {
      out = [...out].sort(comparators(search.sort))
      if (search.dir === 'desc') out.reverse()
    }
    return out
  }, [items, search.own, search.q, search.sort, search.dir, list?.kind])

  // ── Mutations ───────────────────────────────────────────────────────────────
  const addItem = useMutation({
    mutationFn: async (vars: { cardId: string; quantity: number }) => {
      // Resolve the card's primary variant, then add it.
      const detail = await api.card(vars.cardId)
      const primary = detail.variants.find((v) => v.isPrimary) ?? detail.variants[0]
      if (!primary) throw new Error('Card has no variant to add')
      return api.addListItem(id, { cardVariantId: primary.variantId, ...(list?.kind === 'static' ? { staticQuantity: vars.quantity } : {}) })
    },
    onSuccess: () => {
      setAddingId(null)
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
    onError: () => setAddingId(null),
  })

  const removeItem = useMutation({
    mutationFn: (itemId: string) => api.removeListItem(id, itemId),
    onMutate: async (itemId: string) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<ListDetailResponse>(key)
      if (prev) qc.setQueryData<ListDetailResponse>(key, { ...prev, items: prev.items.filter((i) => i.itemId !== itemId) })
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
  })

  const reorder = useMutation({
    mutationFn: (order: string[]) => api.updateList(id, { itemOrder: order }),
    onMutate: async (order: string[]) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<ListDetailResponse>(key)
      if (prev) {
        const byId = new Map(prev.items.map((i) => [i.itemId, i]))
        const reordered = order.map((oid, idx) => ({ ...byId.get(oid)!, position: idx }))
        qc.setQueryData<ListDetailResponse>(key, { ...prev, items: reordered })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })

  const editList = useMutation({
    mutationFn: (body: { name: string; description: string | null; visibility: 'private' | 'public' }) => api.updateList(id, body),
    onSuccess: () => {
      setShowEdit(false)
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
  })

  const deleteList = useMutation({
    mutationFn: () => api.deleteList(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lists'] })
      navigate({ to: '/lists' })
    },
  })

  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const order = items.map((i) => i.itemId)
    const [m] = order.splice(from, 1)
    order.splice(to, 0, m)
    reorder.mutate(order)
  }

  const forceBinder = list?.kind === 'pokedex_binder'
  const effectiveView = forceBinder ? 'binder' : search.view

  return (
    <Content cap={1165}>
      <div className="mb-[16px]">
        <BackPill to="/lists" label="My Lists" />
      </div>

      {isLoading && !data && <Spinner label="Loading list…" />}
      {error && <ErrorState message={(error as Error).message} />}

      {list && (
        <>
          {/* header */}
          <div className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-start justify-between gap-[16px]">
              <div className="min-w-0">
                <div className="mb-[6px] flex items-center gap-[10px]">
                  <span className="rounded-full bg-surface-tertiary px-[10px] py-[3px] text-[11px] font-bold text-text-secondary">{KIND_LABEL[list.kind]}</span>
                  <span className="text-[11px] font-semibold capitalize text-text-muted">{list.visibility}</span>
                  {list.isFavorite && <Icon name="star-filled" size={14} className="text-action-primary" />}
                </div>
                <h1 className="text-[30px] font-bold leading-[38px] text-text-primary">{list.name}</h1>
                {list.description && <p className="mt-[4px] max-w-[560px] text-[14px] text-text-muted">{list.description}</p>}
              </div>
              <div className="flex items-center gap-[8px]">
                <button onClick={() => setShowAdd(true)} className="flex h-[42px] items-center gap-[8px] rounded-full bg-action-primary px-[18px] text-[13px] font-bold text-action-primary-text hover:bg-action-primary-hover">
                  <Icon name="plus" size={16} /> Add Cards
                </button>
                <a href={api.listPdfUrl(id)} target="_blank" rel="noreferrer" className="flex h-[42px] items-center gap-[8px] rounded-full bg-surface-tertiary px-[16px] text-[13px] font-bold text-text-primary hover:bg-action-default-hover">
                  <Icon name="printer" size={16} /> Print checklist
                </a>
                <button onClick={() => setShowEdit(true)} aria-label="Edit list" className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-surface-tertiary text-text-primary hover:bg-action-default-hover">
                  <Icon name="sliders" size={18} />
                </button>
                <button onClick={() => setShowDelete(true)} aria-label="Delete list" className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-surface-tertiary text-action-danger hover:bg-action-danger hover:text-action-danger-text">
                  <Icon name="close" size={18} />
                </button>
              </div>
            </div>

            {/* info + progress */}
            <div className="flex flex-wrap items-center gap-x-[28px] gap-y-[8px] border-y border-divider-subtle py-[12px] text-[13px]">
              <span className="text-text-muted">Created <span className="text-text-primary">{fmtDate(list.createdAt)}</span></span>
              <span className="text-text-muted"><span className="font-bold text-text-primary">{list.itemCount}</span> cards</span>
              {list.marketValueUsd != null && (
                <span className="text-text-muted">List Value <span className="text-change-positive">{fmtUsd(list.marketValueUsd)}</span></span>
              )}
              {list.progress && (
                <div className="ml-auto min-w-[280px] flex-1">
                  <ListProgress {...list.progress} />
                </div>
              )}
            </div>
          </div>

          {/* controls */}
          <div className="mt-[20px] flex flex-col gap-[14px]">
            <div className="flex flex-wrap items-center gap-[16px]">
              <SearchBox value={search.q} onChange={(v) => patch({ q: v })} />
              <div className="scroll-x flex items-center gap-[10px]">
                {SORTS.map((s) => {
                  const active = search.sort === s.key
                  return (
                    <button
                      key={s.key}
                      onClick={() => (active ? patch({ dir: search.dir === 'asc' ? 'desc' : 'asc' }) : patch({ sort: s.key, dir: 'asc' }))}
                      className={`h-[40px] shrink-0 rounded-lg px-[12px] text-[13px] font-bold ${active ? 'bg-action-primary-strong text-action-primary-strong-text' : 'bg-surface-tertiary text-text-muted'}`}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-[12px]">
              {/* dynamic ownership strip */}
              {list.kind === 'dynamic' ? (
                <div className="scroll-x flex items-center gap-[20px]">
                  {[
                    { key: 'all', label: 'Show All' },
                    { key: 'have', label: `Have (${counts.have})` },
                    { key: 'need', label: `Need (${counts.need})` },
                    { key: 'dupes', label: `Dupes (${counts.dupes})` },
                  ].map((o) => (
                    <button
                      key={o.key}
                      onClick={() => patch({ own: o.key as ListSearch['own'] })}
                      className={`whitespace-nowrap text-[14px] ${search.own === o.key ? 'font-semibold text-text-primary' : 'text-text-secondary hover:text-text-body'}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-[16px]">
                {list.kind === 'static' && search.sort === 'custom' && (
                  <button
                    onClick={() => setReordering((r) => !r)}
                    className={`flex h-[36px] items-center gap-[6px] rounded-lg px-[12px] text-[13px] font-bold ${reordering ? 'bg-action-primary-strong text-action-primary-strong-text' : 'bg-surface-tertiary text-text-secondary'}`}
                  >
                    <Icon name="lists" size={15} /> {reordering ? 'Done' : 'Reorder'}
                  </button>
                )}
                {!forceBinder && <ViewToggle view={search.view} patch={patch as never} />}
              </div>
            </div>
          </div>

          {/* body */}
          <div className="mt-[24px]">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-[10px] rounded-xl border border-dashed border-border-default py-[70px] text-center">
                <Icon name="cards" size={40} className="text-icon-muted" />
                <div className="text-[16px] font-bold text-text-primary">This list is empty</div>
                <button onClick={() => setShowAdd(true)} className="mt-[4px] flex h-[42px] items-center gap-[8px] rounded-full bg-action-primary px-[18px] text-[13px] font-bold text-action-primary-text hover:bg-action-primary-hover">
                  <Icon name="plus" size={16} /> Add Cards
                </button>
              </div>
            ) : reordering && list.kind === 'static' ? (
              <ReorderRows items={items} onMove={moveItem} onRemove={(it) => removeItem.mutate(it.itemId)} />
            ) : view.length === 0 ? (
              <div className="py-[60px] text-center text-[14px] text-text-muted">No cards match this filter.</div>
            ) : effectiveView === 'binder' ? (
              <BinderView cards={view} mode="list" alwaysBright={list.kind === 'static'} />
            ) : effectiveView === 'table' ? (
              <TableView cards={view} seriesSlug="" setId="" />
            ) : (
              <GridView cards={view} seriesSlug="" setId="" onRemove={(c) => removeItem.mutate((c as ListItem).itemId)} />
            )}
          </div>
        </>
      )}

      {showAdd && list && (
        <AddCardModal
          listKind={list.kind}
          addingId={addingId}
          onClose={() => setShowAdd(false)}
          onAdd={(card, quantity) => {
            setAddingId(card.cardId)
            addItem.mutate({ cardId: card.cardId, quantity })
          }}
        />
      )}
      {showEdit && list && (
        <ListFormModal
          mode="edit"
          initial={list}
          busy={editList.isPending}
          onClose={() => setShowEdit(false)}
          onSubmit={(body) => editList.mutate({ name: body.name, description: body.description ?? null, visibility: body.visibility ?? 'private' })}
        />
      )}
      {showDelete && list && (
        <ConfirmModal
          title="Delete list"
          message={`Delete “${list.name}”? This can't be undone.`}
          confirmLabel="Delete List"
          busy={deleteList.isPending}
          onClose={() => setShowDelete(false)}
          onConfirm={() => deleteList.mutate()}
        />
      )}
    </Content>
  )
}

export { LIST_SEARCH_DEFAULTS }
