import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
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

// White rounded set-symbol tile (UI-SPEC §3.7). symbolUrl is usually null in
// our data → render a placeholder glyph on the white surface.
export function SetSymbolTile({ url, size = 40 }: { url?: string | null; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg bg-surface-on-light"
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" className="h-[70%] w-[70%] object-contain" />
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
