/**
 * Gallery for TableView — flex-row "table" view for card lists.
 *
 * TableView uses hooks (useSignedIn, useQuery, useMutation, useOnline)
 * via its RowCounters subcomponent. Renders inside an error boundary
 * with a note about requiring a live session for counter interactions.
 */
import { TableView } from './TableView'
import type { CardRow } from '../lib/api'
import type { GalleryMeta } from '../routes/design/galleryTypes'

const mockCards: CardRow[] = Array.from({ length: 5 }, (_, i) => ({
  cardId: `mock-table-${i}`,
  number: String(i + 1),
  numberSort: String(i + 1).padStart(3, '0'),
  name: ['Bulbasaur', 'Ivysaur', 'Venusaur', 'Charmander', 'Charmeleon'][i],
  category: 'Pokemon',
  rarity: i < 3 ? 'Common' : 'Uncommon',
  artist: 'Gallery Artist',
  variantCount: i % 2 === 0 ? 2 : 1,
  images: { low: '', high: '' },
  price: { market: 0.5 + i * 0.75, currency: 'USD' },
  ownership: i % 2 === 0
    ? { totalQuantity: 1, requiredCount: 1, ownedRequired: 1, have: true, need: false, dupe: false }
    : { totalQuantity: 0, requiredCount: 1, ownedRequired: 0, have: false, need: true, dupe: false },
}))

export default {
  name: 'TableView',
  source: 'apps/web/src/components/TableView.tsx',
  section: 'component',
  description: 'Flex-row "table" view for card lists with row counters. Counter interactions require a live session.',
  component: TableView,
  defaults: { cards: mockCards, seriesSlug: 'base', setId: 'base1' },
  variants: [
    { label: 'with cards', props: { cards: mockCards, seriesSlug: 'base', setId: 'base1' } },
    { label: 'single card', props: { cards: mockCards.slice(0, 1), seriesSlug: 'base', setId: 'base1' } },
    { label: 'empty', props: { cards: [], seriesSlug: 'base', setId: 'base1' } },
  ],
  knobs: {},
} satisfies GalleryMeta<{
  cards: CardRow[]
  seriesSlug: string
  setId: string
}>
