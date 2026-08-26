// Aspect-ratio card-art box. Geometry is fixed before any byte arrives
// (no layout shift). Un-warmed images resolve to a placeholder from the
// image service, so the bg-surface-tertiary box IS the skeleton (UI-SPEC §3.22).
//
// Offline honesty (wiki: Frontend-Research §C.5): art the user hasn't viewed isn't cached, so
// the request fails offline. On error we hide the <img> so the tertiary box reads
// as the intended skeleton — a broken-image glyph would be the wrong story.
//
// TWO SOURCES, IN ORDER (see lib/cardArt.ts for the measurements that forced this):
//
//   1. the public object URL, addressed DIRECTLY — one request, straight to the
//      CDN, no serverless function and no redirect in the path;
//   2. `/deckpal/images/…`, the image tier, on any failure — which is what fills
//      the bucket for a cold asset and answers the placeholder for one upstream
//      genuinely has no art for.
//
// So the fast path is fast and the slow path still self-heals; a cold card pays
// one wasted 400 from Storage and then behaves exactly as it did before.
import { useState } from 'react'
import { directArtUrl } from '../lib/cardArt'

export function CardImage({
  low,
  high,
  alt,
  eager = false,
  className = '',
  radius = 8,
}: {
  low: string
  high: string
  alt: string
  eager?: boolean
  className?: string
  radius?: number
}) {
  const direct = directArtUrl(low)
  const directHigh = directArtUrl(high)

  // 0 = direct object URL, 1 = the image tier, 2 = give up and show the skeleton.
  // Starts at 1 when there is no object tier at all (self-host).
  const [step, setStep] = useState(direct ? 0 : 1)

  // Derived-state reset: the same element can be handed a different card (the
  // grid virtualiser recycles rows). Without this a card that fell back to the
  // proxy would keep the next card on the slow path — or worse, stay hidden.
  const [seen, setSeen] = useState(low)
  if (seen !== low) {
    setSeen(low)
    setStep(direct ? 0 : 1)
  }

  const src = step === 0 ? direct : low
  const srcSet =
    step === 0
      ? `${direct} 245w, ${directHigh ?? high} 600w`
      : `${low} 245w, ${high} 600w`

  return (
    <div
      className={`relative w-full overflow-hidden bg-surface-tertiary ${className}`}
      style={{ aspectRatio: '245 / 337', borderRadius: radius }}
    >
      {step < 2 && src && (
        <img
          // Keyed by the step so swapping source families is a fresh element
          // rather than a mutated src the browser may or may not re-request.
          key={step}
          src={src}
          srcSet={srcSet}
          sizes="(min-width: 1068px) 208px, 45vw"
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          // CORS-readable, so the service worker stores a real response instead of
          // an opaque one. Opaque entries are padded by the browser against the
          // origin's storage quota, which is what made the 2000-entry image cache
          // hit `purgeOnQuotaError` and drop everything it had (see src/sw.ts).
          {...(step === 0 ? { crossOrigin: 'anonymous' as const } : {})}
          onError={() => setStep((s) => s + 1)}
          {...(eager ? { fetchPriority: 'high' as const } : {})}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ borderRadius: radius }}
        />
      )}
    </div>
  )
}
