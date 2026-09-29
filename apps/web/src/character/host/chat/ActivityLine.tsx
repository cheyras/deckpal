import { useEffect, useId, useState, type JSX } from 'react'
import { Icon } from '../../../components/Icon'
import {
  activitySummary,
  currentStep,
  isFailure,
  isRunning,
  sourceFavicons,
  stepLabel,
  type ActivityStep,
} from './activityState'
import { iconFor, kindOf, motionFor } from './toolKinds'
import { mergeSources, type Source } from './sourcesState'

export type { ActivityStep } from './activityState'

type ActivityLineProps = {
  steps: ActivityStep[]
  busy: boolean
  startedAt?: number
  waiting?: boolean
  sources?: Source[]
  defaultOpen?: boolean
  onRetryStep?: (id: string) => void
}

function FaviconStrip({ sources }: { sources: readonly Source[] }): JSX.Element | null {
  const favicons = sourceFavicons(sources)
  if (!favicons.urls.length) return null

  return (
    <span className="ml-auto flex shrink-0 items-center gap-[3px]" aria-label={`${sources.length} sources consulted`}>
      {favicons.urls.map((url) => (
        <img key={url} src={url} alt="" className="h-[14px] w-[14px] rounded-[3px]" />
      ))}
      {favicons.more ? <span className="text-text-muted">+{favicons.more}</span> : null}
    </span>
  )
}

function StepRow({ step, onRetry }: { step: ActivityStep; onRetry?: (id: string) => void }): JSX.Element {
  const failed = isFailure(step)
  const running = isRunning(step)
  const detail = step.summary || step.note

  return (
    <li className={failed ? 'rounded-[7px] bg-warning/[0.07] px-[7px] py-[4px]' : ''}>
      <div className="flex items-center gap-[6px]">
        <Icon
          name={iconFor(kindOf(step.name))}
          size={13}
          className={[
            running ? motionFor(kindOf(step.name)) : '',
            failed ? 'text-warning' : 'text-icon-muted',
          ].join(' ')}
        />
        <span>{stepLabel(step)}</span>
        {failed && onRetry ? (
          <button
            type="button"
            aria-label={`Try ${step.title || stepLabel(step)} again`}
            onClick={() => onRetry(step.id)}
            className="ml-auto text-action-primary hover:underline"
          >
            Try again
          </button>
        ) : null}
      </div>
      {detail ? <p className="pl-[19px] text-text-muted">{detail}</p> : null}
    </li>
  )
}

function StepList({
  id,
  open,
  steps,
  onRetryStep,
}: {
  id: string
  open: boolean
  steps: ActivityStep[]
  onRetryStep?: (id: string) => void
}): JSX.Element {
  return (
    <ul id={id} hidden={!open} className="flex flex-col gap-[3px] pl-[21px]">
      {steps.map((step) => (
        <StepRow key={step.id} step={step} onRetry={onRetryStep} />
      ))}
    </ul>
  )
}

export function ActivityLine({
  steps,
  busy,
  startedAt,
  waiting = false,
  sources = [],
  defaultOpen = false,
  onRetryStep,
}: ActivityLineProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const [now, setNow] = useState(Date.now())
  const id = useId()

  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  const active = currentStep(steps)
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  const label = waiting ? 'Waiting for your OK' : active ? stepLabel(active) : 'Thinking…'
  const kind = active ? kindOf(active.name) : 'other'
  const researchSources = mergeSources([
    sources,
    ...steps.filter((step) => kindOf(step.name) === 'research').map((step) => step.sources),
  ])
  const summary = busy ? label : activitySummary(steps, elapsed)
  const failure = !busy && steps.some(isFailure)

  return (
    <div
      data-decke-activity
      className={[
        'flex flex-col gap-[4px] text-[12px] leading-[18px]',
        failure ? 'text-warning' : 'text-text-muted',
      ].join(' ')}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex h-[28px] min-w-0 items-center gap-[7px] rounded-sm text-left hover:text-text-primary"
      >
        <Icon
          name={iconFor(kind)}
          size={14}
          className={[busy && !waiting ? motionFor(kind) : '', 'shrink-0 text-action-primary'].join(' ')}
        />
        <span
          key={summary}
          role={busy ? 'status' : undefined}
          aria-live={busy ? 'polite' : undefined}
          aria-atomic="true"
          className="da-label min-w-0 truncate"
        >
          {summary}
        </span>
        {busy && !waiting ? (
          <span className="shrink-0 font-mono tabular-nums text-text-muted">{elapsed}s</span>
        ) : null}
        {busy ? <FaviconStrip sources={researchSources} /> : null}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} className="shrink-0" />
      </button>
      <StepList id={id} open={open} steps={steps} onRetryStep={onRetryStep} />
    </div>
  )
}
