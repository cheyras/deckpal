/* ─────────────────────────────────────────────────────────────────────────────
 * Landing-page product mockups.
 *
 * These are NOT screenshots. Every one is real DOM/CSS/SVG built from the same
 * design tokens, radii and idioms as the app itself — the completion ring is
 * LevelRing's arc language, the two-bar cluster is ProgressCluster, the tiles
 * keep CardImage's 63:88 physical-card box and proportional radius, the area
 * chart is ValueChart's gradient-under-line, and the deck rows reuse the real
 * EnergyIcon glyphs.
 *
 * IP: no Pokémon card art, no character names, no Poké Ball or wordmark. Card
 * tiles are abstract gradient placeholders. Set names are the factual English
 * set names the product catalogues (nominative use, disclaimed in the footer).
 *
 * Each frame carries role="img" + an aria-label so the illustrative numbers
 * inside never reach a screen reader as if they were real data.
 * ───────────────────────────────────────────────────────────────────────────── */
import { useId, type CSSProperties, type ReactNode } from 'react'
import { EnergyIcon } from '../../components/EnergyIcon'
import { Icon } from '../../components/Icon'
import { tailwindGradient, tailwindGradientStops } from '../../lib/gradientPalette'
import { CARD_ASPECT_RATIO_CSS, CARD_RADIUS_CSS } from '../../lib/cardGeometry'

// action-primary-strong is cyan-300, action-primary is cyan-400 (theme.css) —
// keep these in sync if those tokens' hue family changes.
const PROGRESS_GRADIENT = tailwindGradient('cyan', '300')
const [RING_GRADIENT_FROM] = tailwindGradientStops('cyan', '300')

type Vars = CSSProperties & Record<`--${string}`, string>

/* ── shared atoms ─────────────────────────────────────────────────────────── */

/** Browser/app chrome around a mockup. `label` is the faux URL pill. */
function AppFrame({
  label,
  ariaLabel,
  children,
  bodyClassName = 'p-[14px] sm:p-[18px]',
}: {
  label: string
  ariaLabel: string
  children: ReactNode
  bodyClassName?: string
}) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="ls-card overflow-hidden rounded-2xl border border-border-default bg-surface-secondary shadow-elevated"
    >
      <div className="flex items-center gap-[6px] border-b border-border-default bg-surface-primary px-[12px] py-[9px]">
        <span className="h-[8px] w-[8px] rounded-full bg-surface-quaternary" />
        <span className="h-[8px] w-[8px] rounded-full bg-surface-quaternary" />
        <span className="h-[8px] w-[8px] rounded-full bg-surface-quaternary" />
        <span className="ml-[8px] flex h-[22px] min-w-0 flex-1 items-center truncate rounded-full bg-surface-secondary px-[10px] text-[10px] leading-none text-text-muted">
          {label}
        </span>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  )
}

/**
 * Abstract stand-in for a card. Keeps CardImage's exact 63:88 physical-card
 * box and proportional corner radius so the grids inherit the app's rhythm —
 * but where a real card has art this has a saturated accent window, and where
 * it has a name it has a bar. Reads unmistakably as "a card" at grid size
 * without being one.
 */
function CardPlaceholder({
  accent = 'var(--color-variant-normal)',
  dim = false,
}: {
  accent?: string
  dim?: boolean
}) {
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: CARD_ASPECT_RATIO_CSS,
        borderRadius: CARD_RADIUS_CSS,
        background:
          'linear-gradient(165deg, var(--color-surface-raised) 0%, var(--color-surface-tertiary) 46%, var(--color-surface-secondary) 100%)',
        boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.08)',
        ...(dim ? { filter: 'saturate(0.25)', opacity: 0.55 } : null),
      }}
    >
      {/* art window — the only place colour lives, so tiles read as distinct */}
      <div
        className="absolute rounded-[5px]"
        style={{
          left: '7%',
          right: '7%',
          top: '6%',
          height: '55%',
          background: `linear-gradient(158deg, ${accent} -8%, var(--color-surface-tertiary) 82%)`,
          boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.25)',
        }}
      />
      {/* name bar + a shorter detail bar, in the card's lower third */}
      <div className="absolute left-[9%] right-[9%] top-[68%] h-[5%] rounded-full" style={{ background: 'rgb(255 255 255 / 0.16)' }} />
      <div className="absolute left-[9%] top-[78%] h-[4%] w-[46%] rounded-full" style={{ background: 'rgb(255 255 255 / 0.09)' }} />
      <div className="absolute left-[9%] top-[87%] h-[4%] w-[28%] rounded-full" style={{ background: 'rgb(255 255 255 / 0.06)' }} />
      {/* holo sheen across the whole face */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(112deg, transparent 40%, rgb(255 255 255 / 0.08) 50%, transparent 60%)' }}
      />
    </div>
  )
}

/** An empty binder pocket — the app's "you don't own this yet" state. */
function EmptyPocket({ slot }: { slot: number }) {
  return (
    <div
      className="flex w-full items-center justify-center border border-dashed border-surface-quaternary bg-surface-tertiary-subtle"
      style={{ aspectRatio: CARD_ASPECT_RATIO_CSS, borderRadius: CARD_RADIUS_CSS }}
    >
      <span className="text-[9px] font-semibold text-text-muted">#{slot}</span>
    </div>
  )
}

/** Skeleton text bar — stands in for a card name without naming a card. */
function Bar({ w, h = 7, tone = 0.14 }: { w: string; h?: number; tone?: number }) {
  return <span className="block rounded-full" style={{ width: w, height: h, background: `rgb(255 255 255 / ${tone})` }} />
}

/**
 * Continuous completion ring — LevelRing's arc idiom, drawn as one stroke so it
 * can animate its dashoffset when the section scrolls into view.
 */
export function CompletionRing({ pct, size = 112, stroke = 9 }: { pct: number; size?: number; stroke?: number }) {
  const gid = useId()
  const r = (size - stroke) / 2 - 1
  const circ = 2 * Math.PI * r
  const arc = circ * (1 - Math.min(100, Math.max(0, pct)) / 100)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={RING_GRADIENT_FROM} />
            <stop offset="55%" stopColor="var(--color-action-primary-strong)" />
            <stop offset="100%" stopColor="var(--color-action-primary)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-tertiary)" strokeWidth={stroke} />
        <circle
          className="ls-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ '--ls-circ': String(circ), '--ls-arc': String(arc) } as Vars}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[24px] font-extrabold leading-none text-text-primary">{pct}%</span>
        <span className="mt-[4px] text-[9px] font-bold uppercase tracking-[0.08em] text-text-muted">Complete</span>
      </span>
    </div>
  )
}

/** ProgressCluster's two-bar stack: gradient "complete" bar + thin master bar. */
function ProgressBars({ owned, total, pct, second }: { owned: number; total: number; pct: number; second: number }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-[6px] text-[10px] font-bold leading-[15px] text-text-muted">
        <span className="text-[15px] font-extrabold text-text-primary">{owned.toLocaleString()}</span>/{total} Collected
      </div>
      <div className="relative h-[6px] w-full rounded-full bg-surface-primary">
        <div
          className="ls-bar-fill h-full rounded-full"
          style={
            {
              '--ls-bar': `${pct}%`,
              background: PROGRESS_GRADIENT,
            } as Vars
          }
        />
        {[25, 50, 75].map((m) => (
          <span
            key={m}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] leading-none"
            style={{ left: `${m}%`, color: pct >= m ? 'var(--color-action-primary-strong)' : 'var(--color-text-muted)' }}
          >
            {pct >= m ? '★' : '●'}
          </span>
        ))}
      </div>
      <div className="mt-[5px] flex items-center gap-[8px]">
        <div className="relative h-[2px] flex-1 rounded-full bg-surface-primary">
          <div className="ls-bar-fill h-full rounded-full bg-success" style={{ '--ls-bar': `${second}%` } as Vars} />
        </div>
        <span className="text-[9px] font-bold uppercase tracking-wide text-success">Master</span>
      </div>
    </div>
  )
}

/** The app's white rounded set-symbol tile, with a derived acronym (ui.tsx §SetSymbolTile). */
function SetTag({ tag, size = 34 }: { tag: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg bg-surface-on-light font-black leading-none text-surface-on-light-text"
      style={{ width: size, height: size, fontSize: size * (tag.length >= 3 ? 0.32 : 0.4) }}
    >
      {tag}
    </span>
  )
}

/* ── 1 · hero: an assistant grounded in YOUR collection ───────────────────────
 * The differentiator is not "there is a chat" — every product has one of those.
 * It is that the reply is answered out of the visitor's own shelf. So the bubble
 * is deliberately small and the thing it *cites* is large: a real DeckPal
 * readiness panel, owned-vs-missing, with the cards you are short on and what
 * they cost. The chrome bar says "your assistant", not a vendor name: DeckPal
 * ships no assistant of its own, you point yours at it.
 *
 * The arithmetic is checked, because a mockup whose numbers do not reconcile is
 * the fastest way to look fake: 54 owned + 6 missing = 60, and
 * 2 × $4.10 + 4 × $1.25 = $13.20.
 * ───────────────────────────────────────────────────────────────────────────── */

const AGENT_TOOL_CALLS = ['collection_summary', 'search_cards', 'decks']

const AGENT_MISSING = [
  { qty: 2, kind: 'Stadium', code: 'SSP 142', price: '$4.10', accent: 'var(--color-variant-holofoil)', w: '36%' },
  {
    qty: 4,
    kind: 'Special Energy',
    code: 'SCR 088',
    price: '$1.25',
    accent: 'var(--color-variant-reverse-holo)',
    w: '48%',
  },
]

export function AgentMockup() {
  return (
    <AppFrame
      label="your assistant · DeckPal connector"
      ariaLabel="Illustration of an AI assistant connected to DeckPal: the question “what can I build from what I own?”, the DeckPal tools it called, and a reply citing a 54-of-60 deck with the missing cards and their prices."
    >
      {/* the ask */}
      <div className="flex justify-end">
        <p className="max-w-[88%] rounded-2xl rounded-br-[7px] bg-action-primary px-[13px] py-[9px] text-[13px] font-semibold leading-[1.45] text-action-primary-text">
          What can I build from what I own?
        </p>
      </div>

      {/* the tools it reached for — named, so the mechanism is legible */}
      <div className="mt-[13px] flex flex-wrap items-center gap-[6px]">
        <span
          className="inline-flex items-center gap-[5px] rounded-full bg-halo-neutral px-[9px] py-[4px] text-[10px] font-bold text-action-primary"
          style={{ boxShadow: 'inset 0 0 0 1px var(--color-overlay-ring)' }}
        >
          <Icon name="sparkle" size={12} /> DeckPal
        </span>
        {AGENT_TOOL_CALLS.map((t) => (
          <span
            key={t}
            className="rounded-full bg-surface-tertiary px-[8px] py-[4px] font-mono text-[10px] font-semibold text-text-secondary"
          >
            {t}
          </span>
        ))}
        <span className="text-[10px] text-text-muted">reading your collection</span>
      </div>

      {/* the answer */}
      <div className="mt-[13px] flex gap-[9px]">
        <span
          className="mt-[1px] flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-text-secondary"
          style={{ boxShadow: 'inset 0 0 0 1px var(--color-border-default)' }}
        >
          <Icon name="sparkle" size={15} />
        </span>
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-[7px] border border-border-default bg-surface-tertiary-subtle p-[11px] sm:p-[13px]">
          <p className="text-[13px] leading-[1.55] text-text-body">
            You are six cards off a Standard lightning list —{' '}
            <strong className="font-bold text-text-primary">54 of the 60 are already in your binder</strong>, and the
            rest come to $13.20.
          </p>

          <div className="mt-[11px] rounded-xl border border-border-default bg-surface-secondary p-[11px]">
            <div className="flex items-center gap-[10px]">
              <SetTag tag="SSP" size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-bold text-text-primary">Lightning Box</span>
                <span className="block truncate text-[10px] text-text-muted">Standard · Surging Sparks core</span>
              </span>
              <span className="shrink-0 text-[13px] font-extrabold tabular-nums text-text-primary">54/60</span>
            </div>

            <div className="relative mt-[9px] h-[6px] w-full rounded-full bg-surface-primary">
              <div
                className="ls-bar-fill h-full rounded-full"
                style={
                  {
                    '--ls-bar': '90%',
                    '--ls-delay': '460ms',
                    background: PROGRESS_GRADIENT,
                  } as Vars
                }
              />
            </div>

            <div className="mt-[9px] flex flex-wrap items-center gap-[6px]">
              <span className="inline-flex items-center gap-[5px] rounded-full bg-halo-success px-[8px] py-[3px] text-[10px] font-bold text-success">
                <Icon name="check" size={11} strokeWidth={2.6} /> 54 owned
              </span>
              <span className="inline-flex items-center gap-[5px] rounded-full bg-surface-tertiary px-[8px] py-[3px] text-[10px] font-bold text-text-secondary">
                6 missing
              </span>
            </div>

            <div className="mt-[10px] flex flex-col gap-[8px] border-t border-divider-subtle pt-[10px]">
              {AGENT_MISSING.map((m) => (
                <div key={m.code} className="flex items-center gap-[9px]">
                  <span className="w-[22px] shrink-0">
                    <CardPlaceholder accent={m.accent} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
                    <span className="flex items-center gap-[7px]">
                      <span className="shrink-0 text-[11px] font-extrabold leading-none tabular-nums text-text-primary">
                        ×{m.qty}
                      </span>
                      <Bar w={m.w} h={6} tone={0.2} />
                    </span>
                    <span className="truncate text-[10px] leading-none text-text-muted">
                      {m.kind} · {m.code}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-bold tabular-nums text-text-secondary">{m.price}</span>
                </div>
              ))}
            </div>

            <div className="mt-[10px] flex items-center justify-between gap-[8px] border-t border-divider-subtle pt-[10px]">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted">Buy the rest</span>
              <span className="inline-flex items-center gap-[6px] rounded-lg bg-action-primary px-[10px] py-[5px] text-[11px] font-extrabold text-action-primary-text">
                <Icon name="cart" size={12} /> $13.20
              </span>
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  )
}

/* ── 2 · collection: ring + variants ──────────────────────────────────────── */

const VARIANTS = [
  { label: 'Normal', color: 'var(--color-variant-normal)', dark: true, qty: 3 },
  { label: 'Reverse Holofoil', color: 'var(--color-variant-reverse-holo)', dark: false, qty: 2 },
  { label: 'Holofoil', color: 'var(--color-variant-holofoil)', dark: false, qty: 1 },
  { label: 'Additional', color: 'var(--color-variant-other)', dark: true, qty: 0 },
]

export function ProgressMockup() {
  return (
    <AppFrame
      label="deckpal.app/series/scarlet-violet/sv08"
      ariaLabel="Illustration of a set page: a completion ring at 78 percent, a collected-versus-total progress bar, and per-printing counters."
    >
      <div className="flex items-center gap-[16px]">
        <CompletionRing pct={78} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-extrabold text-text-primary">Surging Sparks</div>
          <div className="mb-[10px] text-[11px] text-text-muted">Scarlet &amp; Violet · 252 cards</div>
          <ProgressBars owned={197} total={252} pct={78} second={41} />
        </div>
      </div>

      <div className="mt-[16px] flex flex-wrap gap-[6px]">
        {VARIANTS.map((v) => (
          <span
            key={v.label}
            className="inline-flex items-center gap-[6px] rounded-full px-[9px] py-[4px] text-[10px] font-bold"
            style={
              v.qty > 0
                ? { background: v.color, color: v.dark ? 'var(--color-surface-primary)' : '#fff' }
                : {
                    background: 'var(--color-surface-tertiary-transparent)',
                    color: 'var(--color-text-muted)',
                    boxShadow: `inset 0 0 0 1.5px ${v.color}`,
                  }
            }
          >
            {v.label}
            <span className="tabular-nums opacity-80">{v.qty}</span>
          </span>
        ))}
      </div>

      <div className="mt-[14px] grid grid-cols-5 gap-[8px]">
        {[
          'var(--color-variant-normal)',
          'var(--color-variant-holofoil)',
          'var(--color-variant-reverse-holo)',
          'var(--color-variant-other)',
          'var(--color-variant-normal)',
        ].map((accent, i) => (
          <div key={i} className="relative">
            <CardPlaceholder accent={accent} dim={i === 3} />
            <span
              className="absolute -top-[5px] right-[3px] flex h-[19px] min-w-[19px] items-center justify-center rounded-[6px] px-[4px] text-[11px] font-extrabold leading-none shadow-panel"
              style={
                i === 3
                  ? {
                      background: 'var(--color-surface-tertiary-transparent)',
                      color: 'var(--color-text-muted)',
                      boxShadow: `inset 0 0 0 2px ${accent}`,
                    }
                  : { background: accent, color: i === 0 || i === 4 ? 'var(--color-surface-primary)' : '#fff' }
              }
            >
              {i === 3 ? 0 : i + 1}
            </span>
          </div>
        ))}
      </div>
    </AppFrame>
  )
}

/* ── 3 · value over time ──────────────────────────────────────────────────── */

const SERIES_POINTS = [3418, 3465, 3402, 3540, 3611, 3572, 3688, 3742, 3701, 3830, 3906, 3884, 3975, 4061, 4183]
const RANGES = ['30 Days', '3 Months', '6 Months', '1 Year']

export function ValueMockup() {
  const gid = useId()
  const W = 560
  const H = 190
  const padL = 8
  const padR = 8
  const padT = 12
  const padB = 24
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const min = Math.min(...SERIES_POINTS)
  const max = Math.max(...SERIES_POINTS)
  const pad = (max - min) * 0.18
  const lo = min - pad
  const range = max + pad - lo
  const x = (i: number) => padL + (i / (SERIES_POINTS.length - 1)) * plotW
  const y = (v: number) => padT + (1 - (v - lo) / range) * plotH
  const line = SERIES_POINTS.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L ${x(SERIES_POINTS.length - 1).toFixed(1)} ${padT + plotH} L ${padL} ${padT + plotH} Z`

  return (
    <AppFrame
      label="deckpal.app/insights"
      ariaLabel="Illustration of the insights page: total collection value with a rising area chart over six months."
    >
      <div className="flex flex-wrap items-end justify-between gap-[10px]">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted">
            Total Estimated Collection Value
          </div>
          <div className="mt-[3px] flex items-baseline gap-[8px]">
            <span className="text-[27px] font-extrabold leading-none text-text-primary tabular-nums">$4,182.60</span>
            <span className="rounded-full bg-halo-success px-[8px] py-[2px] text-[11px] font-bold text-change-positive">
              +$126.40 · 3.1%
            </span>
          </div>
        </div>
        <div className="flex gap-[4px]">
          {RANGES.map((r) => (
            <span
              key={r}
              className={[
                'rounded-full px-[9px] py-[4px] text-[10px] font-semibold',
                r === '6 Months'
                  ? 'bg-action-primary text-action-primary-text'
                  : 'bg-surface-tertiary text-text-secondary',
              ].join(' ')}
            >
              {r}
            </span>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        className="mt-[12px] block"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-action-primary)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--color-action-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => {
          const yy = padT + (plotH * i) / 3
          return (
            <line
              key={i}
              x1={padL}
              x2={W - padR}
              y1={yy}
              y2={yy}
              stroke="var(--color-divider-subtle)"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
          )
        })}
        <path className="ls-chart-area" d={area} fill={`url(#${gid})`} />
        <path
          className="ls-chart-line"
          d={line}
          pathLength={1}
          fill="none"
          stroke="var(--color-action-primary)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {SERIES_POINTS.map((v, i) =>
          i % 3 === 0 || i === SERIES_POINTS.length - 1 ? (
            <circle
              key={i}
              className="ls-chart-dot"
              cx={x(i)}
              cy={y(v)}
              r={3}
              fill="var(--color-action-primary)"
              stroke="var(--color-surface-secondary)"
              strokeWidth={2}
              style={{ '--ls-delay': `${900 + i * 40}ms` } as Vars}
            />
          ) : null,
        )}
      </svg>

      <div className="mt-[2px] flex justify-between text-[10px] text-text-muted">
        {['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'].map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
    </AppFrame>
  )
}

/* ── 4 · deck builder ─────────────────────────────────────────────────────── */

const DECK_ROWS: { section: string; count: number; rows: { w: string; qty: number; energy?: string }[] }[] = [
  { section: 'Pokémon', count: 14, rows: [{ w: '58%', qty: 4 }, { w: '44%', qty: 3 }, { w: '66%', qty: 2 }] },
  { section: 'Trainer', count: 34, rows: [{ w: '50%', qty: 4 }, { w: '62%', qty: 4 }] },
  {
    section: 'Energy',
    count: 12,
    rows: [
      { w: '46%', qty: 8, energy: 'lightning' },
      { w: '52%', qty: 4, energy: 'water' },
    ],
  },
]

export function DeckMockup() {
  return (
    <AppFrame
      label="deckpal.app/decks/42"
      ariaLabel="Illustration of the deck builder: sixty cards grouped into Pokémon, Trainer and Energy sections, with a version history and an export-to-PTCG-Live action."
    >
      <div className="mb-[12px] flex flex-wrap items-center gap-[6px]">
        <span className="rounded-full bg-surface-tertiary px-[9px] py-[4px] text-[10px] font-bold text-text-primary">
          Standard
        </span>
        <span className="rounded-full bg-halo-success px-[9px] py-[4px] text-[10px] font-bold text-success">Legal</span>
        <span className="rounded-full bg-surface-tertiary px-[9px] py-[4px] text-[10px] font-bold text-text-secondary">
          12W – 4L – 1T
        </span>
        <span className="ml-auto text-[13px] font-extrabold tabular-nums text-text-primary">60/60</span>
      </div>

      <div className="rounded-xl border border-border-default bg-surface-tertiary-subtle p-[10px]">
        {DECK_ROWS.map((g) => (
          <div key={g.section} className="mb-[8px] last:mb-0">
            <div className="mb-[6px] text-[9px] font-extrabold uppercase tracking-[0.1em] text-text-muted">
              {g.section} ({g.count})
            </div>
            {g.rows.map((r, i) => (
              <div key={i} className="flex items-center gap-[9px] border-b border-divider-subtle/40 py-[6px] last:border-0">
                {r.energy ? (
                  <EnergyIcon type={r.energy} size={18} />
                ) : (
                  <span className="h-[18px] w-[13px] shrink-0 rounded-[3px] bg-surface-quaternary" />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
                  <Bar w={r.w} h={7} tone={0.2} />
                  <Bar w="26%" h={5} tone={0.09} />
                </span>
                <span className="shrink-0 rounded-[6px] bg-surface-tertiary px-[7px] py-[2px] text-[11px] font-extrabold tabular-nums text-text-primary">
                  ×{r.qty}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
        <span className="inline-flex items-center gap-[6px] rounded-lg bg-action-primary px-[12px] py-[7px] text-[11px] font-bold text-action-primary-text">
          <Icon name="external" size={13} /> Export to PTCG Live
        </span>
        <span className="inline-flex items-center gap-[6px] rounded-lg bg-surface-tertiary px-[12px] py-[7px] text-[11px] font-bold text-text-primary">
          <Icon name="shuffle" size={13} /> Test Hand
        </span>
        <span className="inline-flex items-center gap-[6px] rounded-lg bg-surface-tertiary px-[10px] py-[7px] text-[11px] font-semibold text-text-secondary">
          <Icon name="history" size={13} /> v7
        </span>
      </div>
    </AppFrame>
  )
}

/* ── 5 · scanner ──────────────────────────────────────────────────────────── */

export function ScanMockup() {
  return (
    <AppFrame
      label="deckpal.app/scan"
      ariaLabel="Illustration of the card scanner: a camera viewport with a focus reticle over a card, and a ranked list of matches below."
    >
      <div className="relative overflow-hidden rounded-xl bg-surface-primary" style={{ aspectRatio: '4 / 3' }}>
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(75% 60% at 50% 45%, var(--color-surface-tertiary), var(--color-surface-primary) 78%)' }}
        />
        {/* the card being scanned */}
        <div className="absolute left-1/2 top-1/2 w-[34%] -translate-x-1/2 -translate-y-1/2">
          <CardPlaceholder accent="var(--color-variant-reverse-holo)" />
        </div>
        {/* focus reticle — four corner brackets, with the scan line sweeping
            inside it so the two read as one alignment affordance */}
        <div className="absolute left-1/2 top-1/2 h-[74%] w-[42%] -translate-x-1/2 -translate-y-1/2">
          <span className="ls-reticle absolute inset-0">
            {(
              [
                'left-0 top-0 border-l-2 border-t-2 rounded-tl-md',
                'right-0 top-0 border-r-2 border-t-2 rounded-tr-md',
                'left-0 bottom-0 border-b-2 border-l-2 rounded-bl-md',
                'right-0 bottom-0 border-b-2 border-r-2 rounded-br-md',
              ] as const
            ).map((c) => (
              <span key={c} className={`absolute h-[22px] w-[22px] border-action-primary ${c}`} />
            ))}
          </span>
          <span
            className="ls-scanline absolute inset-x-[4%] h-[2px] rounded-full"
            style={{
              background: 'linear-gradient(90deg, transparent, var(--color-action-primary), transparent)',
              boxShadow: '0 0 14px var(--color-glow-active)',
            }}
          />
        </div>
        <span className="absolute bottom-[10px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-overlay-scrim-strong px-[10px] py-[4px] text-[10px] font-semibold text-text-primary">
          Hold steady — no shutter needed
        </span>
      </div>

      <div className="mt-[12px] flex flex-col gap-[7px]">
        {[
          { pct: 98, best: true, accent: 'var(--color-variant-reverse-holo)' },
          { pct: 71, best: false, accent: 'var(--color-variant-normal)' },
          { pct: 64, best: false, accent: 'var(--color-variant-holofoil)' },
        ].map((m, i) => (
          <div
            key={i}
            className={[
              'flex items-center gap-[10px] rounded-lg border px-[9px] py-[7px]',
              m.best ? 'border-action-primary/40 bg-halo-neutral' : 'border-border-default bg-surface-tertiary-subtle',
            ].join(' ')}
          >
            <span className="w-[24px] shrink-0">
              <CardPlaceholder accent={m.accent} dim={!m.best} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
              <Bar w={m.best ? '56%' : '44%'} h={7} tone={m.best ? 0.26 : 0.13} />
              <Bar w="30%" h={5} tone={0.09} />
            </span>
            <span
              className={[
                'shrink-0 rounded-full px-[8px] py-[3px] text-[10px] font-bold tabular-nums',
                m.best ? 'bg-action-primary text-action-primary-text' : 'bg-surface-tertiary text-text-secondary',
              ].join(' ')}
            >
              {m.best ? `Best match · ${m.pct}%` : `${m.pct}%`}
            </span>
          </div>
        ))}
      </div>
    </AppFrame>
  )
}

/* ── 6 · binder ───────────────────────────────────────────────────────────── */

const POCKETS: (string | null)[] = [
  'var(--color-variant-normal)',
  'var(--color-variant-holofoil)',
  null,
  'var(--color-variant-reverse-holo)',
  'var(--color-variant-normal)',
  'var(--color-variant-other)',
  null,
  'var(--color-variant-holofoil)',
  'var(--color-variant-reverse-holo)',
]

export function BinderMockup() {
  return (
    <AppFrame
      label="deckpal.app/lists/binder"
      ariaLabel="Illustration of the nine-pocket binder view: a three-by-three page of card slots with two empty pockets."
    >
      <div className="mb-[12px] flex flex-wrap items-center gap-[6px]">
        {['9-Pocket', '4-Pocket', '12-Pocket'].map((p) => (
          <span
            key={p}
            className={[
              'rounded-full px-[9px] py-[4px] text-[10px] font-bold',
              p === '9-Pocket' ? 'bg-action-primary text-action-primary-text' : 'bg-surface-tertiary text-text-secondary',
            ].join(' ')}
          >
            {p}
          </span>
        ))}
        <span className="ml-auto text-[11px] font-semibold text-text-muted">Page 3 / 9</span>
      </div>

      {/* Capped and centred: nine 63:88 pockets across a full feature column
          would run past 1000px tall and dwarf the copy beside it. */}
      <div className="mx-auto grid max-w-[380px] grid-cols-3 gap-[9px] rounded-xl border border-border-default bg-surface-tertiary-subtle p-[9px]">
        {POCKETS.map((accent, i) =>
          accent ? <CardPlaceholder key={i} accent={accent} /> : <EmptyPocket key={i} slot={19 + i} />,
        )}
      </div>

      <div className="mt-[12px] flex items-center justify-between">
        <span className="inline-flex items-center gap-[5px] rounded-lg bg-surface-tertiary px-[10px] py-[6px] text-[11px] font-semibold text-text-secondary">
          <Icon name="chevron-left" size={13} /> Prev
        </span>
        <span className="text-[11px] text-text-muted">7 of 9 pockets filled</span>
        <span className="inline-flex items-center gap-[5px] rounded-lg bg-surface-tertiary px-[10px] py-[6px] text-[11px] font-semibold text-text-secondary">
          Next <Icon name="chevron-right" size={13} />
        </span>
      </div>
    </AppFrame>
  )
}
