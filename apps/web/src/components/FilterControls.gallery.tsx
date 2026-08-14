/**
 * Gallery for FilterControls — filter-bar building blocks.
 */
import { OwnershipStrip, SearchBox, SortChips, VariantLegend, ViewToggle } from './FilterControls'
import type { CardSearch } from '../routes/setSearch'
import type { GalleryMeta } from '../routes/design/galleryTypes'

const mockSearch: CardSearch = {
  sort: 'number',
  dir: 'asc',
  view: 'grid',
  goal: 'complete',
  own: 'all',
  q: '',
  page: 1,
}

const noop = () => {}

export const ownershipStripGallery = {
  name: 'OwnershipStrip',
  source: 'apps/web/src/components/FilterControls.tsx',
  section: 'component',
  description: 'Show All / Have / Need / Dupes filter strip with goal-star switcher.',
  component: OwnershipStrip,
  defaults: {
    search: mockSearch,
    patch: noop,
    counts: { have: 142, need: 58, dupes: 12 },
  },
  variants: [
    {
      label: 'default (all)',
      props: {
        search: mockSearch,
        patch: noop,
        counts: { have: 142, need: 58, dupes: 12 },
      },
    },
    {
      label: 'have selected',
      props: {
        search: { ...mockSearch, own: 'have' as const },
        patch: noop,
        counts: { have: 142, need: 58, dupes: 12 },
      },
    },
    {
      label: 'no owned',
      props: {
        search: mockSearch,
        patch: noop,
        counts: { have: 0, need: 200, dupes: 0 },
      },
    },
  ],
  knobs: {},
} satisfies GalleryMeta<{
  search: CardSearch
  patch: (p: Partial<CardSearch>) => void
  counts: { have: number; need: number; dupes: number }
}>

export const searchBoxGallery = {
  name: 'SearchBox',
  source: 'apps/web/src/components/FilterControls.tsx',
  section: 'component',
  description: 'Search input field for filtering cards.',
  component: SearchBox,
  defaults: { value: '', onChange: noop },
  variants: [
    { label: 'empty', props: { value: '', onChange: noop } },
    { label: 'with query', props: { value: 'Charizard', onChange: noop } },
  ],
  knobs: {
    value: { kind: 'text' },
  },
} satisfies GalleryMeta<{ value: string; onChange: (v: string) => void }>

export const sortChipsGallery = {
  name: 'SortChips',
  source: 'apps/web/src/components/FilterControls.tsx',
  section: 'component',
  description: 'Sort-by chips (Number, Name, Rarity, Price, Artist) with asc/desc indicators.',
  component: SortChips,
  defaults: { search: mockSearch, patch: noop },
  variants: [
    { label: 'number asc', props: { search: mockSearch, patch: noop } },
    {
      label: 'price desc',
      props: { search: { ...mockSearch, sort: 'price' as const, dir: 'desc' as const }, patch: noop },
    },
    {
      label: 'name asc',
      props: { search: { ...mockSearch, sort: 'name' as const }, patch: noop },
    },
  ],
  knobs: {},
} satisfies GalleryMeta<{ search: CardSearch; patch: (p: Partial<CardSearch>) => void }>

export const variantLegendGallery = {
  name: 'VariantLegend',
  source: 'apps/web/src/components/FilterControls.tsx',
  section: 'component',
  description: 'Color legend for variant types (Normal, Reverse Holo, Holofoil, Other).',
  component: VariantLegend,
  defaults: {},
  variants: [{ label: 'default', props: {} }],
  knobs: {},
} satisfies GalleryMeta<Record<string, never>>

export const viewToggleGallery = {
  name: 'ViewToggle',
  source: 'apps/web/src/components/FilterControls.tsx',
  section: 'component',
  description: 'Grid/Table/Binder view mode toggle.',
  component: ViewToggle,
  defaults: { view: 'grid' as const, patch: noop },
  variants: [
    { label: 'grid', props: { view: 'grid' as const, patch: noop } },
    { label: 'table', props: { view: 'table' as const, patch: noop } },
    { label: 'binder', props: { view: 'binder' as const, patch: noop } },
  ],
  knobs: {
    view: { kind: 'select', options: ['grid', 'table', 'binder'] as const },
  },
} satisfies GalleryMeta<{ view: 'grid' | 'table' | 'binder'; patch: (p: Partial<CardSearch>) => void }>

export default ownershipStripGallery
