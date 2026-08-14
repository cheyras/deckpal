/**
 * Pending extraction list — every audit-§4 gap not yet closed and every
 * known off-theme color. Entries are deleted as Phase 2 lands them.
 * The design-system page renders a completeness meter from this.
 */

export interface PendingItem {
  /** Backlog ID from the plan (C1-C13) or descriptive ID for off-theme values */
  id: string
  /** Human-readable label */
  label: string
  /** What it is: extraction or off-theme value */
  kind: 'extraction' | 'off-theme' | 'adoption'
  /** More detail about what needs to happen */
  description: string
  /** Which audit section documents this */
  auditRef: string
}

export const PENDING_ITEMS: PendingItem[] = [
  // ── Off-theme values (audit §1.5) ──────────────────────────────────
  // C1–C13 all landed (commits fdb2334…f19079f); their entries were deleted
  // as the plan prescribes, along with the off-theme colours C9/C11 promoted
  // into theme.css (--color-warning, --color-energy-*, sort-glyph tokens).
  {
    id: 'off-theme-spacing',
    label: 'No spacing token scale',
    kind: 'off-theme',
    description:
      '2,441 arbitrary-pixel spacing utilities, zero spacing tokens. Out of scope (see plan §8.2) — requires designing a scale + ~2,400-call-site migration.',
    auditRef: '§1.4',
  },
]

/** Componentization backlog progress (C1–C13 from the plan §4). */
export function completionStats(): { done: number; total: number; pct: number } {
  // The backlog was a fixed list of 13 items; entries are deleted from
  // PENDING_ITEMS as they land, so "remaining" is what is still listed here.
  const BACKLOG_TOTAL = 13
  const remaining = PENDING_ITEMS.filter((i) => i.kind !== 'off-theme').length
  const done = BACKLOG_TOTAL - remaining
  return { done, total: BACKLOG_TOTAL, pct: Math.round((done / BACKLOG_TOTAL) * 100) }
}
