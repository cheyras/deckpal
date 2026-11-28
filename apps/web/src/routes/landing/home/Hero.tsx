/* The home hero: one big friendly line, one line under it, one button, and the
 * video slot right beneath, visible above the fold on a phone and on a laptop.
 *
 * The headline is the LCP candidate on a phone and the poster is on desktop, so
 * nothing here waits on JavaScript or on the network beyond that one still. The
 * film (heroVideo.ts) is attached only once the page is loaded and idle. */
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { COPY } from '../copy'
import {
  HERO_PHONE_MEDIA,
  HERO_PHONE_POSTER_SIZES,
  HERO_POSTER_SIZES,
  HERO_VIDEO,
  heroSourcesFor,
  type HeroVideoConfig,
} from '../heroVideo'
import { Photo, PrimaryCta, usePrefersReducedMotion } from '../parts'

export function HomeHero() {
  const h = COPY.home.hero
  return (
    <section className="hm-hero" id="top" aria-labelledby="hero-title">
      <div className="hm-hero-sky" aria-hidden="true">
        <span className="hm-spark hm-spark-a" />
        <span className="hm-spark hm-spark-b" />
        <span className="hm-spark hm-spark-c" />
      </div>
      <div className="ls-wrap hm-hero-in">
        <h1 className="hm-h1" id="hero-title">
          {h.headline}
        </h1>
        <p className="hm-sub">{h.sub}</p>
        <div className="hm-hero-cta">
          <PrimaryCta className="hm-btn-lg">{h.cta}</PrimaryCta>
          <p className="hm-price">{h.price}</p>
        </div>
        <HeroVideo config={HERO_VIDEO} label={h.videoLabel} />
      </div>
    </section>
  )
}

const saveData = (): boolean => {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return !!c?.saveData || /(^|-)2g$/.test(c?.effectiveType ?? '')
}

/** After `load` and an idle moment, so the film never competes with first paint. */
function useAfterLoadIdle(enabled: boolean): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let idle = 0
    let timer = 0
    const go = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
      if (ric) idle = ric(() => setReady(true), { timeout: 2500 })
      else timer = window.setTimeout(() => setReady(true), 600)
    }
    if (document.readyState === 'complete') go()
    else window.addEventListener('load', go, { once: true })
    return () => {
      window.removeEventListener('load', go)
      const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
      if (idle && cic) cic(idle)
      if (timer) window.clearTimeout(timer)
    }
  }, [enabled])
  return ready
}

/** Whether HERO_PHONE_MEDIA matches now, kept current (a phone rotated, a window resized). */
function usePhoneMedia(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(HERO_PHONE_MEDIA).matches)
  useEffect(() => {
    const mq = window.matchMedia(HERO_PHONE_MEDIA)
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}

/**
 * The 16:9 slot (1:1 on a phone when the config has a phone cut). Its box is sized by `aspect-ratio` before anything loads, so
 * neither the poster nor the film can shift the page. With no film configured
 * (or on Save-Data, or if the file fails) it is the poster and nothing else:
 * no play button that would do nothing.
 */
export function HeroVideo({ config, label }: { config: HeroVideoConfig; label: string }) {
  const reduced = usePrefersReducedMotion()
  const phone = usePhoneMedia() && !!config.phone
  const sources = heroSourcesFor(config, phone)
  const hasFilm = sources.length > 0
  const [failed, setFailed] = useState(false)
  const [lite] = useState(() => typeof navigator !== 'undefined' && saveData())
  const want = hasFilm && !failed && !lite
  const ready = useAfterLoadIdle(want)
  const ref = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLDivElement>(null)
  // `userPaused` is the visitor's choice and wins over visibility.
  const [userPaused, setUserPaused] = useState(false)
  const [playing, setPlaying] = useState(false)
  const autoplay = !reduced && !userPaused
  // a new cut (the phone turned, the window resized) stays hidden until it plays
  useEffect(() => setPlaying(false), [phone])

  useEffect(() => {
    const v = ref.current
    const el = box.current
    if (!ready || !v || !el) return
    if (typeof IntersectionObserver === 'undefined') {
      if (autoplay) v.play().catch(() => {})
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting && autoplay) v.play().catch(() => {})
        else v.pause()
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ready, autoplay, phone])

  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) {
      setUserPaused(false)
      v.play().catch(() => {})
    } else {
      setUserPaused(true)
      v.pause()
    }
  }

  return (
    <div ref={box} className={`hm-video ${playing ? 'is-playing' : ''}`}>
      <Photo
        name={config.poster.name}
        alt={COPY.hero.photoAlt}
        sizes={HERO_POSTER_SIZES}
        eager
        className="hm-video-poster"
        art={config.phone && { name: config.phone.poster.name, media: HERO_PHONE_MEDIA, sizes: HERO_PHONE_POSTER_SIZES }}
      />
      {want && ready && (
        <video
          // a new element per cut: swapping <source>s in place would not reload the film
          key={phone ? 'phone' : 'wide'}
          ref={ref}
          className="hm-video-film"
          muted
          playsInline
          loop
          preload="metadata"
          aria-label={label}
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
        >
          {/* A missing file errors on its <source>, not the <video>; when the
              last one fails there is nothing left to try, so drop to the poster. */}
          {sources.map((s, i) => (
            <source
              key={s.src}
              src={s.src}
              type={s.type}
              onError={i === sources.length - 1 ? () => setFailed(true) : undefined}
            />
          ))}
          {config.captions && <track kind="captions" src={config.captions} srcLang="en" label="English" default />}
        </video>
      )}
      {want && ready && (
        <button
          type="button"
          className="hm-video-btn"
          onClick={toggle}
          aria-label={playing ? 'Pause the video' : 'Play the video'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} strokeWidth={2.4} />
        </button>
      )}
    </div>
  )
}
