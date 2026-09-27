import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CreateDeckBody, type DeckFormat, type DeckImportSummary, type DeckImportFixResult, type DeckSummary } from '../lib/api'
import { confirmedDecklistText } from '../lib/deckImportFixes'
import { decklistLineRange } from '../lib/decklistLines'
import { deckeEntitled, onDeckeEntitlementChange } from '../character/host/entitlement'
import { startDeckeErrand, endDeckeErrand } from '../character/host/errand'
import { Content, Spinner, ErrorState, Button, EmptyState, SelectableCard } from '../components/ui'
import { Modal } from '../components/ListModals'
import { RecycleBin } from '../components/RecycleBin'
import { Icon } from '../components/Icon'
import { EnergyIcon } from '../components/EnergyIcon'
import { fmtUsd } from '../lib/format'
import { FORMAT_META, LegalBadge } from './deckShared'
import { DECK_SEARCH_DEFAULTS } from './deckSearch'
import { RecordSpans } from './deck/intelShared'
import { useLateEntrance } from '../lib/lateEntrance'

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
        <span className="absolute right-[10px] top-[10px] inline-flex items-center gap-[4px] rounded-full bg-surface-primary/80 px-[10px] py-[3px] text-[14px] font-bold text-text-secondary backdrop-blur-sm">
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
          <span className="font-display truncate text-[16px] font-bold text-text-primary">{deck.name}</span>
          {deck.isFavorite && <Icon name="star-filled" size={16} className="shrink-0 text-action-primary" />}
        </div>
        {deck.description && <p className="line-clamp-2 text-[14px] text-text-muted">{deck.description}</p>}
        <div className="mt-auto flex items-center justify-between pt-[6px] text-[12px]">
          <span className="font-semibold text-text-secondary">
            {deck.totalCount}/60 cards
            {rec && (
              <>
                {' · '}
                <RecordSpans wins={rec.wins} losses={rec.losses} ties={rec.ties} />
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
          <span className="text-[14px] font-semibold text-text-secondary">Name</span>
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
          <span className="text-[14px] font-semibold text-text-secondary">Format</span>
          <div className="grid grid-cols-2 gap-[8px]">
            {FORMATS.map((f) => (
              <SelectableCard key={f} active={formatCode === f} onClick={() => setFormatCode(f)}>
                <div className="text-[14px] font-bold text-text-primary">{FORMAT_META[f].label}</div>
                <div className="text-[14px] text-text-muted">{FORMAT_META[f].blurb}</div>
              </SelectableCard>
            ))}
          </div>
        </div>
        {error && <div className="text-[14px] text-error">{error}</div>}
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
  const listRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // ── CHECK FIRST, THEN CREATE ──────────────────────────────────────────────
  //
  // This dialog promised "unresolved lines are reported, never dropped", and
  // the import then navigated straight to the new deck: a line that matched no
  // card was simply missing from it, and the reader met "Not Legal — Add 2"
  // with no idea which two. So the list is resolved first, without writing
  // anything. A clean list imports at once; otherwise every unmatched line is
  // shown here, while the text is still in front of them, to fix or to skip.
  const [checked, setChecked] = useState<{ text: string; formatCode: DeckFormat; summary: DeckImportSummary } | null>(null)
  const check = useMutation({ mutationFn: (asked: { text: string; formatCode: DeckFormat }) => api.checkDeckImport(asked) })
  const fix = useMutation({ mutationFn: (asked: { text: string; formatCode: DeckFormat }) => api.fixDeckImport(asked) })
  const [entitled, setEntitled] = useState(false)
  const [fixResult, setFixResult] = useState<{ text: string; formatCode: DeckFormat; result: DeckImportFixResult } | null>(null)
  const [undone, setUndone] = useState<ReadonlySet<number>>(new Set())
  const [fixError, setFixError] = useState<string | null>(null)
  const [errandActive, setErrandActive] = useState(false)
  const reviewRevision = useRef(0)
  const close = () => { reviewRevision.current++; onClose() }
  useEffect(() => {
    if (errandActive) startDeckeErrand()
    else endDeckeErrand()
  }, [errandActive])
  useEffect(() => {
    let active = true
    const refresh = () => { void deckeEntitled().then(ok => { if (active) setEntitled(ok) }) }
    refresh()
    const unsubscribe = onDeckeEntitlementChange(refresh)
    return () => { active = false; unsubscribe(); endDeckeErrand() }
  }, [])
  // The form as it is NOW, for a check that comes back after the reader kept
  // typing: its result describes the text it was sent, not this one.
  const latest = useRef({ text, formatCode, name })
  latest.current = { text, formatCode, name }
  const submit = () => {
    const now = latest.current
    onSubmit({ text: now.text, formatCode: now.formatCode, name: now.name.trim() || undefined })
  }

  const unmatched = checked?.summary.unresolvedLines ?? []
  // Resolution depends on the text AND the format, so either change means the
  // list shown below describes a list that no longer exists.
  const stale = checked !== null && (checked.text !== text || checked.formatCode !== formatCode)
  const skipping = checked !== null && !stale && unmatched.length > 0
  const matchedCards = checked?.summary.totalCards ?? 0
  const reviewing = fixResult !== null && !stale && fixResult.text === text && fixResult.formatCode === formatCode
  useEffect(() => { if (fixResult && !reviewing) setErrandActive(false) }, [fixResult, reviewing])
  const acceptedFixes = reviewing ? fixResult.result.fixes.filter(f => !undone.has(f.lineIndex)) : []
  const confirmedText = reviewing ? confirmedDecklistText(text, fixResult.result.fixes, undone) : null
  const fixedByLine = new Map(acceptedFixes.map(f => [f.lineIndex, f]))
  const unmatchedWithIndexes = (() => {
    const wanted = new Map<string, number>()
    unmatched.forEach(line => wanted.set(line.trim(), (wanted.get(line.trim()) ?? 0) + 1))
    const rows: { line: string; lineIndex: number }[] = []
    text.split('\n').forEach((raw, lineIndex) => {
      const key = raw.trim(), left = wanted.get(key) ?? 0
      if (left > 0) { rows.push({ line: key, lineIndex }); wanted.set(key, left - 1) }
    })
    return rows
  })()
  const remaining = unmatchedWithIndexes.filter(row => !fixedByLine.has(row.lineIndex)).length
  const askDecke = () => {
    if (!checked || stale || fix.isPending || !entitled) return
    const asked = { text, formatCode }
    setFixError(null)
    setFixResult(null)
    setUndone(new Set())
    setErrandActive(true)
    fix.mutate(asked, {
      onSuccess: result => {
        const now = latest.current
        if (now.text !== asked.text || now.formatCode !== asked.formatCode) { setErrandActive(false); return }
        // The server may abstain, but it may never rewrite a line outside the
        // checked unmatched set or reuse a physical occurrence.
        const allowed = new Map(unmatchedWithIndexes.map(row => [row.lineIndex, row.line]))
        if (result.fixes.some(f => allowed.get(f.lineIndex) !== f.original.trim()) ||
          confirmedDecklistText(asked.text, result.fixes, new Set()) === null) {
          setErrandActive(false)
          setFixError('Deck-E returned a fix for a different line. Please check the list again.')
          return
        }
        if (result.fixes.length === 0) {
          setErrandActive(false)
          setFixError('Deck-E could not find a safe match for these lines. You can edit them yourself or import the matched cards.')
          return
        }
        setFixResult({ ...asked, result })
      },
      onError: e => {
        setErrandActive(false)
        if (latest.current.text === asked.text && latest.current.formatCode === asked.formatCode)
          setFixError((e as Error).message || 'Deck-E could not check this list. You can edit the lines yourself.')
      },
    })
  }
  const confirmFixes = () => {
    if (!confirmedText || !reviewing || check.isPending) return
    setErrandActive(false)
    const asked = { text: confirmedText, formatCode }
    const source = { text, formatCode }
    const revision = reviewRevision.current
    check.mutate(asked, {
      onSuccess: ({ import: summary }) => {
        const now = latest.current
        if (now.text !== source.text || now.formatCode !== source.formatCode || reviewRevision.current !== revision) return
        // Move the accepted text into the editor, then show any lines that still
        // need the reader. Only a clean server check may create a deck.
        setText(asked.text)
        latest.current = { ...now, text: asked.text }
        setFixResult(null)
        setUndone(new Set())
        setChecked({ ...asked, summary })
        if (summary.unresolvedLines.length === 0) onSubmit({ ...asked, name: now.name.trim() || undefined })
      },
    })
  }

  const run = () => {
    if (reviewing) return confirmFixes()
    if (skipping) return submit()
    const asked = { text, formatCode }
    check.mutate(asked, {
      onSuccess: ({ import: summary }) => {
        if (latest.current.text !== asked.text || latest.current.formatCode !== asked.formatCode) return
        setChecked({ ...asked, summary })
        // Only a clean check of the list still on screen imports by itself. An
        // edit made while it ran leaves the result stale, and the reader's next
        // press checks what they actually wrote.
        const now = latest.current
        if (summary.unresolvedLines.length === 0 && now.text === asked.text && now.formatCode === asked.formatCode) submit()
      },
    })
  }
  const editLine = (lineIndex: number) => {
    const el = listRef.current
    if (!el) return
    const raw = el.value.split('\n')[lineIndex]
    const range = raw === undefined ? null : decklistLineRange(el.value, raw, lineIndex)
    if (!range) return
    el.focus()
    el.setSelectionRange(range[0], range[1])
  }
  const undoFix = (lineIndex: number) => {
    reviewRevision.current++
    setUndone(prev => new Set([...prev, lineIndex]))
  }
  const them = unmatched.length === 1 ? 'it' : 'them'
  // On a phone the panel lands under a tall textarea; bring the lines into view.
  useEffect(() => {
    if (checked && checked.summary.unresolvedLines.length > 0) panelRef.current?.scrollIntoView({ block: 'nearest' })
  }, [checked])
  useEffect(() => {
    if (reviewing && window.innerWidth <= 500) panelRef.current?.scrollIntoView({ block: 'end' })
  }, [reviewing])

  // The actions are pinned below the scroll area: on a phone the unmatched-line
  // panel pushes them off screen, right as it tells the reader to use them.
  const formId = 'deck-import-form'
  return (
    <Modal
      title="Import from PTCG Live"
      onClose={close}
      wide
      footer={
        <div className="flex justify-end gap-[10px]">
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit" form={formId} disabled={!text.trim() || (reviewing ? !confirmedText : skipping && matchedCards === 0) || fix.isPending} loading={busy || check.isPending}>
            {check.isPending ? 'Checking…' : busy ? 'Importing…' : reviewing ? (remaining ? 'Confirm fixes' : 'Confirm and import') : skipping ? `Import without ${them}` : 'Import Deck'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          run()
        }}
        className="flex flex-col gap-[16px]"
      >
        <p className="text-[14px] text-text-muted">
          Paste a decklist exported from Pokémon TCG Live (or the Limitless deck builder). Each line
          resolves to a catalogue card; any line that doesn't is shown to you before the deck is created.
        </p>
        <div className="flex flex-wrap items-end gap-[16px]">
          <label className="flex flex-1 flex-col gap-[6px]" style={{ minWidth: 200 }}>
            <span className="text-[14px] font-semibold text-text-secondary">Deck name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Imported Deck" maxLength={120}
              className="h-[42px] rounded-lg border border-border-default bg-surface-primary px-[14px] text-[14px] text-text-primary placeholder:text-text-muted" />
          </label>
          <label className="flex flex-col gap-[6px]">
            <span className="text-[14px] font-semibold text-text-secondary">Format</span>
            <select value={formatCode} onChange={(e) => { setFormatCode(e.target.value as DeckFormat); setFixResult(null); setErrandActive(false) }}
              className="h-[42px] rounded-lg border border-border-default bg-surface-primary px-[12px] text-[14px] text-text-primary">
              {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_META[f].label}</option>)}
            </select>
          </label>
        </div>
        <textarea
          ref={listRef}
          autoFocus
          aria-label="Decklist"
          value={text}
          onChange={(e) => { setText(e.target.value); setFixResult(null); setErrandActive(false) }}
          rows={checked ? 6 : 12}
          placeholder={'Pokémon: 6\n3 Charizard ex OBF 125\n…\n\nTrainer: …\n\nEnergy: …\n\nTotal Cards: 60'}
          className="rounded-lg border border-border-default bg-surface-primary px-[14px] py-[10px] font-mono text-[14px] leading-[19px] text-text-primary placeholder:text-text-muted"
        />
        {checked && unmatched.length > 0 && (
          <div ref={panelRef} role="alert" className="rounded-xl border border-border-default bg-surface-secondary p-[14px]" style={{ borderLeft: '3px solid var(--color-warning)' }}>
            <div className="flex items-start justify-between gap-[12px]">
              <div className="flex min-w-0 flex-col gap-[8px]">
                <div className="flex items-center gap-[8px] text-[14px] font-bold text-text-primary">
                  <Icon name="alert" size={16} className="shrink-0 text-warning" />
                  {reviewing ? 'Review Deck-E’s fixes' : <>{unmatched.length} line{unmatched.length === 1 ? " doesn't" : "s don't"} match a card</>}
                </div>
                {!stale && entitled && !reviewing && (
                  <button type="button" onClick={askDecke} disabled={fix.isPending || check.isPending}
                    className="self-start rounded-full bg-action-primary px-[14px] py-[8px] text-[14px] font-bold text-white disabled:opacity-50">
                    {fix.isPending ? 'Deck-E is checking…' : 'Ask Deck-E'}
                  </button>
                )}
              </div>
              {entitled && errandActive && <div data-decke-errand aria-hidden="true" className="h-[92px] w-[72px] shrink-0 sm:h-[112px] sm:w-[88px]" />}
            </div>
            {fix.isPending && !stale && <p role="status" className="mt-[8px] text-[14px] text-text-muted">Deck-E is checking {unmatched.length} line{unmatched.length === 1 ? '' : 's'}…</p>}
            {reviewing && <p aria-live="polite" className="mt-[8px] text-[14px] text-text-secondary">
              Does this look correct? {acceptedFixes.length === 0
                ? 'No fixes are selected.'
                : unmatched.length === 1
                  ? 'Deck-E suggested a fix for this line.'
                  : `Deck-E suggested fixes for ${acceptedFixes.length} of ${unmatched.length} lines.`}
              {remaining > 0 && ` ${remaining} line${remaining === 1 ? '' : 's'} still need${remaining === 1 ? 's' : ''} your help.`}
            </p>}
            <ul className="mt-[10px] flex flex-col gap-[8px]">
              {unmatchedWithIndexes.map(({ line, lineIndex }) => {
                const found = fixedByLine.get(lineIndex)
                return (
                  <li key={lineIndex} className="flex min-w-0 flex-col gap-[6px] rounded-lg bg-surface-primary p-[10px]">
                    {found ? <>
                      <div className="flex min-w-0 items-start gap-[10px]">
                        {found.card.image && <img src={found.card.image} alt="" className="h-[56px] w-[40px] shrink-0 rounded object-cover" />}
                        <div className="min-w-0 flex-1">
                          <div className="break-words font-mono text-[13px] text-text-muted line-through" aria-label={`Was: ${line}`}>{line}</div>
                          <div className="break-words font-mono text-[14px] font-semibold text-text-primary">{found.replacement}</div>
                          <div className="text-[13px] text-text-muted">{found.reason}</div>
                        </div>
                        <button type="button" onClick={() => undoFix(lineIndex)} disabled={check.isPending}
                          className="shrink-0 rounded-full px-[8px] py-[6px] text-[14px] font-semibold text-link hover:bg-action-default-hover disabled:opacity-50">Undo</button>
                      </div>
                    </> : <div className="flex min-w-0 items-center justify-between gap-[10px]">
                      <code className="min-w-0 break-words font-mono text-[14px] text-text-primary">{line}</code>
                      <button type="button" onClick={() => editLine(lineIndex)} aria-label={`Edit the line ${line}`}
                        className="h-[36px] shrink-0 rounded-full px-[12px] text-[14px] font-semibold text-link hover:bg-action-default-hover hover:text-link-hover">Edit</button>
                    </div>}
                  </li>
                )
              })}
            </ul>
            <p className="mt-[10px] text-[14px] text-text-muted">
              {stale
                ? 'You changed the list, so importing checks it again.'
                : reviewing
                  ? remaining ? 'Confirm these fixes to recheck the list. You can then edit or skip any remaining lines.' : 'Undo any line Deck-E got wrong before confirming.'
                : matchedCards > 0
                  ? `Fix ${them} above and import again, or import the other ${matchedCards} card${matchedCards === 1 ? '' : 's'} without ${them}.`
                  : 'Nothing in this list matched a card yet. Fix the lines above to import it.'}
            </p>
          </div>
        )}
        {fixError && !stale && <div role="alert" className="text-[14px] text-error">{fixError}</div>}
        {(check.error || error) && <div className="text-[14px] text-error">{((check.error as Error | null)?.message ?? error)}</div>}
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
  // Issue #49: on a cold cache the wrapper's entrance is over ~6s before the
  // first deck card exists, so the content itself has to introduce it.
  const enter = useLateEntrance(isLoading)

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
      {error && <ErrorState message={(error as Error).message} className={enter} />}

      {data && decks.length === 0 && (
        <EmptyState
          className={enter}
          icon="deck"
          title="No Decks Yet"
          body="Build one from scratch, or import a Pokémon TCG Live decklist."
        >
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            <Icon name="download" size={18} /> Import
          </Button>
          <Button onClick={() => setShowNew(true)}>
            <Icon name="plus" size={18} /> New Deck
          </Button>
        </EmptyState>
      )}

      {decks.length > 0 && (
        <div
          className={`grid gap-[20px] ${enter}`}
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
          data-decke-deck-list
          data-decke-landmark="[data-decke-deck-list]"
          data-decke-label="the deck list"
          data-decke-rank="container"
        >
          {decks.map((d) => <DeckCard key={d.id} deck={d} />)}
        </div>
      )}

      {/* Deleting a deck no longer takes its version history and battle logs
          with it (migration 038) — this is the undo, and the only route to a
          real, permanent delete. */}
      <RecycleBin
        kind="deck"
        load={async (signal) =>
          (await api.deletedDecks(signal)).decks.map((d) => ({
            id: d.id,
            name: d.name,
            detail: `${d.formatCode} · ${d.totalCount} card${d.totalCount === 1 ? '' : 's'} · v${d.version}`,
          }))
        }
        restore={api.restoreDeck}
        purge={api.purgeDeck}
        invalidate={['decks']}
      />

      {showNew && <NewDeckModal busy={create.isPending} error={err} onClose={() => setShowNew(false)} onSubmit={(b) => create.mutate(b)} />}
      {showImport && <ImportModal busy={importDeck.isPending} error={err} onClose={() => setShowImport(false)} onSubmit={(b) => importDeck.mutate(b)} />}
    </Content>
  )
}
