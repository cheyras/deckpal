/* The back half of the page: built by a player (with the open-source facts),
 * connect (steps and an at-a-glance chart; the detail lives on /connect), FAQ,
 * and the closing band. CopyField and CompatTable are shared with /connect. */
import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Icon } from '../../../components/Icon'
import { AiSymbol, aiIdFor } from '../aiLogos'
import { COPY, type CompatRow } from '../copy'
import { BrowseCta, GitHubGlyph, Photo, PrimaryCta, REPO, Reveal, SectionHead, useInView } from '../parts'

/* ── Built by a player ────────────────────────────────────────────────────── */

export function FounderSection() {
  const f = COPY.founder
  return (
    <section className="lp-sec lp-founder" id="open-source" aria-labelledby="founder-title">
      <div className="ls-wrap lp-founder-grid">
        <Reveal className="lp-founder-photo">
          <a href={REPO} target="_blank" rel="noreferrer" className="lp-repo-shot">
            <span className="lp-repo-bar" aria-hidden="true">
              <i />
              <i />
              <i />
              <span>github.com/cheyras/deckpal</span>
            </span>
            <Photo name="github" alt={f.photoAlt} sizes="(min-width: 1024px) 520px, 100vw" />
          </a>
        </Reveal>
        <Reveal className="lp-founder-copy" delay={80}>
          <SectionHead eyebrow={f.eyebrow} title={f.headline} id="founder-title">
            <p className="lp-lede">{f.body}</p>
          </SectionHead>
          {/* A first-person note from the owner goes here once they have written
              it (COPY.founder.note). Nothing ships in their voice before that. */}
          <dl className="lp-facts">
            <div>
              <dt>{f.licenseLabel}</dt>
              <dd>{f.license}</dd>
            </div>
            <div>
              <dt>{f.commitsLabel}</dt>
              <dd>{f.commits}</dd>
            </div>
            <div>
              <dt>{f.prsLabel}</dt>
              <dd>{f.prs}</dd>
            </div>
          </dl>
          <p className="lp-muted lp-small">{f.asOf}</p>
          <a href={REPO} target="_blank" rel="noreferrer" className="ls-cta lp-btn lp-btn-ghost">
            <GitHubGlyph size={18} />
            {f.repoCta}
          </a>
        </Reveal>
      </div>
    </section>
  )
}

/* ── Connect ──────────────────────────────────────────────────────────────── */

export function CopyField({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const id = window.setTimeout(() => setDone(false), 1800)
    return () => window.clearTimeout(id)
  }, [done])
  return (
    <div className="lp-copyfield">
      <code>{value}</code>
      <button
        type="button"
        className="lp-copy-btn"
        aria-label={`${COPY.connect.copy} ${label}`}
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => setDone(true), () => {})
        }}
      >
        <Icon name={done ? 'check' : 'copy'} size={16} />
        <span aria-live="polite">{done ? COPY.connect.copied : COPY.connect.copy}</span>
      </button>
    </div>
  )
}

export function ConnectSection() {
  const c = COPY.connect
  return (
    <section className="lp-sec lp-connect" id="connect" aria-labelledby="connect-title">
      <div className="ls-wrap">
        <Reveal>
          <SectionHead eyebrow={c.eyebrow} title={c.headline} id="connect-title">
            <p className="lp-lede">{c.body}</p>
          </SectionHead>
        </Reveal>
        <ol className="lp-connect-steps">
          {c.steps.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 80} className="lp-connect-step">
              <span className="lp-step-n" aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="lp-h3">{s.title}</h3>
              <p>{s.body}</p>
            </Reveal>
          ))}
        </ol>
        <div className="lp-connect-cta">
          <div className="lp-connect-url">
            <CopyField value={c.mcpUrl} label="connector URL" />
          </div>
          <div className="lp-cta-row">
            <a href={c.addClaudeHref} target="_blank" rel="noreferrer" className="ls-cta lp-btn lp-btn-primary">
              <AiSymbol id="claude" size={18} decorative />
              {c.addClaude}
              <Icon name="external" size={16} />
            </a>
            <a
              href={c.addChatgptHref}
              target="_blank"
              rel="noreferrer"
              className="ls-cta lp-btn lp-btn-ghost"
            >
              <AiSymbol id="chatgpt" size={18} decorative />
              {c.addChatgpt}
              <Icon name="external" size={16} />
            </a>
          </div>
          <ul className="lp-trustlist">
            {c.trust.map((t, i) => (
              <li key={t}>
                <Icon name={i === 0 ? 'shield-check' : 'logout'} size={16} />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <CompatGlance />
      </div>
    </section>
  )
}

/** The landing's chart: one row per app, two answers, and a way to the detail. */
function CompatGlance() {
  const c = COPY.connect
  return (
    <div className="lp-glance">
      <table className="lp-glance-table">
        <caption className="sr-only">{c.summaryLabel}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">{c.columns.app}</span>
            </th>
            <th scope="col">{c.summaryFree}</th>
            <th scope="col">{c.summaryChange}</th>
          </tr>
        </thead>
        <tbody>
          {c.table.map((r) => {
            const id = aiIdFor(r.app)
            return (
              <tr key={r.app}>
                <th scope="row">
                  <span className="lp-app">
                    {id && <AiSymbol id={id} size={22} decorative />}
                    {r.app.split(' ')[0]}
                  </span>
                </th>
                <td>
                  <Answer text={r.freeShort} ok={r.freeOk} />
                </td>
                <td>
                  <Answer text={r.changeShort} ok={r.changeOk} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="lp-glance-foot">
        <Link to={c.learnMoreHref} className="ls-cta lp-btn lp-btn-ghost">
          {c.learnMore}
          <Icon name="arrow-right" size={16} />
        </Link>
        <p className="lp-muted lp-small">
          {c.summaryNote} {c.disclaimer}
        </p>
      </div>
    </div>
  )
}

function Answer({ text, ok }: { text: string; ok: boolean }) {
  return (
    <span className={`lp-answer ${ok ? 'is-yes' : text === 'No' ? 'is-no' : 'is-maybe'}`}>
      <Icon name={ok ? 'check' : text === 'No' ? 'minus' : 'alert'} size={14} strokeWidth={2.4} />
      {text}
    </span>
  )
}

export function CompatTable() {
  const c = COPY.connect
  const [free, setFree] = useState(false)
  const [change, setChange] = useState(false)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const rows = c.table.filter((r) => (!free || r.freeOk) && (!change || r.changeOk))
  return (
    <div className="lp-compat">
      <p className="lp-fineprint">{c.finePrint}</p>
      <div className="lp-compat-bar">
        <span className="lp-checked">
          <Icon name="clipboard-check" size={16} />
          {c.checked}
        </span>
        <div className="lp-filters" role="group" aria-label={c.filtersLabel}>
          <button type="button" className="lp-chip" aria-pressed={free} onClick={() => setFree((v) => !v)}>
            {free && <Icon name="check" size={14} strokeWidth={2.4} />}
            {c.filterFree}
          </button>
          <button type="button" className="lp-chip" aria-pressed={change} onClick={() => setChange((v) => !v)}>
            {change && <Icon name="check" size={14} strokeWidth={2.4} />}
            {c.filterChange}
          </button>
        </div>
      </div>
      <table className="lp-table">
        <thead>
          <tr>
            <th scope="col">{c.columns.app}</th>
            <th scope="col">{c.columns.free}</th>
            <th scope="col">{c.columns.lowest}</th>
            <th scope="col">{c.columns.change}</th>
            <th scope="col">
              <span className="sr-only">{c.columns.notes}</span>
            </th>
          </tr>
        </thead>
        {rows.length === 0 && (
          <tbody>
            <tr>
              <td colSpan={5} className="lp-muted">
                {c.noRows}
              </td>
            </tr>
          </tbody>
        )}
        {rows.map((r) => (
          <CompatBody key={r.app} row={r} open={openRow === r.app} onToggle={() => setOpenRow((o) => (o === r.app ? null : r.app))} />
        ))}
      </table>
    </div>
  )
}

function CompatBody({ row, open, onToggle }: { row: CompatRow; open: boolean; onToggle: () => void }) {
  const c = COPY.connect
  const id = `compat-${row.app.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <tbody className={open ? 'is-open' : ''}>
      <tr>
        <th scope="row">
          <span className="lp-app">
            {aiIdFor(row.app) && <AiSymbol id={aiIdFor(row.app)!} size={22} decorative />}
            {row.app}
          </span>
          {row.tested && (
            <span className="lp-tested">
              <Icon name="check-circle" size={14} />
              {c.testedYes}
            </span>
          )}
        </th>
        <td data-label={c.columns.free}>
          <span className={row.freeOk ? 'lp-yes' : 'lp-no'}>{row.free}</span>
        </td>
        <td data-label={c.columns.lowest}>{row.lowest}</td>
        <td data-label={c.columns.change}>
          <span className={row.changeOk ? 'lp-yes' : 'lp-no'}>{row.change}</span>
        </td>
        <td className="lp-td-toggle">
          <button type="button" className="lp-link-btn" aria-expanded={open} aria-controls={id} onClick={onToggle}>
            {c.showNotes}
            <Icon name="chevron-down" size={16} className="lp-chev" />
          </button>
        </td>
      </tr>
      <tr id={id} className="lp-notes-row" hidden={!open}>
        <td colSpan={5}>
          {row.notes && <p>{row.notes}</p>}
          <p className="lp-muted">{row.tested ? c.testedYes : c.testedNo}</p>
        </td>
      </tr>
    </tbody>
  )
}

/* ── FAQ ──────────────────────────────────────────────────────────────────── */

export function FaqSection() {
  const f = COPY.faq
  const [open, setOpen] = useState<Set<string>>(() => new Set([f.items[0].id]))
  useEffect(() => {
    const open = (hash: string) => {
      const m = hash.match(/^#faq-(.+)$/)
      if (m && f.items.some((i) => i.id === m[1])) setOpen((s) => new Set(s).add(m[1]))
    }
    open(window.location.hash)
    const onHash = () => open(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [f.items])
  return (
    <section className="lp-sec lp-faq" id="faq" aria-labelledby="faq-title">
      <div className="ls-wrap lp-faq-grid">
        <Reveal>
          <SectionHead eyebrow={f.eyebrow} title={f.headline} id="faq-title" />
        </Reveal>
        <div className="lp-faq-list">
          {f.items.map((item) => {
            const isOpen = open.has(item.id)
            return (
              <div key={item.id} id={`faq-${item.id}`} className="ls-faq lp-faq-item" data-open={isOpen}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`faq-a-${item.id}`}
                    onClick={() =>
                      setOpen((s) => {
                        const n = new Set(s)
                        if (n.has(item.id)) n.delete(item.id)
                        else n.add(item.id)
                        return n
                      })
                    }
                  >
                    <span>{item.q}</span>
                    <Icon name="chevron-down" size={20} className="ls-faq-chev" />
                  </button>
                </h3>
                <div className="ls-faq-body" id={`faq-a-${item.id}`} role="region" aria-label={item.q}>
                  <div>
                    <p>{item.a}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ── Closing ──────────────────────────────────────────────────────────────── */

export function ClosingSection() {
  const c = COPY.closing
  const ref = useRef<HTMLElement>(null)
  const seen = useInView(ref, { threshold: 0.3 })
  return (
    <section ref={ref} className={`lp-closing ${seen ? 'is-seen' : ''}`} aria-labelledby="closing-title">
      <Photo name="closing" alt={c.photoAlt} sizes="100vw" className="lp-closing-photo" />
      <div className="lp-closing-scrim" aria-hidden="true" />
      <div className="ls-wrap lp-closing-copy">
        <h2 className="lp-h2" id="closing-title">
          {c.headline}
        </h2>
        <p className="lp-lede lp-lede-center">{c.body}</p>
        <div className="lp-cta-row lp-cta-center">
          <PrimaryCta>{c.primary}</PrimaryCta>
          <BrowseCta>{c.secondary}</BrowseCta>
        </div>
        <p className="lp-price">{c.microline}</p>
      </div>
    </section>
  )
}
