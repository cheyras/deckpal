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
  // ── Component extractions (audit §4) ─────────────────────────────────
  {
    id: 'C3',
    label: 'CounterBox dedupe',
    kind: 'extraction',
    description:
      'Byte-identical component in CardTile.tsx and TableView.tsx. Fix #15181f/#fff hex drift.',
    auditRef: '§4.3, §1.5',
  },
  {
    id: 'C4',
    label: 'ProgressBar + ProgressRing',
    kind: 'extraction',
    description:
      'Track/fill/milestone-dots API. Promote --color-track-subtle: #1a1d24 into theme.css. 6 independent implementations.',
    auditRef: '§4.4, §1.5',
  },
  {
    id: 'C5',
    label: 'EmptyState',
    kind: 'extraction',
    description:
      'Icon + title + body + optional CTA. The documented-but-unbuilt EmptyStateMessage from BEHAVIOR-SPEC.',
    auditRef: '§4.7',
  },
  {
    id: 'C6',
    label: 'Tabs',
    kind: 'extraction',
    description:
      'One component, variant underline|pill. Collapses 4 hand-rolled tab idioms across Profile, CardDetail, DeckBuilder, Insights.',
    auditRef: '§4.8',
  },
  {
    id: 'C7',
    label: 'SelectableCard',
    kind: 'extraction',
    description:
      'Identical-className active/inactive option card in DecksIndex and ListModals.',
    auditRef: '§4.6',
  },
  {
    id: 'C8',
    label: 'StatTile',
    kind: 'extraction',
    description:
      'Three different stat displays (two named Stat) across SetHeader, Profile, Insights.',
    auditRef: '§4.10',
  },
  {
    id: 'C9',
    label: 'FilterControls adoption',
    kind: 'adoption',
    description:
      'Make ListDetail and SearchResults import OwnershipStrip/SortChips instead of reimplementing.',
    auditRef: '§4.5, §1.5',
  },
  {
    id: 'C10',
    label: 'useDismiss hook',
    kind: 'extraction',
    description:
      'Outside-click + Escape dismiss boilerplate duplicated in PokedexIndex and SeriesIndex.',
    auditRef: '§4.9',
  },
  {
    id: 'C11',
    label: 'Token wiring fixes',
    kind: 'adoption',
    description:
      'Convert z-[N] to z-(--z-*), promote --color-warning: #ff9d42, promote 11 energy colors, fix Profile banner gradient hex drift.',
    auditRef: '§1.5, §1.1',
  },
  {
    id: 'C12',
    label: 'RecordSpans import fix',
    kind: 'adoption',
    description:
      'Delete DecksIndex.DeckCard inline copy, import from deck/intelShared.',
    auditRef: '§4.11',
  },
  {
    id: 'C13',
    label: 'authUi relocation',
    kind: 'adoption',
    description:
      'Move Field, FormAlert, StatusPanel to components/ui/ (they are primitives). Re-export from authUi.',
    auditRef: '§2.4',
  },

  // ── Off-theme values (audit §1.5) ──────────────────────────────────
  {
    id: 'off-theme-track',
    label: '#1a1d24 progress-bar track',
    kind: 'off-theme',
    description:
      'Untokenized track color, 7 occurrences across 6 files. Should become --color-track-subtle. Addressed by C4.',
    auditRef: '§1.5',
  },
  {
    id: 'off-theme-warning',
    label: '#ff9d42 warning orange',
    kind: 'off-theme',
    description:
      '9 occurrences in DeckBuilder. No --color-warning token exists. Addressed by C11.',
    auditRef: '§1.5',
  },
  {
    id: 'off-theme-energy',
    label: 'Energy-type color palette (11 colors)',
    kind: 'off-theme',
    description:
      'Hardcoded in EnergyIcon.tsx TYPES record, not in theme.css. Addressed by C11.',
    auditRef: '§1.5',
  },
  {
    id: 'off-theme-sort',
    label: '#d3b745 sort-glyph accent',
    kind: 'off-theme',
    description:
      'Accidental color in FilterControls/SearchResults sort arrows. Does not match any token. Addressed by C9.',
    auditRef: '§1.5',
  },
  {
    id: 'off-theme-spacing',
    label: 'No spacing token scale',
    kind: 'off-theme',
    description:
      '2,441 arbitrary-pixel spacing utilities, zero spacing tokens. Out of scope (see plan §8.2) — requires designing a scale + ~2,400-call-site migration.',
    auditRef: '§1.4',
  },
]

/** How many of the extraction/adoption items are done (always 0 in Phase 1) */
export function completionStats(): { done: number; total: number; pct: number } {
  const actionable = PENDING_ITEMS.filter((i) => i.kind !== 'off-theme')
  const done = 2 // C1 (Button), C2 (Spinner) landed
  return { done, total: actionable.length, pct: Math.round((done / actionable.length) * 100) }
}
