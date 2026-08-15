// Small shared chips for the Deck Intelligence tabs (Strategy / Battles / History).
// House recipe: pill chips on surface-tertiary; result colours from the status tokens.

import type { BattleResult } from '../../lib/api'
import { Icon } from '../../components/Icon'

export function VersionChip({ version, current = false }: { version: number; current?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-[9px] py-[2px] text-[12px] font-bold ${
        current ? 'bg-action-primary text-action-primary-text' : 'bg-surface-tertiary text-text-secondary'
      }`}
    >
      v{version}
    </span>
  )
}

// Attribution chip. 'web' (the default writer) renders nothing; 'deckpal-mcp' is
// surfaced as "agent" with a sparkle, anything else shows its raw source name.
export function SourceChip({ source }: { source: string }) {
  if (source === 'web') return null
  const agent = source === 'deckpal-mcp'
  return (
    <span className="inline-flex shrink-0 items-center gap-[4px] rounded-full bg-surface-tertiary px-[8px] py-[2px] text-[12px] font-bold uppercase tracking-wide text-text-muted">
      {agent && <Icon name="sparkle" size={11} className="text-action-primary" />}
      {agent ? 'agent' : source}
    </span>
  )
}

const RESULT_STYLE: Record<BattleResult, { label: string; bg: string; color: string }> = {
  win: { label: 'WIN', bg: 'rgba(50,255,206,0.16)', color: 'var(--color-success)' },
  loss: { label: 'LOSS', bg: 'rgba(255,120,147,0.16)', color: 'var(--color-error)' },
  tie: { label: 'TIE', bg: 'rgba(255,225,101,0.14)', color: 'var(--color-action-primary)' },
}

export function ResultBadge({ result }: { result: BattleResult | null }) {
  if (!result) {
    return (
      <span className="inline-flex w-[52px] shrink-0 items-center justify-center rounded-md bg-surface-tertiary py-[3px] text-[14px] font-bold text-text-muted">
        —
      </span>
    )
  }
  const s = RESULT_STYLE[result]
  return (
    <span
      className="inline-flex w-[52px] shrink-0 items-center justify-center rounded-md py-[3px] text-[14px] font-bold"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  )
}

// "3W–1L(–1T)" with wins/losses in the status colours. Sized by the parent.
export function RecordSpans({ wins, losses, ties }: { wins: number; losses: number; ties: number }) {
  return (
    <>
      <span style={{ color: 'var(--color-success)' }}>{wins}W</span>
      <span className="text-text-muted">–</span>
      <span style={{ color: 'var(--color-error)' }}>{losses}L</span>
      {ties > 0 && (
        <>
          <span className="text-text-muted">–</span>
          <span className="text-text-secondary">{ties}T</span>
        </>
      )}
    </>
  )
}
