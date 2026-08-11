import { Tabs, type TabsProps } from './Tabs'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

const NAV_ITEMS = [
  { key: 'profile', label: 'Profile' },
  { key: 'collection', label: 'Collection', to: '/series' },
  { key: 'insights', label: 'Insights', to: '/insights' },
  { key: 'lists', label: 'Lists', to: '/lists' },
] as const

const SECTION_ITEMS = [
  { key: 'card', label: 'Card' },
  { key: 'price', label: 'Price' },
  { key: 'tcg', label: 'TCG' },
] as const

const TOGGLE_ITEMS = [
  { key: 'overview', label: 'Overview' },
  { key: 'trends', label: 'Trends' },
] as const

const CURRENCY_ITEMS = [
  { key: 'USD', label: 'USD' },
  { key: 'EUR', label: 'EUR' },
] as const

export default {
  name: 'Tabs',
  source: 'apps/web/src/components/ui/Tabs.tsx',
  section: 'primitive',
  description:
    'Shared tab strip — underline for page sections, pill for mode toggles (md primary, sm muted).',
  component: Tabs,
  defaults: {
    variant: 'underline',
    items: SECTION_ITEMS as unknown as TabsProps['items'],
    value: 'card',
  },
  variants: [
    {
      label: 'underline / section',
      props: {
        variant: 'underline',
        items: SECTION_ITEMS as unknown as TabsProps['items'],
        value: 'card',
      },
    },
    {
      label: 'underline / nav (with links)',
      props: {
        variant: 'underline',
        items: NAV_ITEMS as unknown as TabsProps['items'],
        value: 'profile',
      },
    },
    {
      label: 'pill / md',
      props: {
        variant: 'pill',
        items: TOGGLE_ITEMS as unknown as TabsProps['items'],
        value: 'overview',
      },
    },
    {
      label: 'pill / sm (muted)',
      props: {
        variant: 'pill',
        size: 'sm' as const,
        items: CURRENCY_ITEMS as unknown as TabsProps['items'],
        value: 'USD',
      },
    },
  ],
  knobs: {
    variant: { kind: 'select', options: ['underline', 'pill'] as const },
    size: { kind: 'select', options: ['sm', 'md'] as const },
    value: { kind: 'text' },
  },
} satisfies GalleryMeta<TabsProps>
