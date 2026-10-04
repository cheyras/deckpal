/* Small pieces the landing sections share: motion hooks, the photo element, the
 * CTAs, section heads and the nav. */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Link } from '@tanstack/react-router'
import { BrandLogo, Icon } from '../../components/Icon'
import { COPY } from './copy'
import { PHOTOS, srcSet, type PhotoName } from './data'

export type Vars = CSSProperties & Record<`--${string}`, string | number>

export const REPO = 'https://github.com/cheyras/deckpal'

/* ── motion ───────────────────────────────────────────────────────────────── */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** True once the element has come into view (and stays true). */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  { rootMargin = '0px 0px -15% 0px', threshold = 0.2 }: { rootMargin?: string; threshold?: number } = {},
): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin, threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, rootMargin, threshold, seen])
  return seen
}

/** Whether the element is on screen right now (for pausing loops off-screen). */
export function useOnScreen<T extends Element>(ref: RefObject<T | null>): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setOn(es.some((e) => e.isIntersecting)), { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return on
}

/** Stamps `data-revealed` on every `[data-reveal]` as it enters the viewport. */
export function useScrollReveal(): void {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.lp [data-reveal]'))
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

/** rAF-throttled scroll position, for the nav's backdrop. */
export function useScrollY(): number {
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

/** setTimeout that is cleared on unmount and on every re-arm. */
export function useTimers() {
  const ids = useRef<number[]>([])
  useEffect(() => () => ids.current.forEach((i) => window.clearTimeout(i)), [])
  return {
    after(ms: number, fn: () => void) {
      ids.current.push(window.setTimeout(fn, ms))
    },
    clear() {
      ids.current.forEach((i) => window.clearTimeout(i))
      ids.current = []
    },
  }
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

export function Photo({
  name,
  alt,
  sizes,
  eager = false,
  className = '',
  style,
}: {
  name: PhotoName
  alt: string
  sizes: string
  eager?: boolean
  className?: string
  style?: CSSProperties
}) {
  const p = PHOTOS[name]
  const mid = p.widths[1]
  return (
    <picture className={className} style={style}>
      <source type="image/avif" srcSet={srcSet(name, 'avif')} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(name, 'webp')} sizes={sizes} />
      <img
        src={`/marketing/landing/${name}-${mid}.webp`}
        width={mid}
        height={Math.round((mid * p.h) / p.w)}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        {...(eager ? { fetchPriority: 'high' as const } : {})}
      />
    </picture>
  )
}

export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'li' | 'p' | 'ul' | 'ol'
}) {
  return (
    <Tag data-reveal className={className} style={{ '--lp-delay': `${delay}ms` } as Vars}>
      {children}
    </Tag>
  )
}

export function PrimaryCta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <Link to="/auth" search={{ mode: 'signup' as const }} className={`ls-cta lp-btn lp-btn-primary ${className}`}>
      {children}
    </Link>
  )
}

export function BrowseCta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <Link to="/series" className={`ls-cta lp-btn lp-btn-ghost ${className}`}>
      {children}
    </Link>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="lp-eyebrow">{children}</p>
}

export function SectionHead({
  eyebrow,
  title,
  children,
  center = false,
  id,
}: {
  eyebrow: string
  title: string
  children?: ReactNode
  center?: boolean
  id?: string
}) {
  return (
    <div className={`lp-head ${center ? 'lp-head-center' : ''}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="lp-h2" id={id}>
        {title}
      </h2>
      {children}
    </div>
  )
}

/** "Example" tag for demo panels, so no illustration passes as live data. */
export function ExampleTag({ label = COPY.exampleLabel }: { label?: string }) {
  return <span className="lp-example">{label}</span>
}

export function GitHubGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

export function Nav({ scrolled }: { scrolled: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <header className={`lp-nav ${scrolled || open ? 'is-solid' : ''}`}>
      <nav className="ls-wrap lp-nav-row" aria-label="Primary">
        <a href="#top" className="lp-nav-logo" aria-label="DeckPal, back to top">
          <BrandLogo height={26} />
        </a>
        <ul className="lp-nav-links">
          {COPY.nav.links.map((l) => (
            <li key={l.href}>
              <a href={l.href}>{l.label}</a>
            </li>
          ))}
        </ul>
        <span className="flex-1" />
        <a href={REPO} target="_blank" rel="noreferrer" aria-label={COPY.nav.github} className="lp-nav-icon">
          <GitHubGlyph />
        </a>
        <Link to="/auth" className="lp-nav-signin">
          {COPY.nav.signIn}
        </Link>
        <Link to="/auth" search={{ mode: 'signup' as const }} className="ls-cta lp-btn lp-btn-primary lp-btn-sm">
          {COPY.nav.cta}
        </Link>
        <button
          type="button"
          className="lp-nav-menu"
          aria-expanded={open}
          aria-controls="lp-nav-sheet"
          aria-label={COPY.nav.menu}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name={open ? 'close' : 'menu'} size={22} />
        </button>
      </nav>
      <div id="lp-nav-sheet" className="lp-nav-sheet" hidden={!open}>
        <ul className="ls-wrap">
          {COPY.nav.links.map((l) => (
            <li key={l.href}>
              <a href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </a>
            </li>
          ))}
          <li>
            <Link to="/auth" onClick={() => setOpen(false)}>
              {COPY.nav.signIn}
            </Link>
          </li>
        </ul>
      </div>
    </header>
  )
}
