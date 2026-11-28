/* The example conversation, on /features since the 2026-11-27 redesign (it was
 * the old home hero): a phone playing one continuous conversation, the whole
 * loop from a first draft to a TCGplayer cart, each task carried to its end. It
 * keeps playing (no hover pause), stops off screen, has a pause button, and
 * under reduced motion shows the finished conversation and never moves. */
import { Fragment, useEffect, useRef, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { COPY, type ChatLine } from '../copy'
import { artUrl } from '../data'
import { ExampleTag, useOnScreen, usePrefersReducedMotion } from '../parts'

/* ── the phone ────────────────────────────────────────────────────────────── */

// One authored sequence, in reading order. Times are ms.
const CHAR_MS = 22 // typing speed for the visitor's lines
const BEFORE_TYPE = 450 // pause before the visitor starts typing
const DOTS_MS = 850 // "thinking" before each reply
const READ_MS_PER_CHAR = 34 // reading time after each reply, so long replies hold longer
const READ_MIN = 1600
const END_HOLD = 4000 // the finished conversation, before it starts over

type Beat = { line: number; typeFrom: number; typeTo: number; showAt: number }

/** When each line starts typing (visitor) or appears (AI), and the total length. */
function schedule(lines: readonly ChatLine[]): { beats: Beat[]; total: number } {
  const beats: Beat[] = []
  let t = 300
  lines.forEach((l, i) => {
    if (l.who === 'you') {
      const typeFrom = t + BEFORE_TYPE
      const typeTo = typeFrom + l.text.length * CHAR_MS
      beats.push({ line: i, typeFrom, typeTo, showAt: typeFrom })
      t = typeTo
    } else {
      const showAt = t + DOTS_MS
      beats.push({ line: i, typeFrom: t, typeTo: showAt, showAt })
      t = showAt + Math.max(READ_MIN, l.text.length * READ_MS_PER_CHAR) + (l.card ? 1200 : 0)
    }
  })
  return { beats, total: t + END_HOLD }
}

export function HeroPhone() {
  const h = COPY.hero
  const lines = h.chat
  const reduced = usePrefersReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(ref)
  const [paused, setPaused] = useState(false)
  // The conversation opens with the first question already asked, so the phone
  // is never a blank screen on load.
  const { beats, total } = schedule(lines)
  const start = beats[1]?.typeFrom ?? 0
  const [t, setT] = useState(start)
  const running = !reduced && onScreen && !paused

  useEffect(() => {
    if (!running) return
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      setT((x) => {
        const n = x + Math.min(now - last, 250)
        return n > total ? start : n
      })
      last = now
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [running, total, start])

  const tt = reduced ? total : t
  const ending = !reduced && tt > total - 500

  return (
    <div ref={ref} className={`lp-phone ${paused ? 'is-paused' : ''}`}>
      <div className="lp-phone-screen" role="img" aria-label={`${h.demoLabel}. ${lines.map((l) => l.text).join(' ')}`}>
        <div className="lp-phone-bar">
          <span className="lp-phone-dot" />
          <span>{h.connected}</span>
          <span className="flex-1" />
          <ExampleTag />
        </div>
        <div className={`lp-chat ${ending ? 'is-ending' : ''}`}>
          {beats.map((b) => {
            const l = lines[b.line]
            if (tt < b.typeFrom) return null
            if (l.who === 'you') {
              const chars = Math.min(l.text.length, Math.floor((tt - b.typeFrom) / CHAR_MS))
              return (
                <div key={b.line} className="lp-bubble lp-bubble-you">
                  {l.text.slice(0, chars)}
                  {chars < l.text.length && <span className="lp-caret" />}
                </div>
              )
            }
            if (tt < b.showAt) {
              return (
                <div key={b.line} className="lp-bubble lp-bubble-ai lp-dots">
                  <i />
                  <i />
                  <i />
                </div>
              )
            }
            return (
              <Fragment key={b.line}>
                <div className="lp-bubble lp-bubble-ai lp-in">{l.text}</div>
                {l.card === 'deck' && <DeckCard />}
                {l.card === 'cart' && <CartCard />}
              </Fragment>
            )
          })}
        </div>
      </div>
      {!reduced && (
        <button
          type="button"
          className="lp-phone-pause"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? h.play : h.pause}
        >
          <Icon name={paused ? 'play' : 'pause'} size={14} strokeWidth={2.4} />
        </button>
      )}
    </div>
  )
}

function DeckCard() {
  const d = COPY.hero.deck
  return (
    <div className="lp-deckcard lp-in-up">
      <div className="lp-deckcard-art">
        {['me05-038', 'sv08.5-037', 'me05-036'].map((id, i) => (
          <img key={id} src={artUrl(id)} alt="" style={{ zIndex: 3 - i }} />
        ))}
      </div>
      <div className="lp-deckcard-body">
        <strong>{d.name}</strong>
        <span className="lp-muted">{d.meta}</span>
        <span className="lp-meter" aria-hidden="true">
          <span style={{ width: `${(48 / 60) * 100}%` }} />
        </span>
        <span className="lp-deckcard-row">
          <span>{d.owned}</span>
          <span className="lp-ok">
            <Icon name="check" size={14} strokeWidth={2.4} /> {d.legal}
          </span>
        </span>
      </div>
    </div>
  )
}

function CartCard() {
  const c = COPY.hero.cart
  return (
    <div className="lp-deckcard lp-cartcard lp-in-up">
      <span className="lp-cartcard-icon" aria-hidden="true">
        <Icon name="cart" size={22} />
      </span>
      <div className="lp-deckcard-body">
        <strong>{c.title}</strong>
        <span className="lp-muted">{c.meta}</span>
        <span className="lp-ok">
          <Icon name="check" size={14} strokeWidth={2.4} /> {c.action}
        </span>
      </div>
    </div>
  )
}
