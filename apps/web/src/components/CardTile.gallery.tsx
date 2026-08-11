/**
 * Gallery for CardTile — the signature grid tile.
 *
 * CardTile uses hooks (useSignedIn, useMutation, useQuery, useOnline)
 * that require a live session. It renders inside an error boundary
 * with a note. CardImage (its presentational core) has its own gallery.
 */
import { CardTile } from './CardTile'
import type { CardRow } from '../lib/api'
import type { GalleryMeta } from '../routes/design/galleryTypes'

const mockCard: CardRow = {
  cardId: 'swsh1-1',
  number: '1',
  numberSort: '001',
  name: 'Celebi V',
  category: 'Pokemon',
  rarity: 'Rare Holo V',
  artist: 'PLANETA Mochizuki',
  variantCount: 3,
  images: { low: '', high: '' },
  price: { market: 4.25, currency: 'USD' },
  ownership: { totalQuantity: 2, requiredCount: 1, ownedRequired: 1, have: true, need: false, dupe: true },
  standardVariants: [
    { variantId: 1, kind: 'normal', displayName: 'Normal', tier: 'standard', quantity: 2 },
    { variantId: 2, kind: 'reverseHolofoil', displayName: 'Reverse Holo', tier: 'standard', quantity: 0 },
    { variantId: 3, kind: 'holofoil', displayName: 'Holofoil', tier: 'standard', quantity: 1 },
  ],
}

export default {
  name: 'CardTile',
  source: 'apps/web/src/components/CardTile.tsx',
  section: 'component',
  description: 'Signature grid tile: art, owned-quantity badge, variant-count badge, per-variant counters. Requires live session for counter interactions.',
  component: CardTile,
  defaults: { card: mockCard, seriesSlug: 'swsh', setId: 'swsh1' },
  variants: [
    { label: 'owned', props: { card: mockCard, seriesSlug: 'swsh', setId: 'swsh1' } },
    {
      label: 'unowned',
      props: {
        card: {
          ...mockCard,
          ownership: { totalQuantity: 0, requiredCount: 1, ownedRequired: 0, have: false, need: true, dupe: false },
        },
        seriesSlug: 'swsh',
        setId: 'swsh1',
      },
    },
    {
      label: 'no price',
      props: {
        card: { ...mockCard, price: null },
        seriesSlug: 'swsh',
        setId: 'swsh1',
      },
    },
  ],
  knobs: {
    eager: { kind: 'boolean' },
    ownership: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{
  card: CardRow
  seriesSlug: string
  setId: string
  eager?: boolean
  onRemove?: () => void
  badge?: string
  ownership?: boolean
}>
