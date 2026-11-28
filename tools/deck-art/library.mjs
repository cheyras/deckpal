/**
 * The deck-box art library: every generated image the /decks tiles can use,
 * with the exact prompt that made it. `generate.mjs` sends these to Codex;
 * `process.mjs` turns the results into the shipped WebP sets and writes
 * apps/web/src/components/deckArt/art/MANIFEST.json from them.
 *
 * Two layers, each a set of FAMILIES with several VARIANTS:
 *
 *   box       the deck box's printed front panel — one family per energy type,
 *             in that type's shape language (flame, wave, leaf, bolt…)
 *   backdrop  the studio behind the box — one family per deck STYLE (how the
 *             deck plays: power, engine, control, swarm, balanced), so the same
 *             Fire box sits under a spotlight for a big-hitting ex deck and in
 *             a calm painted studio for a stall deck
 *
 * Every image is generated GRAYSCALE on purpose. The app recolours it at
 * render time with a gradient map built from the deck's palette (an SVG
 * feComponentTransfer), so one image serves every colour a deck can be.
 *
 * Rules carried by every prompt: abstract or material only — no text,
 * letters, numbers, logos, people, animals, creatures, Pokémon or any
 * recognisable character. Same rule as scripts/gen-marketing-images.mjs.
 */

export const BOX_RULES =
  'Square abstract artwork for the printed front panel of a premium trading-card deck box. ' +
  'Monochrome GRAYSCALE only, no colour at all: it will be recoloured later with a gradient map, ' +
  'so use the full tonal range from deep black to bright white with clear, separated mid-tones. ' +
  'Bold, graphic, packaging-print quality with crisp edges. Full-bleed to all four edges: no border, ' +
  'no frame, no vignette, and even visual density across the whole canvas so any crop works. ' +
  'Absolutely no text, letters, numbers, logos, symbols of real brands, people, animals, creatures, ' +
  'Pokémon or any recognisable character.'

export const BACKDROP_RULES =
  'Wide landscape (3:2) photograph of an EMPTY professional product-photography studio set, to sit ' +
  'behind a small product. Monochrome GRAYSCALE only, no colour at all: it will be recoloured later. ' +
  'The lower third reads as floor, the upper two thirds as wall or sweep, with no hard horizon line. ' +
  'Key light from the upper centre-right. Keep the centre calm and uncluttered. Overall mid-to-dark ' +
  'tones: no blown-out highlights and no large pure-black areas except the far corners. Soft, ' +
  'high-end, photographic. No objects, no products, no furniture, no people, no animals, no text, ' +
  'no logos, no watermarks.'

const box = (type, variants) =>
  variants.map(([v, subject]) => ({
    id: `box-${type}-${v}`,
    layer: 'box',
    family: type,
    variant: v,
    subject,
    prompt: `${BOX_RULES} Subject: ${subject}.`,
  }))

const backdrop = (style, variants) =>
  variants.map(([v, subject]) => ({
    id: `backdrop-${style}-${v}`,
    layer: 'backdrop',
    family: style,
    variant: v,
    subject,
    prompt: `${BACKDROP_RULES} Set: ${subject}.`,
  }))

export const LIBRARY = [
  // ── box: one family per energy type ──────────────────────────────────────
  ...box('fire', [
    ['a', 'stylised flame ribbons rising in layered tongues, with scattered ember sparks'],
    ['b', 'a radiant sunburst of heat: sharp rays from an off-centre core, crossed by rippling heat-haze bands'],
    ['c', 'molten lava cracks: a cooled dark crust split by glowing seams, embers caught in the gaps'],
  ]),
  ...box('water', [
    ['a', 'layered curling ocean waves in a woodblock-print style, with foam crests and spray dots'],
    ['b', 'concentric ripples spreading across a still surface, with a few falling droplets'],
    ['c', 'marbled flowing currents: swirling liquid bands like ink spreading through water'],
  ]),
  ...box('grass', [
    ['a', 'overlapping broad leaves with fine vein lines, layered in depth'],
    ['b', 'climbing vines and curling tendrils with small buds, flowing across the panel'],
    ['c', 'unfurling fern fronds and seed-pod spirals in a botanical engraving style'],
  ]),
  ...box('lightning', [
    ['a', 'branching forked lightning bolts crackling across a stormy field'],
    ['b', 'jagged electric zigzag shards built from a bold halftone dot pattern'],
    ['c', 'crackling plasma arcs and spark bursts leaping between small glowing nodes'],
  ]),
  ...box('psychic', [
    ['a', 'hypnotic op-art concentric rings that warp and pulse outward'],
    ['b', 'a swirling cosmic nebula with scattered stars around a bright core'],
    ['c', 'a kaleidoscopic sacred-geometry mandala of interlocking circles and petal arcs'],
  ]),
  ...box('fighting', [
    ['a', 'cracked stone with layered rock strata and fractured, chiselled edges'],
    ['b', 'explosive bold ink brush-stroke impact bursts with radiating speed lines'],
    ['c', 'stacked mountain ridges drawn as flowing topographic contour lines'],
  ]),
  ...box('darkness', [
    ['a', 'billowing smoke and ink clouds with soft trailing tendrils'],
    ['b', 'a night sky of thin crescent moons and scattered stars over drifting cloud bands'],
    ['c', 'shattered obsidian shards with sharp reflective facets'],
  ]),
  ...box('metal', [
    ['a', 'brushed steel panels with rows of rivets and machined seams'],
    ['b', 'an interlocking pattern of abstract cog teeth and hexagonal armour plating'],
    ['c', 'liquid chrome folds with mirror-like highlights and deep reflections'],
  ]),
  ...box('fairy', [
    ['a', 'soft four-point sparkles and starbursts tangled in flowing ribbons'],
    ['b', 'delicate floral lace of petals and filigree scrollwork'],
    ['c', 'faceted prisms and crystal glints scattered among soft out-of-focus circles'],
  ]),
  ...box('dragon', [
    ['a', 'an overlapping scale-armour pattern, rhythmic and deeply embossed'],
    ['b', 'serpentine coiling bands carved with ancient spiral motifs, like a stone relief'],
    ['c', 'a faceted gemstone crystal cluster with sharp angular planes'],
  ]),
  ...box('colorless', [
    ['a', 'a clean interlocking geometric tessellation of triangles and hexagons'],
    ['b', 'a star-field constellation of fine points joined by thin straight lines'],
    ['c', 'folded-paper origami facets with soft shadows, like a plaster relief'],
  ]),

  // ── backdrop: one family per deck style ──────────────────────────────────
  ...backdrop('spotlight', [
    ['a', 'a single theatrical spotlight cone falling from the upper right onto a seamless paper sweep, light haze in the air'],
    ['b', 'two crossing spotlight beams cutting through atmospheric haze above a dark stage floor'],
    ['c', 'a hard-edged circular spotlight pool on a dark sweep, with a soft rim of spill light around it'],
    ['d', 'shafts of light streaming down through haze between tall dark studio flats'],
  ]),
  ...backdrop('gobo', [
    ['a', 'a window-frame light pattern projected across a plaster studio wall, fading onto a soft floor'],
    ['b', 'dappled foliage shadows from a gobo projector across a studio wall and floor'],
    ['c', 'venetian-blind stripes of light falling diagonally across a studio wall and floor'],
    ['d', 'a geometric lattice gobo pattern of light on a curved studio sweep'],
  ]),
  ...backdrop('canvas', [
    ['a', 'a hand-painted mottled canvas portrait backdrop with cloudy brush texture, like an old-master photo studio'],
    ['b', 'a softly crumpled muslin backdrop with gentle folds and smooth light falloff'],
    ['c', 'a weathered plaster wall with soft tonal stains meeting a smooth floor'],
    ['d', 'a stippled painted backdrop with a soft lighter halo behind the centre'],
  ]),
  ...backdrop('bokeh', [
    ['a', 'soft out-of-focus bokeh light circles scattered across a dark studio background, very shallow depth of field'],
    ['b', 'tiny glittering bokeh specks drifting in a dark hazy studio'],
    ['c', 'large soft bokeh orbs near the top fading down to a dark floor'],
    ['d', 'defocused streaks and circles of distant arena lights behind a dark floor'],
  ]),
  ...backdrop('sweep', [
    ['a', 'a seamless paper studio sweep with a smooth gradient of light falloff and a soft floor reflection'],
    ['b', 'a curved infinity cove (cyclorama) with soft overhead light'],
    ['c', 'a smooth polished concrete studio floor meeting a dark wall with a soft glow along the join'],
    ['d', 'a deep velvet-dark studio sweep with a gentle radial glow behind the centre'],
  ]),
]

/** Pixel crop targets, in the app's 320×180 scene units (DeckBox.tsx). */
export const BOX_FACE = { w: 80, h: 110 }
export const SCENE = { w: 320, h: 180 }
