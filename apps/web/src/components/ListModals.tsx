import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type CreateListBody, type ListKind, type ListSummary, type ListVisibility } from '../lib/api'
import { fmtPrice, fmtNumber } from '../lib/format'
import { Icon } from './Icon'
import { Button } from './ui/Button'
import { SelectableCard } from './ui/SelectableCard'
import { Sheet } from './ui/Sheet'

// ── Modal shell ───────────────────────────────────────────────────────────────
// Kept as a name so callers read the same, but it is a Sheet now: portalled to
// the body, capped to the viewport, with its own scroll area. See Sheet.tsx for
// what that fixes.
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  /** Pinned under the scroll area, so actions survive a short screen. */
  footer?: ReactNode
}) {
  return (
    <Sheet title={title} onClose={onClose} size={wide ? 'lg' : 'md'} footer={footer}>
      {children}
    </Sheet>
  )
}

// ── Create / edit list form ──────────────────────────────────────────────────
const KIND_LABEL: Record<ListKind, { title: string; blurb: string }> = {
  dynamic: { title: 'Dynamic List', blurb: 'Trackable — checkboxes and a progress bar that sync with your collection.' },
  static: { title: 'Static List', blurb: 'A fixed list. The same card can appear multiple times, each with its own quantity.' },
  pokedex_binder: { title: 'Pokédex Binder', blurb: 'One slot per Pokémon species, rendered as a binder.' },
}

export function ListFormModal({
  mode,
  initial,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  initial?: Partial<ListSummary>
  busy?: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (body: CreateListBody & { isFavorite?: boolean }) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<ListKind>((initial?.kind as ListKind) ?? 'dynamic')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [visibility, setVisibility] = useState<ListVisibility>((initial?.visibility as ListVisibility) ?? 'private')

  const formId = 'list-form'
  return (
    <Modal
      title={mode === 'create' ? 'New List' : 'Edit List'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-[10px]">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!name.trim()} loading={busy}>
            {busy ? 'Saving…' : mode === 'create' ? 'Create List' : 'Save'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          onSubmit({ name: name.trim(), kind, description: description.trim() || null, visibility })
        }}
        className="flex flex-col gap-[18px]"
      >
        <label className="flex flex-col gap-[6px]">
          <span className="text-[14px] font-semibold text-text-secondary">Name</span>
          <input
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Charizard chase list"
            maxLength={120}
            className="h-[44px] rounded-lg border border-border-default bg-surface-primary px-[14px] text-[15px] text-text-primary placeholder:text-text-muted"
          />
        </label>

        {mode === 'create' && (
          <div className="flex flex-col gap-[8px]">
            <span className="text-[14px] font-semibold text-text-secondary">Type</span>
            <div className="flex flex-col gap-[8px]">
              {(Object.keys(KIND_LABEL) as ListKind[]).map((k) => {
                const active = kind === k
                return (
                  <SelectableCard key={k} active={active} onClick={() => setKind(k)}>
                    <div className="flex items-center justify-between">
                      <span className="text-[14px] font-bold text-text-primary">{KIND_LABEL[k].title}</span>
                      {active && <Icon name="star-filled" size={16} className="text-action-primary" />}
                    </div>
                    <div className="text-[14px] text-text-muted">{KIND_LABEL[k].blurb}</div>
                  </SelectableCard>
                )
              })}
            </div>
          </div>
        )}

        <label className="flex flex-col gap-[6px]">
          <span className="text-[14px] font-semibold text-text-secondary">Description (optional)</span>
          <textarea
            value={description ?? ''}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            className="rounded-lg border border-border-default bg-surface-primary px-[14px] py-[10px] text-[14px] text-text-primary placeholder:text-text-muted"
          />
        </label>

        <div className="flex flex-col gap-[8px]">
          <span className="text-[14px] font-semibold text-text-secondary">Visibility</span>
          <div className="flex gap-[10px]">
            {(['private', 'public'] as ListVisibility[]).map((v) => (
              <SelectableCard
                key={v}
                active={visibility === v}
                onClick={() => setVisibility(v)}
                className={`flex-1 text-center text-[14px] font-semibold capitalize ${
                  visibility === v ? 'text-text-primary' : 'text-text-muted'
                }`}
              >
                {v}
              </SelectableCard>
            ))}
          </div>
        </div>

        {error && <div className="text-[14px] text-error">{error}</div>}
      </form>
    </Modal>
  )
}

// ── Add-to-List picker (card search) ─────────────────────────────────────────
export function AddCardModal({
  listKind,
  onClose,
  onAdd,
  addingId,
}: {
  listKind: ListKind
  onClose: () => void
  onAdd: (card: { cardId: string; name: string }, quantity: number) => void
  addingId?: string | null
}) {
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [qty, setQty] = useState(1)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300)
    return () => clearTimeout(t)
  }, [term])

  const { data, isFetching } = useQuery({
    queryKey: ['listSearch', debounced],
    queryFn: ({ signal }) => {
      const p = new URLSearchParams({ pageSize: '24', sort: 'name' })
      if (debounced) p.set('q', debounced)
      return api.searchCards(p, signal)
    },
    enabled: debounced.length > 0,
  })

  return (
    <Modal title="Add Cards" onClose={onClose} wide>
      <div className="flex flex-col gap-[16px]">
        {/* Sticky inside the sheet's scroll area: scrolling deep into results
            should never strand the field you are searching with. -mt/-mx/px
            pull it flush with the sheet padding so the sticky backdrop covers
            the full width as rows pass under it. */}
        <label className="sticky -top-[20px] z-(--z-raised) -mx-[20px] -mt-[20px] flex h-[48px] items-center bg-surface-secondary px-[20px] pt-[8px] nav:-mx-[24px] nav:-top-[24px] nav:px-[24px]">
          <span className="pointer-events-none absolute left-[34px] text-icon-default nav:left-[38px]">
            <Icon name="search" size={20} />
          </span>
          <input
            data-autofocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search cards by name or number…"
            className="h-[48px] w-full rounded-lg border border-border-default bg-surface-primary pl-[44px] pr-[12px] text-[15px] text-text-primary placeholder:text-text-muted"
          />
        </label>

        {listKind === 'static' && (
          <label className="flex items-center gap-[10px] text-[14px] font-semibold text-text-secondary">
            Quantity per add
            <div className="flex items-center gap-[6px]">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-[30px] w-[30px] items-center justify-center rounded-md bg-surface-tertiary text-text-primary">
                <Icon name="minus" size={14} />
              </button>
              <span className="w-[24px] text-center text-[15px] font-bold text-text-primary">{qty}</span>
              <button type="button" onClick={() => setQty((q) => q + 1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-md bg-surface-tertiary text-text-primary">
                <Icon name="plus" size={14} />
              </button>
            </div>
          </label>
        )}

        <div className="min-h-[200px]">
          {!debounced && <div className="py-[40px] text-center text-[14px] text-text-muted">Start typing to find cards.</div>}
          {debounced && isFetching && !data && <div className="py-[40px] text-center text-[14px] text-text-muted">Searching…</div>}
          {data && data.cards.length === 0 && <div className="py-[40px] text-center text-[14px] text-text-muted">No cards match “{debounced}”.</div>}
          <div className="grid gap-[12px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
            {data?.cards.map((c) => (
              <button
                key={c.cardId}
                onClick={() => onAdd({ cardId: c.cardId, name: c.name }, qty)}
                disabled={addingId === c.cardId}
                className="group flex flex-col rounded-lg border border-transparent p-[6px] text-left hover:border-border-default hover:bg-surface-tertiary disabled:opacity-50"
              >
                <div className="relative overflow-hidden rounded-md">
                  <img src={c.images.low} alt={c.name} loading="lazy" className="aspect-[245/337] w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[14px] font-bold text-white opacity-0 group-hover:opacity-100">
                    {addingId === c.cardId ? 'Adding…' : '+ Add'}
                  </span>
                </div>
                <span className="mt-[4px] truncate text-[14px] font-medium text-text-primary">{c.name}</span>
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-text-muted">{fmtNumber(c.number)}</span>
                  <span className="text-[14px] text-change-positive">{fmtPrice(c.price)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── Simple confirm dialog ─────────────────────────────────────────────────────
export function ConfirmModal({ title, message, confirmLabel, onClose, onConfirm, busy }: { title: string; message: string; confirmLabel: string; onClose: () => void; onConfirm: () => void; busy?: boolean }) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <div className="flex justify-end gap-[10px]">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-[14px] text-text-body">{message}</p>
    </Sheet>
  )
}
