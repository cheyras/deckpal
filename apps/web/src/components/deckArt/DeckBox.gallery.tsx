/**
 * Gallery for the deck-box art (/decks tiles). The preview wrapper builds a
 * DeckArtSpec through the real derivation (derive.ts), so what is shown here
 * is exactly what a deck with these energies and featured cards would get.
 */
import { DeckBoxArt } from './DeckBox'
import { derivePalette, hashString, motifFor, type DeckArtSpec, type EnergyType, type MotifKind } from './derive'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

const CARDS = [
  { cardId: 'sv03-125', name: 'Charizard ex', low: '/deckpal/images/en/sv/sv03/125/low.webp', high: '/deckpal/images/en/sv/sv03/125/high.webp' },
  { cardId: 'sv06-130', name: 'Dragapult ex', low: '/deckpal/images/en/sv/sv06/130/low.webp', high: '/deckpal/images/en/sv/sv06/130/high.webp' },
]

interface PreviewProps {
  deck: string
  primary: EnergyType
  secondary: EnergyType | 'none'
  cards: number
  motif: MotifKind | 'by type'
  pending: boolean
}

function DeckBoxPreview({ deck, primary, secondary, cards, motif, pending }: PreviewProps) {
  const types: EnergyType[] = secondary === 'none' || secondary === primary ? [primary] : [primary, secondary]
  const base = motifFor(deck, types)
  const spec: DeckArtSpec = {
    v: 1,
    featured: CARDS.slice(0, Math.max(0, Math.min(2, cards))),
    types,
    palette: derivePalette(types, null),
    motif: motif === 'by type' ? base : { kind: motif, seed: hashString(deck) },
    provisional: false,
  }
  return (
    <div style={{ width: 320 }} className="overflow-hidden rounded-xl border border-border-default">
      <DeckBoxArt spec={spec} pending={pending} />
    </div>
  )
}

const TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless'] as const

export default {
  name: 'DeckBoxArt',
  source: 'apps/web/src/components/deckArt/DeckBox.tsx',
  section: 'component',
  description:
    'The /decks tile art: a studio-lit deck box in its leading energy type, a generated motif in the deck\'s other colours, the energy types on the label band, and the main attackers standing in front. Live tiles also take colour from the attacker\'s art, which this preview skips.',
  component: DeckBoxPreview,
  defaults: { deck: 'gallery-deck', primary: 'Fire', secondary: 'none', cards: 1, motif: 'by type', pending: false },
  variants: [
    { label: 'Fire, one attacker', props: { deck: 'a', primary: 'Fire', secondary: 'none', cards: 1, motif: 'by type', pending: false } },
    { label: 'Fire + Psychic, two', props: { deck: 'b', primary: 'Fire', secondary: 'Psychic', cards: 2, motif: 'by type', pending: false } },
    { label: 'Water (waves)', props: { deck: 'c', primary: 'Water', secondary: 'none', cards: 1, motif: 'by type', pending: false } },
    { label: 'Psychic (orbits)', props: { deck: 'd', primary: 'Psychic', secondary: 'Grass', cards: 1, motif: 'by type', pending: false } },
    { label: 'Metal (facets)', props: { deck: 'e', primary: 'Metal', secondary: 'none', cards: 1, motif: 'by type', pending: false } },
    { label: 'Lightning, pale box', props: { deck: 'f', primary: 'Lightning', secondary: 'Fighting', cards: 2, motif: 'by type', pending: false } },
    { label: 'no Pokémon', props: { deck: 'g', primary: 'Water', secondary: 'none', cards: 0, motif: 'by type', pending: false } },
    { label: 'loading (placeholder cards)', props: { deck: 'h', primary: 'Colorless', secondary: 'none', cards: 0, motif: 'facets', pending: true } },
  ],
  knobs: {
    deck: { kind: 'text' },
    primary: { kind: 'select', options: TYPES },
    secondary: { kind: 'select', options: ['none', ...TYPES] },
    cards: { kind: 'number', min: 0, max: 2, step: 1 },
    motif: { kind: 'select', options: ['by type', 'rays', 'waves', 'orbits', 'facets'] },
    pending: { kind: 'boolean' },
  },
} satisfies GalleryMeta<PreviewProps>
