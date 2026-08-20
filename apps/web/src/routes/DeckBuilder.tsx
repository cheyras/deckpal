import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  api, type DeckDetail, type DeckCard, type DeckFormat, type Violation, type CardRef, type SearchCard, type RevertResult,
} from '../lib/api'
import { Content, Spinner, ErrorState, BackPill, Button, Tabs } from '../components/ui'
import { Modal, ConfirmModal } from '../components/ListModals'
import { Icon } from '../components/Icon'
import { KebabMenu } from '../components/KebabMenu'
import { EnergyIcon, ENERGY_TYPES } from '../components/EnergyIcon'
import { fmtUsd, fmtPrice } from '../lib/format'
import { FORMAT_META, LegalBadge } from './deckShared'
import { type DeckSearch, type DeckTab, DECK_SEARCH_DEFAULTS } from './deckSearch'
import { CardSheet } from './CardDetail'
import { StrategyTab } from './deck/StrategyTab'
import { BattlesTab } from './deck/BattlesTab'
import { HistoryTab } from './deck/HistoryTab'

const FORMATS: DeckFormat[] = ['standard', 'expanded', 'glc', 'unlimited']
const SECTION_TITLE = { pokemon: 'Pokémon', trainer: 'Trainer', energy: 'Energy' } as const

// Basic energy cards are named "<Type> Energy" (DeckCard carries no per-card type
// field), so infer the energy symbol from the leading word for the energy section.
function basicEnergyType(card: DeckCard): string | null {
  if (card.category !== 'Energy') return null
  const first = card.name.split(/\s+/)[0]?.toLowerCase()
  return first && ENERGY_TYPES.includes(first) ? first : null
}
const MARK_POOL: Record<DeckFormat, string[] | null> = {
  standard: ['H', 'I', 'J'],
  expanded: ['D', 'E', 'F', 'G', 'H', 'I', 'J'],
  glc: ['D', 'E', 'F', 'G', 'H', 'I', 'J'],
  unlimited: null,
}

// ── Format selector + GLC type picker ─────────────────────────────────────────
function FormatSelector({ deck, glcTypes, onFormat, onGlcType }: {
  deck: DeckDetail['deck']; glcTypes: string[]
  onFormat: (f: DeckFormat) => void; onGlcType: (t: string) => void
}) {
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="text-[14px] font-bold uppercase tracking-wide text-text-muted">Format</div>
      <div className="grid grid-cols-2 gap-[6px]">
        {FORMATS.map((f) => {
          const active = deck.formatCode === f
          return (
            <button key={f} onClick={() => onFormat(f)}
              className={`rounded-lg px-[10px] py-[8px] text-[14px] font-bold ${active ? 'bg-action-primary-strong text-action-primary-strong-text' : 'bg-surface-tertiary text-text-secondary hover:bg-action-default-hover'}`}>
              {FORMAT_META[f].short}
            </button>
          )
        })}
      </div>
      {deck.formatCode === 'glc' && (
        <label className="flex items-center justify-between gap-[8px] text-[14px] text-text-secondary">
          <span className="font-semibold">Deck type</span>
          <EnergyIcon type={deck.glcType ?? glcTypes[0]} size={20} className="shrink-0" />
          <select value={deck.glcType ?? glcTypes[0]} onChange={(e) => onGlcType(e.target.value)}
            className="h-[34px] flex-1 rounded-lg border border-border-default bg-surface-primary px-[10px] text-[14px] text-text-primary">
            {glcTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}

// ── Legality panel: the orange "Not Legal" disclosure, EVERY failing rule ─────
function ViolationThumbs({ ids, refs }: { ids: number[] | undefined; refs: Record<string, CardRef> }) {
  if (!ids || ids.length === 0) return null
  const shown = ids.slice(0, 8)
  return (
    <div className="mt-[8px] flex flex-wrap gap-[4px]">
      {shown.map((id) => {
        const r = refs[String(id)]
        if (!r) return null
        return <img key={id} src={r.image} alt={r.name} title={`${r.name} (${r.setId.toUpperCase()} ${r.number})`} className="h-[46px] w-[33px] rounded object-cover ring-1 ring-border-default" />
      })}
      {ids.length > shown.length && <span className="self-center text-[14px] text-text-muted">+{ids.length - shown.length}</span>}
    </div>
  )
}

function LegalityPanel({ detail, onDisclose }: { detail: DeckDetail; onDisclose: () => void }) {
  const { validation: v, cardRefs } = detail
  const errors = v.violations.filter((x) => x.severity === 'error')
  const warnings: (Violation | { code: string; message: string })[] = [...v.violations.filter((x) => x.severity === 'warning'), ...v.warnings]
  return (
    <div className="rounded-xl border border-border-default bg-surface-secondary p-[16px]">
      <div className="flex items-center justify-between">
        <LegalBadge legal={v.legal} big onClick={v.legal ? undefined : onDisclose} />
        <span className="text-[14px] text-text-muted">{v.counts.total}/60</span>
      </div>
      {v.legal ? (
        <p className="mt-[10px] text-[14px] text-text-secondary">
          This deck is legal for {FORMAT_META[detail.deck.formatCode].label}. All construction rules pass.
        </p>
      ) : (
        <div className="mt-[12px] flex flex-col gap-[10px]">
          <p className="text-[14px] text-text-muted">{errors.length} rule{errors.length === 1 ? '' : 's'} failing:</p>
          {errors.map((x, i) => (
            <div key={i} className="rounded-lg bg-surface-tertiary/60 p-[10px]" style={{ borderLeft: '3px solid var(--color-warning)' }}>
              <div className="text-[14px] font-bold text-text-primary">{x.message}</div>
              <div className="mt-[2px] text-[14px] text-text-muted">{x.rule}</div>
              <ViolationThumbs ids={x.card_ids} refs={cardRefs} />
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-[12px] flex flex-col gap-[6px] border-t border-divider-subtle pt-[10px]">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-[6px] text-[14px] text-text-muted">
              <Icon name="alert" size={13} className="mt-[1px] shrink-0" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-[12px] flex items-center justify-between border-t border-divider-subtle pt-[10px] text-[14px] text-text-muted">
        <span>Pokémon {v.counts.pokemon} · Trainer {v.counts.trainer} · Energy {v.counts.energy}</span>
      </div>
      <div className="mt-[4px] text-[14px] text-text-muted">Legality data verified {v.format_data_checked_at}.</div>
    </div>
  )
}

// ── Deck-list row with quantity stepper ───────────────────────────────────────
// The deck-scoped header of the card sheet. The thumbnails in the list are tiny,
// so the sheet leads with the card at a readable size and answers the questions
// that only make sense *inside a deck* — copies run, shortfall against your
// collection, and what those copies cost — before the shared card body.
// The expansion code printed on the card next to its collector number ("PBL"),
// shown alongside TCGdex's internal set id ("ME05") — which is the id the app
// keys on but is printed nowhere, so it is not what a player reads off the card
// in hand (issue #57). Outlined rather than filled so it does not read as a
// second regulation mark, which sits right beside it and IS a filled chip.
function PrintedSetCode({ code }: { code: string | null }) {
  if (!code) return null
  return (
    <span className="whitespace-nowrap rounded px-[4px] font-bold text-text-body ring-1 ring-border-default" title="Code printed on the card">
      {code}
    </span>
  )
}

function DeckCardContext({ card, offending, onSet }: {
  card: DeckCard; offending: boolean; onSet: (q: number) => void
}) {
  const short = Math.max(0, card.quantity - card.owned)
  const unit = card.price?.market ?? null
  const lineTotal = unit != null ? unit * card.quantity : null

  return (
    <div className="mt-[16px]">
      {/* One row per deck ENTRY for this card, mapped over a list rather than
          hard-coded, because that is the shape variant-scoped deck records need:
          2 Normal + 1 Reverse Holofoil is two entries, each with its own count.
          deck_card is still keyed on card today (see its schema comment), so the
          list has exactly one element until that migration lands.

          Neither the art nor the name/set heading is repeated here — the card
          body renders both immediately above this tab strip, and showing them
          again was the same card twice, once small and once large. */}
      <div className="flex items-center justify-between gap-[12px] rounded-lg bg-surface-secondary px-[12px] py-[10px]">
        <div className="min-w-0 text-[14px] text-text-muted">
          {card.setName} · {card.setId.toUpperCase()} {card.number}
          {card.setCode && <span className="ml-[6px] inline-block"><PrintedSetCode code={card.setCode} /></span>}
          {card.regulationMark && <span className="ml-[6px] rounded bg-surface-tertiary px-[4px] font-bold">{card.regulationMark}</span>}
        </div>
        {/* same mutation the deck row uses, so the tab is not read-only */}
        <div className="flex shrink-0 items-center gap-[8px]">
          <span className="text-[14px] text-text-muted">Copies</span>
          <button onClick={() => onSet(card.quantity - 1)} aria-label="Decrease copies" className="flex h-[28px] w-[28px] items-center justify-center rounded-md bg-surface-tertiary text-text-primary hover:bg-action-default-hover">
            <Icon name="minus" size={13} />
          </button>
          <span className="w-[22px] text-center text-[16px] font-bold text-text-primary">{card.quantity}</span>
          <button onClick={() => onSet(card.quantity + 1)} aria-label="Increase copies" className="flex h-[28px] w-[28px] items-center justify-center rounded-md bg-surface-tertiary text-text-primary hover:bg-action-default-hover">
            <Icon name="plus" size={13} />
          </button>
        </div>
      </div>

      {offending && (
        <div className="mt-[12px] flex items-start gap-[8px] rounded-lg bg-warning/10 px-[10px] py-[8px] text-[14px] text-warning">
          <span className="mt-[1px] shrink-0"><Icon name="alert" size={14} /></span>
          <span>This card breaks a rule for the deck's current format — see the legality panel.</span>
        </div>
      )}

      <div className="mt-[12px] grid grid-cols-3 gap-[8px]">
        <div className="rounded-lg bg-surface-secondary px-[10px] py-[8px]">
          <div className="text-[14px] text-text-muted">You own</div>
          <div className={`text-[15px] font-bold ${short === 0 ? 'text-change-positive' : 'text-text-primary'}`}>
            {card.owned} / {card.quantity}
          </div>
        </div>
        <div className="rounded-lg bg-surface-secondary px-[10px] py-[8px]">
          <div className="text-[14px] text-text-muted">Still needed</div>
          <div className={`text-[15px] font-bold ${short > 0 ? 'text-text-primary' : 'text-change-positive'}`}>
            {short === 0 ? 'None' : short}
          </div>
        </div>
        <div className="rounded-lg bg-surface-secondary px-[10px] py-[8px]">
          <div className="text-[14px] text-text-muted">Deck cost</div>
          <div className="text-[15px] font-bold text-change-positive">{fmtUsd(lineTotal)}</div>
          {unit != null && card.quantity > 1 && (
            <div className="text-[14px] text-text-muted">{fmtPrice(card.price)} each</div>
          )}
        </div>
      </div>
    </div>
  )
}

function DeckRow({ card, offending, onSet, onRemove, onOpen }: {
  card: DeckCard; offending: boolean; onSet: (q: number) => void; onRemove: () => void; onOpen: () => void
}) {
  return (
    <div className={`flex items-center gap-[10px] rounded-lg p-[6px] pr-[8px] ${offending ? 'bg-[rgba(255,157,66,0.10)] ring-1 ring-[rgba(255,157,66,0.5)]' : 'hover:bg-surface-tertiary/60'}`}>
      {/* Card identity opens the deck-scoped sheet; the steppers keep their own
          hit targets so tapping +/−/× never opens it by accident. */}
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-[10px] rounded-lg text-left"
        aria-label={`Details for ${card.name}`}
      >
        <img src={card.images.low} alt={card.name} loading="lazy" className="h-[52px] w-[37px] shrink-0 rounded object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[6px]">
            {basicEnergyType(card) && <EnergyIcon type={basicEnergyType(card)!} size={16} className="shrink-0" />}
            <span className="truncate text-[16px] font-semibold text-text-primary">{card.name}</span>
            {offending && <span className="shrink-0 text-warning"><Icon name="alert" size={13} /></span>}
          </div>
          {/* At 14px these four items no longer fit on one line at 390px, and
              each was breaking INSIDE itself ("SWSH1 / 1", "0/1 / owned").
              Each item is atomic — nowrap — and the row wraps BETWEEN them. */}
          <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-[14px] text-text-muted">
            <span className="whitespace-nowrap">{card.setId.toUpperCase()} {card.number}</span>
            <PrintedSetCode code={card.setCode} />
            {card.regulationMark && <span className="rounded bg-surface-tertiary px-[4px] font-bold">{card.regulationMark}</span>}
            <span className={`whitespace-nowrap ${card.have ? 'text-change-positive' : 'text-text-muted'}`}>{card.owned >= card.quantity ? 'owned' : `${card.owned}/${card.quantity} owned`}</span>
            <span className="whitespace-nowrap text-change-positive">{fmtPrice(card.price)}</span>
          </div>
        </div>
      </button>
      <div className="flex items-center gap-[5px]">
        <button onClick={() => onSet(card.quantity - 1)} aria-label="Decrease" className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-surface-tertiary text-text-primary hover:bg-action-default-hover">
          <Icon name="minus" size={13} />
        </button>
        <span className="w-[20px] text-center text-[14px] font-bold text-text-primary">{card.quantity}</span>
        <button onClick={() => onSet(card.quantity + 1)} aria-label="Increase" className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-surface-tertiary text-text-primary hover:bg-action-default-hover">
          <Icon name="plus" size={13} />
        </button>
        <button onClick={onRemove} aria-label={`Remove ${card.name}`} className="ml-[2px] flex h-[26px] w-[26px] items-center justify-center rounded-md text-icon-default hover:bg-action-danger hover:text-action-danger-text">
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Add-cards modal (reuses /search, can filter the pool by format) ───────────
function DeckAddModal({ format, onClose, onAdd, addingId }: {
  format: DeckFormat; onClose: () => void; onAdd: (cardId: string, qty: number) => void; addingId: string | null
}) {
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [qty, setQty] = useState(1)
  const [legalOnly, setLegalOnly] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300)
    return () => clearTimeout(t)
  }, [term])

  const { data, isFetching } = useQuery({
    queryKey: ['deckSearch', debounced],
    queryFn: ({ signal }) => {
      const p = new URLSearchParams({ pageSize: '30', sort: 'name' })
      if (debounced) p.set('q', debounced)
      return api.searchCards(p, signal)
    },
    enabled: debounced.length > 0,
  })

  const pool = MARK_POOL[format]
  const markLegal = (c: SearchCard) =>
    pool === null || c.category === 'Energy' || (c.regulationMark != null && pool.includes(c.regulationMark))
  const results = (data?.cards ?? []).filter((c) => (legalOnly ? markLegal(c) : true))

  return (
    <Modal title="Add Cards" onClose={onClose} wide>
      <div className="flex flex-col gap-[14px]">
        <div className="flex flex-wrap items-center gap-[12px]">
          <label className="relative flex h-[46px] flex-1 items-center" style={{ minWidth: 220 }}>
            <span className="pointer-events-none absolute left-[14px] text-icon-default"><Icon name="search" size={20} /></span>
            <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search cards by name or number…"
              className="h-[46px] w-full rounded-lg border border-border-default bg-surface-primary pl-[44px] pr-[12px] text-[15px] text-text-primary placeholder:text-text-muted" />
          </label>
          <label className="flex items-center gap-[8px] text-[14px] font-semibold text-text-secondary">
            <div className="flex items-center gap-[6px]">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-[30px] w-[30px] items-center justify-center rounded-md bg-surface-tertiary text-text-primary"><Icon name="minus" size={14} /></button>
              <span className="w-[20px] text-center text-[15px] font-bold text-text-primary">{qty}</span>
              <button type="button" onClick={() => setQty((q) => q + 1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-md bg-surface-tertiary text-text-primary"><Icon name="plus" size={14} /></button>
            </div>
            per add
          </label>
        </div>
        {pool !== null && (
          <label className="flex items-center gap-[8px] text-[14px] text-text-secondary">
            <input type="checkbox" checked={legalOnly} onChange={(e) => setLegalOnly(e.target.checked)} />
            Only cards with a {FORMAT_META[format].short}-legal regulation mark ({pool.join(', ')})
          </label>
        )}

        <div className="min-h-[220px]">
          {!debounced && <div className="py-[40px] text-center text-[14px] text-text-muted">Start typing to find cards to add.</div>}
          {debounced && isFetching && !data && <div className="py-[40px] text-center text-[14px] text-text-muted">Searching…</div>}
          {data && results.length === 0 && <div className="py-[40px] text-center text-[14px] text-text-muted">No cards match “{debounced}”{legalOnly ? ' with a legal mark' : ''}.</div>}
          <div className="grid gap-[12px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
            {results.map((c) => (
              <button key={c.cardId} onClick={() => onAdd(c.cardId, qty)} disabled={addingId === c.cardId}
                className="group flex flex-col rounded-lg border border-transparent p-[6px] text-left hover:border-border-default hover:bg-surface-tertiary disabled:opacity-50">
                <div className="relative overflow-hidden rounded-md">
                  <img src={c.images.low} alt={c.name} loading="lazy" className="aspect-[245/337] w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[14px] font-bold text-white opacity-0 group-hover:opacity-100">
                    {addingId === c.cardId ? 'Adding…' : `+ Add ${qty}`}
                  </span>
                  {c.regulationMark && <span className="absolute left-[4px] top-[4px] rounded bg-surface-primary/80 px-[4px] text-[14px] font-bold text-text-secondary">{c.regulationMark}</span>}
                </div>
                <span className="mt-[4px] truncate text-[16px] font-medium text-text-primary">{c.name}</span>
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-text-muted">{c.set.setId.toUpperCase()} {c.number}</span>
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

// ── Test-hand modal ───────────────────────────────────────────────────────────
function TestHandModal({ deckId, onClose }: { deckId: string; onClose: () => void }) {
  const [seed, setSeed] = useState<number | undefined>(undefined)
  const { data, isFetching } = useQuery({
    queryKey: ['testhand', deckId, seed],
    queryFn: ({ signal }) => api.testHand(deckId, seed, signal),
  })
  const reshuffle = () => { setSeed((Math.random() * 0xffffffff) >>> 0) }
  return (
    <Modal title="Test Hand" onClose={onClose} wide>
      <div className="flex flex-col gap-[16px]">
        {!data && <div className="py-[40px] text-center text-[14px] text-text-muted">Shuffling…</div>}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-x-[20px] gap-y-[6px] text-[14px]">
              <span className={data.mulligans > 0 ? 'font-bold text-warning' : 'font-bold text-change-positive'}>
                {data.mulligans === 0 ? 'Keepable hand' : `${data.mulligans} mulligan${data.mulligans === 1 ? '' : 's'}`}
              </span>
              <span className="text-text-muted">Opponent draws <span className="font-bold text-text-primary">{data.opponentDraws}</span></span>
              <span className="text-text-muted">Basics in deck <span className="font-bold text-text-primary">{data.basicPokemonCount}</span></span>
              <span className="text-text-muted">P(mulligan) <span className="font-bold text-text-primary">{data.mulliganChancePct}%</span></span>
            </div>
            <p className="text-[14px] text-text-muted">{data.note}</p>
            <div className="grid grid-cols-4 gap-[10px] sm:grid-cols-7">
              {data.hand.map((c, i) => (
                <div key={i} className="flex flex-col items-center gap-[4px]">
                  <div className={`relative overflow-hidden rounded-md ${c.isBasicPokemon ? 'ring-2 ring-change-positive' : ''}`}>
                    {c.image ? <img src={c.image} alt={c.name} className="aspect-[245/337] w-full object-cover" /> : <div className="aspect-[245/337] w-full bg-surface-tertiary" />}
                  </div>
                  <span className="line-clamp-2 text-center text-[14px] leading-[13px] text-text-secondary">{c.name}</span>
                </div>
              ))}
            </div>
            <div className="text-[14px] text-text-muted">Green ring = Basic Pokémon (a keepable hand needs at least one). Seed <span className="font-mono">{data.seed}</span>.</div>
          </>
        )}
        <div className="flex justify-end gap-[10px]">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={reshuffle} loading={isFetching}>
            <Icon name="shuffle" size={16} /> {isFetching ? 'Shuffling…' : 'Reshuffle'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Export modal ──────────────────────────────────────────────────────────────
function ExportModal({ deckId, onClose }: { deckId: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const { data, error, refetch } = useQuery({ queryKey: ['export', deckId], queryFn: ({ signal }) => api.exportDeck(deckId, 'ptcgl', signal) })
  const copy = async () => {
    if (!data) return
    try { await navigator.clipboard.writeText(data.text); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard unavailable */ }
  }
  return (
    <Modal title="Export to PTCG Live" onClose={onClose} wide>
      <div className="flex flex-col gap-[12px]">
        <p className="text-[14px] text-text-muted">Copy this list and paste it into Pokémon TCG Live’s deck importer.</p>
        <textarea readOnly value={data?.text ?? (error ? '' : 'Loading…')} rows={16}
          className="rounded-lg border border-border-default bg-surface-primary px-[14px] py-[10px] font-mono text-[14px] leading-[19px] text-text-primary" />
        {error && (
          <div className="flex items-center justify-between gap-[10px] text-[14px] text-warning">
            <span>Couldn’t export this deck.</span>
            <button onClick={() => void refetch()} className="rounded-full bg-surface-tertiary px-[12px] py-[6px] font-bold text-text-primary hover:bg-action-default-hover">Retry</button>
          </div>
        )}
        {data && data.warnings.length > 0 && (
          <div className="flex flex-col gap-[6px] rounded-lg border border-warning/40 bg-warning/10 p-[10px]">
            {data.warnings.map((w, i) => (
              <div key={i} className="flex gap-[8px] text-[14px] leading-[17px] text-text-primary">
                <Icon name="alert" size={14} className="mt-[1px] shrink-0 text-warning" />
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-[10px]">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={copy} disabled={!data}>
            <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied!' : 'Copy to Clipboard'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Buy-missing modal ─────────────────────────────────────────────────────────
// Deep-link-first (same UX as PurchaseSetMenu): the primary action opens the
// TCGplayer Mass Entry cart link(s) from GET /decks/:id/massentry; the copyable
// Mass Entry text is the fallback. Pricing still supplies the value summary and
// the per-card missing list.
function BuyMissingModal({ deckId, onClose }: { deckId: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const { data } = useQuery({ queryKey: ['pricing', deckId], queryFn: ({ signal }) => api.deckPricing(deckId, signal) })
  const { data: me, error: meError } = useQuery({ queryKey: ['deck-massentry', deckId], queryFn: ({ signal }) => api.deckMassEntry(deckId, signal) })
  const copy = async () => {
    const text = me?.text || data?.massEntryText
    if (!text) return
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard unavailable */ }
  }
  return (
    <Modal title="Buy Missing Cards" onClose={onClose} wide>
      <div className="flex flex-col gap-[14px]">
        {!data && <div className="py-[30px] text-center text-[14px] text-text-muted">Pricing…</div>}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-x-[24px] gap-y-[6px] text-[14px]">
              <span className="text-text-muted">Deck value <span className="font-bold text-change-positive">{fmtUsd(data.totalUsd)}</span></span>
              <span className="text-text-muted">You own <span className="font-bold text-change-positive">{fmtUsd(data.ownedValueUsd)}</span></span>
              <span className="text-text-muted">Missing <span className="font-bold text-warning">{fmtUsd(data.missingValueUsd)}</span> ({data.missing.length} card{data.missing.length === 1 ? '' : 's'})</span>
            </div>
            {data.missing.length === 0 ? (
              <div className="rounded-lg bg-surface-tertiary/60 p-[16px] text-center text-[14px] text-change-positive">You own every card in this deck!</div>
            ) : (
              <>
                {/* primary: cart deep link(s) */}
                {me && me.urls.length > 0 && (
                  <div className="flex flex-col gap-[8px]">
                    {me.urls.length > 1 && (
                      <p className="text-[14px] text-text-muted">The list is split into {me.urls.length} links — open each one; they all add to the same cart.</p>
                    )}
                    {me.urls.map((u, i) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer"
                        className="flex h-[44px] items-center justify-center gap-[8px] rounded-full bg-action-primary text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover">
                        <Icon name="cart" size={16} />
                        {me.urls.length > 1 ? `Open TCGplayer cart — link ${i + 1} of ${me.urls.length}` : 'Fill TCGplayer cart'}
                      </a>
                    ))}
                    <p className="rounded-lg bg-surface-tertiary px-[12px] py-[10px] text-[14px] leading-[17px] text-text-secondary">
                      Tip: once the cart fills, open TCGplayer’s <span className="font-semibold text-text-primary">Cart Optimizer</span> (inside
                      the cart) — its consolidation mode finds the fewest sellers, or a single seller with everything, so it all ships in one package.
                    </p>
                  </div>
                )}
                {meError != null && <p className="text-[12px] text-warning">Couldn’t build the cart link — use the copy list below instead.</p>}
                <div className="flex max-h-[300px] flex-col gap-[6px] overflow-y-auto pr-[4px]">
                  {data.missing.map((m) => (
                    <div key={m.cardId} className="flex items-center gap-[10px] rounded-lg bg-surface-tertiary/50 p-[6px] pr-[10px]">
                      <img src={m.image} alt={m.name} className="h-[44px] w-[31px] rounded object-cover" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[16px] font-semibold text-text-primary">{m.missingQty}× {m.name}</div>
                        <div className="text-[14px] text-text-muted">{m.setId.toUpperCase()} {m.number} · {fmtUsd(m.lineTotal)}</div>
                      </div>
                      {m.buyUrl && (
                        <a href={m.buyUrl} target="_blank" rel="noreferrer" className="flex h-[32px] items-center gap-[6px] rounded-full bg-surface-tertiary px-[12px] text-[12px] font-bold text-text-primary hover:bg-action-default-hover">
                          <Icon name="cart" size={14} /> Buy
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                {me && me.unlinkable.length > 0 && (
                  <div className="text-[12px] leading-[18px] text-text-muted">
                    <span className="font-semibold text-text-secondary">Not on TCGplayer ({me.unlinkable.length}):</span>{' '}
                    {me.unlinkable.map((u) => `${u.name} ${u.setId.toUpperCase()} ${u.number}`).join(', ')} — not in the cart link, buy elsewhere.
                  </div>
                )}
                {me?.warnings
                  .filter((w) => !w.includes('no TCGplayer product')) // already rendered above
                  .map((w) => <p key={w} className="text-[12px] text-warning">{w}</p>)}
                {/* fallback: copy the Mass Entry text */}
                <div className="flex items-center justify-between border-t border-divider-subtle pt-[10px]">
                  <span className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Mass Entry list (fallback)</span>
                  <button onClick={copy} className="flex items-center gap-[6px] text-[12px] font-semibold text-link hover:text-link-hover">
                    <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy list'}
                  </button>
                </div>
                <textarea readOnly value={me?.text ?? data.massEntryText} rows={Math.min(6, data.missing.length)}
                  className="w-full resize-none rounded-lg border border-border-default bg-surface-primary p-[10px] font-mono text-[12px] leading-[17px] text-text-secondary" />
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function DeckBuilder() {
  const { id } = useParams({ from: '/decks/$id' })
  const search = useSearch({ from: '/decks/$id' }) as DeckSearch
  const navigate = useNavigate({ from: '/decks/$id' })
  const qc = useQueryClient()
  const key = ['deck', id] as const
  const patchSearch = (p: Partial<DeckSearch>) => navigate({ search: { ...search, ...p } as never, resetScroll: false })

  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: ({ signal }) => api.deck(id, signal), placeholderData: keepPreviousData })

  const [showAdd, setShowAdd] = useState(false)
  const [showTest, setShowTest] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showBuy, setShowBuy] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const setDetail = (d: DeckDetail) => qc.setQueryData(key, d)
  const invalidateSideQueries = () => {
    qc.invalidateQueries({ queryKey: ['testhand', id] })
    qc.invalidateQueries({ queryKey: ['export', id] })
    qc.invalidateQueries({ queryKey: ['pricing', id] })
    qc.invalidateQueries({ queryKey: ['deck-massentry', id] })
    qc.invalidateQueries({ queryKey: ['decks'] })
    // Card edits amend or bump the deck version (the auto-bump rule), so the
    // version timeline + per-version battle rollups are stale after any of them.
    qc.invalidateQueries({ queryKey: ['deck-versions', id] })
    qc.invalidateQueries({ queryKey: ['battle-logs', id] })
  }

  const setQty = useMutation({
    mutationFn: ({ cardId, quantity }: { cardId: string; quantity: number }) => api.setDeckCardQuantity(id, cardId, quantity),
    onMutate: async ({ cardId, quantity }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<DeckDetail>(key)
      if (prev) {
        const cards = quantity <= 0 ? prev.cards.filter((c) => c.cardId !== cardId) : prev.cards.map((c) => (c.cardId === cardId ? { ...c, quantity } : c))
        qc.setQueryData<DeckDetail>(key, { ...prev, cards })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSuccess: (d) => { setDetail(d); invalidateSideQueries() },
  })
  const addCard = useMutation({
    mutationFn: ({ cardId, quantity }: { cardId: string; quantity: number }) => api.addDeckCard(id, cardId, quantity),
    onSuccess: (d) => { setAddingId(null); setDetail(d); invalidateSideQueries() },
    onError: () => setAddingId(null),
  })
  const removeCard = useMutation({
    mutationFn: (cardId: string) => api.removeDeckCard(id, cardId),
    onMutate: async (cardId) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<DeckDetail>(key)
      if (prev) qc.setQueryData<DeckDetail>(key, { ...prev, cards: prev.cards.filter((c) => c.cardId !== cardId) })
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSuccess: (d) => { setDetail(d); invalidateSideQueries() },
  })
  const updateDeck = useMutation({
    mutationFn: (body: Parameters<typeof api.updateDeck>[1]) => api.updateDeck(id, body),
    onSuccess: (d) => { setDetail(d); invalidateSideQueries() },
  })
  const deleteDeck = useMutation({
    mutationFn: () => api.deleteDeck(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['decks'] }); navigate({ to: '/decks' }) },
  })

  const detail = data
  const deck = detail?.deck

  // Battle count for the tab label. Same key/params as BattlesTab's default view
  // (all versions, page 1) so the two share one cache entry.
  const { data: logsData } = useQuery({
    queryKey: ['battle-logs', id, 'all', 1],
    queryFn: ({ signal }) => api.battleLogs(id, {}, signal),
    enabled: Boolean(detail),
  })
  const battleCount = logsData?.totals.total

  const tabs: { key: DeckTab; label: string }[] = [
    { key: 'cards', label: 'Cards' },
    { key: 'strategy', label: 'Strategy' },
    { key: 'battles', label: battleCount != null ? `Battles (${battleCount})` : 'Battles' },
    { key: 'history', label: 'History' },
  ]

  // Strategy saves return the full DeckDetail; the current version's snapshot
  // was amended in place, so version details are stale.
  const onStrategySaved = (d: DeckDetail) => {
    setDetail(d)
    qc.invalidateQueries({ queryKey: ['deck-versions', id] })
  }

  // Revert returns DeckDetail (+ revert bookkeeping) — adopt it and land the
  // user on the Cards tab to see the restored list.
  const onReverted = (d: DeckDetail & { revert: RevertResult }) => {
    setDetail(d)
    invalidateSideQueries()
    patchSearch({ tab: 'cards' })
  }

  // cards that any error violation references → highlight in place (BEHAVIOR-SPEC §8.4)
  const offending = useMemo(() => {
    const set = new Set<string>()
    if (!detail) return set
    for (const v of detail.validation.violations) {
      if (v.severity !== 'error' || !v.card_ids) continue
      for (const cid of v.card_ids) {
        const ref = detail.cardRefs[String(cid)]
        if (ref) set.add(ref.cardId)
      }
    }
    return set
  }, [detail])

  // Resolved from the live deck (not frozen at open time) so the sheet's copies,
  // owned count and cost re-render as the underlying mutations settle.
  const sheetCard = useMemo(
    () => (search.card ? (detail?.cards.find((c) => c.cardId === search.card) ?? null) : null),
    [detail, search.card],
  )

  const grouped = useMemo(() => {
    const cards = detail?.cards ?? []
    const q = search.q.trim().toLowerCase()
    const base = search.missing ? cards.filter((c) => c.owned < c.quantity) : cards
    const filtered = q ? base.filter((c) => c.name.toLowerCase().includes(q) || c.number.toLowerCase().includes(q)) : base
    const sortFn = (a: DeckCard, b: DeckCard) => {
      if (search.sort === 'name') return a.name.localeCompare(b.name)
      if (search.sort === 'quantity') return b.quantity - a.quantity
      if (search.sort === 'price') return (b.price?.market ?? 0) - (a.price?.market ?? 0)
      return (a.numberSort ?? '').localeCompare(b.numberSort ?? '')
    }
    const by = (s: DeckCard['section']) => filtered.filter((c) => c.section === s).sort(sortFn)
    return { pokemon: by('pokemon'), trainer: by('trainer'), energy: by('energy'), shown: filtered.length }
  }, [detail, search.q, search.sort, search.missing])

  return (
    <Content cap={1240}>
      <div className="mb-[16px]"><BackPill to="/decks" label="Deck Builder" /></div>
      {isLoading && !data && <Spinner label="Loading deck…" />}
      {error && <ErrorState message={(error as Error).message} />}

      {detail && deck && (
        <div className="flex flex-col gap-[20px] lg:flex-row lg:items-start">
          {/* left: deck list */}
          <div className="min-w-0 flex-1">
            {/* The kebab shares the badge row rather than floating beside the whole
                header block. Under the old `items-start` it aligned its TOP edge to
                the badges' top, and it is 40px tall against their ~26px, so its
                centre sat ~7px below theirs — visibly off, with nothing to read the
                offset as deliberate (issue #48). Sitting in the row it belongs to,
                `items-center` does the alignment for free, and the deck name below
                gets the full width instead of ending at the kebab. */}
            <div>
              <div className="flex items-center justify-between gap-[12px]">
                <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                  <span className="inline-flex items-center gap-[5px] rounded-full bg-surface-tertiary px-[10px] py-[3px] text-[14px] font-bold text-text-secondary">
                    {FORMAT_META[deck.formatCode].short}
                    {deck.formatCode === 'glc' && deck.glcType && (
                      <>
                        <span>·</span>
                        <EnergyIcon type={deck.glcType} size={14} />
                        {deck.glcType}
                      </>
                    )}
                  </span>
                  <LegalBadge legal={deck.legal} />
                </div>
                <KebabMenu
                  ariaLabel="Deck options"
                  size={40}
                  items={[
                    { key: 'delete', label: 'Delete deck', icon: 'close', danger: true, onSelect: () => setShowDelete(true) },
                  ]}
                />
              </div>
              <div className="mt-[6px] min-w-0">
                {editingName ? (
                  <input
                    autoFocus defaultValue={deck.name} onFocus={() => setNameDraft(deck.name)}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => { setEditingName(false); if (nameDraft.trim() && nameDraft !== deck.name) updateDeck.mutate({ name: nameDraft.trim() }) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    className="w-full max-w-[420px] rounded-lg border border-border-default bg-surface-primary px-[10px] py-[4px] text-[26px] font-bold text-text-primary" />
                ) : (
                  <h1 onClick={() => setEditingName(true)} title="Click to rename" className="cursor-text text-[28px] font-bold leading-[36px] text-text-primary">{deck.name}</h1>
                )}
              </div>
            </div>

            {/* tabs — Cards · Strategy · Battles (n) · History */}
            <Tabs
              items={tabs}
              value={search.tab}
              onChange={(key) => patchSearch({ tab: key as DeckTab })}
              className="mt-[16px]"
            />

            {search.tab === 'strategy' && <StrategyTab deckId={id} strategyMd={deck.strategyMd} onSaved={onStrategySaved} />}
            {search.tab === 'battles' && <BattlesTab deckId={id} currentVersion={deck.version} />}
            {search.tab === 'history' && <HistoryTab deckId={id} onReverted={onReverted} />}

            {search.tab === 'cards' && (
            <>
            {/* controls */}
            <div className="mt-[16px] flex flex-wrap items-center gap-[10px]">
              <button onClick={() => setShowAdd(true)} className="flex h-[42px] items-center gap-[8px] rounded-full bg-action-primary px-[18px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover">
                <Icon name="plus" size={16} /> Add Cards
              </button>
              <label className="relative flex h-[42px] flex-1 items-center" style={{ minWidth: 180, maxWidth: 320 }}>
                <span className="pointer-events-none absolute left-[12px] text-icon-default"><Icon name="search" size={18} /></span>
                <input value={search.q} onChange={(e) => patchSearch({ q: e.target.value })} placeholder="Filter deck…"
                  className="h-[42px] w-full rounded-lg border border-border-default bg-surface-primary pl-[38px] pr-[12px] text-[14px] text-text-primary placeholder:text-text-muted" />
              </label>
              <select value={search.sort} onChange={(e) => patchSearch({ sort: e.target.value as DeckSearch['sort'] })}
                className="h-[42px] rounded-lg border border-border-default bg-surface-primary px-[10px] text-[14px] text-text-primary">
                <option value="section">Sort: Section</option>
                <option value="name">Sort: Name</option>
                <option value="quantity">Sort: Quantity</option>
                <option value="price">Sort: Price</option>
              </select>
              <button onClick={() => patchSearch({ missing: !search.missing })} aria-pressed={search.missing}
                title="Show only cards you still need copies of"
                className={`h-[42px] rounded-lg border px-[14px] text-[14px] font-semibold ${search.missing ? 'border-action-primary bg-action-primary text-action-primary-text' : 'border-border-default bg-surface-primary text-text-secondary hover:bg-surface-tertiary'}`}>
                Missing
              </button>
            </div>

            {/* sections */}
            <div className="mt-[18px] flex flex-col gap-[18px]">
              {detail.cards.length === 0 ? (
                <div className="flex flex-col items-center gap-[10px] rounded-xl border border-dashed border-border-default py-[60px] text-center">
                  <Icon name="deck" size={40} className="text-icon-muted" />
                  <div className="text-[16px] font-bold text-text-primary">This deck is empty</div>
                  <button onClick={() => setShowAdd(true)} className="mt-[4px] flex h-[42px] items-center gap-[8px] rounded-full bg-action-primary px-[18px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover">
                    <Icon name="plus" size={16} /> Add Cards
                  </button>
                </div>
              ) : grouped.shown === 0 ? (
                // Filters composed to nothing. Distinguish "deck fully owned"
                // (Missing on, no text filter) from "no matches".
                <div className="flex flex-col items-center gap-[8px] rounded-xl border border-dashed border-border-default py-[40px] text-center">
                  {search.missing && !search.q.trim() && detail.cards.every((c) => c.owned >= c.quantity) ? (
                    <>
                      <Icon name="check" size={32} className="text-change-positive" />
                      <div className="text-[15px] font-bold text-text-primary">You own every card in this deck</div>
                      <div className="text-[14px] text-text-muted">Nothing is missing — turn off the Missing filter to see the full list.</div>
                    </>
                  ) : (
                    <>
                      <Icon name="search" size={32} className="text-icon-muted" />
                      <div className="text-[15px] font-bold text-text-primary">No cards match</div>
                      <div className="text-[14px] text-text-muted">
                        {search.missing ? 'No missing cards match the current filter.' : 'Nothing in this deck matches the filter.'}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                (['pokemon', 'trainer', 'energy'] as const).map((sec) => {
                  const rows = grouped[sec]
                  if (rows.length === 0) return null
                  const count = rows.reduce((n, c) => n + c.quantity, 0)
                  return (
                    <div key={sec}>
                      <div className="mb-[8px] flex items-center gap-[8px] text-[14px] font-bold text-text-secondary">
                        <span className="uppercase tracking-wide">{SECTION_TITLE[sec]}</span>
                        <span className="text-text-muted">({count})</span>
                      </div>
                      <div className="flex flex-col gap-[4px]">
                        {rows.map((c) => (
                          <DeckRow key={c.cardId} card={c} offending={offending.has(c.cardId)}
                            onSet={(q) => setQty.mutate({ cardId: c.cardId, quantity: Math.max(0, Math.min(60, q)) })}
                            onRemove={() => removeCard.mutate(c.cardId)}
                            onOpen={() => patchSearch({ card: c.cardId })} />
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            </>
            )}
          </div>

          {/* right: sticky sidebar */}
          <div className="flex w-full flex-col gap-[14px] lg:sticky lg:top-[92px] lg:w-[340px] lg:shrink-0">
            <div className="rounded-xl border border-border-default bg-surface-secondary p-[16px]">
              <FormatSelector
                deck={deck} glcTypes={detail.glcTypes}
                onFormat={(f) => updateDeck.mutate({ formatCode: f })}
                onGlcType={(t) => updateDeck.mutate({ formatCode: 'glc', glcType: t })}
              />
            </div>

            <LegalityPanel detail={detail} onDisclose={() => { /* already expanded */ }} />

            <div className="rounded-xl border border-border-default bg-surface-secondary p-[16px]">
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-text-muted">Total</span>
                <span className={`font-bold ${detail.counts.total === 60 ? 'text-text-primary' : 'text-warning'}`}>{detail.counts.total}/60</span>
              </div>
              <div className="mt-[6px] flex items-center justify-between text-[14px]">
                <span className="text-text-muted">Deck value</span>
                <span className="font-bold text-change-positive">{fmtUsd(deck.valueUsd)}</span>
              </div>
              <div className="mt-[14px] flex flex-col gap-[8px]">
                <button onClick={() => setShowTest(true)} className="flex h-[42px] items-center justify-center gap-[8px] rounded-full bg-surface-tertiary text-[14px] font-bold text-text-primary hover:bg-action-default-hover">
                  <Icon name="shuffle" size={16} /> Test Hand
                </button>
                <button onClick={() => setShowBuy(true)} className="flex h-[42px] items-center justify-center gap-[8px] rounded-full bg-surface-tertiary text-[14px] font-bold text-text-primary hover:bg-action-default-hover">
                  <Icon name="cart" size={16} /> Buy Missing Cards
                </button>
                <button onClick={() => setShowExport(true)} className="flex h-[42px] items-center justify-center gap-[8px] rounded-full bg-surface-tertiary text-[14px] font-bold text-text-primary hover:bg-action-default-hover">
                  <Icon name="download" size={16} /> Export to PTCG Live
                </button>
                <a href={api.deckPdfUrl(id)} target="_blank" rel="noreferrer" className="flex h-[42px] items-center justify-center gap-[8px] rounded-full bg-surface-tertiary text-[13px] font-bold text-text-primary hover:bg-action-default-hover">
                  <Icon name="printer" size={16} /> Export PDF
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAdd && deck && (
        <DeckAddModal format={deck.formatCode} addingId={addingId} onClose={() => setShowAdd(false)}
          onAdd={(cardId, qty) => { setAddingId(cardId); addCard.mutate({ cardId, quantity: qty }) }} />
      )}
      {showTest && <TestHandModal deckId={id} onClose={() => setShowTest(false)} />}
      {showExport && <ExportModal deckId={id} onClose={() => setShowExport(false)} />}
      {showBuy && <BuyMissingModal deckId={id} onClose={() => setShowBuy(false)} />}
      {showDelete && deck && (
        <ConfirmModal title="Delete deck" message={`Delete “${deck.name}”? This can't be undone.`} confirmLabel="Delete Deck"
          busy={deleteDeck.isPending} onClose={() => setShowDelete(false)} onConfirm={() => deleteDeck.mutate()} />
      )}

      {/* Deck-scoped card sheet, driven by ?card=. Rendered here so opening and
          closing it never unmounts the builder — scroll, filters and tab survive.
          The card must still be in the deck; a stale ?card= (e.g. after a remove)
          simply resolves to nothing and the param is dropped on close. */}
      {sheetCard && (
        <CardSheet
          cardId={sheetCard.cardId}
          ariaLabel={`${sheetCard.name} in this deck`}
          onClose={() => patchSearch({ card: undefined })}
          contextSlot={
            <DeckCardContext
              card={sheetCard}
              offending={offending.has(sheetCard.cardId)}
              onSet={(q) => setQty.mutate({ cardId: sheetCard.cardId, quantity: Math.max(0, Math.min(60, q)) })}
            />
          }
        />
      )}
    </Content>
  )
}

export { DECK_SEARCH_DEFAULTS }
