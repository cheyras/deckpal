import { useState, type JSX } from 'react'
import { Icon } from '../../../components/Icon'
import { faviconUrl, isHttpsSource, type Source } from './sourcesState'

function SourceIcon({ host }: { host: string }): JSX.Element {
  const [failed, setFailed] = useState(false)
  const url = faviconUrl(host)

  if (!url || failed) {
    return (
      <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] bg-surface-tertiary text-[9px] font-semibold text-text-muted">
        {host.trim().charAt(0).toUpperCase() || '?'}
      </span>
    )
  }

  return (
    <img
      src={url}
      alt=""
      className="h-[16px] w-[16px] shrink-0 rounded-[4px]"
      onError={() => setFailed(true)}
    />
  )
}

function SourceRow({ source }: { source: Source }): JSX.Element {
  const label = source.title || source.host

  return (
    <li className="flex min-w-0 items-center gap-[6px]">
      <SourceIcon host={source.host} />
      {isHttpsSource(source) ? (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 truncate text-action-primary hover:underline"
        >
          {label}
        </a>
      ) : (
        <span className="min-w-0 truncate text-text-muted">{label}</span>
      )}
      <span className="shrink-0 text-text-muted">{source.host}</span>
    </li>
  )
}

export function SourcesList({ sources }: { sources: readonly Source[] }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!sources.length) return null

  return (
    <section className="mt-[8px] text-[12px] leading-[18px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-[4px] text-text-muted hover:text-text-primary"
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        Sources ({sources.length})
      </button>
      {open ? (
        <ul className="mt-[4px] flex flex-col gap-[4px]">
          {sources.map((source) => (
            <SourceRow key={source.url} source={source} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}
