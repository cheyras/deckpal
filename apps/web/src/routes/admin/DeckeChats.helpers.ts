export type Coverage = 'complete' | 'partial' | 'unknown'

export function costLabel(cost: string | number | null, coverage: Coverage): string {
  if (cost === null || coverage === 'unknown') return 'Unknown cost'
  return `$${cost} USD${coverage === 'partial' ? ' (partial)' : ''}`
}

export function sharingLabel(source: string | null | undefined): string {
  return ({ decke_ask: 'Asked', feedback: 'Feedback', reader: 'Reader' } as Record<string, string>)[source ?? ''] ?? 'Not recorded'
}

export function eventOffset(event: Record<string, unknown>, startedAt?: string | null): string {
  const at = typeof event.at === 'string' ? Date.parse(event.at) : NaN
  const started = startedAt ? Date.parse(startedAt) : NaN
  if (!Number.isFinite(at) || !Number.isFinite(started)) return 'Time not recorded'
  return `+${Math.max(0, at - started)} ms`
}

export function json(value: unknown): string { return JSON.stringify(value ?? null, null, 2) }
