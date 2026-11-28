/* The card orbit: real card art from the app's own image tier, on two rings
 * turning slowly in opposite directions around the catalog's live count.
 *
 * GPU-only: each ring is one element whose `transform: rotate()` is a CSS
 * animation, so the compositor turns it and the main thread does nothing per
 * frame. The cards ride the ring (no per-card animation). `data-play` (set by
 * usePlayWhenVisible) pauses both rings whenever the section is off screen.
 * Phones get the inner ring and half the outer one. Reduced motion: the rings
 * stand still, cards fanned where they are. Images are lazy and sized, so the
 * section is the same height before and after they arrive. */
import { useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { BrandD, Icon } from '../../../components/Icon'
import { COPY } from '../copy'
import { useLiveCatalog } from '../data'
import { type Vars, usePlayWhenVisible } from '../parts'
import { CardArt } from './Beats'

// The sample deck's cards and the three Pitch Black printings of its star: all
// real catalog ids, all already used elsewhere on these pages.
const INNER = ['me05-038', 'sv08.5-037', 'me05-036', 'me02.5-192', 'sv08.5-035', 'me05-115']
const OUTER = ['me05-099', 'me01-125', 'me05-037', 'me02.5-184', 'sv08.5-036', 'me03-077', 'me02.5-213', 'sv10.5w-084', 'me01-114', 'me03-082']

const fmt = new Intl.NumberFormat('en-US')

export function OrbitSection() {
  const o = COPY.home.orbit
  const cat = useLiveCatalog()
  const ref = useRef<HTMLDivElement>(null)
  usePlayWhenVisible(ref)
  const body = o.body.replace('{cards}', fmt.format(cat.cards)).replace('{sets}', fmt.format(cat.sets))
  return (
    <section className="hm-sec hm-orbit" id="catalog" aria-labelledby="orbit-title">
      <div ref={ref} className="hm-orbit-stage" aria-hidden="true">
        <div className="hm-ring hm-ring-inner">
          {INNER.map((id, i) => (
            <span key={id} className="hm-ring-slot" style={{ '--a': `${(360 / INNER.length) * i}deg`, '--t': `${i % 2 ? 8 : -6}deg` } as Vars}>
              <CardArt id={id} className="hm-orbit-card" />
            </span>
          ))}
        </div>
        <div className="hm-ring hm-ring-outer">
          {OUTER.map((id, i) => (
            <span
              key={id}
              className={`hm-ring-slot ${i % 2 ? 'hm-ring-wide' : ''}`}
              style={{ '--a': `${(360 / OUTER.length) * i + 18}deg`, '--t': `${i % 3 === 0 ? -9 : i % 3 === 1 ? 5 : 11}deg` } as Vars}
            >
              <CardArt id={id} className="hm-orbit-card" />
            </span>
          ))}
        </div>
      </div>
      <div className="ls-wrap hm-orbit-copy" data-reveal>
        <span className="hm-orbit-mark" aria-hidden="true">
          <BrandD size={34} />
        </span>
        <h2 className="hm-h2" id="orbit-title">
          {o.headline}
        </h2>
        <p className="hm-lead">{body}</p>
        <Link to="/series" className="ls-cta lp-btn lp-btn-ghost hm-orbit-cta">
          <span>
            {o.cta}
            <span className="lp-btn-note">, {o.note}</span>
          </span>
          <Icon name="arrow-right" size={16} />
        </Link>
      </div>
    </section>
  )
}
