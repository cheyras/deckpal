import { labelFor } from './toolKinds'
import { faviconUrl, type Source } from './sourcesState'

export type ActivityPhase = 'start' | 'progress' | 'ok' | 'partial' | 'error' | 'declined' | 'unknown'

export type ActivityStep = {
  id: string
  name: string
  phase: ActivityPhase
  label?: string
  args?: unknown
  title?: string
  summary?: string
  sources?: Source[]
  note?: string
}

const MOVE_TOOLS = new Set(['flyTo', 'goTo', 'click', 'highlight', 'journey', 'escort', 'scrollToMe'])

export function isRunning(step: ActivityStep): boolean {
  return step.phase === 'start' || step.phase === 'progress'
}

export function isFailure(step: ActivityStep): boolean {
  return step.phase === 'error' || step.phase === 'partial'
}

export function currentStep(steps: readonly ActivityStep[]): ActivityStep | undefined {
  return [...steps].reverse().find(isRunning) ?? steps.at(-1)
}

export function stepLabel(step: ActivityStep): string {
  return labelFor(step)
}

export function activitySummary(steps: readonly ActivityStep[], elapsedSeconds: number): string {
  const relevant = steps.filter((step) => !MOVE_TOOLS.has(step.name) && step.phase !== 'declined')
  const declined = steps.filter((step) => !MOVE_TOOLS.has(step.name) && step.phase === 'declined').length
  const failures = relevant.filter(isFailure).length
  const elapsed = `${Math.max(0, Math.floor(elapsedSeconds))}s`
  const skipped = declined
    ? `, skipped ${declined === 1 ? '1 change' : `${declined} changes`}`
    : ''

  if (!relevant.length && declined) {
    return `${declined === 1 ? 'Skipped that change' : `Skipped ${declined} changes`} · ${elapsed}`
  }
  if (failures) return `${failures} step${failures === 1 ? '' : 's'} didn't work${skipped} · ${elapsed}`
  return `Looked at ${relevant.length} thing${relevant.length === 1 ? '' : 's'}${skipped} · ${elapsed}`
}

export function sourceFavicons(sources: readonly Source[]): { urls: string[]; more: number } {
  const urls = sources
    .map((source) => faviconUrl(source.host))
    .filter((url): url is string => Boolean(url))

  return { urls: urls.slice(0, 3), more: Math.max(0, sources.length - 3) }
}
