/**
 * Pending extraction list — every audit-§4 gap not yet closed and every
 * known off-theme color. Entries are deleted as Phase 2 lands them.
 * The design-system page renders a completeness meter from this.
 */

interface PendingItem {
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
  /** How to finish it, in order — rendered as a numbered list. */
  steps?: string[]
}

export const PENDING_ITEMS: PendingItem[] = [
  // ── Off-theme values (audit §1.5) ──────────────────────────────────
  // C1–C13 all landed (commits fdb2334…f19079f); their entries were deleted
  // as the plan prescribes, along with the off-theme colours C9/C11 promoted
  // into theme.css (--color-warning, --color-energy-*, sort-glyph tokens).
  {
    // The scale itself landed on 2026-11-27 (theme.css "spacing", Tokens →
    // Foundations). What is left is the call sites, and this entry stays until
    // the audit script reports zero.
    id: 'off-theme-spacing',
    label: 'Spacing call sites still off the token scale',
    kind: 'off-theme',
    description:
      'The scale exists: a 4px grid (--spacing: 4px) whose sanctioned steps are listed under Tokens → Foundations, plus the roles px-gutter, size-hit and top-corner. The shared primitives in components/ui, the app shell and this page are on it. As of 2026-11-27, 2,254 bracketed pixel spacing utilities remain elsewhere: 1,964 are on the scale and rewrite mechanically (px-[16px] → px-4, the same pixels), and 290 are off it (3px ×58, 7px ×57, 5px ×53, 18px ×35, 9px ×20, …) and each needs a person to choose the step it was meant to be. Recount with: node apps/web/scripts/spacing-audit.mjs --files',
    auditRef: '§1.4',
    steps: [
      'One file per change, by whoever owns the file, never a repo-wide codemod: the rewrite touches thousands of lines other work is editing.',
      'Rewrite the on-scale values first. It is pixel-identical, so a typecheck and a glance at the page is the whole review.',
      'Then the off-scale values, with the page open at 390px and 1440px: snap each to the nearest step that reads right, and look at it. A 3px that was an optical nudge may want 2px (0.5) or 4px (1); an 18px usually wants 16 or 20.',
      'Leave alignment values that are derived from something else (a 62px indent that lines sub-items up under a 24px icon, a 46px inset that clears an input’s icon) as brackets with a comment saying what they align to.',
      'Largest first: DeckBuilder.tsx, CardDetail.tsx, deck/BattlesTab.tsx, DecksIndex.tsx, AgentAccess.tsx, DeckeScreen.tsx and the Deck-E chat files carry a third of what remains.',
    ],
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
