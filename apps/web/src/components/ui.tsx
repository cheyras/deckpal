import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { EnergyIcon } from './EnergyIcon'

// Re-export new primitives from ui/ so existing `import { X } from '../components/ui'`
// call sites keep working without a mass import-rewrite.
export { Button, buttonClass } from './ui/Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './ui/Button'
export { CounterBox } from './ui/CounterBox'
export { ProgressBar, ProgressRing } from './ui/Progress'
export type { ProgressBarProps, ProgressRingProps } from './ui/Progress'
export { EmptyState } from './ui/EmptyState'
export type { EmptyStateProps } from './ui/EmptyState'

// Content column: 85% of main with a per-page max-width cap, centred
// (UI-SPEC §4.1 — gutters are proportional, not fixed).
export function Content({ children, cap = 1165 }: { children: ReactNode; cap?: number }) {
  // At ≥1068 the content column is exactly 85% of MAIN (the 7.5% gutters ARE the
  // padding) — so no extra horizontal padding at desktop, or the card grid loses
  // a column (UI-SPEC §4.1: 4×207.81 + 3×53 = 990.25 = 85% of 1165).
  return (
    <div className="px-[16px] py-[24px] nav:px-0">
      <div className="mx-auto w-full nav:w-[85%]" style={{ maxWidth: cap }}>
        {children}
      </div>
    </div>
  )
}

// TCGdex asset URLs omit the file extension; append one so <img> resolves.
export function assetUrl(url: string | null | undefined, ext = 'png'): string | undefined {
  if (!url) return undefined
  return /\.(png|webp|jpg|jpeg|svg)$/i.test(url) ? url : `${url}.${ext}`
}

// Local set logo/symbol served by deckscout-images from the WebP cache. The path is
// a pure function of the set's tcgdex_id; the service 404s when a set lacks that
// asset, so callers gate on known presence AND handle onError for a clean fallback.
export function setAssetUrl(setId: string, kind: 'logo' | 'symbol'): string {
  return `/deckscout/images/sets/${encodeURIComponent(setId)}/${kind}.webp`
}

export function BackPill({ to, params, label }: { to: string; params?: Record<string, string>; label: string }) {
  return (
    <Link
      to={to}
      params={params as never}
      className="inline-flex h-[28px] items-center gap-[4px] rounded-full bg-surface-tertiary px-[12px] text-[10px] font-bold text-text-primary hover:bg-action-default-hover"
    >
      <Icon name="chevron-left" size={14} />
      {label}
    </Link>
  )
}

// --- Set-symbol fallbacks ----------------------------------------------------
// Some sets legitimately have no warmed symbol (49 of 218) — and a few families
// (Black Star Promos, energy sets, McDonald's Collection) either have no symbol
// or a generic one that doesn't convey what the set is. For those we render a
// small authored mark; for everything else we derive a readable acronym tag from
// the set code/id (e.g. `mep`→MEP, `mee`→MEE, `swsh12.5gg`→GG) — never a bare ◆.

// Black Star Promo set ids across every series (name also carries "Black Star Promos").
const BLACK_STAR_PROMO_IDS = new Set([
  'basep', 'bwp', 'dpp', 'hgssp', 'mep', 'np', 'smp', 'svp', 'swshp', 'xyp',
])
// Energy sets (full-art / basic-energy printings) — show all the type symbols.
const ENERGY_SET_IDS = new Set(['mee', 'sve'])

type SetMark = 'promo' | 'energy' | null

// Classify a set into a special-mark family from its id and/or name. Works from
// the id alone (so callers that don't pass a name — e.g. CardDetail — still get
// the right mark); the name is a secondary signal for robustness.
//
// There is deliberately no McDonald's branch (issue #15). The two marks below are
// original artwork standing in for *Pokémon TCG* families that have no per-set
// symbol upstream. A McDonald's branch instead reproduced a third-party corporate
// trademark (the Golden Arches) as app chrome — the same exposure the Poké Ball /
// POKÉMON wordmark icons were replaced for (DECISIONS.md 2026-08-09). Those sets
// now use the ordinary ladder: the real TCGdex set symbol where one is published
// (2021swsh), else the derived tag below.
function setMarkKind(setId?: string | null, name?: string | null): SetMark {
  const id = (setId ?? '').toLowerCase()
  const nm = name ?? ''
  if (BLACK_STAR_PROMO_IDS.has(id) || /black star promos?/i.test(nm)) return 'promo'
  if (ENERGY_SET_IDS.has(id) || /\benergy\b/i.test(nm)) return 'energy'
  return null
}

// Derive a short, readable acronym tag from a set's code/id (falling back to its
// name). Purpose-built for the tile — keeps it to a few uppercase chars so it fits.
export function deriveSetTag(setId?: string | null, name?: string | null): string {
  const raw = (setId ?? '').trim()
  const compact = raw.replace(/[^a-zA-Z0-9]/g, '')
  // Short clean codes (mep, mee, svp, rc, np, A3, B1a, P-A, me02…) read best as-is.
  if (compact.length > 0 && compact.length <= 4) return compact.toUpperCase()
  // Year-bucketed sets (the McDonald's Collection: 2011bw … 2024sv) are known by
  // their year, not their era suffix. Without this the name-initials branch below
  // produced "MS2" for "McDonald's Collection 2021" (issue #15).
  const year = raw.match(/^(20\d{2})/)
  if (year) return year[1]!
  // Trailing letter suffix after a digit → Galarian/Trainer Gallery, Shiny Vault,
  // Classic Collection (swsh12.5gg→GG, swsh10.5tg→TG, cel25cc→CC, swsh4.5sv→SV).
  const suffix = raw.match(/\d([a-zA-Z]{2,3})$/)
  if (suffix) return suffix[1].toUpperCase()
  // Otherwise initials from the set name, skipping filler words.
  if (name) {
    const words = name
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !/^(the|of|and|a|an|set|collection|promos?|trainer|classic|pack|cards?|kit)$/i.test(w))
    if (words.length >= 2) return words.slice(0, 4).map((w) => w[0]).join('').toUpperCase()
  }
  // Last resort: leading letter prefix, else the compacted head.
  const prefix = raw.match(/^([a-zA-Z]{1,4})/)
  if (prefix) return prefix[1].toUpperCase()
  return compact.slice(0, 4).toUpperCase() || '?'
}

// Authored mark: the black star with "PROMO" beneath, white-outlined — the icon
// printed on every Black Star Promo card. Reads as a plain black star on the
// white tile (the white outline is for dark backgrounds).
function PromoStarMark({ size }: { size: number }) {
  return (
    <svg width={size * 0.86} height={size * 0.86} viewBox="0 0 24 26" role="img" aria-label="Black Star Promo">
      <title>Black Star Promo</title>
      <path
        d="M12 1.5 L15 8.3 L22.4 9 L16.9 14 L18.5 21.2 L12 17.4 L5.5 21.2 L7.1 14 L1.6 9 L9 8.3 Z"
        fill="#111318"
        stroke="#ffffff"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      <text
        x="12"
        y="24.6"
        textAnchor="middle"
        fontSize="5.4"
        fontWeight="800"
        letterSpacing="0.2"
        fill="#111318"
        stroke="#ffffff"
        strokeWidth="0.35"
        paintOrder="stroke"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        PROMO
      </text>
    </svg>
  )
}

// Composed mark: a small cluster of the Pokémon energy-type symbols, standing in
// for an energy set's thumbnail.
function EnergySymbolsMark({ size }: { size: number }) {
  const types = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting']
  const icon = Math.round(size * 0.3)
  return (
    <div
      className="grid grid-cols-3 place-items-center"
      style={{ gap: size * 0.02, width: '84%', height: '84%' }}
    >
      {types.map((t) => (
        <EnergyIcon key={t} type={t} size={icon} />
      ))}
    </div>
  )
}

// White rounded set-symbol tile (UI-SPEC §3.7). The symbol is served locally from
// the WebP cache by set id. When a set belongs to a special family (Black Star
// Promo, energy) we render an authored mark; when it has no warmed symbol (or the
// fetch fails) we render a derived acronym tag — never a bare ◆, no broken image,
// no layout shift. `name` is optional & backward-compatible.
export function SetSymbolTile({
  setId,
  hasSymbol,
  name,
  size = 40,
}: {
  setId?: string | null
  hasSymbol?: boolean | null
  name?: string | null
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  const mark = setMarkKind(setId, name)
  const showImg = Boolean(setId && hasSymbol && !mark && !failed)
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-on-light"
      style={{ width: size, height: size }}
    >
      {mark === 'promo' ? (
        <PromoStarMark size={size} />
      ) : mark === 'energy' ? (
        <EnergySymbolsMark size={size} />
      ) : showImg ? (
        <img
          src={setAssetUrl(setId!, 'symbol')}
          alt=""
          className="h-[70%] w-[70%] object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="font-black leading-none text-surface-on-light-text"
          style={{ fontSize: size * (deriveSetTag(setId, name).length >= 4 ? 0.3 : 0.4) }}
        >
          {deriveSetTag(setId, name)}
        </span>
      )}
    </div>
  )
}

/**
 * Spinner — the one shared loading indicator.
 *
 * `inline` renders a bare ring element suitable for embedding inside text,
 * buttons (see Button `loading` prop), or horizontal layouts. The ring
 * colour inherits from `currentColor` so it adapts to any context.
 *
 * Without `inline` the spinner is a block-level, vertically-centred element
 * with an optional text label — the page/section loading state.
 */
export function Spinner({
  label,
  size,
  inline = false,
  className,
}: {
  label?: string
  /** Ring diameter in pixels. Defaults to 40 (block) or 16 (inline). */
  size?: number
  /** Render just the ring, no centering/padding — for inline contexts. */
  inline?: boolean
  className?: string
}) {
  const s = size ?? (inline ? 16 : 40)

  if (inline) {
    return (
      <span
        className={`shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent${className ? ` ${className}` : ''}`}
        style={{ width: s, height: s }}
        aria-hidden="true"
      />
    )
  }

  return (
    <div className="flex flex-col items-center justify-center gap-[12px] py-[80px] text-text-muted">
      <div
        className="animate-spin rounded-full border-2 border-surface-tertiary border-t-action-primary"
        style={{ width: s, height: s }}
      />
      {label && <span className="text-[14px]">{label}</span>}
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-[8px] py-[80px] text-center">
      <div className="text-[24px] font-bold text-text-primary">Something went wrong</div>
      <div className="text-[14px] text-text-muted">{message}</div>
    </div>
  )
}
