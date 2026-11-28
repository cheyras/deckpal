/**
 * Gallery for SetSymbolTile (moved out of ui.gallery.tsx with the component).
 * The printed mark itself, and how it compares with real cards, is in
 * PrintedSetMark.gallery.tsx.
 */
import { SetSymbolTile } from './SetSymbolTile'
import type { GalleryMeta } from '../routes/design/galleryTypes'

type Props = { setId?: string | null; name?: string | null; size?: number; regulationMark?: string | null }

const setSymbolTileGallery = {
  name: 'SetSymbolTile',
  source: 'apps/web/src/components/SetSymbolTile.tsx',
  section: 'primitive',
  description:
    'White tile showing a set symbol — or, for sets that print a code (SV era on, energy, MEP and McDonald’s sets included), the code drawn the way the card prints it: plate, white keyline, condensed capitals, EN. On a card’s own sheet it adds that card’s regulation box. Fallback ladders: promo star, derived acronym.',
  component: SetSymbolTile,
  defaults: { setId: 'me01', name: 'Mega Evolution', size: 40, regulationMark: null },
  variants: [
    { label: 'Scarlet & Violet (sv01 · SVI)', props: { setId: 'sv01', name: 'Scarlet & Violet', size: 40 } },
    { label: 'Mega Evolution (me01 · MEG)', props: { setId: 'me01', name: 'Mega Evolution', size: 40 } },
    { label: 'wide code (sv06 · TWM)', props: { setId: 'sv06', name: 'Twilight Masquerade', size: 40 } },
    { label: 'energy set (mee · MEE)', props: { setId: 'mee', name: 'Mega Evolution Energy', size: 40 } },
    { label: 'promo that prints a code (mep · MEP)', props: { setId: 'mep', name: 'MEP Black Star Promos', size: 40 } },
    { label: 'Black Star promo (svp keeps its star)', props: { setId: 'svp', name: 'SVP Black Star Promos', size: 40 } },
    { label: 'read off the cards (2024sv · M24)', props: { setId: '2024sv', name: "McDonald's Collection 2024", size: 40 } },
    { label: 'read off the cards (30th · 30C)', props: { setId: '30th', name: '30th Celebration', size: 40 } },
    { label: 'card sheet, 28 + its regulation mark (sv07 · H)', props: { setId: 'sv07', name: 'Stellar Crown', size: 28, regulationMark: 'H' } },
    { label: 'card sheet, 28 (no regulation mark known)', props: { setId: 'sve', name: 'Scarlet & Violet Energy', size: 28 } },
    { label: 'series row, 36 (me05 · PBL)', props: { setId: 'me05', name: 'Pitch Black', size: 36 } },
    { label: 'series index, 48 (sv10 · DRI)', props: { setId: 'sv10', name: 'Destined Rivals', size: 48 } },
    { label: 'with symbol (swsh1)', props: { setId: 'swsh1', name: 'Sword & Shield', size: 40 } },
    { label: 'acronym fallback (unknown set id)', props: { setId: 'no-such-set', name: 'Fates Collide', size: 40 } },
    { label: 'promo set without a code (swshp)', props: { setId: 'swshp', name: 'SWSH Black Star Promos', size: 40 } },
    { label: 'no data', props: { setId: null, name: null, size: 40 } },
  ],
  knobs: {
    setId: { kind: 'text' },
    size: { kind: 'number', min: 20, max: 120, step: 4 },
    regulationMark: { kind: 'text' },
  },
} satisfies GalleryMeta<Props>

export default setSymbolTileGallery
export { setSymbolTileGallery }
