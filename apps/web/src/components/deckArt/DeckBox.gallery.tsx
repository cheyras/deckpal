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

// Stand-in card faces, drawn inline. Like the other galleries (CardImage,
// CardTile, TableView), this one makes no card-art requests: /design is also
// rendered by the browser suites against a fixture server that has no card
// art, and every request it cannot serve fails the run. Live tiles show the
// real art; these only need to read as "a card standing in front of the box".
function standInCard(art: [string, string]): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 63 88">' +
    `<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${art[0]}"/><stop offset="1" stop-color="${art[1]}"/></linearGradient></defs>` +
    '<rect width="63" height="88" rx="3" fill="#d9c56e"/>' +
    '<rect x="2.5" y="2.5" width="58" height="83" rx="2" fill="#eeebe3"/>' +
    '<rect x="5" y="8" width="53" height="37" fill="url(#a)"/>' +
    '<rect x="5" y="4.2" width="30" height="2.2" rx="1" fill="#57534a"/>' +
    '<g fill="#b9b3a6"><rect x="6" y="50" width="51" height="2" rx="1"/><rect x="6" y="55" width="44" height="2" rx="1"/><rect x="6" y="63" width="51" height="2" rx="1"/><rect x="6" y="68" width="38" height="2" rx="1"/></g>' +
    '</svg>'
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

const ATTACKER = standInCard(['#f08a3c', '#9c2f1c'])
const PARTNER = standInCard(['#5fb3a8', '#5a3a8c'])
const CARDS = [
  { cardId: 'gallery-1', name: 'Stand-in attacker', low: ATTACKER, high: ATTACKER },
  { cardId: 'gallery-2', name: 'Stand-in partner', low: PARTNER, high: PARTNER },
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
    "The /decks tile art: a studio-lit deck box with generated panel art in its leading energy type (recoloured by gradient map), the deck's name in one of seven title treatments, its energy types on the label band, and the main attackers in front, in a generated studio chosen by how the deck plays. Live tiles show the real card art and take colour from it; this preview draws stand-in cards and skips that sampling.",
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
