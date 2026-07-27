import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'

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

// Local set logo/symbol served by pokedex-images from the WebP cache. The path is
// a pure function of the set's tcgdex_id; the service 404s when a set lacks that
// asset, so callers gate on known presence AND handle onError for a clean fallback.
export function setAssetUrl(setId: string, kind: 'logo' | 'symbol'): string {
  return `/pokedex/images/sets/${encodeURIComponent(setId)}/${kind}.webp`
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

// White rounded set-symbol tile (UI-SPEC §3.7). The symbol is served locally from
// the WebP cache by set id; when a set has no symbol (49 of 218) or the fetch fails,
// a placeholder ◆ glyph fills the same white tile — no broken image, no layout shift.
export function SetSymbolTile({
  setId,
  hasSymbol,
  size = 40,
}: {
  setId?: string | null
  hasSymbol?: boolean | null
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  const showImg = Boolean(setId && hasSymbol && !failed)
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg bg-surface-on-light"
      style={{ width: size, height: size }}
    >
      {showImg ? (
        <img
          src={setAssetUrl(setId!, 'symbol')}
          alt=""
          className="h-[70%] w-[70%] object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="font-black text-surface-on-light-text"
          style={{ fontSize: size * 0.42 }}
        >
          ◆
        </span>
      )}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-[12px] py-[80px] text-text-muted">
      <div className="h-[40px] w-[40px] animate-spin rounded-full border-2 border-surface-tertiary border-t-action-primary" />
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
