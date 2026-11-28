/**
 * Gallery for the deck-box art (/decks tiles). The preview wrapper builds a
 * DeckArtSpec through the real derivation (derive.ts), so what is shown here
 * is exactly what a deck with these energies, this style and this name would
 * get — with each choice the deck would make automatically exposed as a knob.
 */
import { DeckBoxArt } from './DeckBox'
import { BACKDROP_VARIANTS, BOX_ART_VARIANTS, DECK_STYLES, ENERGY_TYPES, STUDIO_FOR_STYLE, derivePalette, type DeckArtSpec, type DeckStyle, type EnergyType } from './derive'
import { TREATMENTS, type TreatmentId } from './title'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

const CARDS = [
  { cardId: 'sv03-125', name: 'Charizard ex', low: '/deckpal/images/en/sv/sv03/125/low.webp', high: '/deckpal/images/en/sv/sv03/125/high.webp' },
  { cardId: 'sv06-130', name: 'Dragapult ex', low: '/deckpal/images/en/sv/sv06/130/low.webp', high: '/deckpal/images/en/sv/sv06/130/high.webp' },
]

interface PreviewProps {
  name: string
  primary: EnergyType
  secondary: EnergyType | 'none'
  cards: number
  style: DeckStyle
  boxVariant: (typeof BOX_ART_VARIANTS)[number]
  studioVariant: (typeof BACKDROP_VARIANTS)[number]
  treatment: TreatmentId
  pending: boolean
}

function DeckBoxPreview({ name, primary, secondary, cards, style, boxVariant, studioVariant, treatment, pending }: PreviewProps) {
  const types: EnergyType[] = secondary === 'none' || secondary === primary ? [primary] : [primary, secondary]
  const spec: DeckArtSpec = {
    v: 2,
    featured: CARDS.slice(0, Math.max(0, Math.min(2, cards))),
    types,
    palette: derivePalette(types, null),
    style,
    art: { box: `box-${primary.toLowerCase()}-${boxVariant}`, backdrop: `backdrop-${STUDIO_FOR_STYLE[style]}-${studioVariant}` },
    provisional: false,
  }
  return (
    <div style={{ width: 340 }} className="overflow-hidden rounded-xl border border-border-default">
      <DeckBoxArt spec={spec} deckId={name} name={name} pending={pending} treatment={treatment} />
    </div>
  )
}

const base: PreviewProps = { name: 'Charizard Pidgeot', primary: 'Fire', secondary: 'none', cards: 1, style: 'power', boxVariant: 'a', studioVariant: 'a', treatment: 'arcade', pending: false }

export default {
  name: 'DeckBoxArt',
  source: 'apps/web/src/components/deckArt/DeckBox.tsx',
  section: 'component',
  description:
    "The /decks tile art: a studio-lit deck box with generated panel art in its leading energy type (recoloured by gradient map), the deck's name in one of seven title treatments, its energy types on the label band, and the main attackers in front, in a generated studio chosen by how the deck plays. Live tiles also take colour from the attacker's art, which this preview skips.",
  component: DeckBoxPreview,
  defaults: base,
  variants: [
    { label: 'arcade · power · Fire', props: base },
    { label: 'varsity · power · Lightning', props: { ...base, name: 'Miraidon Iron Hands', primary: 'Lightning', style: 'power', boxVariant: 'a', studioVariant: 'b', treatment: 'varsity', cards: 2 } },
    { label: 'crest · engine · Psychic', props: { ...base, name: 'Gardevoir', primary: 'Psychic', style: 'engine', boxVariant: 'b', studioVariant: 'b', treatment: 'crest' } },
    { label: 'foil · balanced · Metal', props: { ...base, name: 'Gholdengo', primary: 'Metal', style: 'balanced', boxVariant: 'b', studioVariant: 'a', treatment: 'foil' } },
    { label: 'serif · control · Water', props: { ...base, name: 'Palkia & Friends', primary: 'Water', style: 'control', boxVariant: 'a', studioVariant: 'a', treatment: 'serif' } },
    { label: 'stencil · swarm · Fighting', props: { ...base, name: 'Lucario Rush', primary: 'Fighting', style: 'swarm', boxVariant: 'c', studioVariant: 'c', treatment: 'stencil' } },
    { label: 'outline · engine · Grass', props: { ...base, name: 'Leafy Toolbox', primary: 'Grass', secondary: 'Water', style: 'engine', boxVariant: 'c', studioVariant: 'd', treatment: 'outline' } },
    { label: 'long name, 2 lines', props: { ...base, name: 'The Extremely Long Name For My Regional Championship Deck', treatment: 'foil', style: 'balanced' } },
    { label: 'CJK + emoji', props: { ...base, name: 'リザードン 🔥 デッキ', primary: 'Fire', treatment: 'crest', style: 'engine' } },
    { label: 'no Pokémon', props: { ...base, name: 'Trainer Toolbox', primary: 'Colorless', cards: 0, style: 'control', treatment: 'serif' } },
    { label: 'loading (placeholder cards)', props: { ...base, name: 'New import', pending: true, treatment: 'foil' } },
  ],
  knobs: {
    name: { kind: 'text' },
    primary: { kind: 'select', options: ENERGY_TYPES },
    secondary: { kind: 'select', options: ['none', ...ENERGY_TYPES] },
    cards: { kind: 'number', min: 0, max: 2, step: 1 },
    style: { kind: 'select', options: DECK_STYLES },
    boxVariant: { kind: 'select', options: BOX_ART_VARIANTS },
    studioVariant: { kind: 'select', options: BACKDROP_VARIANTS },
    treatment: { kind: 'select', options: TREATMENTS },
    pending: { kind: 'boolean' },
  },
} satisfies GalleryMeta<PreviewProps>
