// Presentational pieces of the Battles tab's v2 detail: the most-faced summary
// and the digest (prize race + turning points). Props in, markup out — no
// queries and only type imports from lib/api, so they render under node:test
// through react-dom/server. Typographic on purpose: plain lists and muted text,
// no boxes, pills or chart furniture.

import type { BattleDigest, BattleResult } from '../../lib/api'
import { RecordSpans } from './intelShared'
import { turningPoints, type MostFaced } from './battleLogView'

// The house's small section heading inside a tab or a row. These are real
// headings at text size — group labels — so `.font-text` opts them out of the
// display serif every h1–h3 gets (theme.css explains why a utility cannot).
export const SECTION_HEADING = 'font-text text-[14px] font-semibold text-text-secondary'

/** `T7` on screen; "Turn 7" to a screen reader and on hover. */
function TurnLabel({ turn }: { turn: number }) {
  return (
    <>
      <span aria-hidden="true" title={`Turn ${turn}`}>
        T{turn}
      </span>
      <span className="sr-only">Turn {turn}</span>
    </>
  )
}

// ── Most faced ────────────────────────────────────────────────────────────────

export function MostFacedSummary({
  summary,
  version,
  partial,
}: {
  summary: MostFaced
  /** The version filter in force, for the heading. */
  version: number | null
  /** The tally came from one page of several, so it is not the version's whole record. */
  partial: boolean
}) {
  if (!summary.rows.length) return null
  const scopeNote = version != null ? `on v${version}${partial ? ', this page' : ''}` : partial ? 'this page' : null
  return (
    <section aria-labelledby="battles-most-faced">
      <h2 id="battles-most-faced" className={SECTION_HEADING}>
        Most faced
        {scopeNote && <span className="font-normal text-text-muted"> · {scopeNote}</span>}
      </h2>
      <ol className="mt-[6px] flex max-w-[440px] flex-col gap-[3px] text-[14px] leading-[20px]">
        {summary.rows.map((a) => (
          <li key={a.key} className="flex min-w-0 items-baseline gap-[12px]">
            <span className="min-w-0 flex-1 truncate text-text-primary" title={a.label}>
              {a.label}
            </span>
            <span className="shrink-0 tabular-nums text-text-muted">
              {a.games} game{a.games === 1 ? '' : 's'}
            </span>
            <span className="w-[72px] shrink-0 text-right font-semibold tabular-nums">
              <RecordSpans wins={a.wins} losses={a.losses} ties={a.ties} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

// ── Digest ────────────────────────────────────────────────────────────────────

/**
 * The prize race as one wrapped line of running scores (yours–theirs), each at
 * the turn it happened, the side that just scored set in bold. Then the turning
 * points as sentences. Renders nothing when the timeline is empty — an owner
 * the log could not identify leaves nothing honest to draw.
 */
export function DigestView({ digest, result, idBase }: { digest: BattleDigest; result: BattleResult | null; idBase: string }) {
  const events = digest.prizeTimeline
  if (!events.length) return null
  const points = turningPoints(digest, result)
  const notes = [
    digest.wentFirst ? `You went ${digest.wentFirst === 'me' ? 'first' : 'second'}` : null,
    digest.closeGame ? 'Close game' : null,
  ].filter(Boolean)
  return (
    <div className="flex flex-col gap-[12px]">
      <section aria-labelledby={`${idBase}-race`}>
        <h3 id={`${idBase}-race`} className={SECTION_HEADING}>
          Prize race <span className="font-normal text-text-muted">· yours–theirs</span>
        </h3>
        <ol className="mt-[6px] flex flex-wrap gap-x-[14px] gap-y-[4px] text-[14px] leading-[20px] tabular-nums">
          {events.map((e, i) => (
            <li
              key={i}
              className="whitespace-nowrap"
              title={e.knockedOut ? `${e.side === 'me' ? 'You' : 'They'} knocked out ${e.side === 'me' ? 'their' : 'your'} ${e.knockedOut}` : undefined}
            >
              <span className="text-text-muted">
                <TurnLabel turn={e.turn} />
              </span>{' '}
              <span className={e.side === 'me' ? 'font-bold text-text-primary' : 'text-text-secondary'}>{e.score.me}</span>
              <span className="text-text-muted">–</span>
              <span className={e.side === 'opponent' ? 'font-bold text-text-primary' : 'text-text-secondary'}>{e.score.opponent}</span>
            </li>
          ))}
        </ol>
        {notes.length > 0 && <p className="mt-[4px] text-[12px] text-text-muted">{notes.join(' · ')}</p>}
      </section>
      {points.length > 0 && (
        <section aria-labelledby={`${idBase}-turns`}>
          <h3 id={`${idBase}-turns`} className={SECTION_HEADING}>
            Turning points
          </h3>
          <ul className="mt-[6px] flex flex-col gap-[3px] text-[14px] leading-[20px]">
            {points.map((p, i) => (
              <li key={i} className="flex min-w-0 gap-[10px]">
                <span className="w-[30px] shrink-0 tabular-nums text-text-muted">
                  <TurnLabel turn={p.turn} />
                </span>
                <span className="min-w-0 text-text-body [overflow-wrap:anywhere]">{p.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
