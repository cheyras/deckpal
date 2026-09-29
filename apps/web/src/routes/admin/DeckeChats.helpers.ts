import type { DeckeImprovementTokens } from '../../lib/api'

export type Coverage = 'complete' | 'partial' | 'unknown'

export function costLabel(cost: string | number | null, coverage: Coverage): string {
  if (cost === null || coverage === 'unknown') return 'Unknown cost'
  return `$${cost} USD${coverage === 'partial' ? ' (partial)' : ''}`
}

export function tokenLabel(tokens: DeckeImprovementTokens): string {
  const known = Object.entries(tokens)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => `${name.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`)} ${value}`)
  return known.length ? known.join(' · ') : 'Tokens not recorded'
}

export function turnOffset(seconds: number): string {
  return seconds === 0 ? 'At chat start' : `+${seconds}s`
}

export function eventLabel(event: { ordinal: number; batch: number; batchOrdinal: number; legId: string | null }): string {
  return `Event ${event.ordinal} · batch ${event.batch}.${event.batchOrdinal}${event.legId === null ? '' : ` · leg ${event.legId}`}`
}

export function json(value: unknown): string { return JSON.stringify(value ?? null, null, 2) }
