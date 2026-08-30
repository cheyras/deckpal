import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CreateListBody, type ListKind, type ListSummary } from '../lib/api'
import { Content, Spinner, ErrorState, ProgressBar } from '../components/ui'
import { ListFormModal } from '../components/ListModals'
import { RecycleBin } from '../components/RecycleBin'
import { Icon } from '../components/Icon'
import { fmtUsd } from '../lib/format'
import { LIST_SEARCH_DEFAULTS } from './listSearch'
import { useLateEntrance } from '../lib/lateEntrance'

const KIND_META: Record<ListKind, { label: string }> = {
  dynamic: { label: 'Dynamic List' },
  static: { label: 'Static List' },
  pokedex_binder: { label: 'Pokédex Binder' },
}

/**
 * The cover as a grid of the list's own cards (2026-08-29 walkthrough,
 * deferred item: "like a grid of the cards in the list … determine how many
 * across smartly … a maximum that will show").
 *
 * The layout ladder only ever uses shapes it can FILL — 4×2, 3×2, 2×2, 3×1,
 * 2×1 — because a half-empty second row reads as a loading failure, not a
 * design. One card keeps the old single-art cover; past eight the rest are
 * summarised by the +N chip rather than shrunk into confetti (the server
 * sends at most 8 — distinct cards, cover pick first).
 */
function CoverMosaic({ list }: { list: ListSummary }) {
  const tiles = list.coverImages ?? []
  if (tiles.length === 0) {
    return <Icon name="lists" size={40} className="text-icon-muted" />
  }
  if (tiles.length === 1) {
    return <img src={tiles[0]!.low} alt="" className="h-full w-full object-cover" style={{ objectPosition: 'center 22%' }} />
  }
  const [cols, rows] =
    tiles.length >= 8 ? [4, 2] : tiles.length >= 6 ? [3, 2] : tiles.length >= 4 ? [2, 2] : tiles.length === 3 ? [3, 1] : [2, 1]
  const shown = tiles.slice(0, cols * rows)
  const more = list.itemCount - shown.length
  return (
    <>
      <div
        className="grid h-full w-full gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
      >
        {shown.map((img, i) => (
          <img key={i} src={img.low} alt="" className="h-full w-full object-cover" style={{ objectPosition: 'center 25%' }} />
        ))}
      </div>
      {more > 0 && (
        <span className="absolute bottom-[8px] right-[8px] rounded-full bg-surface-primary/80 px-[8px] py-[2px] text-[12px] font-bold text-text-secondary backdrop-blur-sm">
          +{more}
        </span>
      )}
    </>
  )
}

function ListCard({ list }: { list: ListSummary }) {
  return (
    <Link
      to="/lists/$id"
      params={{ id: list.id }}
      search={LIST_SEARCH_DEFAULTS}
      className="flex flex-col overflow-hidden rounded-xl border border-border-default bg-surface-tertiary transition-colors hover:border-surface-quaternary"
    >
      {/* cover */}
      <div className="relative flex h-[132px] items-center justify-center overflow-hidden bg-surface-secondary">
        <CoverMosaic list={list} />
        <span className="absolute right-[10px] top-[10px] rounded-full bg-surface-primary/80 px-[10px] py-[3px] text-[14px] font-bold text-text-secondary backdrop-blur-sm">
          {KIND_META[list.kind].label}
        </span>
        {list.visibility === 'public' && (
          <span className="absolute left-[10px] top-[10px] rounded-full bg-action-primary-strong px-[10px] py-[3px] text-[14px] font-bold text-action-primary-strong-text">
            Public
          </span>
        )}
      </div>
      {/* body */}
      <div className="flex flex-1 flex-col gap-[8px] p-[16px]">
        <div className="flex items-start justify-between gap-[8px]">
          <span className="font-display truncate text-[16px] font-bold text-text-primary">{list.name}</span>
          {list.isFavorite && <Icon name="star-filled" size={16} className="shrink-0 text-action-primary" />}
        </div>
        {list.description && <p className="line-clamp-2 text-[14px] text-text-muted">{list.description}</p>}
        <div className="mt-auto flex flex-col gap-[6px] pt-[6px]">
          {list.progress ? (
            <>
              <ProgressBar pct={list.progress.pct} />
              <div className="flex items-center justify-between text-[14px]">
                <span className="font-semibold text-text-secondary">
                  {list.progress.owned}/{list.progress.total} owned
                </span>
                <span className="font-bold text-action-primary">{list.progress.pct}%</span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between text-[14px]">
              <span className="font-semibold text-text-secondary">{list.itemCount} cards</span>
              <span className="text-change-positive">{fmtUsd(list.marketValueUsd)}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

export function ListsIndex() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['lists'], queryFn: ({ signal }) => api.lists(signal) })
  const enter = useLateEntrance(isLoading)

  const create = useMutation({
    mutationFn: (body: CreateListBody) => api.createList(body),
    onSuccess: () => {
      setShowCreate(false)
      setCreateError(null)
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
    onError: (e) => setCreateError((e as Error).message),
  })

  const lists = data?.lists ?? []

  return (
    <Content cap={1200}>
      <div className="mb-[24px] mt-[8px] flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-bold leading-[40px] text-text-primary">My Lists</h1>
          <p className="text-[14px] text-text-muted">{lists.length} list{lists.length === 1 ? '' : 's'}</p>
        </div>
        <button
          onClick={() => {
            setCreateError(null)
            setShowCreate(true)
          }}
          className="flex h-[46px] items-center gap-[8px] rounded-full bg-action-primary px-[20px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover"
        >
          <Icon name="plus" size={18} /> New List
        </button>
      </div>

      {isLoading && <Spinner label="Loading lists…" />}
      {error && <ErrorState message={(error as Error).message} className={enter} />}

      {data && lists.length === 0 && (
        <div className={`flex flex-col items-center justify-center gap-[12px] rounded-xl border border-dashed border-border-default py-[80px] text-center ${enter}`}>
          <Icon name="lists" size={44} className="text-icon-muted" />
          <div className="text-[20px] font-bold text-text-primary">No Lists Yet</div>
          <p className="text-[14px] text-text-muted">Create your first Pokémon TCG list.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-[4px] flex h-[44px] items-center gap-[8px] rounded-full bg-action-primary px-[20px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover"
          >
            <Icon name="plus" size={18} /> New List
          </button>
        </div>
      )}

      {lists.length > 0 && (
        <div
          className={`grid gap-[20px] ${enter}`}
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
          data-decke-list-index
          data-decke-landmark="[data-decke-list-index]"
          data-decke-label="the grid of your lists"
          data-decke-rank="container"
        >
          {lists.map((l) => (
            <ListCard key={l.id} list={l} />
          ))}
        </div>
      )}

      {/* Deleting a list is reversible now (migration 038) — this is where the
          undo lives, and the only place "delete forever" can be reached. */}
      <RecycleBin
        kind="list"
        load={async (signal) =>
          (await api.deletedLists(signal)).lists.map((l) => ({
            id: l.id,
            name: l.name,
            detail: `${KIND_META[l.kind].label} · ${l.itemCount} card${l.itemCount === 1 ? '' : 's'}`,
          }))
        }
        restore={(id) => api.restoreList(id)}
        purge={(id) => api.purgeList(id)}
        invalidate={['lists']}
      />

      {showCreate && (
        <ListFormModal
          mode="create"
          busy={create.isPending}
          error={createError}
          onClose={() => setShowCreate(false)}
          onSubmit={(body) => create.mutate(body)}
        />
      )}
    </Content>
  )
}
