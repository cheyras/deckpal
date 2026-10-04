/* "What else can DeckPal do?": a carousel of cards, each a large illustration,
 * a heading and a line. The illustrations are drawn here (no product screens),
 * from the theme's tokens, so they sit in either theme and cost no requests.
 *
 * It advances by itself while on screen, stops on hover or focus, has a pause
 * button (WCAG 2.2.2), and under reduced motion stays put; the arrows and a
 * swipe always work. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../../../components/Icon'
import { COPY } from '../copy'
import { Reveal, SectionHead, useOnScreen, usePrefersReducedMotion } from '../parts'

const ADVANCE_MS = 4500
/** After the visitor scrolls, swipes or presses an arrow, autoplay waits this long. */
const QUIET_MS = 9000

type Card = { key: string; title: string; body: string; art: ReactNode }

export function MoreSection() {
  const m = COPY.more
  const c = m.cells
  const cards: Card[] = [
    { key: 'prices', ...c.prices, art: <PricesArt /> },
    { key: 'progress', ...c.progress, art: <ProgressArt /> },
    { key: 'collection', ...c.collection, art: <CollectionArt /> },
    { key: 'lists', ...c.lists, art: <ListsArt /> },
    { key: 'binders', ...c.binders, art: <BinderArt /> },
    { key: 'versions', ...c.versions, art: <VersionsArt /> },
    { key: 'records', ...c.records, art: <RecordsArt /> },
  ]
  return (
    <section className="lp-sec lp-more" id="more" aria-labelledby="more-title">
      <div className="ls-wrap">
        <Reveal>
          <SectionHead eyebrow={m.eyebrow} title={m.headline} id="more-title" />
        </Reveal>
        <Carousel cards={cards} label={m.headline} />
      </div>
    </section>
  )
}

function Carousel({ cards, label }: { cards: Card[]; label: string }) {
  const track = useRef<HTMLUListElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(box)
  const reduced = usePrefersReducedMotion()
  const [hold, setHold] = useState(false)
  const [paused, setPaused] = useState(false)
  const touched = useRef(0)
  const nudge = () => {
    touched.current = Date.now()
  }

  // Both arrows wrap, so neither ever disables under the visitor's focus.
  const step = useCallback(
    (dir: 1 | -1) => {
      const el = track.current
      if (!el) return
      const card = el.querySelector('li')
      const w = card ? card.getBoundingClientRect().width + 16 : el.clientWidth
      const behavior = reduced ? 'auto' : 'smooth'
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4
      const atStart = el.scrollLeft < 4
      if (dir === 1 && atEnd) el.scrollTo({ left: 0, behavior })
      else if (dir === -1 && atStart) el.scrollTo({ left: el.scrollWidth, behavior })
      else el.scrollBy({ left: dir * w, behavior })
    },
    [reduced],
  )

  useEffect(() => {
    if (reduced || !onScreen || hold || paused) return
    const id = window.setInterval(() => {
      if (Date.now() - touched.current > QUIET_MS) step(1)
    }, ADVANCE_MS)
    return () => window.clearInterval(id)
  }, [reduced, onScreen, hold, paused, step])

  return (
    <div
      className="lp-carousel"
      ref={box}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHold(false)}
    >
      <ul
        className="lp-carousel-track"
        ref={track}
        aria-label={label}
        tabIndex={0}
        onPointerDown={nudge}
        onWheel={nudge}
        onTouchStart={nudge}
        onKeyDown={nudge}
      >
        {cards.map((c) => (
          <li key={c.key} className="lp-ccard">
            <div className="lp-ccard-art" aria-hidden="true">
              {c.art}
            </div>
            <h3 className="lp-h3">{c.title}</h3>
            <p className="lp-ccard-body">{c.body}</p>
          </li>
        ))}
      </ul>
      <div className="lp-carousel-ctl">
        {!reduced && (
          <button
            type="button"
            className="lp-icon-btn"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Play the carousel' : 'Pause the carousel'}
          >
            <Icon name={paused ? 'play' : 'pause'} size={14} strokeWidth={2.4} />
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className="lp-icon-btn"
          onClick={() => {
            nudge()
            step(-1)
          }}
          aria-label="Previous"
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <button
          type="button"
          className="lp-icon-btn"
          onClick={() => {
            nudge()
            step(1)
          }}
          aria-label="Next"
        >
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
    </div>
  )
}

/* ── illustrations ────────────────────────────────────────────────────────────
 * 240 by 160, one shared vocabulary: rounded cards, a cyan accent, an amber
 * second colour, and outline strokes in the secondary text tone. */

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 240 160" className="lp-ill">
      {children}
    </svg>
  )
}

function MiniCard({ x, y, r = 0, tone = 'accent' }: { x: number; y: number; r?: number; tone?: 'accent' | 'warm' | 'muted' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r} 27 38)`}>
      <rect width="54" height="76" rx="6" className="ill-card" />
      <rect x="6" y="8" width="42" height="28" rx="3" className={`ill-${tone}-fill`} />
      <rect x="6" y="44" width="30" height="4" rx="2" className="ill-ink" />
      <rect x="6" y="54" width="38" height="4" rx="2" className="ill-ink" />
      <rect x="6" y="64" width="22" height="4" rx="2" className="ill-ink" />
    </g>
  )
}

function PricesArt() {
  return (
    <Svg>
      <rect x="28" y="22" width="184" height="116" rx="12" className="ill-card" />
      <path d="M44 112 L76 98 L100 104 L128 80 L152 86 L180 58 L196 50" className="ill-accent-line" />
      <path d="M44 112 L76 98 L100 104 L128 80 L152 86 L180 58 L196 50 L196 124 L44 124 Z" className="ill-accent-area" />
      <circle cx="196" cy="50" r="5" className="ill-accent-fill" />
      <circle cx="58" cy="44" r="16" className="ill-warm-fill" />
      <text x="58" y="50" textAnchor="middle" className="ill-glyph">
        $
      </text>
      <rect x="82" y="38" width="44" height="6" rx="3" className="ill-ink" />
      <rect x="82" y="50" width="28" height="6" rx="3" className="ill-ink" />
    </Svg>
  )
}

function ProgressArt() {
  const r = 46
  const c = 2 * Math.PI * r
  return (
    <Svg>
      {[0, 1, 2].map((row) =>
        [0, 1].map((col) => (
          <rect key={`${row}-${col}`} x={24 + col * 22} y={34 + row * 32} width="18" height="26" rx="3" className={row * 2 + col < 4 ? 'ill-accent-fill' : 'ill-slot'} />
        )),
      )}
      <circle cx="152" cy="80" r={r} className="ill-ring" />
      <circle
        cx="152"
        cy="80"
        r={r}
        className="ill-ring-on"
        strokeDasharray={`${c * 0.76} ${c}`}
        transform="rotate(-90 152 80)"
      />
      <text x="152" y="88" textAnchor="middle" className="ill-big">
        76%
      </text>
    </Svg>
  )
}

function CollectionArt() {
  return (
    <Svg>
      <MiniCard x={58} y={40} r={-12} tone="muted" />
      <MiniCard x={92} y={34} r={0} tone="accent" />
      <g transform="translate(126 40) rotate(12 27 38)">
        <rect width="54" height="76" rx="6" className="ill-card" />
        <rect x="6" y="8" width="42" height="28" rx="3" className="ill-warm-fill" />
        <path d="M0 70 L54 16 M0 52 L36 16 M18 76 L54 40" className="ill-sheen" />
      </g>
      <circle cx="176" cy="40" r="15" className="ill-accent-fill" />
      <text x="176" y="46" textAnchor="middle" className="ill-glyph ill-on-accent">
        ×4
      </text>
    </Svg>
  )
}

function ListsArt() {
  return (
    <Svg>
      <rect x="58" y="22" width="124" height="120" rx="12" className="ill-card" />
      <rect x="96" y="14" width="48" height="16" rx="6" className="ill-slot" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i} transform={`translate(74 ${46 + i * 22})`}>
          <rect width="14" height="14" rx="4" className={i < 2 ? 'ill-accent-fill' : 'ill-slot'} />
          {i < 2 && <path d="M3.5 7.5 L6.5 10.5 L11 4" className="ill-check" />}
          <rect x="22" y="4" width={i === 3 ? 50 : 72} height="6" rx="3" className="ill-ink" />
        </g>
      ))}
      <path d="M182 34 c-6 -10 -20 -4 -14 6 l14 14 l14 -14 c6 -10 -8 -16 -14 -6 z" className="ill-warm-fill" />
    </Svg>
  )
}

function BinderArt() {
  const page = (x: number) =>
    [0, 1, 2].flatMap((row) =>
      [0, 1, 2].map((col) => {
        const n = row * 3 + col
        const filled = x < 120 ? n !== 4 : n % 3 !== 1
        return (
          <rect
            key={`${x}-${n}`}
            x={x + 8 + col * 26}
            y={30 + row * 36}
            width="22"
            height="30"
            rx="3"
            className={filled ? (n % 4 === 0 ? 'ill-warm-fill' : 'ill-accent-fill') : 'ill-slot'}
          />
        )
      }),
    )
  return (
    <Svg>
      <rect x="28" y="20" width="184" height="124" rx="10" className="ill-card" />
      <line x1="120" y1="24" x2="120" y2="140" className="ill-spine" />
      {[48, 80, 112].map((y) => (
        <circle key={y} cx="120" cy={y} r="3.5" className="ill-ring-hole" />
      ))}
      {page(32)}
      {page(124)}
    </Svg>
  )
}

function VersionsArt() {
  return (
    <Svg>
      <line x1="40" y1="70" x2="200" y2="70" className="ill-track" />
      {[
        [56, 'v1'],
        [120, 'v2'],
        [184, 'v3'],
      ].map(([x, v], i) => (
        <g key={v as string}>
          <circle cx={x as number} cy="70" r="16" className={i === 2 ? 'ill-accent-fill' : 'ill-node'} />
          <text x={x as number} y="75" textAnchor="middle" className={`ill-glyph ${i === 2 ? 'ill-on-accent' : ''}`}>
            {v}
          </text>
        </g>
      ))}
      <rect x="132" y="98" width="88" height="22" rx="11" className="ill-plus" />
      <text x="176" y="113" textAnchor="middle" className="ill-small ill-plus-ink">
        +1 Lampent
      </text>
      <rect x="20" y="98" width="104" height="22" rx="11" className="ill-minus" />
      <text x="72" y="113" textAnchor="middle" className="ill-small ill-minus-ink">
        −1 Pokémon Catcher
      </text>
    </Svg>
  )
}

function RecordsArt() {
  const rows: [string, number, number][] = [
    ['v1', 6, 2],
    ['v2', 0, 3],
    ['v3', 4, 1],
  ]
  return (
    <Svg>
      {rows.map(([v, w, l], i) => (
        <g key={v} transform={`translate(32 ${36 + i * 34})`}>
          <text x="0" y="14" className="ill-glyph ill-left">
            {v}
          </text>
          <rect x="30" y="2" width={w * 20} height="16" rx="5" className="ill-win" />
          <rect x={30 + w * 20 + (w ? 4 : 0)} y="2" width={l * 20} height="16" rx="5" className="ill-loss" />
        </g>
      ))}
    </Svg>
  )
}
