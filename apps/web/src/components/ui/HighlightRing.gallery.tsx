import { HighlightRing, type HighlightRingProps } from './HighlightRing'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

export default {
  name: 'HighlightRing',
  source: 'apps/web/src/components/ui/HighlightRing.tsx',
  section: 'primitive',
  description:
    'Marks the one element currently being talked about — by the assistant, a tour, or a background job. A chasing cyan/rose/amber edge, deliberately unlike every static border treatment in the system. Only one element is ringed at a time, application-wide, so turning one on releases the other.',
  component: HighlightRing,
  defaults: {
    active: true,
    children: (
      <div className="rounded-lg border border-border-default bg-surface-tertiary px-[16px] py-[12px] text-[13px]">
        Charizard · Base Set · #4
      </div>
    ),
  },
  knobs: {
    active: { kind: 'boolean' },
    durationMs: { kind: 'number', min: 0, max: 10000, step: 500 },
    radius: { kind: 'number', min: 0, max: 32, step: 2 },
  },
  variants: [
    {
      label: 'active',
      props: {
        active: true,
        children: (
          <div className="rounded-lg border border-border-default bg-surface-tertiary px-[16px] py-[12px] text-[13px]">
            Charizard · Base Set · #4
          </div>
        ),
      },
    },
    {
      label: 'inactive',
      props: {
        active: false,
        children: (
          <div className="rounded-lg border border-border-default bg-surface-tertiary px-[16px] py-[12px] text-[13px]">
            Blastoise · Base Set · #2
          </div>
        ),
      },
    },
  ],
} satisfies GalleryMeta<HighlightRingProps>
