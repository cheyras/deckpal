/**
 * Gallery for intelShared.tsx — deck intelligence chips.
 */
import { VersionChip, SourceChip, ResultBadge, RecordSpans } from './intelShared'
import type { GalleryMeta } from '../design/galleryTypes'

export const versionChipGallery = {
  name: 'VersionChip',
  source: 'apps/web/src/routes/deck/intelShared.tsx',
  section: 'component',
  description: 'Labels a deck version number, with current-version highlight.',
  component: VersionChip,
  defaults: { version: 3, current: false },
  variants: [
    { label: 'v1', props: { version: 1 } },
    { label: 'v3 (current)', props: { version: 3, current: true } },
    { label: 'v7', props: { version: 7, current: false } },
  ],
  knobs: {
    version: { kind: 'number', min: 1, max: 99 },
    current: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{ version: number; current?: boolean }>

export const sourceChipGallery = {
  name: 'SourceChip',
  source: 'apps/web/src/routes/deck/intelShared.tsx',
  section: 'component',
  description: 'Labels a change as web vs. rotom-mcp-authored (sparkle glyph for agent).',
  component: SourceChip,
  defaults: { source: 'web' },
  variants: [
    { label: 'web', props: { source: 'web' } },
    { label: 'agent', props: { source: 'rotom-mcp' } },
  ],
  knobs: {
    source: { kind: 'select', options: ['web', 'rotom-mcp'] },
  },
} satisfies GalleryMeta<{ source: string }>

export const resultBadgeGallery = {
  name: 'ResultBadge',
  source: 'apps/web/src/routes/deck/intelShared.tsx',
  section: 'component',
  description: 'Win/loss/tie badge for battle log entries.',
  component: ResultBadge,
  defaults: { result: 'win' as const },
  variants: [
    { label: 'win', props: { result: 'win' as const } },
    { label: 'loss', props: { result: 'loss' as const } },
    { label: 'tie', props: { result: 'tie' as const } },
    { label: 'null', props: { result: null } },
  ],
  knobs: {
    result: { kind: 'select', options: ['win', 'loss', 'tie'] as const },
  },
} satisfies GalleryMeta<{ result: 'win' | 'loss' | 'tie' | null }>

export const recordSpansGallery = {
  name: 'RecordSpans',
  source: 'apps/web/src/routes/deck/intelShared.tsx',
  section: 'component',
  description: 'Win/loss/tie record summary inline text.',
  component: RecordSpans,
  defaults: { wins: 12, losses: 5, ties: 2 },
  variants: [
    { label: 'mixed', props: { wins: 12, losses: 5, ties: 2 } },
    { label: 'undefeated', props: { wins: 8, losses: 0, ties: 0 } },
    { label: 'no games', props: { wins: 0, losses: 0, ties: 0 } },
    { label: 'no ties', props: { wins: 15, losses: 3, ties: 0 } },
  ],
  knobs: {
    wins: { kind: 'number', min: 0, max: 999 },
    losses: { kind: 'number', min: 0, max: 999 },
    ties: { kind: 'number', min: 0, max: 999 },
  },
} satisfies GalleryMeta<{ wins: number; losses: number; ties: number }>

export default versionChipGallery
