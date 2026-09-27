// A thumbnail whose bytes have to be FETCHED, not linked.
//
// ── THE RULE THIS EXISTS TO KEEP ───────────────────────────────────────────
//
// Everything the labeler displays lives behind `labelerOnlyInProduction`, which
// reads the verified JWT subject. A browser-initiated `<img src>` sends cookies
// and never the `Authorization: Bearer` header this API authenticates with, so
// a URL handed to an element is a 403 — measured against production, and the
// cause of an entire harvest grid rendering as broken images.
//
// So both grids that show stored frames — the corpus and the pending queue —
// go through this one component. Two copies of "fetch, blob, revoke, observe"
// is two places for the lazy-loading and the revocation to drift, and the
// revocation is the part that matters: a few hundred queued phone photos is
// hundreds of megabytes pinned if a blob URL outlives its card.
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'

export function AuthThumb({
  load,
  alt,
  cacheKey,
  className = 'h-full w-full object-contain',
  onMissing,
}: {
  /** Fetch the bytes. Takes the abort signal so a card scrolled past mid-flight
   *  does not finish a request nobody is waiting for. */
  load: (signal: AbortSignal) => Promise<Blob>
  alt: string
  /** Re-fetch when this changes — the row's id, normally. `load` is usually an
   *  inline closure and cannot be an effect dependency without re-running on
   *  every render. */
  cacheKey: string | number
  className?: string
  onMissing?: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  // A decode failure clears the URL, so the explanation replaces the broken
  // image rather than sitting next to it.
  const shown = failure ? null : url
  // `load` is read through a ref so a new closure each render never restarts a
  // fetch; `cacheKey` is the only thing that may.
  const loadRef = useRef(load)
  loadRef.current = load
  const missingRef = useRef(onMissing)
  missingRef.current = onMissing

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let objectUrl: string | null = null
    const ac = new AbortController()
    setUrl(null)
    setFailure(null)

    const fetchIt = () => {
      void loadRef.current
        .call(null, ac.signal)
        .then((blob) => {
          if (cancelled) return
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        })
        .catch((error) => {
          if (!cancelled) {
            if (error instanceof ApiError && error.status === 404 && missingRef.current) missingRef.current()
            else setFailure(error instanceof ApiError && error.status === 404
              ? 'This photo is no longer available.'
              : 'Could not load this photo. Try again later.')
          }
        })
    }

    const cleanup = () => {
      cancelled = true
      ac.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }

    // No IntersectionObserver (older WebViews, jsdom) is not a reason to show
    // nothing — fall back to fetching immediately.
    if (typeof IntersectionObserver === 'undefined') {
      fetchIt()
      return cleanup
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          fetchIt()
        }
      },
      // A screen ahead, so a scroll lands on decoded frames rather than gaps.
      { rootMargin: '400px' },
    )
    io.observe(host)
    return () => {
      io.disconnect()
      cleanup()
    }
  }, [cacheKey])

  return (
    <div ref={hostRef} className="h-full w-full">
      {shown ? (
        // `onError` IS NOT OPTIONAL HERE. Fetching the bytes can succeed and
        // DECODING them still fail — Chrome cannot read HEIC at all, so an
        // iPhone photo arrives intact and renders as the browser's torn-page
        // glyph. Thirty of those in a grid reads as "the app is broken" rather
        // than "this browser cannot open this format", which is what the owner
        // saw. Say which.
        <img src={shown} alt={alt} className={className} onError={() => setFailure("this browser can't open this format")} />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-[6px] text-center text-[10px] leading-[13px] text-white/35">
          {failure ?? ''}
        </div>
      )}
    </div>
  )
}
