import { useMemo, useState } from 'react'
import { useQuery, useQueryClient, keepPreviousData, type QueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { api, type ListDetailResponse, type ListItem } from '../lib/api'
import { Content, Spinner, ErrorState, BackPill, ProgressBar, EmptyState, Button } from '../components/ui'
import { GridView } from '../components/GridView'
import { TableView } from '../components/TableView'
import { BinderView } from '../components/BinderView'
import { CardSheet } from './CardDetail'

import { VariantChip } from '../components/VariantChip'
import { SearchBox, ViewToggle, SortChipStrip, OwnershipButtons } from '../components/FilterControls'
import { AddCardModal, ConfirmModal, ListFormModal } from '../components/ListModals'
import { Icon } from '../components/Icon'
import { KebabMenu } from '../components/KebabMenu'
import { fmtUsd, fmtDate } from '../lib/format'
import { type ListSearch, type ListSortKey, LIST_SEARCH_DEFAULTS } from './listSearch'
import { useLateEntrance } from '../lib/lateEntrance'
import { save, useLane, writeFailureText } from '../lib/writes'
import { showToast } from '../lib/toast'

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
        <div className="mb-[6px] text-[14px] font-bold leading-[15px] text-text-muted">
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
          <span className="w-[24px] text-center text-[14px] font-bold text-text-muted">{i + 1}</span>
          {it.images.low && <img src={it.images.low} alt="" className="h-[56px] w-[40px] rounded object-cover" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-text-primary">{it.name}</div>
            <div className="flex flex-wrap items-center gap-x-[6px] text-[14px] text-text-muted">
              <span>{it.setName}</span>
              {it.variant && <VariantChip variant={it.variant} className="text-text-body" />}
              {it.staticQuantity != null && <span className="font-bold text-text-secondary">×{it.staticQuantity}</span>}
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
  // Issue #49: the wrapper entrance fires while this is still a spinner.
  const enter = useLateEntrance(isLoading && !data)

  const [showAdd, setShowAdd] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [reordering, setReordering] = useState(false)
  // Cards added since the picker opened, so a finished add says so on its tile.
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const laneKey = `list:${id}`
  const lane = useLane(laneKey)
  const laneVersion = lane.getVersion()
  const list = data?.list
  // What the server has, as the person is about to see it: a removal that is
  // still saving is already gone, and a reorder that is still saving already
  // applies. A write that fails simply stops being pending, and the row is back.
  const items = useMemo(() => {
    const kept = (data?.items ?? []).filter((i) => !lane.intent(`remove:${i.itemId}`))
    const order = lane.intent<string[]>('order')
    return order ? inOrder(kept, order) : kept
    // laneVersion stands in for `lane`: one stable object whose intents change underneath.
  }, [data, lane, laneVersion])
  // A rule-backed list: membership is a saved query the server re-evaluates
  // on every read. Add/reorder don't exist for it; "remove" excludes.
  const smart = !!list?.rule

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

  // ── Writes ──────────────────────────────────────────────────────────────────
  // All of them queue on this list's lane (lib/writes.ts): one request at a
  // time, so the list summary each one answers with lands in order, and each
  // ends visibly — saved, or rolled back with a message saying what did not.
  const named = list ? `“${list.name}”` : 'this list'
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key })
    void qc.invalidateQueries({ queryKey: ['lists'] })
  }

  const addItem = (card: { cardId: string; name: string }, quantity: number) => {
    const staticList = list?.kind === 'static'
    void save(laneKey, {
      item: `add:${card.cardId}`,
      send: async (signal) => {
        // Resolve the card's primary variant, then add it.
        const detail = await api.card(card.cardId, signal)
        const primary = detail.variants.find((v) => v.isPrimary) ?? detail.variants[0]
        if (!primary) throw new Error('Card has no variant to add')
        return api.addListItem(id, { cardVariantId: primary.variantId, ...(staticList ? { staticQuantity: quantity } : {}) }, signal)
      },
      onSaved: () => {
        setAdded((prev) => new Set(prev).add(card.cardId))
        refresh()
      },
      failure: `Couldn't add ${card.name} to ${named}.`,
      // The server ignores a card a list already holds — except a static list,
      // which may hold it twice on purpose, so there a repeat is a second copy.
      retry: staticList ? undefined : () => addItem(card, quantity),
    })
  }

  const removeItem = (item: ListItem) =>
    void save(laneKey, {
      item: `remove:${item.itemId}`,
      intent: true,
      send: (signal) => api.removeListItem(id, item.itemId, signal),
      onSaved: () => {
        qc.setQueryData<ListDetailResponse>(key, (old) => old && { ...old, items: old.items.filter((i) => i.itemId !== item.itemId) })
        refresh()
      },
      failure: `Couldn't remove ${item.name} from ${named}.`,
      retry: () => removeItem(item),
    })

  const reorder = (order: string[]) =>
    void save(laneKey, {
      item: 'order',
      intent: order,
      send: (signal) => api.updateList(id, { itemOrder: order }, signal),
      onSaved: () => qc.setQueryData<ListDetailResponse>(key, (old) => old && { ...old, items: inOrder(old.items, order) }),
      failure: `Couldn't save the new order of ${named}.`,
      retry: () => reorder(order),
    })

  // A form that stays open reports in place: the person is looking at it.
  const editList = (body: Parameters<typeof api.updateList>[1]) => {
    setEditError(null)
    void lane
      .write({
        item: 'edit',
        send: (signal) => api.updateList(id, body, signal),
        onSaved: (res) => {
          qc.setQueryData<ListDetailResponse>(key, (old) => old && { ...old, list: res.list })
          refresh()
        },
      })
      .then((o) => {
        if (o.status === 'saved') setShowEdit(false)
        else if (o.status === 'failed') setEditError(writeFailureText(`Couldn't save your changes to ${named}.`, o.error))
      })
  }

  const deleteList = () => {
    setDeleteError(null)
    const name = named
    void lane.write({ item: 'delete', send: (signal) => api.deleteList(id, signal) }).then((o) => {
      if (o.status === 'failed') return setDeleteError(writeFailureText(`Couldn't delete ${name}.`, o.error))
      if (o.status !== 'saved') return
      void qc.invalidateQueries({ queryKey: ['lists'] })
      navigate({ to: '/lists' })
      showToast({ tone: 'info', message: `Moved ${name} to Recently deleted.`, action: { label: 'Undo', run: () => restoreList(qc, id, name) } })
    })
  }

  // Pin a smart list: the server materialises the current evaluation into
  // stored rows and detaches the rule — the list keeps today's cards and
  // stops changing on its own. Undoable via the mutation log.
  const pinList = () =>
    void save(laneKey, {
      item: 'pin',
      send: (signal) => api.updateList(id, { rule: null }, signal),
      onSaved: refresh,
      failure: `Couldn't pin ${named} as a regular list.`,
      retry: pinList,
    })

  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const order = items.map((i) => i.itemId)
    const [m] = order.splice(from, 1)
    order.splice(to, 0, m)
    reorder(order)
  }

  const forceBinder = list?.kind === 'pokedex_binder'
  const effectiveView = forceBinder ? 'binder' : search.view

  return (
    <Content cap={1165}>
      <div className="mb-[16px]">
        <BackPill to="/lists" label="My Lists" />
      </div>

      {isLoading && !data && <Spinner label="Loading list…" />}
      {error && <ErrorState message={(error as Error).message} className={enter} />}

      {list && (
        <>
          {/* header */}
          <div
            className="flex flex-col gap-[16px]"
            data-decke-list-header
            data-decke-landmark="[data-decke-list-header]"
            data-decke-label="the list header"
            data-decke-rank="container"
          >
            <div className="flex flex-wrap items-start justify-between gap-[16px]">
              <div className="min-w-0">
                <div className="mb-[6px] flex items-center gap-[10px]">
                  <span className={`rounded-full px-[10px] py-[3px] text-[12px] font-bold ${smart ? 'bg-action-primary-strong text-action-primary-strong-text' : 'bg-surface-tertiary text-text-secondary'}`}>
                    {smart ? 'Smart List' : KIND_LABEL[list.kind]}
                  </span>
                  <span className="text-[12px] font-semibold capitalize text-text-muted">{list.visibility}</span>
                  {list.isFavorite && <Icon name="star-filled" size={14} className="text-action-primary" />}
                </div>
                <h1 className="text-[30px] font-bold leading-[38px] text-text-primary">{list.name}</h1>
                {list.description && <p className="mt-[4px] max-w-[560px] text-[14px] text-text-muted">{list.description}</p>}
                {smart && list.rule && (
                  // The visual difference the owner asked for: a smart list
                  // SAYS it is live, names its rule, and shows the cards will
                  // leave on their own.
                  <p className="mt-[6px] flex flex-wrap items-center gap-x-[6px] text-[14px] text-text-body">
                    <Icon name="sparkle" size={14} className="text-action-primary" />
                    <span>
                      Live — showing what's still missing for{' '}
                      <span className="font-semibold text-text-primary">
                        {list.rule.setName ?? list.rule.setId} · {list.rule.goal}
                      </span>
                      {list.rule.maxPriceUsd != null && <> under ${list.rule.maxPriceUsd}</>}
                      . Cards leave by themselves as you collect them.
                    </span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-[8px]">
                {smart ? (
                  <button onClick={() => setShowEdit(true)} className="flex h-[42px] items-center gap-[8px] rounded-full bg-action-primary px-[18px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover">
                    <Icon name="sliders" size={16} /> Edit Rule
                  </button>
                ) : (
                  <button onClick={() => setShowAdd(true)} className="flex h-[42px] items-center gap-[8px] rounded-full bg-action-primary px-[18px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover">
                    <Icon name="plus" size={16} /> Add Cards
                  </button>
                )}
                <a href={api.listPdfUrl(id)} target="_blank" rel="noreferrer" className="flex h-[42px] items-center gap-[8px] rounded-full bg-surface-tertiary px-[16px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover">
                  <Icon name="printer" size={16} /> Print checklist
                </a>
                <button onClick={() => setShowEdit(true)} aria-label="Edit list" className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-surface-tertiary text-text-primary hover:bg-action-default-hover">
                  <Icon name="sliders" size={18} />
                </button>
                <KebabMenu
                  ariaLabel="List options"
                  size={42}
                  items={[
                    ...(smart
                      ? [{
                          key: 'pin',
                          label: lane.busy('pin') ? 'Pinning…' : 'Pin as regular list',
                          icon: 'lists' as const,
                          onSelect: pinList,
                        }]
                      : []),
                    { key: 'delete', label: 'Delete list', icon: 'close', danger: true, onSelect: () => setShowDelete(true) },
                  ]}
                />
              </div>
            </div>

            {/* info + progress */}
            <div className="flex flex-wrap items-center gap-x-[28px] gap-y-[8px] border-y border-divider-subtle py-[12px] text-[14px]">
              <span className="text-text-muted">Created <span className="text-text-primary">{fmtDate(list.createdAt)}</span></span>
              <span className="text-text-muted"><span className="font-bold text-text-primary">{list.itemCount}</span> {smart ? 'to get' : 'cards'}</span>
              {list.marketValueUsd != null && (
                <span className="text-text-muted">{smart ? 'Cost to finish' : 'List Value'} <span className="text-change-positive">{fmtUsd(list.marketValueUsd)}</span></span>
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
              <SortChipStrip
                items={SORTS}
                activeKey={search.sort}
                activeDir={search.dir}
                onSort={(key, dir) => patch({ sort: key as ListSortKey, dir })}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-[12px]">
              {/* dynamic ownership strip */}
              {list.kind === 'dynamic' && !smart ? (
                <OwnershipButtons
                  items={[
                    { key: 'all', label: 'Show All' },
                    { key: 'have', label: `Have (${counts.have})` },
                    { key: 'need', label: `Need (${counts.need})` },
                    { key: 'dupes', label: `Dupes (${counts.dupes})` },
                  ]}
                  activeKey={search.own}
                  onSelect={(key) => patch({ own: key as ListSearch['own'] })}
                />
              ) : (
                <div />
              )}
              <div className="flex items-center gap-[16px]">
                {list.kind === 'static' && search.sort === 'custom' && (
                  <button
                    onClick={() => setReordering((r) => !r)}
                    className={`flex h-[36px] items-center gap-[6px] rounded-lg px-[12px] text-[14px] font-bold ${reordering ? 'bg-action-primary-strong text-action-primary-strong-text' : 'bg-surface-tertiary text-text-secondary'}`}
                  >
                    <Icon name="lists" size={15} /> {reordering ? 'Done' : 'Reorder'}
                  </button>
                )}
                {!forceBinder && <ViewToggle view={search.view} patch={patch as never} />}
              </div>
            </div>
          </div>

          {/* body */}
          {/* One landmark for the whole item region, not one per item. The
              items are rendered by GridView / BinderView / TableView /
              ReorderRows depending on the list kind and the view toggle, and
              four components would each need marking to give Deck-E a per-item
              selector — with no guarantee the same item is addressable across
              a view switch. "The cards in this list" is a thing he can point at
              in every one of those states, which is the honest offer. */}
          <div
            className={`mt-[24px] ${enter}`}
            data-decke-list-items
            data-decke-landmark="[data-decke-list-items]"
            data-decke-label="the cards in this list"
            data-decke-rank="container"
          >
            {items.length === 0 ? (
              <EmptyState icon="cards" title="This list is empty">
                <Button onClick={() => setShowAdd(true)}>
                  <Icon name="plus" size={16} /> Add Cards
                </Button>
              </EmptyState>
            ) : reordering && list.kind === 'static' ? (
              <ReorderRows items={items} onMove={moveItem} onRemove={removeItem} />
            ) : view.length === 0 ? (
              <div className="py-[60px] text-center text-[14px] text-text-muted">No cards match this filter.</div>
            ) : effectiveView === 'binder' ? (
              <BinderView cards={view} mode="list" alwaysBright={list.kind === 'static'} />
            ) : effectiveView === 'table' ? (
              <TableView cards={view} seriesSlug="" setId="" />
            ) : (
              <GridView cards={view} seriesSlug="" setId="" onRemove={(c) => removeItem(c as ListItem)} />
            )}
          </div>
        </>
      )}

      {/* Card detail as a bottom-sheet driven by ?card=<cardId>, keeping this page
          mounted so scroll, filter and sort survive an open→close cycle. Same
          mechanism as the set and species pages.

          It is also the fix for "I clicked a card and Back didn't return me to the
          list": until 2026-08-29 a list tile navigated to the standalone card
          route, whose BackPill can only point at the card's SET — that is the only
          ancestor a `/series/$series/$set/$number` URL carries. A sheet has no
          back problem, because nothing was left. */}
      {search.card && (
        <CardSheet
          cardId={search.card}
          onClose={() => patch({ card: undefined })}
        />
      )}

      {showAdd && list && (
        <AddCardModal
          listKind={list.kind}
          isAdding={(cardId) => lane.busy(`add:${cardId}`)}
          wasAdded={(cardId) => added.has(cardId)}
          onClose={() => {
            setShowAdd(false)
            setAdded(new Set())
          }}
          onAdd={addItem}
        />
      )}
      {showEdit && list && (
        <ListFormModal
          mode="edit"
          initial={list}
          excluded={data?.excluded}
          busy={lane.busy('edit')}
          error={editError}
          onClose={() => {
            setShowEdit(false)
            setEditError(null)
          }}
          onSubmit={(body) =>
            editList({
              name: body.name,
              description: body.description ?? null,
              visibility: body.visibility ?? 'private',
              // undefined = the form had no rule section = leave it alone.
              ...(body.rule !== undefined ? { rule: body.rule } : {}),
            })
          }
        />
      )}
      {showDelete && list && (
        <ConfirmModal
          title="Delete list"
          message={`Delete “${list.name}”? It moves to Recently deleted, where you can restore it.`}
          confirmLabel="Delete List"
          busy={lane.busy('delete')}
          error={deleteError}
          onClose={() => {
            setShowDelete(false)
            setDeleteError(null)
          }}
          onConfirm={deleteList}
        />
      )}
    </Content>
  )
}

/** `items` in the order given, positions renumbered to match. */
function inOrder(items: ListItem[], order: string[]): ListItem[] {
  const rank = new Map(order.map((itemId, i) => [itemId, i]))
  const at = (i: ListItem) => rank.get(i.itemId) ?? Number.MAX_SAFE_INTEGER
  return [...items].sort((a, b) => at(a) - at(b)).map((it, position) => ({ ...it, position }))
}

/** Undo a delete: the list comes back out of Recently deleted. */
function restoreList(qc: QueryClient, id: string, name: string): void {
  void save(`list:${id}`, {
    item: 'restore',
    send: (signal) => api.restoreList(id, signal),
    onSaved: () => void qc.invalidateQueries({ queryKey: ['lists'] }),
    failure: `Couldn't restore ${name}. It's still in Recently deleted.`,
    retry: () => restoreList(qc, id, name),
  })
}

export { LIST_SEARCH_DEFAULTS }
