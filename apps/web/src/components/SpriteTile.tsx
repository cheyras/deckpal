import { useArtSrc } from '../lib/useArtSrc'

// A species sprite in a fixed-geometry box. The sprite job may still be running,
// so a 404 is expected and handled EXACTLY like un-warmed card art: the box owns
// its geometry before any byte arrives (no layout shift) and falls back to a
// Poké-ball glyph placeholder on error. Uncaptured species render dimmed.
//
// Source order is the ladder in lib/cardArt.ts — the object URL directly, then
// the image tier. It matters most here: the Pokédex asks for ~320 sprites on one
// screen, and every one of them used to be a serverless invocation plus a
// redirect (measured p50 2456 ms / slowest 8557 ms on production, 2026-08-26).
export function SpriteTile({
  src,
  alt,
  captured,
  pixelated = true,
  className = '',
}: {
  src: string
  alt: string
  captured: boolean
  pixelated?: boolean
  className?: string
}) {
  const art = useArtSrc(src)
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-surface-tertiary ${className}`}
      style={{ aspectRatio: '1 / 1' }}
    >
      {art.failed || !art.src ? (
        <Placeholder />
      ) : (
        <img
          key={art.step}
          src={art.src}
          {...(art.crossOrigin ? { crossOrigin: art.crossOrigin } : {})}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={art.onError}
          className="h-[82%] w-[82%] object-contain"
          style={{
            imageRendering: pixelated ? 'pixelated' : 'auto',
            filter: captured ? 'none' : 'grayscale(1) brightness(0.55)',
            opacity: captured ? 1 : 0.6,
          }}
        />
      )}
    </div>
  )
}

function Placeholder() {
  return (
    <svg width="42%" height="42%" viewBox="0 0 24 24" aria-hidden="true" className="text-icon-muted-strong">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M3 12h18" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  )
}
