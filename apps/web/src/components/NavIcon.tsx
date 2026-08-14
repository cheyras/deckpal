// Animated nav icons — the micro-illustration layer of the premium pass.
//
// Same 24px / stroke-1.75 / currentColor contract as Icon.tsx, and the RESTING
// (unselected) geometry is deliberately the same drawing, so nothing jumps when
// the skin is switched. What is new is that each icon is built from separately
// addressable parts, and selecting the row plays a little story with them:
//
//   cards   the back card fans out from behind the front one
//   lists   the bullets pop in sequence and the rules draw out
//   deck    the cover swings open on its spine, a card rises out
//   pokedex the ball tips, the button lights, a ring pings off it
//   chart   bars grow from the axis, then the trend draws over them
//   camera  the iris stops down, the lens lights, a catch-light pops
//
// All of the timing lives in premium.css (§6) keyed off `data-on`, not here —
// this file is only the geometry and the part names. Icons the nav does not
// animate fall through to <Icon>, so this stays a six-icon file rather than a
// second copy of the whole set.

import { Icon, type IconName } from './Icon'
import { useSkin } from '../lib/useSkin'

/** The subset with a selected-state animation. Everything else falls through. */
const ANIMATED = new Set<IconName>(['cards', 'lists', 'deck', 'pokedex', 'chart', 'camera'])

export function isAnimatedNavIcon(name: IconName): boolean {
  return ANIMATED.has(name)
}

function Svg({ size, active, children }: { size: number; active: boolean; children: React.ReactNode }) {
  return (
    <svg
      className="px-icon"
      data-on={active ? 'true' : 'false'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const ART: Partial<Record<IconName, (active: boolean, size: number) => React.ReactNode>> = {
  // Front card + a back card that fans. The back card is drawn FIRST so it
  // sits behind; its rotation origin is set in CSS (bottom-left) so it pivots
  // out of the stack the way a real fan does.
  cards: (active, size) => (
    <Svg size={size} active={active}>
      <path className="px-card-back" d="M17 6l3 1.2a2 2 0 011.2 2.5l-3.2 8.8" />
      <rect x="3" y="4" width="12" height="16" rx="2" />
      <path className="px-card-line px-card-line-1" d="M8 8h4" />
      <path className="px-card-line px-card-line-2" d="M8 12h4" />
    </Svg>
  ),

  lists: (active, size) => (
    <Svg size={size} active={active}>
      <path className="px-rule px-rule-1" d="M8 6h13" />
      <path className="px-rule px-rule-2" d="M8 12h13" />
      <path className="px-rule px-rule-3" d="M8 18h13" />
      <circle className="px-dot px-dot-1" cx="3.5" cy="6" r="1" />
      <circle className="px-dot px-dot-2" cx="3.5" cy="12" r="1" />
      <circle className="px-dot px-dot-3" cx="3.5" cy="18" r="1" />
    </Svg>
  ),

  // The inner card is drawn first so the cover closes over it when unselected.
  deck: (active, size) => (
    <Svg size={size} active={active}>
      <rect className="px-inner-card" x="11" y="5" width="7" height="14" rx="1.5" />
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path className="px-cover" d="M9 3v18" />
    </Svg>
  ),

  pokedex: (active, size) => (
    <Svg size={size} active={active}>
      <g className="px-ball">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
      </g>
      <circle className="px-ball-ring" cx="12" cy="12" r="4" strokeWidth={1.25} />
      <circle className="px-ball-core" cx="12" cy="12" r="2.5" />
    </Svg>
  ),

  chart: (active, size) => (
    <Svg size={size} active={active}>
      {/* Bars sit under the trend line and use currentColor at reduced alpha
          (set in CSS) so the line stays the figure and they stay the ground. */}
      <rect className="px-bar px-bar-1" x="7" y="13" width="2.5" height="7" rx="0.6" fill="currentColor" stroke="none" />
      <rect className="px-bar px-bar-2" x="11.5" y="10" width="2.5" height="10" rx="0.6" fill="currentColor" stroke="none" />
      <rect className="px-bar px-bar-3" x="16" y="6" width="2.5" height="14" rx="0.6" fill="currentColor" stroke="none" />
      <path d="M4 4v15a1 1 0 001 1h15" />
      <path className="px-trend" d="M8 15l3.5-4 3 2.5L20 7" />
    </Svg>
  ),

  camera: (active, size) => (
    <Svg size={size} active={active}>
      <path d="M4 8a2 2 0 012-2h1.5l1.2-1.8a1 1 0 01.83-.45h5a1 1 0 01.83.45L15.5 6H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
      <circle className="px-flash" cx="17.2" cy="9.2" r="0.85" fill="currentColor" stroke="none" />
      <circle className="px-lens" cx="12" cy="13" r="3.2" />
      <circle className="px-lens-core" cx="12" cy="13" r="1.4" stroke="none" />
    </Svg>
  ),
}

/**
 * Renders the animated variant when the premium skin is on and one exists for
 * `name`; otherwise the plain <Icon>. Callers do not need to know which.
 *
 * The classic fall-through is not just tidiness — the resting states of the
 * animated parts (the deck's inner card, the chart's bars) are established by
 * premium.css. Rendering this markup with that stylesheet inert would show
 * them all at once, so classic gets the original icon, unchanged.
 */
export function NavIcon({ name, active, size = 24 }: { name: IconName; active: boolean; size?: number }) {
  const skin = useSkin()
  const art = ART[name]
  if (skin !== 'premium' || !art) return <Icon name={name} size={size} />
  return <>{art(active, size)}</>
}
