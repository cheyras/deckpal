import type { Price, VariantPrice } from './api'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

// Money: null → "—" (never $0). Non-USD keeps its own currency symbol.
export function fmtPrice(p: Price | VariantPrice | null | undefined): string {
  if (!p || p.market == null) return '—'
  if (p.currency === 'USD') return USD.format(p.market)
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency }).format(p.market)
  } catch {
    return `${p.market} ${p.currency}`
  }
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return USD.format(n)
}

// A number in an explicit currency (Insights, ValueChart). `maximumFractionDigits`
// is threaded through untouched — passing `undefined` is spec-identical to
// omitting it — so each call site keeps its exact Intl options.
export function fmtMoney(v: number, currency: string, maximumFractionDigits?: number): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits }).format(v)
  } catch {
    return `${v} ${currency}`
  }
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  // A calendar-only date (`YYYY-MM-DD`, no time or offset) names a DAY, not an
  // instant. `new Date('2026-09-16')` parses that as UTC midnight, so
  // `toLocaleDateString` shifts it a calendar day early in zones behind UTC
  // (Sep 15 in America/Denver). Build the Date from the calendar parts in the
  // local zone instead, so the named day renders as that day everywhere. Real
  // catalog `released_on` values arrive as bare `YYYY-MM-DD` from Postgres DATE
  // columns, so this also fixes the dates on existing set rows.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    if (isNaN(date.getTime())) return '—'
    // The local-zone constructor rolls overflow into a valid neighbour
    // (2026-13-01 → Jan 2027, 2026-02-30 → Mar 2, 2026-02-29 in a non-leap
    // year → Mar 1), so verify the parts round-trip exactly before formatting;
    // anything that was normalised is an impossible calendar date and falls
    // back to the em dash. A real leap day like 2024-02-29 survives intact.
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return '—'
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  // Anything with a time or offset is an instant; convert to the local calendar
  // day as before (a 00:30 UTC price-timestamp lands on the previous evening in
  // Denver, which is correct for "when did this happen here").
  const dt = new Date(iso)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// "2 hours ago" freshness line for prices.
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'unknown'
  const then = new Date(iso).getTime()
  if (isNaN(then)) return 'unknown'
  const diff = Date.now() - then
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// Card number as printed: "#001".
export function fmtNumber(n: string): string {
  const asInt = parseInt(n, 10)
  if (!isNaN(asInt) && String(asInt) === n) return `#${String(asInt).padStart(3, '0')}`
  return `#${n}`
}

// Pokémon type → accent colour (for dex type pills). Lowercase slug keys, as the
// insights backend returns them (e.g. "fire", "grass", "psychic").
const TYPE_COLORS: Record<string, string> = {
  normal: '#a8a878',
  fire: '#f08030',
  water: '#6890f0',
  electric: '#f8d030',
  grass: '#78c850',
  ice: '#98d8d8',
  fighting: '#c03028',
  poison: '#a040a0',
  ground: '#e0c068',
  flying: '#a890f0',
  psychic: '#f85888',
  bug: '#a8b820',
  rock: '#b8a038',
  ghost: '#705898',
  dragon: '#7038f8',
  dark: '#705848',
  steel: '#b8b8d0',
  fairy: '#ee99ac',
}
export function typeColor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? '#7f8596'
}

// Set LVL from Complete-Set pct: 0 if 0%, else 1 + floor(pct/25), cap "Max".
// Mirrors setLevel() in apps/api/src/insights/trainerLevel.ts — keep them in step.
export function setLevelLabel(pct: number): string {
  if (pct >= 100) return 'MAX'
  if (pct === 0) return '0'
  return String(1 + Math.floor(pct / 25))
}
