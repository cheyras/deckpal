/* "Ask it anything": a chat window that plays example conversations one after
 * another, each carried to the end of a real task, with the opening questions as
 * chips beneath it. Clicking a chip plays that conversation and stops the
 * autoplay. The answers are examples, labelled as such; there is no live AI
 * here. Moving content that starts by itself gets a pause control (WCAG 2.2.2),
 * stops off screen, and under reduced motion shows one finished conversation. */
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { COPY, type ChatLine } from '../copy'
import { Photo, PrimaryCta, Reveal, SectionHead, useOnScreen, usePrefersReducedMotion } from '../parts'

const CHAR_MS = 20
const BEFORE_TYPE = 400
const DOTS_MS = 800
const READ_MS_PER_CHAR = 30
const READ_MIN = 1500
const END_HOLD = 2600

type Beat = { from: number; show: number; line: ChatLine }

/** The visitor's question, then the turns, as one timeline. */
function timeline(q: string, turns: readonly ChatLine[]): { beats: Beat[]; total: number } {
  const lines: ChatLine[] = [{ who: 'you', text: q }, ...turns]
  const beats: Beat[] = []
  let t = 250
  for (const line of lines) {
    if (line.who === 'you') {
      const from = t + BEFORE_TYPE
      beats.push({ from, show: from, line })
      t = from + line.text.length * CHAR_MS
    } else {
      const show = t + DOTS_MS
      beats.push({ from: t, show, line })
      t = show + Math.max(READ_MIN, line.text.length * READ_MS_PER_CHAR)
    }
  }
  return { beats, total: t + END_HOLD }
}

function lastReply(beats: Beat[], tt: number): string {
  for (let k = beats.length - 1; k >= 0; k--) {
    const b = beats[k]
    if (b.line.who === 'ai' && tt >= b.show) return b.line.text
  }
  return ''
}

export function AskSection() {
  const a = COPY.ask
  return (
    <section className="lp-sec lp-ask" id="ask" aria-labelledby="ask-title">
      <div className="lp-ask-bg" aria-hidden="true">
        <Photo name="ask" alt="" sizes="100vw" />
      </div>
      <div className="ls-wrap">
        <Reveal>
          <SectionHead eyebrow={a.eyebrow} title={a.headline} id="ask-title" center>
            <p className="lp-lede lp-lede-center">{a.body}</p>
          </SectionHead>
        </Reveal>
        <Playground />
        <div className="lp-ask-cta">
          <PrimaryCta>{a.cta}</PrimaryCta>
        </div>
      </div>
    </section>
  )
}

function Playground() {
  const a = COPY.ask
  const prompts = a.prompts
  const reduced = usePrefersReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(ref)
  const [i, setI] = useState(0)
  const [t, setT] = useState(0)
  const [auto, setAuto] = useState(true)
  const [paused, setPaused] = useState(false)
  const { beats, total } = timeline(prompts[i].q, prompts[i].turns)
  // A picked conversation still plays out; it just doesn't hand on to the next.
  const finished = t >= total
  const running = !reduced && onScreen && !paused && !(finished && !auto)

  useEffect(() => {
    if (!running) return
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      setT((x) => x + Math.min(now - last, 250))
      last = now
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [running])

  useEffect(() => {
    if (auto && t > total) {
      setI((x) => (x + 1) % prompts.length)
      setT(0)
    }
  }, [auto, t, total, prompts.length])

  const tt = reduced ? total : t

  const pick = (j: number) => {
    setAuto(false)
    setPaused(false)
    setI(j)
    setT(0)
  }

  return (
    <div className={`lp-play ${paused || (finished && !auto) ? 'is-paused' : ''}`} ref={ref}>
      <div className="lp-play-window">
        <div className="lp-play-head">
          <span className="lp-phone-dot" aria-hidden="true" />
          <span>{a.ai}</span>
          <span className="lp-example">{COPY.exampleLong}</span>
          <span className="flex-1" />
          {!reduced && (
            <button
              type="button"
              className="lp-icon-btn"
              onClick={() => {
                if (!auto) {
                  setAuto(true)
                  setPaused(false)
                  if (finished) {
                    setT(0)
                    setI((x) => (x + 1) % prompts.length)
                  }
                } else setPaused((p) => !p)
              }}
              aria-label={auto && !paused ? a.pause : a.play}
            >
              <Icon name={auto && !paused ? 'pause' : 'play'} size={14} strokeWidth={2.4} />
            </button>
          )}
        </div>
        <div className="lp-play-body">
          {beats.map((b, k) => {
            if (tt < b.from) return null
            const you = b.line.who === 'you'
            if (you) {
              const chars = Math.min(b.line.text.length, Math.floor((tt - b.from) / CHAR_MS))
              return (
                <div key={`${i}-${k}`} className="lp-msg lp-msg-you">
                  {k === 0 && <span className="lp-msg-who">{a.you}</span>}
                  <p className="lp-bubble lp-bubble-you">
                    {b.line.text.slice(0, chars)}
                    {chars < b.line.text.length && <span className="lp-caret" />}
                  </p>
                </div>
              )
            }
            return (
              <div key={`${i}-${k}`} className="lp-msg lp-msg-ai">
                {k === 1 && <span className="lp-msg-who">{a.ai}</span>}
                {tt < b.show ? (
                  <p className="lp-bubble lp-bubble-ai lp-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </p>
                ) : (
                  <p className="lp-bubble lp-bubble-ai lp-in">{b.line.text}</p>
                )}
              </div>
            )
          })}
        </div>
        {/* Screen readers hear finished replies to a picked question, never the typing. */}
        <p className="sr-only" aria-live="polite">
          {!auto ? lastReply(beats, tt) : ''}
        </p>
      </div>
      <ul className="lp-chips" aria-label={a.promptsLabel}>
        {prompts.map((p, j) => (
          <li key={p.q} className={j >= 5 ? 'lp-chip-extra' : ''}>
            <button
              type="button"
              className={`lp-chip ${j === i ? 'is-on' : ''}`}
              aria-pressed={!auto && j === i}
              onClick={() => pick(j)}
            >
              {p.q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
