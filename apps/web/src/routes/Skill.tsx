/* ─────────────────────────────────────────────────────────────────────────────
 * /skill: DeckPal's playbooks for AI agents — the step-by-step guides an agent
 * opens with DeckPal's `playbook` tool, shown here so a person can read them and
 * a client without the tool can follow them. One source: the texts come from the
 * API (`GET /playbooks`), which serves the same strings the tool returns
 * (packages/agent-tools/src/playbooks/texts.ts), so this page cannot drift.
 *
 * The owner asked for the skill to live here, with the copy saved in claude.ai
 * only a pointer (2026-10-13): the download below is that pointer.
 *
 * Chrome-free and public (lib/landingRoute.ts), like /connect, which links here.
 * Cloud-only for the same reason: it teaches deckpal.app's connector.
 * ───────────────────────────────────────────────────────────────────────────── */
import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BrandLogo, Icon } from '../components/Icon'
import { usePageMeta } from '../lib/seo'
import { SkipLink } from '../components/SkipLink'
import { api } from '../lib/api'
import { SiteFooter } from './landing/SiteFooter'
import './landing/landing.css'
import './landing/page.css'

const MarkdownView = lazy(() => import('./deck/MarkdownView'))

/** What each playbook is for, in the order the index lists them. */
const TITLES: Record<string, string> = {
  'battle-log': 'Log a game',
  'game-analysis': 'Review a game',
  'record-review': "Review a deck's record",
  'deck-build': 'Build a deck',
  'deck-tune': 'Change a deck',
  'strategy-guide': 'Strategy guides',
  rules: 'Rules questions',
  collection: 'Collection, lists and carts',
  prices: 'Prices',
  'undo-and-history': 'Undo and history',
  tools: 'Which tool for what',
}

type Loaded = { index: string; playbooks: Array<{ name: string; text: string }> }

export function Skill() {
  usePageMeta({
    title: 'Playbooks for AI agents · DeckPal',
    description: "The step-by-step guides an AI app follows with your DeckPal account: logging and reviewing games, decks, rules, collection and prices.",
    path: '/skill',
  })
  const [data, setData] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const ctl = new AbortController()
    api.playbooks(ctl.signal).then(setData, (err: unknown) => {
      if (!ctl.signal.aborted) {
        console.warn('[deckpal] playbooks failed to load', err)
        setFailed(true)
      }
    })
    return () => ctl.abort()
  }, [])

  return (
    <div className="ls lp min-h-screen">
      <SkipLink />
      <header className="lp-nav is-solid">
        <nav className="ls-wrap lp-nav-row" aria-label="Primary">
          <Link to="/" className="lp-nav-logo" aria-label="DeckPal home">
            <BrandLogo height={26} />
          </Link>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="lp-doc">
        <div className="ls-wrap lp-doc-wrap">
          <Link to="/connect" className="lp-link lp-doc-back">
            <Icon name="chevron-left" size={16} />
            Connect an AI app
          </Link>
          <p className="lp-eyebrow">For AI apps</p>
          <h1 className="lp-h2">DeckPal playbooks</h1>
          <p className="lp-lede">
            The step-by-step guides an AI app follows with your DeckPal account. A connected app opens them with DeckPal's{' '}
            <code>playbook</code> tool, so it always has the version that matches DeckPal today; they are here so you can read
            them too.
          </p>

          <section className="lp-doc-sec" aria-labelledby="claude-skill">
            <h2 className="lp-h3" id="claude-skill">
              Using Claude?
            </h2>
            <p>
              Claude reads these through the connector on its own. If you also want a skill in Claude, download this one and add
              it under Settings, Capabilities, Skills. It holds no instructions of its own: it points Claude at the{' '}
              <code>playbook</code> tool and this page, so it never goes stale.
            </p>
            <a href={`${import.meta.env.BASE_URL}skill/deckpal-skill.zip`} download className="ls-cta lp-btn lp-btn-primary">
              <Icon name="download" size={16} />
              Download the DeckPal skill
            </a>
          </section>

          {failed && (
            <p role="alert" className="lp-muted">
              The playbooks could not be loaded. Try again in a moment.
            </p>
          )}
          {!data && !failed && <p className="lp-muted" aria-live="polite">Loading the playbooks…</p>}

          {data && (
            <Suspense fallback={<p className="lp-muted">Loading…</p>}>
              <nav aria-label="Playbooks" className="lp-doc-sec">
                <h2 className="lp-h3">Playbooks</h2>
                <ul className="lp-doc-list">
                  <li>
                    <a className="lp-link" href="#rules-for-every-job">
                      Rules for every job
                    </a>
                  </li>
                  {data.playbooks.map((p) => (
                    <li key={p.name}>
                      <a className="lp-link" href={`#${p.name}`}>
                        {TITLES[p.name] ?? p.name}
                      </a>{' '}
                      <code>{p.name}</code>
                    </li>
                  ))}
                </ul>
              </nav>
              <section className="lp-doc-sec" id="rules-for-every-job" aria-label="Rules for every job">
                <MarkdownView markdown={data.index} />
              </section>
              {data.playbooks.map((p) => (
                <section key={p.name} className="lp-doc-sec" id={p.name} aria-label={TITLES[p.name] ?? p.name}>
                  <MarkdownView markdown={p.text} />
                </section>
              ))}
            </Suspense>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
