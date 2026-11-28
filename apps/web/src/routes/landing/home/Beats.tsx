/* The four story beats: Plan, Playtest, Tune, Build. Each is a big short
 * headline, two or three lines, and a small looping mock of the product doing
 * the thing, so the page shows rather than explains. The mocks are simplified
 * recreations with real card art and an "Example" label; the full versions,
 * with the real demos and every detail, are on /features.
 *
 * Every mock is a useStepLoop timeline: plays while on screen, holds its last
 * frame, starts again. Reduced motion shows the last frame and never moves. */
import { useRef, type ReactNode } from 'react'
import { Icon } from '../../../components/Icon'
import { COPY, type StageId } from '../copy'
import { MISSING, artUrl } from '../data'
import { type Vars, usePrefersReducedMotion } from '../parts'
import { STEP_ICON } from './HowItWorks'
import { useStepLoop } from './useStepLoop'

/** A card face from the app's own image tier. Lazy, sized, never shifts. */
export function CardArt({ id, className = '', style }: { id: string; className?: string; style?: Vars }) {
  return (
    <img
      className={`hm-card ${className}`}
      style={style}
      src={artUrl(id)}
      width={245}
      height={342}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  )
}

function Beat({ id, flip, headline, body, children }: { id: StageId; flip?: boolean; headline: string; body: string; children: ReactNode }) {
  return (
    <section className={`hm-sec hm-beat ${flip ? 'is-flip' : ''}`} id={id} aria-labelledby={`${id}-title`}>
      <div className="ls-wrap hm-beat-in">
        <div className="hm-beat-copy" data-reveal>
          <span className="hm-beat-badge" aria-hidden="true">
            <Icon name={STEP_ICON[id]} size={20} strokeWidth={2.2} />
          </span>
          <h2 className="hm-h2" id={`${id}-title`}>
            {headline}
          </h2>
          <p className="hm-lead">{body}</p>
        </div>
        <div className="hm-beat-visual" data-reveal style={{ '--lp-delay': '80ms' } as Vars}>
          {children}
        </div>
      </div>
    </section>
  )
}

function Mock({ at, hold, label, className, children }: { at: readonly number[]; hold: number; label: string; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  useStepLoop(ref, at, hold, reduced)
  return (
    <div ref={ref} className={`hm-mock ${className}`} role="img" aria-label={label}>
      <span className="hm-example">{COPY.exampleLabel}</span>
      {children}
    </div>
  )
}

/* ── Plan: binder cards slide into a saved deck ───────────────────────────── */

export function PlanBeat() {
  const b = COPY.home.beats.plan
  const ids = ['me05-036', 'me05-037', 'me05-038']
  return (
    <Beat id="plan" headline={b.headline} body={b.body}>
      <Mock at={[200, 900, 1500, 2100]} hold={3600} label={`${b.ask} ${b.deck}. ${b.owned}.`} className="hm-mock-plan">
        <p className="hm-bubble hm-bubble-you hm-s1">{b.ask}</p>
        <div className="hm-plan-fan">
          {ids.map((id, i) => (
            <CardArt key={id} id={id} className="hm-plan-card hm-s2" style={{ '--i': i }} />
          ))}
        </div>
        <div className="hm-deck hm-s3">
          <span className="hm-deck-icon" aria-hidden="true">
            <Icon name="cards" size={20} />
          </span>
          <span className="hm-deck-body">
            <strong>{b.deck}</strong>
            <span className="hm-meter" aria-hidden="true">
              <span className="hm-s4" />
            </span>
            <span className="hm-muted">{b.owned}</span>
          </span>
        </div>
      </Mock>
    </Beat>
  )
}

/* ── Playtest: an opening hand deals into a fan ───────────────────────────── */

const HAND = ['me05-036', 'sv08.5-035', 'me02.5-184', 'me02.5-213', 'me01-125', 'me02.5-192', 'mee-005']

export function PlaytestBeat() {
  const b = COPY.home.beats.playtest
  return (
    <Beat id="playtest" flip headline={b.headline} body={b.body}>
      <Mock at={[150, 1300]} hold={3400} label={`${b.hand}: Litwick, Duskull, Buddy-Buddy Poffin, Ultra Ball, Rare Candy, Lillie's Determination, Psychic Energy. ${b.verdict}`} className="hm-mock-hand">
        <p className="hm-mock-title">{b.hand}</p>
        <div className="hm-hand">
          {HAND.map((id, i) => (
            <CardArt key={id} id={id} className="hm-hand-card hm-s1" style={{ '--i': i, '--o': i - 3 }} />
          ))}
        </div>
        <p className="hm-pill hm-pill-ok hm-s2">
          <Icon name="check" size={16} strokeWidth={2.6} />
          {b.verdict}
        </p>
      </Mock>
    </Beat>
  )
}

/* ── Tune: a log reads in, a result lands, a swap is suggested ────────────── */

export function TuneBeat() {
  const b = COPY.home.beats.tune
  return (
    <Beat id="tune" headline={b.headline} body={b.body}>
      <Mock at={[150, 650, 1150, 1900, 2700]} hold={3400} label={`${b.log.join(' ')} ${b.result}. ${b.swapIn}. ${b.swapOut}.`} className="hm-mock-tune">
        <div className="hm-log">
          {b.log.map((line, i) => (
            <p key={line} className={`hm-log-line hm-s${i + 1}`}>
              {line}
            </p>
          ))}
        </div>
        <p className="hm-pill hm-pill-bad hm-s4">{b.result}</p>
        <div className="hm-swap hm-s5">
          <span className="hm-swap-row is-in">
            <CardArt id="me05-037" className="hm-swap-card" />
            {b.swapIn}
          </span>
          <span className="hm-swap-row is-out">
            <CardArt id="me03-082" className="hm-swap-card" />
            {b.swapOut}
          </span>
        </div>
      </Mock>
    </Beat>
  )
}

/* ── Build: the missing cards, priced, and one button ─────────────────────── */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function BuildBeat() {
  const b = COPY.home.beats.build
  const total = MISSING.reduce((a, m) => a + m.qty * m.price, 0)
  return (
    <Beat id="build" flip headline={b.headline} body={b.body}>
      <Mock at={[150, 1500, 2300]} hold={3000} label={`${b.title}. ${b.total} ${usd.format(total)}. ${b.button}.`} className="hm-mock-build">
        <p className="hm-mock-title">{b.title}</p>
        <ul className="hm-missing">
          {MISSING.map((m, i) => (
            <li key={m.id} className="hm-s1" style={{ '--i': i } as Vars}>
              <CardArt id={m.id} className="hm-missing-card" />
              <span className="hm-missing-name">{m.name}</span>
              <span className="hm-muted">x{m.qty}</span>
              <span className="hm-missing-price">{usd.format(m.qty * m.price)}</span>
            </li>
          ))}
        </ul>
        <p className="hm-total hm-s2">
          <span>{b.total}</span>
          <strong>{usd.format(total)}</strong>
        </p>
        <span className="hm-fakebtn hm-s3">
          <Icon name="cart" size={18} />
          {b.button}
        </span>
      </Mock>
    </Beat>
  )
}
