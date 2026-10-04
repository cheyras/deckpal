/* The four stage sections: Plan, Playtest, Tune, Build. Each is a split of copy
 * and one visual: a photograph from the same league night with a working,
 * simplified piece of the product over it. Demos play once when they scroll
 * into view, in reading order, and land in their finished state under reduced
 * motion. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../../../components/Icon'
import { COPY } from '../copy'
import { LOG_EXCERPT, MISSING, OWNED, PRINTINGS, SAMPLE_DECK, artUrl, useLivePrices, type DeckLine } from '../data'
import type { PhotoName } from '../data'
import { ExampleTag, Photo, Reveal, useInView, usePrefersReducedMotion, useTimers } from '../parts'
import type { StageId } from '../copy'
import { STAGE_ICON } from './Loop'

function StageSplit({
  id,
  flip = false,
  eyebrow,
  title,
  lead,
  body,
  visual,
}: {
  id: StageId
  flip?: boolean
  eyebrow: string
  title: string
  lead?: ReactNode
  body: readonly string[]
  visual: ReactNode
}) {
  return (
    <section className={`lp-sec lp-stage ${flip ? 'is-flip' : ''}`} id={id} aria-labelledby={`${id}-title`}>
      <div className="ls-wrap lp-split">
        <Reveal className="lp-split-copy">
          <div className="lp-head">
            <p className="lp-eyebrow lp-eyebrow-icon">
              <span className="lp-stage-icon" aria-hidden="true">
                <Icon name={STAGE_ICON[id]} size={14} strokeWidth={2.2} />
              </span>
              {eyebrow}
            </p>
            <h2 className="lp-h2" id={`${id}-title`}>
              {title}
            </h2>
          </div>
          {lead}
          {body.map((p) => (
            <p key={p} className="lp-body">
              {p}
            </p>
          ))}
        </Reveal>
        <div className="lp-split-visual">{visual}</div>
      </div>
    </section>
  )
}

/** A photograph as the backdrop, with the piece of product framed inside it. */
function Frame({ photo, alt, children }: { photo: PhotoName; alt: string; children: ReactNode }) {
  return (
    <div className="lp-frame">
      <Photo name={photo} alt={alt} sizes="(min-width: 1024px) 720px, 100vw" className="lp-frame-photo" />
      <div className="lp-frame-shade" aria-hidden="true" />
      <div className="lp-frame-body">{children}</div>
    </div>
  )
}

/* ── Plan ─────────────────────────────────────────────────────────────────── */

const PLAN_LINES = ['me05-036', 'me05-037', 'me05-038', 'sv08.5-035', 'sv08.5-037', 'me01-125']
// Owned counts per tab: the binder and card tabs are the example account; the
// pasted list is the same account before a few pickups.
const PLAN_OWNED: Record<string, Record<string, number>> = {
  binder: OWNED,
  card: OWNED,
  list: { ...OWNED, 'me05-036': 2, 'me05-037': 1, 'sv08.5-035': 1 },
}
const PLAN_TOTAL: Record<string, number> = { binder: 48, card: 48, list: 41 }

export function PlanSection() {
  const p = COPY.plan
  return (
    <StageSplit id="plan" eyebrow={p.eyebrow} title={p.headline} body={p.body} visual={<PlanDemo />} />
  )
}

function PlanDemo() {
  const p = COPY.plan
  const [tab, setTab] = useState<(typeof p.tabs)[number]['id']>('binder')
  const owned = PLAN_OWNED[tab]
  const current = p.tabs.find((t) => t.id === tab)!
  const lines = PLAN_LINES.map((id) => SAMPLE_DECK.find((l) => l.id === id)!) as DeckLine[]
  const onKey = (e: React.KeyboardEvent) => {
    const i = p.tabs.findIndex((t) => t.id === tab)
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (n === null) return
    e.preventDefault()
    const next = p.tabs[(n + p.tabs.length) % p.tabs.length]
    setTab(next.id)
    document.getElementById(`plan-tab-${next.id}`)?.focus()
  }
  return (
    <Frame photo="plan" alt={p.photoAlt}>
      <div className="lp-tabs" role="tablist" aria-label={p.tabsLabel} onKeyDown={onKey}>
        {p.tabs.map((t) => (
          <button
            key={t.id}
            id={`plan-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls="plan-panel"
            tabIndex={tab === t.id ? 0 : -1}
            className="lp-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="lp-panel lp-panel-plan" id="plan-panel" role="tabpanel" aria-labelledby={`plan-tab-${tab}`}>
        <div className="lp-panel-top">
          <ExampleTag />
        </div>
        <div className="lp-mini-chat" key={tab}>
          <p className="lp-bubble lp-bubble-you lp-in">{current.ask}</p>
          <p className="lp-bubble lp-bubble-ai lp-in lp-d1">{current.summary}</p>
        </div>
        <div className="lp-builder">
          <div className="lp-builder-head">
            <strong>{p.builder.title}</strong>
            <span className="lp-ok">
              <Icon name="check" size={14} strokeWidth={2.4} /> {p.builder.legal}
            </span>
          </div>
          <div className="lp-builder-meter">
            <span className="lp-meter">
              <span style={{ width: `${(PLAN_TOTAL[tab] / 60) * 100}%` }} />
            </span>
            <span className="lp-muted">
              {PLAN_TOTAL[tab]} / 60 {p.builder.owned.toLowerCase()}
            </span>
          </div>
          <ul className="lp-builder-list">
            {lines.map((l) => {
              const have = Math.min(owned[l.id] ?? l.qty, l.qty)
              return (
                <li key={l.id}>
                  <img src={artUrl(l.id)} alt="" loading="lazy" />
                  <span className="lp-qty">{l.qty}</span>
                  <span className="lp-name">{l.name}</span>
                  {have >= l.qty ? (
                    <span className="lp-have">
                      <Icon name="check" size={13} strokeWidth={2.6} />
                      {p.builder.owned}
                    </span>
                  ) : (
                    <span className="lp-need">
                      {p.builder.missing} {l.qty - have}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </Frame>
  )
}

/* ── Playtest ─────────────────────────────────────────────────────────────── */

const DECK_IDS: string[] = SAMPLE_DECK.flatMap((l) => Array.from({ length: l.qty }, () => l.id))
const KIND = new Map(SAMPLE_DECK.map((l) => [l.id, l.kind]))
const NAME = new Map(SAMPLE_DECK.map((l) => [l.id, l.name]))

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function drawHand(rand: () => number): string[] {
  const deck = [...DECK_IDS]
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck.slice(0, 7)
}

// A fixed first hand so the page reads the same for everyone before a click.
function firstHand(): string[] {
  for (let seed = 11; ; seed++) {
    const h = drawHand(mulberry32(seed))
    if (h.filter((id) => KIND.get(id) === 'basic').length === 2 && h.some((id) => KIND.get(id) === 'supporter')) return h
  }
}

export function PlaytestSection() {
  const p = COPY.playtest
  return (
    <StageSplit id="playtest" flip eyebrow={p.eyebrow} title={p.headline} body={p.body} visual={<HandDraw />} />
  )
}

function HandDraw() {
  const p = COPY.playtest
  const initial = useMemo(firstHand, [])
  const [hand, setHand] = useState(initial)
  const [round, setRound] = useState(0)
  const basics = hand.filter((id) => KIND.get(id) === 'basic').length
  const supporters = hand.filter((id) => KIND.get(id) === 'supporter').length
  const energy = hand.filter((id) => KIND.get(id) === 'energy').length
  return (
    <Frame photo="playtest" alt={p.photoAlt}>
      <div className="lp-panel lp-panel-hand">
        <div className="lp-panel-top">
          <span className="lp-panel-title">{p.handLabel}</span>
          <ExampleTag label="Sample deck" />
        </div>
        <ol className="lp-fan" key={round} aria-label={`${p.handLabel}: ${hand.map((id) => NAME.get(id)).join(', ')}`}>
          {hand.map((id, i) => (
            <li
              key={`${round}-${i}`}
              style={{ '--i': i, '--a': `${(i - 3) * 8}deg`, '--x': `${(i - 3) * 14}%`, '--y': `${Math.abs(i - 3) ** 2 * 1.5}px` } as React.CSSProperties}
            >
              <img src={artUrl(id)} alt="" />
            </li>
          ))}
        </ol>
        <p className="lp-hand-stats" aria-live="polite">
          {basics === 0 ? (
            <span className="lp-need">{p.mulligan}</span>
          ) : (
            <>
              <span>{p.basics(basics)}</span>
              <span>{p.supporter(supporters)}</span>
              <span>{p.energy(energy)}</span>
            </>
          )}
        </p>
        <div className="lp-hand-foot">
          <button
            type="button"
            className="ls-cta lp-btn lp-btn-primary lp-btn-sm"
            onClick={() => {
              setHand(drawHand(Math.random))
              setRound((r) => r + 1)
            }}
          >
            <Icon name="shuffle" size={16} />
            {round === 0 ? p.draw : p.redraw}
          </button>
          <span className="lp-muted lp-small">{p.deckLabel}</span>
        </div>
      </div>
    </Frame>
  )
}

/* ── Tune ─────────────────────────────────────────────────────────────────── */

export function TuneSection() {
  const t = COPY.tune
  return (
    <StageSplit
      id="tune"
      eyebrow={t.eyebrow}
      title={t.headline}
      lead={<blockquote className="lp-quote">{t.quote}</blockquote>}
      body={t.body}
      visual={<LogDemo />}
    />
  )
}

function LogDemo() {
  const t = COPY.tune
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref)
  const reduced = usePrefersReducedMotion()
  const timers = useTimers()
  const [mode, setMode] = useState<'paste' | 'tell'>('paste')
  const [step, setStep] = useState(0) // paste: lines then fields; tell: message then fields
  const lineCount = LOG_EXCERPT.length
  const pasteEnd = lineCount + 5
  const tellEnd = 5

  useEffect(() => {
    timers.clear()
    if (reduced) {
      setStep(mode === 'paste' ? pasteEnd : tellEnd)
      return
    }
    if (!seen) return
    setStep(0)
    // One authored sequence: the input (log lines, or the message), a beat, then
    // each parsed field in reading order, then the "logged" line.
    const gaps =
      mode === 'paste'
        ? [250, ...Array(lineCount - 1).fill(110), 450, 160, 160, 160, 220]
        : [250, 500, 160, 160, 220]
    let at = 0
    gaps.forEach((g, i) => {
      at += g
      timers.after(at, () => setStep(i + 1))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, seen, reduced])

  const fieldsFrom = mode === 'paste' ? lineCount + 1 : 2
  const f = t.fields
  const v = t.parsed
  const fields =
    mode === 'paste'
      ? [
          [f.result, v.result],
          [f.opponent, v.opponent],
          [f.turns, v.turns],
          [f.prizes, v.prizes],
        ]
      : [
          [f.result, v.result],
          [f.matchup, v.opponent],
          [f.notes, v.notes],
        ]

  return (
    <div className="lp-visual" ref={ref}>
      <Frame photo="tune" alt={t.photoAlt}>
      <div className="lp-panel lp-panel-log">
        <div className="lp-panel-top">
          <div className="lp-seg" role="group" aria-label={t.modesLabel}>
            {(['paste', 'tell'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                className="lp-seg-btn"
                onClick={() => setMode(m)}
              >
                {m === 'paste' ? t.modePaste : t.modeTell}
              </button>
            ))}
          </div>
          <ExampleTag />
        </div>
        {mode === 'paste' ? (
          <div className="lp-log" aria-label={t.pasteHint}>
            {LOG_EXCERPT.slice(0, Math.min(step, lineCount)).map((line, i) => (
              <div key={i} className={line.endsWith('Turn') || line === 'Setup' ? 'lp-log-head' : ''}>
                {line}
              </div>
            ))}
          </div>
        ) : (
          step >= 1 && <p className="lp-bubble lp-bubble-you lp-in">{t.tellMessage}</p>
        )}
        <dl className="lp-fields">
          {fields.map(([k, val], i) =>
            step >= fieldsFrom + i ? (
              <div key={k} className="lp-field lp-in-up">
                <dt>{k}</dt>
                <dd className={k === f.result ? 'lp-loss' : ''}>{val}</dd>
              </div>
            ) : null,
          )}
        </dl>
        {step >= fieldsFrom + fields.length && (
          <p className="lp-logged lp-in">
            <Icon name="check-circle" size={16} /> {t.logged}
          </p>
        )}
      </div>
      </Frame>
    </div>
  )
}

/* ── Build ────────────────────────────────────────────────────────────────── */

export function BuildSection() {
  const b = COPY.build
  return <StageSplit id="build" flip eyebrow={b.eyebrow} title={b.headline} body={b.body} visual={<BuildDemo />} />
}

const money = (n: number) => `$${n.toFixed(2)}`
const LIVE_IDS = [...MISSING.map((m) => m.id), ...PRINTINGS.slice(1).map((p) => p.id)]

function BuildDemo() {
  const b = COPY.build
  const ref = useRef<HTMLDivElement>(null)
  const near = useInView(ref, { rootMargin: '400px 0px 400px 0px', threshold: 0 })
  const seen = useInView(ref)
  const reduced = usePrefersReducedMotion()
  const live = useLivePrices(LIVE_IDS, near)
  const [pi, setPi] = useState(0)
  const priceOf = (id: string, fallback: number) => live[id] ?? fallback
  const printing = PRINTINGS[pi]
  const printingPrice = priceOf(printing.id, printing.price)
  const rows = MISSING.map((m) => ({
    ...m,
    unit: m.id === 'me05-038' ? printingPrice : priceOf(m.id, m.price),
  }))
  const total = rows.reduce((a, r) => a + r.unit * r.qty, 0)
  const shown = useCountUp(total, seen && !reduced)
  const count = rows.reduce((a, r) => a + r.qty, 0)

  return (
    <div className="lp-visual" ref={ref}>
      <Frame photo="build" alt={b.photoAlt}>
      <div className="lp-panel lp-panel-build">
        <div className="lp-panel-top">
          <span className="lp-panel-title">{b.listTitle}</span>
          <ExampleTag label="Example account" />
        </div>
        <ul className="lp-cart">
          {rows.map((r) => (
            <li key={r.id}>
              <span className="lp-qty">{r.qty}</span>
              <span className="lp-name">
                {r.name}
                <span className="lp-muted">{r.id === 'me05-038' ? `Pitch Black ${printing.number}` : r.set}</span>
              </span>
              <span className="lp-price-cell">{money(r.unit * r.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="lp-cart-total">
          <span>
            {b.total} <span className="lp-muted">({count} cards)</span>
          </span>
          <strong aria-hidden="true">{money(reduced || !seen ? total : shown)}</strong>
          <span className="sr-only" aria-live="polite">
            {b.total} {money(total)}
          </span>
        </div>
        <div className="lp-printing">
          <img key={printing.id} src={artUrl(printing.id)} alt={`Mega Chandelure ex, ${printing.rarity}`} className="lp-in" />
          <div className="lp-printing-ctl">
            <label htmlFor="lp-printing" className="lp-panel-title">
              {b.printingLabel}
            </label>
            <input
              id="lp-printing"
              type="range"
              min={0}
              max={PRINTINGS.length - 1}
              step={1}
              value={pi}
              onChange={(e) => setPi(Number(e.target.value))}
              aria-valuetext={`${printing.rarity}, ${money(printingPrice)} each`}
            />
            <ol className="lp-printing-stops" aria-hidden="true">
              {PRINTINGS.map((p, i) => (
                <li key={p.id} className={i === pi ? 'is-on' : ''}>
                  <span>{p.rarity}</span>
                  <span>{money(priceOf(p.id, p.price))}</span>
                </li>
              ))}
            </ol>
            <p className="lp-muted lp-small">{b.printingNote}</p>
          </div>
        </div>
        <div className="lp-cart-foot">
          <span className="lp-fake-btn" aria-hidden="true">
            <Icon name="cart" size={16} /> {b.cartButton}
          </span>
          <span className="lp-muted lp-small">
            {b.cartNote} {b.priceNote}
          </span>
        </div>
      </div>
      </Frame>
    </div>
  )
}

function useCountUp(target: number, run: boolean): number {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (!run) return
    const start = performance.now()
    const a = from.current
    const dur = a === 0 ? 900 : 320
    let frame = requestAnimationFrame(function tick(now) {
      const k = Math.min(1, (now - start) / dur)
      const e = 1 - (1 - k) ** 3
      const x = a + (target - a) * e
      setV(x)
      from.current = x
      if (k < 1) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [target, run])
  return v
}
