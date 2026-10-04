/* "Works with" strip, the loop diagram, and the slim stage bar that pins while
 * the four stage sections scroll past.
 *
 * The diagram is the page's one signature motion: a marker runs the track once
 * when it scrolls into view, round the Plan, Playtest, Tune loop and out along
 * the branch to Build. Under reduced motion it sits at Build and never moves.
 * Each stage has one icon, used in the diagram, the stage bar and the stage
 * sections, so the three read as one system. */
import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../../../components/Icon'
import { AiLockup, aiIdFor } from '../aiLogos'
import { COPY, type StageId } from '../copy'
import { Reveal, SectionHead, useInView, usePrefersReducedMotion } from '../parts'

export const STAGE_ICON: Record<StageId, IconName> = {
  plan: 'lists',
  playtest: 'cards',
  tune: 'sliders',
  build: 'cart',
}

export function WorksWith() {
  const w = COPY.works
  return (
    <section className="lp-works" aria-labelledby="works-title">
      <div className="ls-wrap lp-works-in">
        <p className="lp-works-lead" id="works-title">
          {w.lead}
        </p>
        <ul className="lp-works-apps">
          {w.apps.map((a) => {
            const id = aiIdFor(a)
            return <li key={a}>{id ? <AiLockup id={id} height={34} /> : a}</li>
          })}
        </ul>
        <p className="lp-works-foot">
          <a className="lp-link" href="#connect">
            {w.link}
            <Icon name="arrow-right" size={16} />
          </a>
          <span className="lp-muted">{w.disclaimer}</span>
        </p>
      </div>
    </section>
  )
}

// Node x positions match the centres of the four step columns below (12.5% ...).
const Y = 64
const NODES: Record<StageId, { x: number; y: number }> = {
  plan: { x: 125, y: Y },
  playtest: { x: 375, y: Y },
  tune: { x: 625, y: Y },
  build: { x: 875, y: Y },
}
const R = 58 // half the loop's height: the end caps are half circles
const LOOP = `M125,${Y} L625,${Y} A${R},${R} 0 0 1 625,${Y + 2 * R} L125,${Y + 2 * R} A${R},${R} 0 0 1 125,${Y}`
const BRANCH = `M625,${Y} L875,${Y}`
const ROUTE = `${LOOP} L625,${Y} L875,${Y}`
const RUN_MS = 4600

export function LoopSection() {
  const l = COPY.loop
  return (
    <section className="lp-sec lp-loop" id="loop" aria-labelledby="loop-title">
      <div className="ls-wrap">
        <Reveal>
          <SectionHead eyebrow={l.eyebrow} title={l.headline} id="loop-title" center>
            <p className="lp-lede lp-lede-center">{l.body}</p>
          </SectionHead>
        </Reveal>
        <div className="lp-loop-figure">
          <LoopDiagram />
          <ol className="lp-steps">
            {l.steps.map((s, i) => (
              <Reveal as="li" key={s.id} delay={i * 80} className={`lp-step lp-step-${s.id}`}>
                <a href={`#${s.id}`}>
                  <span className="lp-step-n" aria-hidden="true">
                    <Icon name={STAGE_ICON[s.id]} size={16} />
                  </span>
                  <span className="lp-step-title">{s.title}</span>
                  <span className="lp-step-body">{s.body}</span>
                </a>
                {/* Phones get no diagram, so the loop-back is said in the list. */}
                {s.id === 'tune' && (
                  <span className="lp-step-loop" aria-hidden="true">
                    <Icon name="history" size={16} />
                    {l.loopLabel}
                  </span>
                )}
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

function LoopDiagram() {
  const l = COPY.loop
  const ref = useRef<SVGSVGElement>(null)
  const route = useRef<SVGPathElement>(null)
  const reduced = usePrefersReducedMotion()
  const seen = useInView(ref, { threshold: 0.5 })
  const [pos, setPos] = useState(NODES.plan)
  const [lit, setLit] = useState<Set<StageId>>(new Set())

  useEffect(() => {
    const path = route.current
    if (!path) return
    const len = path.getTotalLength()
    if (reduced) {
      setPos(NODES.build)
      setLit(new Set(['plan', 'playtest', 'tune', 'build']))
      return
    }
    if (!seen) return
    const start = performance.now()
    let frame = 0
    const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)
    // Distance along the route at which the marker first reaches each node, so a
    // dropped frame can never skip lighting one.
    const at: Record<StageId, number> = {
      plan: 0,
      playtest: NODES.playtest.x - NODES.plan.x,
      tune: NODES.tune.x - NODES.plan.x,
      build: len - 1,
    }
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / RUN_MS)
      const d = ease(k) * len
      const p = path.getPointAtLength(d)
      setPos({ x: p.x, y: p.y })
      setLit((prev) => {
        const ids = (Object.keys(at) as StageId[]).filter((id) => d >= at[id])
        return ids.length === prev.size ? prev : new Set(ids)
      })
      if (k < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [seen, reduced])

  return (
    <svg ref={ref} className="lp-loop-svg" viewBox={`0 0 1000 ${Y + 2 * R + 14}`} role="img" aria-label={l.diagramLabel}>
      <path d={LOOP} className="lp-track" />
      <path d={BRANCH} className="lp-track lp-track-branch" />
      <path ref={route} d={ROUTE} fill="none" stroke="none" />
      {/* the label sits inside the loop it describes */}
      <text x="375" y={Y + R + 6} className="lp-track-label" textAnchor="middle">
        {l.loopLabel}
      </text>
      <path d={`M312,${Y + 2 * R - 7} L298,${Y + 2 * R} L312,${Y + 2 * R + 7}`} className="lp-track-arrow" />
      {(Object.keys(NODES) as StageId[]).map((id) => {
        const n = NODES[id]
        const step = l.steps.find((s) => s.id === id)!
        return (
          <g key={id} className={`lp-node ${lit.has(id) ? 'is-lit' : ''} ${id === 'build' ? 'lp-node-exit' : ''}`}>
            {id === 'build' ? (
              <rect x={n.x - 22} y={n.y - 22} width="44" height="44" rx="12" />
            ) : (
              <circle cx={n.x} cy={n.y} r="22" />
            )}
            <svg x={n.x - 11} y={n.y - 11} width="22" height="22" overflow="visible" className="lp-node-icon">
              <Icon name={STAGE_ICON[id]} size={22} strokeWidth={2} />
            </svg>
            <text x={n.x} y={n.y - 36} textAnchor="middle">
              {step.title}
            </text>
          </g>
        )
      })}
      <circle cx={pos.x} cy={pos.y} r="6" className="lp-marker" />
    </svg>
  )
}

const STAGES: StageId[] = ['plan', 'playtest', 'tune', 'build']

/** Pinned under the nav while any of the four stage sections holds the reading line. */
export function StageBar() {
  const [active, setActive] = useState<StageId | null>(null)
  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const line = window.innerHeight * 0.4
      let hit: StageId | null = null
      for (const id of STAGES) {
        const r = document.getElementById(id)?.getBoundingClientRect()
        if (r && r.top <= line && r.bottom > line) hit = id
      }
      setActive(hit)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  const idx = active ? STAGES.indexOf(active) : -1
  return (
    <nav className={`lp-stagebar ${active ? 'is-on' : ''}`} aria-label={COPY.loop.stageNav} aria-hidden={!active}>
      <ol className="ls-wrap">
        {COPY.loop.steps.map((s, i) => (
          <li key={s.id} className={i === idx ? 'is-active' : i < idx ? 'is-done' : ''}>
            <a href={`#${s.id}`} tabIndex={active ? 0 : -1} aria-current={i === idx ? 'step' : undefined}>
              <span className="lp-stagebar-dot" aria-hidden="true">
                <Icon name={STAGE_ICON[s.id]} size={12} strokeWidth={2.2} />
              </span>
              {s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
