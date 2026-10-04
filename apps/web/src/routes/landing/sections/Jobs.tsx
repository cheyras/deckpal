/* "Give it a job": six things your AI can change in DeckPal, beside one demo of
 * the safety step. A write is previewed first (log_cards defaults to a dry run
 * that shows current and new quantities) and only lands when you approve it. */
import { useState } from 'react'
import { Icon, type IconName } from '../../../components/Icon'
import { COPY } from '../copy'
import { ExampleTag, Reveal, SectionHead } from '../parts'
import { artUrl } from '../data'

const ICONS: IconName[] = ['deck', 'scroll', 'book', 'cards', 'lists', 'cart']
const fmt = new Intl.NumberFormat('en-US')

export function JobsSection() {
  const j = COPY.jobs
  return (
    <section className="lp-sec lp-jobs" id="jobs" aria-labelledby="jobs-title">
      <div className="ls-wrap">
        <Reveal>
          <SectionHead eyebrow={j.eyebrow} title={j.headline} id="jobs-title">
            <p className="lp-lede">{j.body}</p>
          </SectionHead>
        </Reveal>
        <div className="lp-jobs-grid">
          <ApproveDemo />
          <ul className="lp-jobs-list">
            {j.items.map((it, i) => (
              <Reveal as="li" key={it} delay={i * 60} className="lp-job">
                <Icon name={ICONS[i]} size={22} className="lp-job-icon" />
                <span>{it}</span>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function ApproveDemo() {
  const d = COPY.jobs.demo
  const [approved, setApproved] = useState(false)
  const count = d.before + (approved ? 1 : 0)
  return (
    <div className="lp-panel lp-approve">
      <div className="lp-panel-top">
        <span className="lp-panel-title">{COPY.ask.ai}</span>
        <ExampleTag />
      </div>
      <p className="lp-bubble lp-bubble-you">{d.ask}</p>
      <div className={`lp-preview ${approved ? 'is-saved' : ''}`}>
        <p className="lp-preview-head">
          {approved ? (
            <>
              <Icon name="check-circle" size={16} /> {d.approved}
            </>
          ) : (
            d.previewTitle
          )}
        </p>
        <div className="lp-preview-row">
          <img src={artUrl('me05-038')} alt="" />
          <span className="lp-name">
            <strong>
              <span className="lp-plus">+1</span> {d.line}
            </strong>
            <span className="lp-muted">{d.lineMeta}</span>
          </span>
          <span className="lp-delta" aria-label={approved ? d.ownedNow : d.ownedWillBe}>
            <span className={approved ? 'lp-muted' : ''}>0</span>
            <Icon name="arrow-right" size={14} />
            <strong>1</strong>
          </span>
        </div>
        <div className="lp-preview-foot">
          {approved ? (
            <button type="button" className="lp-link-btn" onClick={() => setApproved(false)}>
              {d.again}
            </button>
          ) : (
            <button type="button" className="ls-cta lp-btn lp-btn-primary lp-btn-sm" onClick={() => setApproved(true)}>
              <Icon name="check" size={16} strokeWidth={2.4} />
              {d.approve}
            </button>
          )}
          <span className="lp-muted lp-small">{d.undo}</span>
        </div>
      </div>
      <div className="lp-counter" aria-live="polite">
        <span className="lp-muted">{d.collection}</span>
        <strong key={count} className={approved ? 'lp-roll' : ''}>
          {fmt.format(count)}
        </strong>
      </div>
    </div>
  )
}
