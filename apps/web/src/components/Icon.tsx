// Minimal line-icon set (24px, stroke=currentColor). Built clean from scratch;
// no pkmn.gg asset is lifted. Icons take colour from `color`/CSS `currentColor`.

export type IconName =
  | 'cards'
  | 'lists'
  | 'deck'
  | 'pokedex'
  | 'stream'
  | 'discord'
  | 'merch'
  | 'pro'
  | 'search'
  | 'sliders'
  | 'grid'
  | 'table'
  | 'binder'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'star-outline'
  | 'star-filled'
  | 'external'
  | 'menu'
  | 'close'
  | 'link'
  | 'minus'
  | 'plus'

const PATHS: Record<IconName, React.ReactNode> = {
  cards: (
    <>
      <rect x="3" y="4" width="12" height="16" rx="2" />
      <path d="M8 8h4M8 12h4" />
      <path d="M17 6l3 1.2a2 2 0 011.2 2.5l-3.2 8.8" />
    </>
  ),
  lists: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1" />
      <circle cx="3.5" cy="12" r="1" />
      <circle cx="3.5" cy="18" r="1" />
    </>
  ),
  deck: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 3v18" />
    </>
  ),
  pokedex: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  stream: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
    </>
  ),
  discord: (
    <>
      <path d="M8 9a12 12 0 018 0M7.5 16a10 10 0 009 0" />
      <path d="M8.5 15.5c-1.5-.5-2.5-2-3-4.5S6 6.5 8.5 6l.5 1M15.5 15.5c1.5-.5 2.5-2 3-4.5S18 6.5 15.5 6l-.5 1" />
      <circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  merch: (
    <>
      <path d="M9 4l-5 2 1.5 3L7 8.5V20h10V8.5L18.5 9 20 6l-5-2a3 3 0 01-6 0z" />
    </>
  ),
  pro: (
    <>
      <path d="M4 7l4 4 4-6 4 6 4-4-2 12H6z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M9 5v14" />
    </>
  ),
  binder: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 9h16M4 15h16M12 3v18" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'star-outline': <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  'star-filled': (
    <path
      d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
      fill="currentColor"
      stroke="none"
    />
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  link: (
    <>
      <path d="M10 13a4 4 0 006 .5l2.5-2.5a4 4 0 00-5.5-5.5L12 6.5" />
      <path d="M14 11a4 4 0 00-6-.5L5.5 13a4 4 0 005.5 5.5L12 17.5" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
}

export function Icon({
  name,
  size = 24,
  className,
  strokeWidth = 1.75,
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

// The brand mark: a yellow rounded tile with a card + star, echoing pkmn.gg's lockup
// without copying it.
export function BrandMark({ size = 33 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="9" fill="var(--color-action-primary)" />
      <rect x="11" y="9" width="13" height="20" rx="2.5" fill="#1f232d" />
      <path
        d="M27 12.5l1.7 3.4 3.8.6-2.8 2.7.7 3.8-3.4-1.8-3.4 1.8.7-3.8-2.8-2.7 3.8-.6z"
        fill="#fff"
      />
    </svg>
  )
}
