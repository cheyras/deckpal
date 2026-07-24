// Aspect-ratio card-art box. Geometry is fixed before any byte arrives
// (no layout shift). Un-warmed images resolve to a placeholder from the
// image service, so the bg-surface-tertiary box IS the skeleton (UI-SPEC §3.22).

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
  return (
    <div
      className={`relative w-full overflow-hidden bg-surface-tertiary ${className}`}
      style={{ aspectRatio: '245 / 337', borderRadius: radius }}
    >
      <img
        src={low}
        srcSet={`${low} 245w, ${high} 600w`}
        sizes="(min-width: 1068px) 208px, 45vw"
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        {...(eager ? { fetchPriority: 'high' as const } : {})}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ borderRadius: radius }}
      />
    </div>
  )
}
