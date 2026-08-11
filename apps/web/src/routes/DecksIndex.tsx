import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CreateDeckBody, type DeckFormat, type DeckSummary } from '../lib/api'
import { Content, Spinner, ErrorState, Button } from '../components/ui'
import { Modal } from '../components/ListModals'
import { Icon } from '../components/Icon'
import { EnergyIcon } from '../components/EnergyIcon'
import { fmtUsd } from '../lib/format'
import { FORMAT_META, LegalBadge } from './deckShared'
import { DECK_SEARCH_DEFAULTS } from './deckSearch'

function DeckCard({ deck }: { deck: DeckSummary }) {
  // Battle record footer line — only once the deck has any scored logs.
  const rec = deck.record && deck.record.wins + deck.record.losses + deck.record.ties > 0 ? deck.record : null
  return (
    <Link
      to="/decks/$id"
      params={{ id: deck.id }}
      search={DECK_SEARCH_DEFAULTS}
      className="flex flex-col overflow-hidden rounded-xl border border-border-default bg-surface-tertiary transition-colors hover:border-surface-quaternary"
    >
      <div className="relative flex h-[132px] items-center justify-center overflow-hidden bg-surface-secondary">
        {deck.coverImage ? (
          <img src={deck.coverImage.low} alt="" className="h-full w-full object-cover" style={{ objectPosition: 'center 22%' }} />
        ) : (
          <Icon name="deck" size={40} className="text-icon-muted" />
        )}
        <span className="absolute right-[10px] top-[10px] inline-flex items-center gap-[4px] rounded-full bg-surface-primary/80 px-[10px] py-[3px] text-[11px] font-bold text-text-secondary backdrop-blur-sm">
          {FORMAT_META[deck.formatCode].short}
          {deck.formatCode === 'glc' && deck.glcType && (
            <>
              <span>·</span>
              <EnergyIcon type={deck.glcType} size={13} />
              {deck.glcType}
            </>
          )}
        </span>
        <span className="absolute left-[10px] top-[10px]">
          <LegalBadge legal={deck.legal} />
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-[8px] p-[16px]">
        <div className="flex items-start justify-between gap-[8px]">
          <span className="truncate text-[16px] font-bold text-text-primary">{deck.name}</span>
          {deck.isFavorite && <Icon name="star-filled" size={16} className="shrink-0 text-action-primary" />}
        </div>
        {deck.description && <p className="line-clamp-2 text-[12px] text-text-muted">{deck.description}</p>}
        <div className="mt-auto flex items-center justify-between pt-[6px] text-[12px]">
          <span className="font-semibold text-text-secondary">
            {deck.totalCount}/60 cards
            {rec && (
              <>
                {' · '}
                <span style={{ color: 'var(--color-success)' }}>{rec.wins}W</span>
                <span className="text-text-muted">–</span>
                <span style={{ color: 'var(--color-error)' }}>{rec.losses}L</span>
                {rec.ties > 0 && (
                  <>
                    <span className="text-text-muted">–</span>
                    <span className="text-text-secondary">{rec.ties}T</span>
                  </>
                )}
              </>
            )}
          </span>
          <span className="text-change-positive">{fmtUsd(deck.valueUsd)}</span>
        </div>
      </div>
    </Link>
  )
}

const FORMATS: DeckFormat[] = ['standard', 'expanded', 'glc', 'unlimited']

function NewDeckModal({ busy, error, onClose, onSubmit }: { busy?: boolean; error?: string | null; onClose: () => void; onSubmit: (b: CreateDeckBody) => void }) {
  const [name, setName] = useState('')
  const [formatCode, setFormatCode] = useState<DeckFormat>('standard')
  return (
    <Modal title="New Deck" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          onSubmit({ name: name.trim(), formatCode })
        }}
        className="flex flex-col gap-[18px]"
      >
        <label className="flex flex-col gap-[6px]">
          <span className="text-[13px] font-semibold text-text-secondary">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Charizard deck"
            maxLength={120}
            className="h-[44px] rounded-lg border border-border-default bg-surface-primary px-[14px] text-[15px] text-text-primary placeholder:text-text-muted"
          />
        </label>
        <div className="flex flex-col gap-[8px]">
          <span className="text-[13px] font-semibold text-text-secondary">Format</span>
          <div className="grid grid-cols-2 gap-[8px]">
            {FORMATS.map((f) => (
              <button
                type="button"
                key={f}
                onClick={() => setFormatCode(f)}
                className={`rounded-lg border-2 px-[12px] py-[10px] text-left ${formatCode === f ? 'border-action-primary bg-surface-tertiary' : 'border-transparent bg-surface-tertiary/50 hover:bg-surface-tertiary'}`}
              >
                <div className="text-[14px] font-bold text-text-primary">{FORMAT_META[f].label}</div>
                <div className="text-[11px] text-text-muted">{FORMAT_META[f].blurb}</div>
              </button>
            ))}
          </div>
        </div>
        {error && <div className="text-[13px] text-error">{error}</div>}
        <div className="mt-[4px] flex justify-end gap-[10px]">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!name.trim()} loading={busy}>
            {busy ? 'Creating…' : 'Create Deck'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ImportModal({ busy, error, onClose, onSubmit }: { busy?: boolean; error?: string | null; onClose: () => void; onSubmit: (b: { text: string; formatCode: DeckFormat; name?: string }) => void }) {
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [formatCode, setFormatCode] = useState<DeckFormat>('standard')
  return (
    <Modal title="Import from PTCG Live" onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          onSubmit({ text, formatCode, name: name.trim() || undefined })
        }}
        className="flex flex-col gap-[16px]"
      >
        <p className="text-[13px] text-text-muted">
          Paste a decklist exported from Pokémon TCG Live (or the Limitless deck builder). Each line
          resolves to a catalogue card; unresolved lines are reported, never dropped.
        </p>
        <div className="flex flex-wrap items-end gap-[16px]">
          <label className="flex flex-1 flex-col gap-[6px]" style={{ minWidth: 200 }}>
            <span className="text-[13px] font-semibold text-text-secondary">Deck name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Imported Deck" maxLength={120}
              className="h-[42px] rounded-lg border border-border-default bg-surface-primary px-[14px] text-[14px] text-text-primary placeholder:text-text-muted" />
          </label>
          <label className="flex flex-col gap-[6px]">
            <span className="text-[13px] font-semibold text-text-secondary">Format</span>
            <select value={formatCode} onChange={(e) => setFormatCode(e.target.value as DeckFormat)}
              className="h-[42px] rounded-lg border border-border-default bg-surface-primary px-[12px] text-[14px] text-text-primary">
              {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_META[f].label}</option>)}
            </select>
          </label>
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder={'Pokémon: 6\n3 Charizard ex OBF 125\n…\n\nTrainer: …\n\nEnergy: …\n\nTotal Cards: 60'}
          className="rounded-lg border border-border-default bg-surface-primary px-[14px] py-[10px] font-mono text-[13px] leading-[19px] text-text-primary placeholder:text-text-muted"
        />
        {error && <div className="text-[13px] text-error">{error}</div>}
        <div className="flex justify-end gap-[10px]">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!text.trim()} loading={busy}>
            {busy ? 'Importing…' : 'Import Deck'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function DecksIndex() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['decks'], queryFn: ({ signal }) => api.decks(signal) })

  const create = useMutation({
    mutationFn: (body: CreateDeckBody) => api.createDeck(body),
    onSuccess: (d) => {
      setShowNew(false)
      qc.invalidateQueries({ queryKey: ['decks'] })
      navigate({ to: '/decks/$id', params: { id: d.deck.id }, search: DECK_SEARCH_DEFAULTS })
    },
    onError: (e) => setErr((e as Error).message),
  })
  const importDeck = useMutation({
    mutationFn: (body: { text: string; formatCode: DeckFormat; name?: string }) => api.importDeck(body),
    onSuccess: (d) => {
      setShowImport(false)
      qc.invalidateQueries({ queryKey: ['decks'] })
      navigate({ to: '/decks/$id', params: { id: d.deck.id }, search: DECK_SEARCH_DEFAULTS })
    },
    onError: (e) => setErr((e as Error).message),
  })

  const decks = data?.decks ?? []

  return (
    <Content cap={1200}>
      <div className="mb-[24px] mt-[8px] flex flex-wrap items-center justify-between gap-[12px]">
        <div>
          <h1 className="text-[32px] font-bold leading-[40px] text-text-primary">Deck Builder</h1>
          <p className="text-[14px] text-text-muted">{decks.length} deck{decks.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex items-center gap-[10px]">
          <Button variant="secondary" onClick={() => { setErr(null); setShowImport(true) }}>
            <Icon name="download" size={18} /> Import from PTCG Live
          </Button>
          <Button onClick={() => { setErr(null); setShowNew(true) }}>
            <Icon name="plus" size={18} /> New Deck
          </Button>
        </div>
      </div>

      {isLoading && <Spinner label="Loading decks…" />}
      {error && <ErrorState message={(error as Error).message} />}

      {data && decks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-[12px] rounded-xl border border-dashed border-border-default py-[80px] text-center">
          <Icon name="deck" size={44} className="text-icon-muted" />
          <div className="text-[20px] font-bold text-text-primary">No Decks Yet</div>
          <p className="text-[14px] text-text-muted">Build one from scratch, or import a Pokémon TCG Live decklist.</p>
          <div className="mt-[4px] flex gap-[10px]">
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              <Icon name="download" size={18} /> Import
            </Button>
            <Button onClick={() => setShowNew(true)}>
              <Icon name="plus" size={18} /> New Deck
            </Button>
          </div>
        </div>
      )}

      {decks.length > 0 && (
        <div className="grid gap-[20px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {decks.map((d) => <DeckCard key={d.id} deck={d} />)}
        </div>
      )}

      {showNew && <NewDeckModal busy={create.isPending} error={err} onClose={() => setShowNew(false)} onSubmit={(b) => create.mutate(b)} />}
      {showImport && <ImportModal busy={importDeck.isPending} error={err} onClose={() => setShowImport(false)} onSubmit={(b) => importDeck.mutate(b)} />}
    </Content>
  )
}
