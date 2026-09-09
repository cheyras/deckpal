// Ordering and filtering for the harvest view — pure, so the rules that decide
// what the reader sees can be tested without a network, a bucket or a DOM.
//
// ── WHY "SORT BY LABEL" IS NOT ONE COMPARATOR ──────────────────────────────
//
// A row's label is not a scalar. It is a verdict (positive / card back /
// negative), a reason code when it is negative, and — on rows captured with
// sweep mode on — how far the live pipeline got before something refused the
// frame. Those answer different questions: "show me my card backs" is a
// different job from "show me every near-miss I mined off the bookshelf".
//
// So the sort is a named key, the order within each key is DECLARED rather than
// alphabetical, and the filter is separate. Alphabetical would put `back`
// before `negative` before `positive`, which is three verdicts in the order of
// their spelling and no order at all in the sense the reader means.
import type { ScanFlag } from '../../lib/api'

export type HarvestSort = 'newest' | 'oldest' | 'verdict' | 'stage' | 'hasObj'

export const SORT_LABELS: Record<HarvestSort, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  verdict: 'Verdict',
  stage: 'Sweep stage',
  hasObj: 'Presence (low first)',
}

/**
 * Verdict order, most-informative-first for a corpus review: the negatives are
 * what the reader is usually hunting (they are the rows a detector gets wrong),
 * card backs next as the smallest and most easily miscounted class, positives
 * last because there are hundreds and they are the ones already going right.
 * `unknown` sinks: those are the other producers' rows sharing this prefix.
 */
const VERDICT_ORDER = ['negative', 'back', 'positive', 'unknown'] as const

/**
 * Sweep-stage order, HARDEST FIRST — `proposed` is a frame the model half
 * believed and the gate refused, which is the most valuable thing a room sweep
 * produces; `locked` is the pipeline working correctly and is the least
 * interesting row in a review. Rows with no sweep block sort last: they were
 * captured before the mode existed or with it off, and their absence of a stage
 * is not a stage.
 */
const STAGE_ORDER = ['proposed', 'gated', 'tracked', 'locked', 'none'] as const

function rank(order: readonly string[], v: string | null | undefined): number {
  if (!v) return order.length + 1
  const i = order.indexOf(v)
  return i === -1 ? order.length : i
}

/** Newest first — the id IS the capture time, so this is also id-descending. */
const byNewest = (a: ScanFlag, b: ScanFlag) => b.id - a.id

/**
 * Sort a copy. Every comparator falls back to `byNewest`, so equal keys stay in
 * a stable, meaningful order rather than whatever the listing happened to
 * return — a grid that reshuffles its ties on refresh is a grid the reader
 * cannot keep their place in.
 */
export function sortFlags(flags: ScanFlag[], sort: HarvestSort): ScanFlag[] {
  const out = [...flags]
  switch (sort) {
    case 'newest':
      return out.sort(byNewest)
    case 'oldest':
      return out.sort((a, b) => a.id - b.id)
    case 'verdict':
      return out.sort(
        (a, b) =>
          rank(VERDICT_ORDER, a.label?.verdict) - rank(VERDICT_ORDER, b.label?.verdict) ||
          // Within the negatives, group by reason so the reason chips read as
          // blocks rather than a shuffle.
          (a.label?.reason ?? '').localeCompare(b.label?.reason ?? '') ||
          byNewest(a, b),
      )
    case 'stage':
      return out.sort(
        (a, b) => rank(STAGE_ORDER, a.label?.sweepStage) - rank(STAGE_ORDER, b.label?.sweepStage) || byNewest(a, b),
      )
    case 'hasObj':
      // LOW FIRST, and that is the point: a low presence head on a row you
      // labelled as a real card is a detector miss, which is the one thing this
      // corpus exists to find. Rows with no reading sort last — see `rank`.
      return out.sort((a, b) => {
        const av = a.label?.hasObj
        const bv = b.label?.hasObj
        if (av == null && bv == null) return byNewest(a, b)
        if (av == null) return 1
        if (bv == null) return -1
        return av - bv || byNewest(a, b)
      })
  }
}

/** The verdict values present in a set of rows, in the display order above —
 *  so the filter bar offers what the corpus actually contains and never a chip
 *  that matches nothing. */
export function verdictsPresent(flags: ScanFlag[]): string[] {
  const seen = new Set<string>()
  for (const f of flags) if (f.label?.verdict) seen.add(f.label.verdict)
  return [...seen].sort((a, b) => rank(VERDICT_ORDER, a) - rank(VERDICT_ORDER, b))
}

/** Keep only the chosen verdicts. An EMPTY selection means "everything", not
 *  "nothing": a filter bar that empties the grid when the reader deselects the
 *  last chip reads as a bug, and there is no other way back. */
export function filterFlags(flags: ScanFlag[], verdicts: Set<string>): ScanFlag[] {
  if (!verdicts.size) return flags
  return flags.filter((f) => verdicts.has(f.label?.verdict ?? 'unknown'))
}

/** Counts per verdict for the header, including rows whose sidecar could not be
 *  read (they count as `unknown`, because a row that exists and cannot be
 *  described is exactly the thing a total should not quietly omit). */
export function verdictCounts(flags: ScanFlag[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of flags) {
    const v = f.label?.verdict ?? 'unknown'
    out[v] = (out[v] ?? 0) + 1
  }
  return out
}
