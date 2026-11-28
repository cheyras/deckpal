/* "How it works": the loop as a timeline. A dashed line, a round badge per
 * step, a bold one-word label and one short line. Vertical on a phone, across
 * on a wide screen. As it scrolls in, the line draws and each badge pops in
 * turn; under reduced motion everything is simply there. The full explanation
 * of every step is on /features. */
import { Link } from '@tanstack/react-router'
import { useRef } from 'react'
import { Icon, type IconName } from '../../../components/Icon'
import { COPY, type StageId } from '../copy'
import { type Vars, useInView } from '../parts'

export const STEP_ICON: Record<StageId, IconName> = {
  plan: 'lists',
  playtest: 'cards',
  tune: 'sliders',
  build: 'cart',
}

export function HowItWorks() {
  const l = COPY.home.loop
  const ref = useRef<HTMLOListElement>(null)
  const seen = useInView(ref, { threshold: 0.25 })
  return (
    <section className="hm-sec hm-how" id="how" aria-labelledby="how-title">
      <div className="ls-wrap">
        <div className="hm-head" data-reveal>
          <h2 className="hm-h2" id="how-title">
            {l.headline}
          </h2>
          <p className="hm-lead">{l.sub}</p>
        </div>
        <ol ref={ref} className={`hm-timeline ${seen ? 'is-seen' : ''}`}>
          {l.steps.map((s, i) => (
            <li key={s.id} className={`hm-tl-step hm-tl-${s.id}`} style={{ '--i': i } as Vars}>
              <span className="hm-tl-badge" aria-hidden="true">
                <Icon name={STEP_ICON[s.id]} size={22} strokeWidth={2.2} />
              </span>
              <div>
                <h3 className="hm-tl-title">{s.title}</h3>
                <p className="hm-tl-body">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="hm-tl-again" data-reveal>
          <Icon name="history" size={18} />
          {l.again}
        </p>
        <p className="hm-more" data-reveal>
          <Link to="/features" className="hm-link">
            {l.more}
            <Icon name="arrow-right" size={18} />
          </Link>
        </p>
      </div>
    </section>
  )
}
