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
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
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

// Set LVL from Complete-Set pct (verified against pkmn.gg): 0 if 0%, else 1+floor(pct/25), cap "Max".
export function setLevelLabel(pct: number): string {
  if (pct >= 100) return 'MAX'
  if (pct === 0) return '0'
  return String(1 + Math.floor(pct / 25))
}
