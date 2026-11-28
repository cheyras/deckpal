/**
 * Gallery for PrintedSetMark — the set code drawn the way the card prints it —
 * and a real-vs-ours entry that puts the print line of an actual card, cropped
 * live from its art in the image tier, beside ours at the same scale.
 *
 * The variant cards sit on the app's dark surface, so the first entry also shows
 * the mark on dark; SetSymbolTile.gallery.tsx shows it on the light tile.
 */
import { PrintedSetMark } from './PrintedSetMark'
import { PLATE_H, printedMarkLayout } from './printedMark'
import type { GalleryMeta } from '../routes/design/galleryTypes'

// ── PrintedSetMark ──────────────────────────────────────────────────────

type MarkProps = { code: string; height: number; en?: boolean; regulationMark?: string | null; label?: string }

const printedSetMarkGallery = {
  name: 'PrintedSetMark',
  source: 'apps/web/src/components/PrintedSetMark.tsx',
  section: 'primitive',
  description:
    'A printed set code as the card prints it: a fixed 1.75:1 black plate, white keyline, condensed extra-bold capitals, EN — optionally a card’s regulation box. Vector outlines (components/printedMarkGlyphs.ts), no font. Shown here on the dark surface, where the keyline carries it.',
  component: PrintedSetMark,
  defaults: { code: 'MEG', height: 24, en: true, regulationMark: 'I' },
  variants: [
    { label: 'as printed on the card (SVI EN)', props: { code: 'SVI', height: 24 } },
    { label: 'set-symbol layout, no EN (MEP)', props: { code: 'MEP', height: 24, en: false } },
    { label: 'with a regulation mark (G · SVI)', props: { code: 'SVI', height: 24, regulationMark: 'G' } },
    { label: 'widest code, set tighter (TWM)', props: { code: 'TWM', height: 24 } },
    { label: 'digits (M24)', props: { code: 'M24', height: 24 } },
    { label: 'digits (30C)', props: { code: '30C', height: 24 } },
    { label: 'small: 14px (card sheet)', props: { code: 'PBL', height: 14, regulationMark: 'J' } },
    { label: 'large: 60px', props: { code: 'DLR', height: 60, regulationMark: 'J' } },
  ],
  knobs: {
    code: { kind: 'text' },
    height: { kind: 'number', min: 10, max: 120, step: 2 },
    en: { kind: 'boolean' },
    regulationMark: { kind: 'text' },
  },
} satisfies GalleryMeta<MarkProps>

// ── Real vs ours ────────────────────────────────────────────────────────

/** Native size of a card's art in the image tier, and of the print-line crop. */
const CARD_W = 600
const CROP_W = 65
const CROP_H = 29
/** The plate on a 600px scan: 21.5px tall, its outer edge 3.5px left of / 2.5px above the black fill. */
const SCAN_PLATE_H = 21.5

type VsProps = {
  /** The card's art, `/deckpal/images/en/<serie>/<set>/<localId>/high.webp`. */
  image: string
  /** Top-left of the plate's black fill on the 600px scan, measured per card. */
  fill: readonly [number, number]
  code: string
  regulationMark?: string | null
  /** CSS pixels per scan pixel. 1 ≈ the plate at a 44px tile; 3 is a 3× phone's worth. */
  scale?: number
  /** Draw ours over the real crop at half opacity, to check the fit. */
  overlay?: boolean
}

function PrintedMarkVsCard({ image, fill, code, regulationMark = null, scale = 2, overlay = false }: VsProps) {
  const k = Math.max(1, Number(scale) || 1)
  const [fx, fy] = fill
  const x0 = fx - 27
  const y0 = fy - 7
  const plateH = SCAN_PLATE_H * k
  const m = printedMarkLayout(code, { regulationMark, heightPx: plateH })
  // Line ours up on the scan: the plate's outer edge, less the regulation box.
  const left = (fx - 3.5 - x0) * k - (m.plate.x / PLATE_H) * plateH
  const top = (fy - 2.5 - y0) * k
  const box = { width: CROP_W * k, height: CROP_H * k }
  const ours = (
    <div className="absolute" style={{ left, top }}>
      <PrintedSetMark code={code} height={plateH} regulationMark={regulationMark} />
    </div>
  )
  return (
    <div className="flex flex-wrap items-end gap-[12px]">
      <figure className="m-0">
        <div className="relative overflow-hidden rounded-[4px]" style={box}>
          <img
            src={image}
            alt=""
            className="absolute max-w-none"
            style={{ left: -x0 * k, top: -y0 * k, width: CARD_W * k }}
          />
          {overlay && <div className="opacity-50">{ours}</div>}
        </div>
        <figcaption className="mt-[4px] text-[10px] text-text-muted">printed (600px scan)</figcaption>
      </figure>
      <figure className="m-0">
        <div className="relative overflow-hidden rounded-[4px] bg-surface-on-light" style={box}>
          {ours}
        </div>
        <figcaption className="mt-[4px] text-[10px] text-text-muted">ours (vector)</figcaption>
      </figure>
    </div>
  )
}

const art = (serie: string, set: string, localId: string) => `/deckpal/images/en/${serie}/${set}/${localId}/high.webp`

const printedMarkVsCardGallery = {
  name: 'PrintedSetMark — real vs ours',
  source: 'apps/web/src/components/PrintedSetMark.gallery.tsx',
  section: 'primitive',
  description:
    'The print line of a real card (its art from the image tier, cropped) beside ours at the same scale, per era. Scarlet & Violet and Mega Evolution print the same mark; what varies is per-card finish (last variant). Turn on overlay to see ours over the scan.',
  component: PrintedMarkVsCard,
  defaults: { image: art('sv', 'sv01', '001'), fill: [59, 776], code: 'SVI', regulationMark: 'G', scale: 3, overlay: false },
  variants: [
    { label: 'SV · Scarlet & Violet 001 (G · SVI)', props: { image: art('sv', 'sv01', '001'), fill: [59, 776], code: 'SVI', regulationMark: 'G' } },
    { label: 'SV · Twilight Masquerade 001 (H · TWM)', props: { image: art('sv', 'sv06', '001'), fill: [59, 777], code: 'TWM', regulationMark: 'H' } },
    { label: 'SV · Destined Rivals 001 (I · DRI)', props: { image: art('sv', 'sv10', '001'), fill: [59, 776], code: 'DRI', regulationMark: 'I' } },
    { label: 'SV · trainer frame, Stellar Crown 129 (H · SCR)', props: { image: art('sv', 'sv07', '129'), fill: [59, 776], code: 'SCR', regulationMark: 'H' } },
    { label: 'SV · on black art, 151 031 (G · MEW)', props: { image: art('sv', 'sv03.5', '031'), fill: [59, 776], code: 'MEW', regulationMark: 'G' } },
    { label: 'ME · Mega Evolution 001 (I · MEG)', props: { image: art('me', 'me01', '001'), fill: [59, 776], code: 'MEG', regulationMark: 'I' } },
    { label: 'ME · Pitch Black 001 (J · PBL)', props: { image: art('me', 'me05', '001'), fill: [59, 776], code: 'PBL', regulationMark: 'J' } },
    { label: 'ME · Delta Reign 001 (J · DLR)', props: { image: art('me', 'me06', '001'), fill: [59, 776], code: 'DLR', regulationMark: 'J' } },
    { label: 'ME · 30th Celebration 001 (J · 30C)', props: { image: art('me', '30th', '001'), fill: [62, 777], code: '30C', regulationMark: 'J' } },
    { label: 'energy · SV Energy 001 (SVE, no regulation mark)', props: { image: art('sv', 'sve', '001'), fill: [59, 788], code: 'SVE' } },
    { label: 'energy · ME Energy 001 (MEE)', props: { image: art('me', 'mee', '001'), fill: [59, 785], code: 'MEE' } },
    { label: 'promo · MEP 001 (I · MEP)', props: { image: art('me', 'mep', '001'), fill: [60, 776], code: 'MEP', regulationMark: 'I' } },
    { label: "McDonald's 2023 · 1 (G · M23)", props: { image: art('mc', '2023sv', '1'), fill: [57, 776], code: 'M23', regulationMark: 'G' } },
    { label: "McDonald's 2026 · 1 (H · M26)", props: { image: art('mc', '2026me', '1'), fill: [61, 782], code: 'M26', regulationMark: 'H' } },
    {
      label: 'finish, not era: ME gold Mega Hyper Rare 188 prints it knocked out (ours: the standard mark)',
      props: { image: art('me', 'me01', '188'), fill: [59, 776], code: 'MEG', regulationMark: 'I' },
    },
  ],
  knobs: {
    scale: { kind: 'number', min: 1, max: 6, step: 1 },
    overlay: { kind: 'boolean' },
    code: { kind: 'text' },
    regulationMark: { kind: 'text' },
  },
} satisfies GalleryMeta<VsProps>

export default printedSetMarkGallery
export { printedSetMarkGallery, printedMarkVsCardGallery }
