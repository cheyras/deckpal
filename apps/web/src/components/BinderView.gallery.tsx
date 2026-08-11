/**
 * Gallery for BinderView — pocketed-binder card display.
 */
import { BinderView } from './BinderView'
import type { CardRow } from '../lib/api'
import type { GalleryMeta } from '../routes/design/galleryTypes'

// Mock CardRow data — minimal fields BinderView actually reads
const mockCards: CardRow[] = Array.from({ length: 18 }, (_, i) => ({
  cardId: `mock-${i}`,
  number: String(i + 1),
  numberSort: String(i + 1).padStart(3, '0'),
  name: `Card ${i + 1}`,
  category: 'Pokemon',
  rarity: i % 3 === 0 ? 'Rare' : 'Common',
  artist: 'Gallery Artist',
  variantCount: i % 4 === 0 ? 3 : 1,
  images: { low: '', high: '' },
  price: i % 2 === 0 ? { market: 1.5 + i * 0.5, currency: 'USD' } : null,
  ownership: i % 3 !== 2
    ? { totalQuantity: 1, requiredCount: 1, ownedRequired: 1, have: true, need: false, dupe: false }
    : { totalQuantity: 0, requiredCount: 1, ownedRequired: 0, have: false, need: true, dupe: false },
}))

export default {
  name: 'BinderView',
  source: 'apps/web/src/components/BinderView.tsx',
  section: 'component',
  description: 'Pocketed-binder card view with 4/9/12/16-pocket layouts and owned/dim treatment.',
  component: BinderView,
  defaults: { cards: mockCards, mode: 'set' as const, alwaysBright: false },
  variants: [
    { label: 'set mode', props: { cards: mockCards, mode: 'set' as const, alwaysBright: false } },
    { label: 'list (bright)', props: { cards: mockCards.slice(0, 9), mode: 'list' as const, alwaysBright: true } },
    { label: 'empty', props: { cards: [], mode: 'set' as const, alwaysBright: false } },
  ],
  knobs: {
    mode: { kind: 'select', options: ['set', 'list'] as const },
    alwaysBright: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{
  cards: CardRow[]
  mode?: 'set' | 'list'
  alwaysBright?: boolean
}>
