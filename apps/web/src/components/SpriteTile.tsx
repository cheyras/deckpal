import { useState } from 'react'

// A species sprite in a fixed-geometry box. The sprite job may still be running,
// so a 404 is expected and handled EXACTLY like un-warmed card art: the box owns
// its geometry before any byte arrives (no layout shift) and falls back to a
// Poké-ball glyph placeholder on error. Uncaptured species render dimmed.
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
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-surface-tertiary ${className}`}
      style={{ aspectRatio: '1 / 1' }}
    >
      {failed ? (
        <Placeholder />
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
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
