// Minimal line-icon set (24px, stroke=currentColor). Built clean from scratch;
// no pkmn.gg asset is lifted. Icons take colour from `color`/CSS `currentColor`.

export type IconName =
  | 'cards'
  | 'lists'
  | 'deck'
  | 'pokedex'
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
  | 'check'
  | 'check-circle'
  | 'alert'
  | 'copy'
  | 'shuffle'
  | 'download'
  | 'cart'
  | 'chart'
  | 'user'
  | 'gear'
  | 'sparkle'
  | 'camera'
  | 'printer'
  | 'bug'
  | 'book'
  | 'history'
  | 'logout'
  | 'mail'
  | 'key'
  | 'kebab'

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
  check: <path d="M5 12.5l4.5 4.5L19 6.5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.2l2.6 2.6L16 9" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.2L1.8 20.5h20.4L12 3.2z" />
      <path d="M12 9.5v5M12 17.6v.1" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M6 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1" />
    </>
  ),
  shuffle: (
    <>
      <path d="M16 4h4v4" />
      <path d="M4 20l16-16" />
      <path d="M16 20h4v-4" />
      <path d="M4 4l5 5M15 15l5 5" />
    </>
  ),
  download: <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />,
  cart: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h3l2.2 12.2a1.5 1.5 0 001.5 1.3h8.6a1.5 1.5 0 001.5-1.2L21 7H6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 4v15a1 1 0 001 1h15" />
      <path d="M8 15l3.5-4 3 2.5L20 7" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0114 0" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M4.2 7l2.6 1.5M17.2 15.5l2.6 1.5M4.2 17l2.6-1.5M17.2 8.5l2.6-1.5" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" stroke="none" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8a2 2 0 012-2h1.5l1.2-1.8a1 1 0 01.83-.45h5a1 1 0 01.83.45L15.5 6H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  printer: (
    <>
      <path d="M6 9V4h12v5" />
      <path d="M6 18H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-1" />
      <rect x="7" y="15" width="10" height="5" rx="1" />
      <path d="M17 12.5h.01" />
    </>
  ),
  bug: (
    <>
      <path d="M9 6a3 3 0 016 0v1H9V6z" />
      <rect x="7" y="7" width="10" height="11" rx="5" />
      <path d="M12 10v8M3 11h4M17 11h4M3.5 6.5L7 9M20.5 6.5L17 9M3.5 18.5L7 15M20.5 18.5L17 15" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.5C10.4 5 8.3 4.5 4 4.5v14c4.3 0 6.4.5 8 2 1.6-1.5 3.7-2 8-2v-14c-4.3 0-6.4.5-8 2z" />
      <path d="M12 6.5v14" />
    </>
  ),
  history: (
    <>
      <path d="M4.6 7.5A8.5 8.5 0 113.5 12" />
      <path d="M4 3.5v4.5h4.5" />
      <path d="M12 8v4.5l3 2" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M3.5 7.5l7.3 5.1a2 2 0 002.4 0l7.3-5.1" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="4.2" />
      <path d="M12.2 12H21M18.2 12v3.2M15.4 12v2.4" />
    </>
  ),
  kebab: (
    <>
      <circle cx="12" cy="5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
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

// The brand mark: the card-scanner app icon (public/brand-icon.png, 128px with
// baked rounded corners + alpha). Same art as the favicon.
export function BrandMark({ size = 33 }: { size?: number }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}brand-icon.png`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{ display: 'block', borderRadius: '22%' }}
    />
  )
}
