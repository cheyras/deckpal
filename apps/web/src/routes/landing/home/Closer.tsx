/* The quieter half of the home page: which AI apps it works with (the full
 * plan-by-plan comparison is on /connect), then three plain promises: pay what
 * you want, built in the open, yours alone. Each one sentence, no badges. */
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Icon } from '../../../components/Icon'
import { AiLockup, aiIdFor } from '../aiLogos'
import { COPY } from '../copy'
import { GitHubGlyph, REPO, type Vars } from '../parts'

export function WorksSection() {
  const w = COPY.home.works
  return (
    <section className="hm-sec hm-works" id="works" aria-labelledby="works-title">
      <div className="ls-wrap">
        <div className="hm-head" data-reveal>
          <h2 className="hm-h2" id="works-title">
            {w.headline}
          </h2>
          <p className="hm-lead">{w.body}</p>
        </div>
        <ul className="hm-logos" data-reveal style={{ '--lp-delay': '80ms' } as Vars}>
          {COPY.works.apps.map((a) => {
            const id = aiIdFor(a)
            return <li key={a}>{id ? <AiLockup id={id} height={30} /> : a}</li>
          })}
        </ul>
        <p className="hm-more" data-reveal>
          <Link to="/connect" hash="compat" className="hm-link">
            {w.link}
            <Icon name="arrow-right" size={18} />
          </Link>
        </p>
        <p className="hm-fine">{COPY.works.disclaimer}</p>
      </div>
    </section>
  )
}

export function FairSection() {
  const f = COPY.home.fair
  const tiles: { icon: ReactNode; title: string; body: string; link?: { href: string; label: string } }[] = [
    { icon: <Icon name="heart" size={22} strokeWidth={2.2} />, title: f.priceTitle, body: f.priceBody },
    { icon: <Icon name="lock" size={22} strokeWidth={2.2} />, title: f.privateTitle, body: f.privateBody },
    { icon: <GitHubGlyph size={22} />, title: f.codeTitle, body: f.codeBody, link: { href: REPO, label: f.codeLink } },
  ]
  return (
    <section className="hm-sec hm-fair" aria-label="Pricing, privacy and source code">
      <ul className="ls-wrap hm-fair-grid">
        {tiles.map((t, i) => (
          <li key={t.title} className="hm-fair-tile" data-reveal style={{ '--lp-delay': `${i * 80}ms`, '--t': `${[-1.5, 1, -0.5][i]}deg` } as Vars}>
            <span className="hm-fair-icon" aria-hidden="true">
              {t.icon}
            </span>
            <h3 className="hm-h3">{t.title}</h3>
            <p>{t.body}</p>
            {t.link && (
              <a href={t.link.href} target="_blank" rel="noreferrer" className="hm-link">
                {t.link.label}
                <Icon name="external" size={16} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
