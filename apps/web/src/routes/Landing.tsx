/* ─────────────────────────────────────────────────────────────────────────────
 * Landing — the public marketing surface at `/` for logged-OUT visitors.
 *
 * Rendered chrome-free: main.tsx routes `/` here only when Supabase is
 * configured AND there is no session (see indexRoute.beforeLoad), and both
 * RootComponent and AppShell treat it as a public path, so AuthGuard never runs
 * and none of the app's authenticated queries (ProfileChip's overview, the
 * sidebar's series list) ever mount. That matters: those firing while signed
 * out is exactly what caused the 401 → location.assign → reload loop that
 * api.ts's handle401 guard was added for.
 *
 * Everything below the nav is static markup + CSS. No data fetching, no charts
 * library, no animation library — scroll reveal is one IntersectionObserver and
 * the rest is CSS transitions keyed off a `data-revealed` attribute.
 * ───────────────────────────────────────────────────────────────────────────── */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { BrandMark, Icon } from '../components/Icon'
import { buttonClass } from '../components/ui/Button'
import {
  AgentMockup,
  BinderMockup,
  DeckMockup,
  ProgressMockup,
  ScanMockup,
  ValueMockup,
} from './landing/Mockups'
import './landing/landing.css'

type Vars = CSSProperties & Record<`--${string}`, string>

const REPO = 'https://github.com/cheyras/deckscout'
const WIKI = `${REPO}/wiki`
const LICENSE = `${REPO}/blob/main/LICENSE`
/* The connector walkthrough — the same six steps the app shows signed-in under
   Profile → Agent access, but readable by a visitor who has no account yet. */
const MCP_DOCS = `${REPO}/blob/main/DEPLOYMENT.md#connect-an-ai-assistant-mcp`
const ASSETS = `${import.meta.env.BASE_URL}marketing/`

/* ── motion plumbing ──────────────────────────────────────────────────────── */

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Stamps `data-revealed` on every `[data-reveal]` as it enters the viewport.
 * The CSS does the animating; under reduced motion the media query in
 * landing.css already pins everything visible, so this is purely additive and
 * safe to no-op when IntersectionObserver is missing (we reveal everything).
 */
function useScrollReveal(): void {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (typeof IntersectionObserver === 'undefined') {
      nodes.forEach((n) => n.setAttribute('data-revealed', ''))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.setAttribute('data-revealed', '')
          io.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
    )
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [])
}

/** rAF-throttled scroll position, used for the sticky nav and hero parallax. */
function useScrollY(): number {
  const [y, setY] = useState(0)
  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setY(window.scrollY)
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  return y
}

/* ── primitives ───────────────────────────────────────────────────────────── */

function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'li' | 'section' | 'p' | 'span'
}) {
  return (
    <Tag data-reveal className={className} style={{ '--ls-delay': `${delay}ms` } as Vars}>
      {children}
    </Tag>
  )
}

function PrimaryCta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <Link
      to="/auth"
      search={{ mode: 'signup' as const }}
      className={`ls-cta ${buttonClass('primary', 'lg')} ${className}`}
    >
      {children}
    </Link>
  )
}

// The catalog is browsable without an account, so the hero can point at the
// real thing instead of only at the signup form: 23 546 cards, live prices, no
// wall. Styled as the ghost CTA's twin because it IS the secondary path — the
// primary ask is still the account.
function BrowseCta({ className = '' }: { className?: string }) {
  return (
    <Link
      to="/series"
      className={`inline-flex h-[50px] items-center justify-center gap-[8px] rounded-full border border-border-default px-[26px] text-[15px] font-bold text-text-body hover:border-surface-quaternary hover:text-text-primary ${className}`}
    >
      Browse the catalog
    </Link>
  )
}

function GhostCta({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`ls-cta ${buttonClass('ghost', 'lg')} ${className}`}
    >
      {children}
    </a>
  )
}

function GitHubGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

/**
 * Marketing photography, per the imagery contract:
 *   /marketing/<name>-<width>.{avif,webp}
 * The imagery pipeline may not have produced bytes at all, so this is written
 * to be *optional*: on any load error the <picture> unmounts itself entirely,
 * leaving the CSS mesh/gradient backdrop it was layered over. That means no
 * broken-image glyph, no empty reserved box, and — because every caller sizes
 * the image absolutely inside an already-sized parent — no layout shift either
 * way. `type` is written verbatim (image/avif, image/webp); sniffing AVIF
 * yields image/heif, which browsers skip.
 */
function MarketingImage({
  name,
  widths,
  sizes,
  alt,
  className = '',
  width,
  height,
  eager = false,
}: {
  name: string
  widths: number[]
  sizes: string
  alt: string
  className?: string
  width: number
  height: number
  eager?: boolean
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  const set = (ext: string) => widths.map((w) => `${ASSETS}${name}-${w}.${ext} ${w}w`).join(', ')
  const fallbackWidth = widths[Math.min(1, widths.length - 1)]
  return (
    <picture>
      <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
      <source type="image/webp" srcSet={set('webp')} sizes={sizes} />
      <img
        src={`${ASSETS}${name}-${fallbackWidth}.webp`}
        alt={alt}
        {...(alt === '' ? { 'aria-hidden': true } : {})}
        width={width}
        height={height}
        decoding="async"
        loading={eager ? 'eager' : 'lazy'}
        {...(eager ? { fetchPriority: 'high' as const } : {})}
        onError={() => setFailed(true)}
        className={className}
      />
    </picture>
  )
}

/* ── nav ──────────────────────────────────────────────────────────────────── */

function Nav({ scrolled }: { scrolled: boolean }) {
  return (
    <header
      className={[
        'fixed inset-x-0 top-0 z-[20] transition-colors duration-300',
        scrolled ? 'border-b border-border-default bg-surface-primary/85 backdrop-blur-md' : 'border-b border-transparent',
      ].join(' ')}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <nav className="ls-wrap flex h-[66px] items-center gap-[10px]" aria-label="Primary">
        <a href="#top" className="flex items-center gap-[9px] rounded-lg">
          <BrandMark size={30} />
          <span className="brand-wordmark text-[19px] leading-none">DeckScout</span>
        </a>
        <span className="flex-1" />
        {/* Below 480px the four items do not fit; the GitHub icon is the one to
            drop — it is also the hero's secondary CTA and a footer link, while
            "Sign in" has nowhere else to live above the fold. */}
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          aria-label="DeckScout on GitHub"
          className="hidden h-[40px] w-[40px] items-center justify-center rounded-full text-icon-default hover:bg-surface-secondary hover:text-icon-hover min-[480px]:flex"
        >
          <GitHubGlyph />
        </a>
        <Link
          to="/auth"
          className="flex h-[40px] items-center rounded-full px-[10px] text-[14px] font-semibold text-text-body hover:text-text-primary sm:px-[14px]"
        >
          Sign in
        </Link>
        <Link
          to="/auth"
          search={{ mode: 'signup' as const }}
          className="ls-cta flex h-[40px] items-center rounded-full bg-action-primary px-[16px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-strong sm:px-[18px]"
        >
          Get started
        </Link>
      </nav>
    </header>
  )
}

/* ── hero ─────────────────────────────────────────────────────────────────── */

function Hero({ scrollY }: { scrollY: number }) {
  const reduced = useRef(false)
  useEffect(() => {
    reduced.current = prefersReducedMotion()
  }, [])
  const parallax = reduced.current ? 0 : Math.min(scrollY * 0.16, 110)

  return (
    <section className="relative isolate overflow-hidden pb-[56px] pt-[112px] sm:pb-[80px] sm:pt-[150px]" id="top">
      {/* Backdrop, bottom to top: token mesh → grid lines → optional photography
          → scrim. Only the third layer needs image bytes; without them the first
          two still read as a deliberate, premium hero. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="ls-parallax absolute inset-x-0 -top-[10%] h-[120%]"
          style={{ '--ls-parallax': `${parallax}px` } as Vars}
        >
          <div className="ls-mesh absolute inset-0" />
          <div className="ls-grid-lines absolute inset-0" />
          <MarketingImage
            name="hero-bg"
            widths={[960, 1600, 2560]}
            sizes="100vw"
            alt=""
            width={2560}
            height={1440}
            eager
            className="absolute inset-0 h-full w-full object-cover opacity-[0.34] mix-blend-luminosity"
          />
          {/* drifting gold bloom — the one piece of ambient motion in the hero */}
          <div
            className="ls-hero-glow absolute left-1/2 top-[-22%] h-[620px] w-[1000px] max-w-none -translate-x-1/2 rounded-full blur-[80px]"
            style={{ background: 'radial-gradient(closest-side, var(--color-overlay-ring), transparent)' }}
          />
        </div>
        {/* scrim — guarantees text contrast whatever sits behind it */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, var(--color-overlay-scrim-strong) 0%, transparent 32%, transparent 62%, var(--color-surface-primary) 100%)',
          }}
        />
      </div>

      <div className="ls-wrap">
        <Reveal className="mx-auto max-w-[760px] text-center">
          <span className="inline-flex items-center gap-[8px] rounded-full border border-action-ghost-border bg-surface-secondary/70 px-[13px] py-[6px] text-[12px] font-semibold text-text-secondary">
            <span className="h-[6px] w-[6px] rounded-full bg-success" />
            Connect your own Claude · 21 tools over MCP
          </span>
          <h1
            className="mt-[22px] font-extrabold tracking-[-0.03em] text-text-primary"
            style={{ fontSize: 'clamp(38px, 6.4vw, 68px)', lineHeight: 1.04 }}
          >
            Ask Claude what you can build from the cards you own.
          </h1>
          <p
            className="mx-auto mt-[20px] max-w-[640px] text-text-body"
            style={{ fontSize: 'clamp(16px, 1.5vw, 19px)', lineHeight: 1.6 }}
          >
            DeckScout tracks every English Pokémon card you own, then hands that collection to Claude over MCP.
            Bring your own claude.ai or Claude Code — the answers come back from your real cards, prices and match
            history, not generic advice.
          </p>
        </Reveal>

        <Reveal delay={110} className="mt-[30px] flex flex-col items-center justify-center gap-[12px] sm:flex-row">
          <PrimaryCta className="w-full sm:w-auto">Create your free account</PrimaryCta>
          <BrowseCta className="w-full sm:w-auto" />
          <GhostCta href={REPO} className="w-full sm:w-auto">
            <GitHubGlyph size={18} /> View on GitHub
          </GhostCta>
        </Reveal>

        <Reveal delay={180} as="p" className="mt-[16px] text-center text-[13px] text-text-muted">
          No account needed to browse · free to use · private by default · open source
        </Reveal>

        {/* Narrower than the old set-list frame: a conversation reads badly at
            940px, and the panel it cites is the thing that has to be legible. */}
        <Reveal delay={240} className="mx-auto mt-[46px] max-w-[800px]">
          <AgentMockup />
        </Reveal>
      </div>
    </section>
  )
}

/* ── stat strip ───────────────────────────────────────────────────────────── */

// Live counts from the production catalog, restricted the same way the app's own
// series index restricts it: English TCG only. The raw tables hold 23,444 cards /
// 40,107 variants / 218 sets, but 2,480 cards across 15 sets belong to Pokémon TCG
// Pocket — a different game, excluded by /api/series (`WHERE s.tcgdex_id <> 'tcgp'`)
// and therefore not browsable. Quoting the raw totals under the word "English"
// would overstate the product by ~12%.
const STATS = [
  { value: '20,964', label: 'Cards catalogued' },
  { value: '37,627', label: 'Individual printings' },
  { value: '203', label: 'English sets' },
  { value: '1,025', label: 'Pokédex species' },
]

function Stats() {
  return (
    <section className="ls-wrap py-[52px] sm:py-[72px]" aria-label="Catalog size">
      <Reveal className="rounded-2xl border border-border-default bg-surface-secondary px-[18px] py-[26px] sm:px-[32px]">
        <ul className="grid grid-cols-2 gap-y-[26px] sm:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal as="li" key={s.label} delay={i * 90} className="text-center">
              <div
                className="font-extrabold tracking-[-0.02em] text-action-primary tabular-nums"
                style={{ fontSize: 'clamp(26px, 3.4vw, 38px)', lineHeight: 1.1 }}
              >
                {s.value}
              </div>
              <div className="mt-[4px] text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                {s.label}
              </div>
            </Reveal>
          ))}
        </ul>
        <Reveal delay={360} as="p" className="mt-[24px] text-center text-[13px] text-text-muted">
          Every English set across 20 series — from Base Set to the latest release — kept in step with the
          official catalog.
        </Reveal>
      </Reveal>
    </section>
  )
}

/* ── agentic flow ─────────────────────────────────────────────────────────────
 * The lead story, spelled out. Everything claimed here is live and verified:
 * the endpoint, the token flow, the 21 tools, both clients, and the isolation
 * guarantee. What is deliberately NOT claimed: that DeckScout ships an
 * assistant, or anything at all about how good the model is. The product is the
 * connection and the data behind it — the visitor brings the assistant.
 * ───────────────────────────────────────────────────────────────────────────── */

const AGENT_STEPS: { icon: 'key' | 'link' | 'sparkle'; title: string; body: ReactNode }[] = [
  {
    icon: 'key',
    title: 'Create a token',
    body: (
      <>
        <strong className="font-semibold text-text-body">Profile → Agent access</strong> mints a personal token.
        It is shown once — DeckScout keeps only a hash — and you can revoke it from that same screen, on every
        client at once.
      </>
    ),
  },
  {
    icon: 'link',
    title: 'Connect Claude',
    body: (
      <>
        Add <span className="font-mono text-[13px] text-text-body">deckscout.io/mcp</span> as a custom connector
        in claude.ai, or register it in Claude Code with one <span className="font-mono text-[13px] text-text-body">claude&nbsp;mcp&nbsp;add</span> command.
        Both are supported, and there is nothing to install either way.
      </>
    ),
  },
  {
    icon: 'sparkle',
    title: 'Ask about your collection',
    body: (
      <>
        Then just ask, in your own words:
        <span className="mt-[10px] flex flex-col gap-[6px]">
          {[
            'What can I build from what I own?',
            'Here are my last ten games — what is losing them?',
            'What should I buy next to finish this deck?',
          ].map((q) => (
            <span key={q} className="text-text-body">
              “{q}”
            </span>
          ))}
        </span>
      </>
    ),
  },
]

/* Twelve groupings over the 21 tools the connector exposes. */
const AGENT_TOOLS = [
  'Collection summary',
  'Collection log',
  'Collection value',
  'Set progress',
  'Card search',
  'Card lookup',
  'Decks',
  'Lists',
  'Battle logs',
  'Deck strategy guides',
  'Deck version history',
  'Buy list & cart',
]

function AgentFlow() {
  return (
    <section className="relative isolate overflow-hidden py-[52px] sm:py-[76px]" id="agentic">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]"
        style={{ background: 'radial-gradient(closest-side, var(--color-overlay-ring), transparent)' }}
      />
      <div className="ls-wrap">
        <Reveal className="mx-auto max-w-[700px] text-center">
          <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-action-primary">
            Agentic deckbuilding
          </div>
          <h2
            className="mt-[12px] font-extrabold tracking-[-0.025em] text-text-primary"
            style={{ fontSize: 'clamp(26px, 3.2vw, 40px)', lineHeight: 1.12 }}
          >
            Point Claude at your own collection.
          </h2>
          <p className="mt-[16px] text-[16px] leading-[1.65] text-text-body">
            DeckScout speaks MCP. Generate a token, add one connector, and Claude can read your collection, your
            set progress, your decks, your prices and your battle logs — and write back to them. There is no
            chatbot to babysit here: you bring the assistant, DeckScout brings the data.
          </p>
        </Reveal>

        <ol className="mt-[36px] grid gap-[18px] md:grid-cols-3">
          {AGENT_STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 110}>
              <article className="ls-card h-full rounded-2xl border border-border-default bg-surface-secondary p-[20px]">
                <div className="flex items-center gap-[10px]">
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-surface-tertiary text-action-primary">
                    <Icon name={s.icon} size={19} />
                  </span>
                  <span className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-muted">
                    Step {i + 1}
                  </span>
                </div>
                <h3 className="mt-[14px] text-[17px] font-bold text-text-primary">{s.title}</h3>
                <p className="mt-[8px] text-[14px] leading-[1.6] text-text-secondary">{s.body}</p>
              </article>
            </Reveal>
          ))}
        </ol>

        <Reveal delay={140} className="mt-[18px] rounded-2xl border border-border-default bg-surface-secondary p-[20px]">
          <div className="flex flex-wrap items-baseline gap-x-[10px] gap-y-[4px]">
            <h3 className="text-[15px] font-bold text-text-primary">21 tools, one connector</h3>
            <span className="text-[13px] text-text-muted">every one scoped to your account</span>
          </div>
          <ul className="mt-[12px] flex flex-wrap gap-[6px]">
            {AGENT_TOOLS.map((t) => (
              <li
                key={t}
                className="rounded-full bg-surface-tertiary px-[10px] py-[5px] text-[12px] font-semibold text-text-secondary"
              >
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-[14px] text-[13px] leading-[1.65] text-text-secondary">
            Works with claude.ai custom connectors and with Claude Code. A token only ever reaches its own
            account — somebody else’s token cannot see your collection, and a write aimed at an id that is not
            yours is refused rather than quietly applied.
          </p>
        </Reveal>

        <Reveal delay={200} className="mt-[26px] flex flex-col items-center justify-center gap-[12px] sm:flex-row">
          <PrimaryCta className="w-full sm:w-auto">Create your free account</PrimaryCta>
          <GhostCta href={MCP_DOCS} className="w-full sm:w-auto">
            <Icon name="book" size={18} /> Read the setup guide
          </GhostCta>
        </Reveal>
      </div>
    </section>
  )
}

/* ── feature sections ─────────────────────────────────────────────────────── */

function Feature({
  eyebrow,
  title,
  body,
  bullets,
  mockup,
  flip = false,
}: {
  eyebrow: string
  title: string
  body: string
  bullets: string[]
  mockup: ReactNode
  flip?: boolean
}) {
  return (
    <section className="ls-wrap py-[42px] sm:py-[64px]">
      <div className="grid items-center gap-[34px] lg:grid-cols-2 lg:gap-[64px]">
        <Reveal className={flip ? 'lg:order-2' : undefined}>
          <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-action-primary">{eyebrow}</div>
          <h2
            className="mt-[12px] font-extrabold tracking-[-0.025em] text-text-primary"
            style={{ fontSize: 'clamp(26px, 3.2vw, 40px)', lineHeight: 1.12 }}
          >
            {title}
          </h2>
          <p className="mt-[16px] text-[16px] leading-[1.65] text-text-body">{body}</p>
          <ul className="mt-[20px] flex flex-col gap-[10px]">
            {bullets.map((b, i) => (
              <Reveal as="li" key={b} delay={120 + i * 80} className="flex items-start gap-[10px]">
                <span className="mt-[2px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-halo-success text-success">
                  <Icon name="check" size={12} strokeWidth={2.4} />
                </span>
                <span className="text-[14px] leading-[1.55] text-text-secondary">{b}</span>
              </Reveal>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={140} className={flip ? 'lg:order-1' : undefined}>
          {mockup}
        </Reveal>
      </div>
    </section>
  )
}

/* ── open source / trust ──────────────────────────────────────────────────── */

/* `accent` names come from the imagery contract. `hue` + `at` build the token
   wash that stands in for the photograph when there are no bytes — the band has
   to read as a designed element on its own, never as an empty reserved box. */
const TRUST = [
  {
    accent: 'accent-collection',
    hue: 'var(--color-action-primary)',
    at: '24% 4%',
    icon: 'book' as const,
    title: 'AGPL-3.0',
    body: 'Copyleft, on purpose. Anyone who runs a modified DeckScout has to share the changes back — it cannot quietly become someone else’s closed product.',
  },
  {
    accent: 'accent-insights',
    hue: 'var(--color-link)',
    at: '76% 8%',
    icon: 'gear' as const,
    title: 'Self-hostable',
    body: 'Web app, API, Postgres schema and the catalog sync are all in the repo. Run the whole stack on your own box — nothing here is hosted-only magic.',
  },
  {
    accent: 'accent-discovery',
    hue: 'var(--color-completion-grandmaster)',
    at: '50% 96%',
    icon: 'user' as const,
    title: 'Private by default',
    body: 'Your collection, decks and battle logs belong to your account and nobody else’s. Nothing is shared until you deliberately publish a list.',
  },
]

function OpenSource() {
  return (
    <section className="relative isolate overflow-hidden py-[52px] sm:py-[76px]" id="open-source">
      {/* Optional seamless tile; a background layer that 404s just doesn't paint. */}
      <span
        aria-hidden="true"
        className="ls-texture pointer-events-none absolute inset-0 -z-10"
        style={{ '--ls-texture': `url("${ASSETS}texture-grid-800.webp")` } as Vars}
      />
      <div className="ls-wrap">
        <Reveal className="mx-auto max-w-[680px] text-center">
          <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-link">Open source</div>
          <h2
            className="mt-[12px] font-extrabold tracking-[-0.025em] text-text-primary"
            style={{ fontSize: 'clamp(26px, 3.2vw, 40px)', lineHeight: 1.12 }}
          >
            Built in the open, and yours to keep.
          </h2>
          <p className="mt-[16px] text-[16px] leading-[1.65] text-text-body">
            DeckScout isn’t a black box with a login screen. The entire project — app, API, database schema
            and the catalog pipeline — lives on GitHub under AGPL-3.0. Read it, fork it, or take your
            collection and run the whole thing yourself.
          </p>
        </Reveal>

        <div className="mt-[36px] grid gap-[18px] md:grid-cols-3">
          {TRUST.map((t, i) => (
            <Reveal key={t.title} delay={i * 110}>
              <article className="ls-card h-full overflow-hidden rounded-2xl border border-border-default bg-surface-secondary">
                <div
                  className="relative h-[128px] w-full overflow-hidden"
                  style={{
                    background: 'linear-gradient(155deg, var(--color-surface-quaternary), var(--color-surface-secondary))',
                  }}
                >
                  <span
                    className="absolute inset-0 opacity-[0.28]"
                    style={{ background: `radial-gradient(94% 118% at ${t.at}, ${t.hue}, transparent 64%)` }}
                  />
                  <span className="ls-grid-lines absolute inset-0" />
                  <MarketingImage
                    name={t.accent}
                    widths={[400, 800]}
                    sizes="(min-width: 768px) 360px, 100vw"
                    alt=""
                    width={800}
                    height={800}
                    className="absolute inset-0 h-full w-full object-cover opacity-55 mix-blend-luminosity"
                  />
                  {/* bottom-weighted scrim: melts the band into the card body and
                      keeps contrast if a photograph ever lands behind it */}
                  <span
                    className="absolute inset-0"
                    style={{
                      background:
                        'linear-gradient(180deg, transparent 36%, var(--color-surface-secondary) 100%)',
                    }}
                  />
                  <span
                    className="absolute left-1/2 top-1/2 flex h-[52px] w-[52px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-surface-primary text-action-primary"
                    style={{ boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.1), var(--shadow-panel)' }}
                  >
                    <Icon name={t.icon} size={24} />
                  </span>
                </div>
                <div className="p-[18px]">
                  <h3 className="text-[16px] font-bold text-text-primary">{t.title}</h3>
                  <p className="mt-[8px] text-[14px] leading-[1.6] text-text-secondary">{t.body}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200} className="mt-[28px] flex flex-col items-center justify-center gap-[12px] sm:flex-row">
          <GhostCta href={REPO} className="w-full sm:w-auto">
            <GitHubGlyph size={18} /> Browse the source
          </GhostCta>
          <GhostCta href={WIKI} className="w-full sm:w-auto">
            <Icon name="book" size={18} /> Read the wiki
          </GhostCta>
        </Reveal>
      </div>
    </section>
  )
}

/* ── FAQ ──────────────────────────────────────────────────────────────────── */

const FAQ = [
  {
    q: 'How does the Claude connection work?',
    a: 'DeckScout exposes your account over MCP at deckscout.io/mcp. Create a personal token in Profile → Agent access, add it as a custom connector in claude.ai or register it in Claude Code, and Claude gets 21 tools scoped to your data — collection, set progress, card search, decks, lists, battle logs, strategy guides and a buy list. DeckScout has no assistant of its own; you bring yours, and you can revoke the token at any time.',
  },
  {
    q: 'Is DeckScout free?',
    a: 'Yes. The hosted app at deckscout.io is free to use, and because the source is AGPL-3.0 you can run your own copy at no cost either. There is nothing to buy and no card to enter.',
  },
  {
    q: 'Which cards does it cover?',
    a: 'Every English Pokémon TCG set — 20,964 cards and their 37,627 individual printings, across 203 sets and 20 series, plus all 1,025 Pokédex species.',
  },
  {
    q: 'Where do the prices come from?',
    a: 'A daily sync of public market data into our own database — there is no affiliate relationship behind the numbers. A card with no price reads as “—”, never as $0, and each price shows when it was last observed.',
  },
  {
    q: 'Can I bring my decks with me?',
    a: 'Yes. Paste a Pokémon TCG Live decklist to import it, and export back to the same format whenever you like. Every save becomes a version you can diff and revert to.',
  },
  {
    q: 'Is my collection private?',
    a: 'Yes. Accounts are private by default — your collection, decks and battle logs are tied to your account and are not visible to anyone else unless you choose to make a list public.',
  },
  {
    q: 'Can I run it on my own hardware?',
    a: 'Yes. The repository contains the web app, the API, the database schema and the catalog sync, with deployment notes in the wiki. Self-hosted installs skip the hosted accounts entirely.',
  },
]

function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section className="ls-wrap py-[52px] sm:py-[76px]" id="faq">
      <Reveal className="mx-auto max-w-[680px] text-center">
        <h2
          className="font-extrabold tracking-[-0.025em] text-text-primary"
          style={{ fontSize: 'clamp(26px, 3.2vw, 40px)', lineHeight: 1.12 }}
        >
          Questions, answered
        </h2>
      </Reveal>
      <div className="mx-auto mt-[28px] flex max-w-[760px] flex-col gap-[10px]">
        {FAQ.map((f, i) => {
          const isOpen = open === i
          return (
            <Reveal key={f.q} delay={i * 70}>
              <div
                className="ls-faq overflow-hidden rounded-xl border border-border-default bg-surface-secondary"
                data-open={isOpen}
              >
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${i}`}
                    id={`faq-button-${i}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center gap-[14px] px-[18px] py-[16px] text-left hover:bg-action-ghost-hover"
                  >
                    <span className="flex-1 text-[15px] font-semibold text-text-primary">{f.q}</span>
                    <span className="ls-faq-chev shrink-0 text-icon-default">
                      <Icon name="chevron-down" size={18} />
                    </span>
                  </button>
                </h3>
                <div className="ls-faq-body" id={`faq-panel-${i}`} role="region" aria-labelledby={`faq-button-${i}`}>
                  <div>
                    <p className="px-[18px] pb-[18px] text-[14px] leading-[1.65] text-text-secondary">{f.a}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          )
        })}
      </div>
    </section>
  )
}

/* ── final CTA + footer ───────────────────────────────────────────────────── */

function FinalCta() {
  return (
    <section className="ls-wrap py-[52px] sm:py-[76px]">
      <Reveal className="relative isolate overflow-hidden rounded-[24px] border border-border-default bg-surface-secondary px-[22px] py-[52px] text-center sm:px-[48px] sm:py-[72px]">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-[40%] -z-10 h-[420px]"
          style={{ background: 'radial-gradient(closest-side, var(--color-halo-neutral), transparent)' }}
        />
        <h2
          className="mx-auto max-w-[560px] font-extrabold tracking-[-0.025em] text-text-primary"
          style={{ fontSize: 'clamp(28px, 3.6vw, 44px)', lineHeight: 1.1 }}
        >
          Start with one set.
        </h2>
        <p className="mx-auto mt-[16px] max-w-[520px] text-[16px] leading-[1.65] text-text-body">
          Make an account, pick the set you are closest to finishing, and watch the ring fill in. The other
          202 will still be there when you want them.
        </p>
        <div className="mt-[28px] flex flex-col items-center justify-center gap-[12px] sm:flex-row">
          <PrimaryCta className="w-full sm:w-auto">Create your free account</PrimaryCta>
          <GhostCta href={REPO} className="w-full sm:w-auto">
            <GitHubGlyph size={18} /> View on GitHub
          </GhostCta>
        </div>
        <p className="mt-[16px] text-[13px] text-text-muted">No credit card. Nothing to install.</p>
      </Reveal>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-border-default bg-surface-footer">
      <div className="ls-wrap py-[42px]">
        <div className="flex flex-col gap-[32px] md:flex-row md:justify-between">
          <div className="max-w-[320px]">
            <span className="flex items-center gap-[9px]">
              <BrandMark size={28} />
              <span className="brand-wordmark text-[18px] leading-none">DeckScout</span>
            </span>
            <p className="mt-[12px] text-[13px] leading-[1.6] text-text-muted">
              An open-source Pokémon TCG collection tracker. Track, build, and master your collection.
            </p>
          </div>

          <div className="flex gap-[48px]">
            <div>
              <h2 className="mb-[10px] text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary">
                Product
              </h2>
              <ul className="flex flex-col gap-[8px] text-[14px]">
                <li>
                  <Link to="/auth" search={{ mode: 'signup' as const }} className="text-text-body hover:text-link">
                    Create account
                  </Link>
                </li>
                <li>
                  <Link to="/auth" className="text-text-body hover:text-link">
                    Sign in
                  </Link>
                </li>
                <li>
                  <a href="#faq" className="text-text-body hover:text-link">
                    FAQ
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="mb-[10px] text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary">
                Open source
              </h2>
              <ul className="flex flex-col gap-[8px] text-[14px]">
                <li>
                  <a href={REPO} target="_blank" rel="noreferrer" className="text-text-body hover:text-link">
                    GitHub
                  </a>
                </li>
                <li>
                  <a href={WIKI} target="_blank" rel="noreferrer" className="text-text-body hover:text-link">
                    Wiki
                  </a>
                </li>
                <li>
                  <a href={LICENSE} target="_blank" rel="noreferrer" className="text-text-body hover:text-link">
                    License (AGPL-3.0)
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <p className="mt-[36px] border-t border-border-default pt-[20px] text-[12px] leading-[1.6] text-text-muted">
          DeckScout is an independent, fan-made project. Pokémon and all related names are trademarks of
          Nintendo, Creatures Inc. and GAME FREAK inc. DeckScout is not affiliated with, endorsed or sponsored
          by them. Interface illustrations on this page are stylised recreations of the product.
        </p>
      </div>
    </footer>
  )
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export function Landing() {
  const scrollY = useScrollY()
  useScrollReveal()

  return (
    <div className="ls min-h-screen bg-surface-primary">
      <a
        href="#main"
        className="sr-only rounded-full bg-action-primary px-[16px] py-[10px] text-[14px] font-bold text-action-primary-text focus:not-sr-only focus:absolute focus:left-[16px] focus:top-[16px] focus:z-[100]"
      >
        Skip to content
      </a>
      <Nav scrolled={scrollY > 12} />

      <main id="main">
        <Hero scrollY={scrollY} />
        <Stats />

        {/* Narrative order: the agentic connection leads, then the collection
            tracking that gives it something true to say, then value, decks and
            the scanner that feed it. */}
        <AgentFlow />

        <Feature
          eyebrow="Collection tracking"
          title="Count the printing, not just the card."
          body="Most trackers stop at the card. DeckScout tracks each printing of it — Normal, Reverse Holofoil, Holofoil and the special ones — with its own quantity, its own market price and its own place in your completion. Every set carries three goals: Complete, Master and Grandmaster."
          bullets={[
            'Tap a counter on the card to add a copy; hold to take one back',
            'Milestones at 25%, 50% and 75% turn from dots into stars',
            'Filter any set by Have, Need or Dupes in one click',
          ]}
          mockup={<ProgressMockup />}
        />

        <Feature
          flip
          eyebrow="Value & price history"
          title="Know what the binder is worth."
          body="Market prices sync daily into DeckScout's own database — no affiliate strings attached. Your total collection value is snapshotted every day, so a month in you have a real curve instead of a guess, and the trends tab shows what moved while you weren't looking."
          bullets={[
            'Ranges from 30 days to a full year',
            'Per-printing market prices, each stamped with when it was observed',
            'Most expensive card and full-set market value on every set page',
          ]}
          mockup={<ValueMockup />}
        />

        <Feature
          eyebrow="Deck builder & match log"
          title="Build it here. Play it there."
          body="Paste a Pokémon TCG Live decklist to import it, and export straight back the same way. Every save becomes a version you can diff and revert to. Then paste your battle logs — DeckScout reads the result, who went first and what your opponent played, and keeps a win–loss record per deck version."
          bullets={[
            'Standard, Expanded, GLC and Unlimited legality checks',
            'Test hand, deck pricing, and a buy-the-missing-cards handoff',
            'Full version history — reverting never deletes anything',
          ]}
          mockup={<DeckMockup />}
        />

        <Feature
          flip
          eyebrow="Card scanner"
          title="Point your camera at the card."
          body="Line a card up inside the frame and hold still. DeckScout matches it against the catalog by perceptual hash — no shutter button, no typing set codes — and adds it to your collection in a tap. No camera to hand? Drop in a photo instead."
          bullets={[
            'Fires on its own once two frames agree',
            'Ranked matches with a confidence score, not a single guess',
            'JPEG, PNG or WebP upload as a fallback',
          ]}
          mockup={<ScanMockup />}
        />

        <Feature
          eyebrow="Lists, binders & Pokédex"
          title="Lay it out the way you'd shelve it."
          body="Static lists for cards you picked by hand, dynamic lists that keep themselves current, and Pokédex binders that lay out all 1,025 species in order. Flip through 4-, 9-, 12- or 16-pocket pages and see the gaps exactly where they'd sit in the real binder."
          bullets={[
            'Grid, Table and Binder views on every set and list',
            'Printable set checklists and list PDFs',
            'Publish a list when you want to share it — private until then',
          ]}
          mockup={<BinderMockup />}
        />

        <OpenSource />
        <Faq />
        <FinalCta />
      </main>

      <Footer />
    </div>
  )
}
