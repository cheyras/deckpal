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

// SQL DATE / catalog release-date contexts. Accepts bare `YYYY-MM-DD` strings
// and exactly midnight-UTC serializations (`YYYY-MM-DDT00:00:00Z` and
// `YYYY-MM-DDT00:00:00.000Z`), both of which name a calendar day rather than
// an instant. In America/Denver (UTC−6), `2026-09-16T00:00:00Z` is 18:00 the
// prior evening — treating it as an instant would shift the displayed date one
// day early. Use this for set.releasedOn and any other SQL DATE column value.
// For genuine timestamps (price ingest, audit, credit, deck history, admin
// events) use fmtDate, which preserves true instant-to-local-day conversion.
export function fmtCalendarDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const calendarStr = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? iso
    : /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(iso)
    ? iso.substring(0, 10)
    : null
  if (calendarStr === null) return '—'
  const [y, m, d] = calendarStr.split('-').map(Number)
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

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  // A calendar-only date (`YYYY-MM-DD`, no time or offset) names a DAY, not an
  // instant. `new Date('2026-09-16')` parses that as UTC midnight, so
  // `toLocaleDateString` shifts it a calendar day early in zones behind UTC
  // (Sep 15 in America/Denver). Build the Date from the calendar parts in the
  // local zone instead, so the named day renders as that day everywhere.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    if (isNaN(date.getTime())) return '—'
    // Round-trip overflow check: see fmtCalendarDate for the rationale.
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return '—'
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  // Anything with a time or offset is a genuine instant; convert to the local
  // calendar day (a 00:00 UTC midnight timestamp lands on the prior evening in
  // Denver — that is the correct "when did this happen here" reading for
  // timestamps such as price ingest events, audit rows, credit entries and deck
  // history). For SQL DATE columns serialized as midnight-UTC, use
  // fmtCalendarDate instead.
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

// Set LVL from raw owned/total counts — truncating integer math, never a
// rounded percentage. Mirrors the DB's generated user_set_progress.set_level
// column and setLevelFromCounts() in apps/api/src/insights/trainerLevel.ts.
// QUAL-05: the API already computes and sends this; call sites that instead
// derived a level from the *display* pct (rounded to one decimal) could round
// a borderline count like 1999/2000 across a level boundary a card early.
// Kept here only as a fallback for a `setLevel` field that hasn't loaded yet
// (e.g. mid-optimistic-update) — prefer the server's value when it's present.
export function setLevelFromCounts(owned: number, total: number): number {
  if (!owned || !total) return 0
  const intPct = Math.floor((owned * 100) / total) // truncating, like Postgres integer division
  return 1 + Math.min(4, Math.floor(intPct / 25))
}

// Set LVL label from a level (0–5; 5 = fully complete). Mirrors
// setLevelLabel() in apps/api/src/insights/trainerLevel.ts, which formats the
// same authoritative level rather than re-deriving one.
export function setLevelLabel(level: number): string {
  return level >= 5 ? 'MAX' : String(level)
}
