import { StatTile, type StatTileProps } from './StatTile'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

export default {
  name: 'StatTile',
  source: 'apps/web/src/components/ui/StatTile.tsx',
  section: 'primitive',
  description:
    'Stat display — bare (label + value), boxed (compact tile), or card (dashboard panel with children).',
  component: StatTile,
  defaults: { variant: 'bare', label: 'Release Date', value: 'Aug 8, 2025' },
  variants: [
    {
      label: 'bare',
      props: { variant: 'bare', label: 'Release Date', value: 'Aug 8, 2025' },
    },
    {
      label: 'bare / money',
      props: { variant: 'bare', label: 'Full Set Market Value', value: '$2,450.00', money: true },
    },
    {
      label: 'boxed',
      props: { variant: 'boxed', label: 'Total Cards', value: '847' },
    },
    {
      label: 'card',
      props: { variant: 'card', label: 'Collection Value', value: '$4,200' },
    },
    {
      label: 'card / with children',
      props: {
        variant: 'card',
        label: 'Top Movers',
        children: (
          <div className="mt-[6px] text-[14px] text-text-body">
            Custom content goes here — charts, tables, anything.
          </div>
        ),
      },
    },
  ],
  knobs: {
    variant: { kind: 'select', options: ['bare', 'boxed', 'card'] as const },
    label: { kind: 'text' },
    money: { kind: 'boolean' },
  },
} satisfies GalleryMeta<StatTileProps>
