import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CreateDeckBody, type DeckFormat, type DeckSummary } from '../lib/api'
import { deriveImportReview, importReviewReducer, initialImportReview, reviewedImportPayload, type ImportReviewAction } from '../lib/deckImportReview'
import { decklistLineRange } from '../lib/decklistLines'
import { deckeEntitled, onDeckeEntitlementChange } from '../character/host/entitlement'
import { deckeHidden, onDeckeVisibilityChange } from '../character/deckePreference'
import { startDeckeErrand, endDeckeErrand } from '../character/host/errand'
import { Content, Spinner, ErrorState, Button, EmptyState, SelectableCard, FormAlert } from '../components/ui'
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
  // A11Y-08: see ListModals.tsx's ListFormModal for the same fix and the
  // reasoning — Submit stays enabled, and an attempted empty submit shows why.
  const [nameAttempted, setNameAttempted] = useState(false)
  const nameMissing = nameAttempted && !name.trim()
  return (
    <Modal title="New Deck" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) {
            setNameAttempted(true)
            return
          }
          onSubmit({ name: name.trim(), formatCode })
        }}
        className="flex flex-col gap-[18px]"
      >
        <label className="flex flex-col gap-[6px]">
          <span className="text-[14px] font-semibold text-text-secondary">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (nameAttempted) setNameAttempted(false)
            }}
            placeholder="My Charizard deck"
            maxLength={120}
            aria-invalid={nameMissing || undefined}
            aria-describedby={nameMissing ? 'deck-name-error' : undefined}
            className="h-[44px] rounded-lg border border-border-default bg-surface-primary px-[14px] text-[15px] text-text-primary placeholder:text-text-muted"
          />
          {nameMissing && (
            <FormAlert kind="error" id="deck-name-error">
              Name is required.
            </FormAlert>
          )}
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
          <Button type="submit" loading={busy}>
            {busy ? 'Creating…' : 'Create Deck'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ImportModal({ busy, error, onClose, onSubmit }: { busy?: boolean; error?: string | null; onClose: () => void; onSubmit: (b: { text: string; formatCode: DeckFormat; name?: string }) => void }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState(initialImportReview)
  const stateRef = useRef(state)
  const apply = (action: ImportReviewAction) => {
    const next = importReviewReducer(stateRef.current, action)
    stateRef.current = next
    setState(next)
    return next
  }
  const { text, formatCode } = state
  const review = deriveImportReview(state)
  const [name, setName] = useState('')
  const nameRef = useRef(name)
  nameRef.current = name
  const listRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const revealReview = useRef(true)
  const active = useRef(true)
  const [check, setCheck] = useState<{ revision: number; isPending: boolean; error: Error | null }>({ revision: -1, isPending: false, error: null })
  const checkSequence = useRef(0)
  const checkController = useRef<AbortController | null>(null)
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelCheck = () => {
    if (checkTimer.current !== null) clearTimeout(checkTimer.current)
    checkTimer.current = null
    checkSequence.current++
    checkController.current?.abort()
    checkController.current = null
  }
  const validate = async (submit: boolean) => {
    cancelCheck()
    const asked = stateRef.current
    const sequence = checkSequence.current
    const controller = new AbortController()
    checkController.current = controller
    const isLatest = () => active.current && sequence === checkSequence.current &&
      stateRef.current.revision === asked.revision
    setCheck({ revision: asked.revision, isPending: true, error: null })
    try {
      const { import: summary } = await api.checkDeckImport({ text: asked.text, formatCode: asked.formatCode }, controller.signal)
      if (!isLatest()) return
      const validated = apply({ type: 'validated', revision: asked.revision, summary })
      const payload = reviewedImportPayload(validated)
      setCheck({ revision: asked.revision, isPending: false, error: null })
      if (submit && payload) onSubmit({ ...payload, name: nameRef.current.trim() || undefined })
    } catch (error) {
      if (isLatest() && !controller.signal.aborted)
        setCheck({ revision: asked.revision, isPending: false, error: error as Error })
    }
  }
  // Source changes invalidate facts immediately; only check after typing rests.
  // Cancellation saves client work, while revision + sequence guards also cover
  // replies already delivered and repeated checks of the same revision.
  useEffect(() => {
    if (state.started && state.text.trim()) {
      setCheck({ revision: state.revision, isPending: true, error: null })
      checkTimer.current = setTimeout(() => { void validate(false) }, 300)
    } else setCheck({ revision: state.revision, isPending: false, error: null })
    return cancelCheck
  }, [state.revision])
  const checkError = check.revision === state.revision ? check.error : null
  const checking = !!state.text.trim() && (check.isPending || (state.started && !review.current && !checkError))
  const fix = useMutation({
    mutationFn: (asked: { text: string; formatCode: DeckFormat }) => api.fixDeckImport(asked),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ['credits'] }) },
  })
  const [entitled, setEntitled] = useState(false)
  const [hideCharacter, setHideCharacter] = useState(deckeHidden)
  const [fixError, setFixError] = useState<string | null>(null)
  const close = () => { active.current = false; cancelCheck(); endDeckeErrand(); onClose() }
  useEffect(() => onDeckeVisibilityChange(() => setHideCharacter(deckeHidden())), [])
  useEffect(() => {
    active.current = true
    const refresh = () => { void deckeEntitled().then(ok => { if (active.current) setEntitled(ok) }) }
    refresh()
    const unsubscribe = onDeckeEntitlementChange(refresh)
    return () => { active.current = false; unsubscribe(); endDeckeErrand() }
  }, [])

  const checked = state.started
  const stale = !review.current
  const unmatched = review.unresolved.map(row => row.line)
  const matchedCards = review.matchedCards
  const currentFixes = review.corrections
  const invalidFixes = review.issues
  const reviewing = currentFixes.length > 0
  const acceptedFixes = currentFixes.filter(entry => !entry.issue && !review.unresolved.some(row => row.lineId === entry.lineId)).map(entry => entry.fix)
  const fixedByLine = new Map(acceptedFixes.map(fix => [fix.lineIndex, fix]))
  const unmatchedWithIndexes = review.rows
  const reviewCount = review.rows.length
  const remaining = review.unresolved.length
  const showDock = checked && reviewCount > 0 && entitled && !hideCharacter
  useEffect(() => {
    if (showDock) startDeckeErrand()
    else endDeckeErrand()
    return () => endDeckeErrand()
  }, [showDock])
  const askDecke = () => {
    if (!review.current || fix.isPending || !entitled) return
    const asked = stateRef.current
    setFixError(null)
    fix.mutate({ text: asked.text, formatCode: asked.formatCode }, {
      onSuccess: result => {
        if (!active.current || stateRef.current.revision !== asked.revision) return
        if (result.fixes.length === 0) {
          setFixError('Deck-E could not find a safe match for these lines. You can edit them yourself or import the matched cards.')
          return
        }
        revealReview.current = true
        const next = apply({ type: 'accept', revision: asked.revision, fixes: result.fixes })
        if (next.revision === asked.revision)
          setFixError('Deck-E returned a fix for a different line. Please check the list again.')
      },
      onError: e => {
        if (active.current && stateRef.current.revision === asked.revision)
          setFixError((e as Error).message || 'Deck-E could not check this list. You can edit the lines yourself.')
      },
    })
  }
  const run = () => {
    const current = deriveImportReview(stateRef.current)
    if (!current.canAct || checking || fix.isPending || busy) return
    // The only skip action is the explicitly labelled button in this revision.
    // A fresh final check must still satisfy the same gate before any write.
    if (review.canSkip) apply({ type: 'skip', revision: state.revision, lineIds: review.unresolved.map(row => row.lineId) })
    apply({ type: 'start' })
    void validate(true)
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
  const undoFix = (lineIndex: number) => apply({ type: 'undo', lineId: state.lineIds[lineIndex] })
  const them = unmatched.length === 1 ? 'it' : 'them'
  useEffect(() => {
    if (!revealReview.current || review.rows.length === 0) return
    revealReview.current = false
    panelRef.current?.scrollIntoView({ block: window.innerWidth <= 500 && reviewing ? 'end' : 'nearest' })
  }, [state.validation, reviewing])

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
          <Button type="submit" form={formId} disabled={!review.canAct || fix.isPending} loading={busy || checking}>
            {checking ? 'Checking…' : busy ? 'Importing…' : review.canSkip ? 'Import without them' : 'Import deck'}
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
            <select value={formatCode} onChange={(e) => apply({ type: 'format', formatCode: e.target.value as DeckFormat })}
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
          onChange={(e) => apply({ type: 'text', text: e.target.value })}
          rows={checked ? 6 : 12}
          placeholder={'Pokémon: 6\n3 Charizard ex OBF 125\n…\n\nTrainer: …\n\nEnergy: …\n\nTotal Cards: 60'}
          className="rounded-lg border border-border-default bg-surface-primary px-[14px] py-[10px] font-mono text-[14px] leading-[19px] text-text-primary placeholder:text-text-muted"
        />
        {checked && (reviewCount > 0 || invalidFixes.length > 0 || (review.current && matchedCards === 0)) && (
          <div ref={panelRef} role="group" aria-label="Unmatched decklist lines" className="rounded-xl border border-action-primary/45 bg-surface-secondary p-[14px] shadow-sm">
            <div className="flex min-w-0 items-start justify-between gap-[10px]">
              <div role="alert" className="flex min-w-0 items-center gap-[8px] pt-[4px] text-[14px] font-bold text-text-primary">
                <Icon name="sparkle" size={16} className="shrink-0 text-action-primary" />
                <span>{review.pendingTypeCardIds.length > 0 ? 'GLC type is unknown' : invalidFixes.length > 0 ? 'Check card legality' : reviewCount === 0 ? 'No cards found' : reviewing ? `${reviewCount} line${reviewCount === 1 ? '' : 's'} to review` : <>{unmatched.length} line{unmatched.length === 1 ? " doesn't" : "s don't"} match a card</>}</span>
              </div>
              {(!stale || reviewing) && (reviewing || unmatched.length > 0) && entitled && (hideCharacter ? (
                !reviewing && <button type="button" onClick={askDecke} disabled={fix.isPending || checking}
                  className="shrink-0 text-[13px] font-semibold text-link hover:text-link-hover disabled:opacity-50">
                  {fix.isPending ? 'Checking…' : 'Suggest fixes'}
                </button>
              ) : (
                <div className="flex shrink-0 items-start gap-[6px] sm:gap-[10px]">
                  {reviewing || fix.isPending ? (
                    <span role="status" className="flex max-w-[156px] items-center gap-[7px] rounded-xl border border-border-default bg-surface-primary px-[10px] py-[7px] text-[12px] leading-[16px] text-text-secondary sm:max-w-none sm:text-[13px]">
                      {fix.isPending && <Spinner inline size={13} className="text-action-primary motion-reduce:animate-none" />}
                      <span>{fix.isPending ? 'Checking…' : `Fixed ${acceptedFixes.length} of ${reviewCount}, check ${reviewCount === 1 ? 'it' : 'them'}`}</span>
                    </span>
                  ) : (
                    <button type="button" onClick={askDecke} disabled={checking}
                      className="max-w-[156px] rounded-xl border border-action-primary/45 bg-surface-primary px-[10px] py-[7px] text-left text-[12px] leading-[16px] text-text-primary hover:border-action-primary disabled:opacity-50 sm:max-w-none sm:text-[13px]">
                      Want me to fix {unmatched.length === 1 ? 'this' : `these ${unmatched.length}`}?
                    </button>
                  )}
                  <button type="button" onClick={askDecke} disabled={reviewing || fix.isPending || checking}
                    aria-label={reviewing ? 'Deck-E finished suggesting fixes' : fix.isPending ? 'Deck-E is checking the lines' : 'Ask Deck-E to suggest fixes'}
                    className="relative h-[54px] w-[42px] shrink-0 rounded-lg border border-transparent hover:border-action-primary disabled:cursor-default disabled:hover:border-transparent sm:h-[72px] sm:w-[56px]">
                    <span data-decke-errand aria-hidden="true" className="absolute inset-0" />
                  </button>
                </div>
              ))}
            </div>
            <ul className="mt-[10px] flex flex-col gap-[8px]">
              {unmatchedWithIndexes.map(({ line, lineIndex }) => {
                const found = fixedByLine.get(lineIndex)
                const correction = currentFixes.find(entry => entry.fix.lineIndex === lineIndex)
                return (
                  <li key={state.lineIds[lineIndex]} className={`flex min-w-0 flex-col gap-[6px] rounded-lg bg-surface-primary p-[10px] ${reviewing && !found ? 'border-l-[3px] border-warning' : ''}`}>
                    {found ? <>
                      <div className="flex min-w-0 items-start gap-[10px]">
                        {found.card.image && <img src={found.card.image} alt="" className="h-[56px] w-[40px] shrink-0 rounded object-cover" />}
                        <div className="min-w-0 flex-1">
                          <div className="break-words font-mono text-[13px] text-text-muted line-through" aria-label={`Was: ${line}`}>{line}</div>
                          <div className="break-words font-mono text-[14px] font-semibold text-text-primary">{found.replacement}</div>
                          <div className="text-[13px] text-text-muted">{found.reason}</div>
                        </div>
                        <button type="button" onClick={() => undoFix(lineIndex)} disabled={checking}
                          className="shrink-0 rounded-full px-[8px] py-[6px] text-[14px] font-semibold text-link hover:bg-action-default-hover disabled:opacity-50">Undo</button>
                      </div>
                    </> : <div className="flex min-w-0 flex-col gap-[4px]">
                      <div className="flex min-w-0 items-center justify-between gap-[10px]">
                        <code className="min-w-0 break-words font-mono text-[14px] text-text-primary">{line}</code>
                        <button type="button" onClick={() => editLine(lineIndex)} aria-label={`Edit the line ${line}`}
                          className="h-[36px] shrink-0 rounded-full px-[12px] text-[14px] font-semibold text-link hover:bg-action-default-hover hover:text-link-hover">Edit</button>
                      </div>
                      {correction && <div className="flex items-center justify-between gap-[10px]">
                        <span className={`text-[13px] ${review.pendingTypeCardIds.includes(correction.fix.card.id) ? 'text-warning' : 'text-error'}`}>{correction.issue?.reason ?? 'This correction no longer matches a card.'}</span>
                        <button type="button" onClick={() => undoFix(lineIndex)} disabled={checking}
                          className="shrink-0 rounded-full px-[8px] py-[6px] text-[14px] font-semibold text-link hover:bg-action-default-hover disabled:opacity-50">Undo</button>
                      </div>}
                    </div>}
                  </li>
                )
              })}
            </ul>
            {invalidFixes.filter(issue => !currentFixes.some(entry => entry.issue?.cardId === issue.cardId)).map(issue => (
              <p key={`${issue.cardId}:${issue.reason}`} className={`mt-[10px] text-[13px] ${review.pendingTypeCardIds.includes(issue.cardId) ? 'text-warning' : 'text-error'}`}>{issue.reason}</p>
            ))}
            <p className="mt-[10px] text-[13px] text-text-muted">
              {stale
                ? 'Checking the current list and format…'
                : review.pendingTypeCardIds.length
                  ? 'Type-dependent corrections are waiting for the deck’s GLC type.'
                : invalidFixes.length
                  ? `A card is not legal in ${FORMAT_META[formatCode].label}. Edit its line or choose another format.`
                : reviewing
                  ? remaining ? 'Check each fix. Edit or skip the lines still unmatched.' : 'Check each fix. Undo any line Deck-E got wrong.'
                : matchedCards > 0
                  ? `Fix ${them} above and import again, or import the other ${matchedCards} card${matchedCards === 1 ? '' : 's'} without ${them}.`
                  : 'Nothing in this list matched a card yet. Fix the lines above to import it.'}
            </p>
          </div>
        )}
        {fixError && !stale && <div role="alert" className="text-[14px] text-error">{fixError}</div>}
        {(checkError || error) && <div className="text-[14px] text-error">{(checkError?.message ?? error)}
          {checkError && <button type="button" onClick={() => { void validate(false) }} className="ml-[8px] text-link underline">Check again</button>}
        </div>}
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
