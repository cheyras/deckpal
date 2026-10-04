/* ─────────────────────────────────────────────────────────────────────────────
 * /connect: how to connect an AI app to DeckPal. The landing's Connect section
 * stays short and links here for the detail: the connector URL, per-app steps,
 * Claude Code, what Read only means, the 25 tools, and the full compatibility
 * table with its notes and the date it was checked.
 *
 * Chrome-free and public (lib/landingRoute.ts), like /privacy: it is read by
 * people who have no account yet. Every word is in landing/copy.ts
 * (`connectPage`, plus the table in `connect`), so it cannot drift from the
 * landing. Cloud-only: the URL it teaches is deckpal.app's.
 * ───────────────────────────────────────────────────────────────────────────── */
import { Link } from '@tanstack/react-router'
import { BrandLogo, Icon } from '../components/Icon'
import { usePageMeta } from '../lib/seo'
import { useSignedIn } from '../lib/session'
import { SkipLink } from '../components/SkipLink'
import { AiSymbol } from './landing/aiLogos'
import { COPY } from './landing/copy'
import { SiteFooter } from './landing/SiteFooter'
import { CompatTable, CopyField } from './landing/sections/Tail'
import './landing/landing.css'
import './landing/page.css'

export function Connect() {
  const c = COPY.connect
  const p = COPY.connectPage
  // Signed-in readers came here to connect their own account; offer them the app, not a sign-up.
  const signedIn = useSignedIn() === true
  const s = p.sections
  usePageMeta({ title: p.metaTitle, description: p.metaDescription, path: '/connect' })
  return (
    <div className="ls lp min-h-screen">
      <SkipLink />
      <header className="lp-nav is-solid">
        <nav className="ls-wrap lp-nav-row" aria-label="Primary">
          <Link to="/" className="lp-nav-logo" aria-label="DeckPal home">
            <BrandLogo height={26} />
          </Link>
          <span className="flex-1" />
          {signedIn ? (
            <Link to="/series" className="ls-cta lp-btn lp-btn-primary lp-btn-sm">
              {COPY.nav.openApp}
            </Link>
          ) : (
            <>
              <Link to="/auth" className="lp-nav-signin">
                {COPY.nav.signIn}
              </Link>
              <Link to="/auth" search={{ mode: 'signup' as const }} className="ls-cta lp-btn lp-btn-primary lp-btn-sm">
                {COPY.nav.cta}
              </Link>
            </>
          )}
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="lp-doc">
        <div className="ls-wrap lp-doc-wrap">
          <Link to="/" className="lp-link lp-doc-back">
            <Icon name="chevron-left" size={16} />
            {p.back}
          </Link>
          <p className="lp-eyebrow">{c.eyebrow}</p>
          <h1 className="lp-h2">{p.title}</h1>
          <p className="lp-lede">{p.lead}</p>

          <section className="lp-doc-sec" aria-labelledby="need">
            <h2 className="lp-h3" id="need">
              {s.need.title}
            </h2>
            <ul className="lp-doc-list">
              {s.need.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>

          <section className="lp-doc-sec" aria-labelledby="url">
            <h2 className="lp-h3" id="url">
              {s.url.title}
            </h2>
            <p>{s.url.body}</p>
            <CopyField value={c.mcpUrl} label="connector URL" />
          </section>

          <section className="lp-doc-sec" aria-labelledby="claude">
            <h2 className="lp-h3 lp-doc-app" id="claude">
              <AiSymbol id="claude" size={24} decorative />
              {s.claude.title}
            </h2>
            <ol className="lp-doc-steps">
              {s.claude.steps.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
            <p className="lp-muted">{s.claude.note}</p>
            <a href={c.addClaudeHref} target="_blank" rel="noreferrer" className="ls-cta lp-btn lp-btn-primary">
              <AiSymbol id="claude" size={18} decorative />
              {c.addClaude}
              <Icon name="external" size={16} />
            </a>
          </section>

          <section className="lp-doc-sec" aria-labelledby="chatgpt">
            <h2 className="lp-h3 lp-doc-app" id="chatgpt">
              <AiSymbol id="chatgpt" size={24} decorative />
              {s.chatgpt.title}
            </h2>
            <ol className="lp-doc-steps">
              {s.chatgpt.steps.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
            <p className="lp-muted">{s.chatgpt.note}</p>
            <a href={c.addChatgptHref} target="_blank" rel="noreferrer" className="ls-cta lp-btn lp-btn-ghost">
              <AiSymbol id="chatgpt" size={18} decorative />
              {c.addChatgpt}
              <Icon name="external" size={16} />
            </a>
          </section>

          <section className="lp-doc-sec" aria-labelledby="others">
            <h2 className="lp-h3" id="others">
              {s.others.title}
            </h2>
            <p>{s.others.body}</p>
          </section>

          <section className="lp-doc-sec" aria-labelledby="claude-code">
            <h2 className="lp-h3" id="claude-code">
              {s.claudeCode.title}
            </h2>
            <p>{s.claudeCode.body}</p>
            <CopyField value={c.claudeCode} label="Claude Code command" />
          </section>

          <section className="lp-doc-sec" aria-labelledby="access">
            <h2 className="lp-h3" id="access">
              {s.access.title}
            </h2>
            <p>{s.access.body}</p>
          </section>

          <section className="lp-doc-sec" aria-labelledby="tools">
            <h2 className="lp-h3" id="tools">
              {s.tools.title}
            </h2>
            <dl className="lp-doc-tools">
              {s.tools.groups.map((g) => (
                <div key={g.name}>
                  <dt>{g.name}</dt>
                  <dd>
                    <code>{g.tools}</code>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="lp-doc-sec lp-doc-wide" aria-labelledby="compat">
            <h2 className="lp-h3" id="compat">
              {s.compat.title}
            </h2>
            <CompatTable />
            <p className="lp-muted lp-small">{c.disclaimer}</p>
          </section>

          <section className="lp-doc-sec" aria-labelledby="trouble">
            <h2 className="lp-h3" id="trouble">
              {s.trouble.title}
            </h2>
            <ul className="lp-doc-list">
              {s.trouble.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        </div>
      </main>
      <SiteFooter aiLogos />
    </div>
  )
}
