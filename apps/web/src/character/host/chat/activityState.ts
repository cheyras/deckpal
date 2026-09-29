import { labelFor } from './toolKinds'
import { faviconUrl, type Source } from './sourcesState'
export type ActivityPhase = 'start' | 'progress' | 'ok' | 'partial' | 'error' | 'declined' | 'unknown'
export type ActivityStep = { id: string; name: string; phase: ActivityPhase; label?: string; args?: unknown; title?: string; summary?: string; sources?: Source[]; note?: string }
export const isRunning = (step: ActivityStep) => step.phase === 'start' || step.phase === 'progress'
export const isFailure = (step: ActivityStep) => step.phase === 'error' || step.phase === 'partial'
export function currentStep(steps: readonly ActivityStep[]): ActivityStep | undefined { return [...steps].reverse().find(isRunning) ?? steps.at(-1) }
export function stepLabel(step: ActivityStep): string { return labelFor(step) }
export function activitySummary(steps: readonly ActivityStep[], elapsedSeconds: number): string {
  const relevant = steps.filter((step) => step.name !== 'flyTo' && step.name !== 'goTo' && step.name !== 'click' && step.name !== 'highlight' && step.name !== 'journey' && step.name !== 'escort' && step.name !== 'scrollToMe')
  const failures = relevant.filter(isFailure).length
  const elapsed = `${Math.max(0, Math.floor(elapsedSeconds))}s`
  if (failures) return `${failures} step${failures === 1 ? '' : 's'} didn't work · ${elapsed}`
  return `Looked at ${relevant.length} thing${relevant.length === 1 ? '' : 's'} · ${elapsed}`
}
export function sourceFavicons(sources: readonly Source[]): { urls: string[]; more: number } {
  const urls = sources.map((s) => faviconUrl(s.host)).filter((url): url is string => Boolean(url))
  return { urls: urls.slice(0, 3), more: Math.max(0, sources.length - 3) }
}
