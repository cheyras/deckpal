// Physical card geometry — the single source of truth for every box that
// draws a Pokémon card.
//
// PROVENANCE. A standard Pokémon TCG card measures 63 × 88 mm. That footprint
// is well attested: it is the nominal 2.5″ × 3.5″ poker/trading-card size,
// reported unchanged from the game's 1996 launch through current standard-size
// cards, and it is the trim an officially licensed accessory (Ultra Pro
// standard deck protectors) is sized to fit.
//
// The 3 mm corner radius is TRIANGULATED, NOT OFFICIAL. It is inferred from a
// Japanese trading-card die-cutting specification that documents a 63 × 88 mm
// trim with "R3" (3 mm) corners for that poker-size card, plus a Pokémon-
// specific size guide. A second manufacturing source quotes 2.5 mm for
// "standard card corners", and a Pokémon-specific source notes the radius
// varies slightly between print runs and eras. The credible range is therefore
// 2.5–3.0 mm; NO TPCi factory die specification is published, so 3 mm is the
// best-supported point estimate rather than an authoritative figure. Treat it
// as "the corner the box should round to" and not as a claim about any
// individual physical card.
//
// Everything below is DERIVED from the three millimetre constants, so the file
// cannot drift from itself: change a number here and the ratio, the
// percentage, the pixel function and the CSS strings all follow.

export const CARD_WIDTH_MM = 63
export const CARD_HEIGHT_MM = 88
export const CARD_CORNER_RADIUS_MM = 3

// width / height. 63 / 88 = 0.7159090909…  The previous hardcoded 245 / 337
// was 1.55% too wide (245/337 = 0.72729…).
export const CARD_ASPECT_RATIO = CARD_WIDTH_MM / CARD_HEIGHT_MM

// height / width — the RECIPROCAL. This is what row-height arithmetic needs
// (GridView multiplies a tile WIDTH by it to get the art HEIGHT), and it is
// kept here so the grid's measurement-critical constant cannot disagree with
// the aspect ratio CardImage paints: if one is the reciprocal of the other,
// rows cannot drift.
export const CARD_ASPECT_RATIO_INVERSE = CARD_HEIGHT_MM / CARD_WIDTH_MM

// Corner radius as a percentage of the rendered WIDTH. 3 / 63 * 100 =
// 4.761904762…%. At a 245px grid tile that is ~11.67px; at a 600px detail view
// ~28.57px — the same SHAPE at both sizes, which a fixed pixel radius cannot be.
export const CARD_RADIUS_PCT = (CARD_CORNER_RADIUS_MM / CARD_WIDTH_MM) * 100

// Corner radius as a percentage of the rendered HEIGHT. A percentage
// border-radius resolves against each axis INDEPENDENTLY, so to keep the
// corner circular on a non-square box the horizontal and vertical percentages
// must differ. Horizontal = radius/width*100; vertical = radius/height*100.
// On a 63:88 box these resolve to the same pixel length, so the corner stays
// round at any rendered size without measuring it.
export const CARD_RADIUS_PCT_Y = (CARD_CORNER_RADIUS_MM / CARD_HEIGHT_MM) * 100

// The radius, in pixels, for a card rendered `widthPx` wide. Linear in the
// width; 0 at 0. Used by callers that need a concrete pixel value (e.g. a
// canvas or a style that cannot take a percentage).
export function cardRadiusPx(widthPx: number): number {
  return (widthPx * CARD_CORNER_RADIUS_MM) / CARD_WIDTH_MM
}

// A ready-made CSS `aspect-ratio` value: `63 / 88`.
export const CARD_ASPECT_RATIO_CSS = `${CARD_WIDTH_MM} / ${CARD_HEIGHT_MM}`

// A ready-made CSS `border-radius` value that keeps the corner circular at any
// rendered size: `4.76…% / 3.40…%`. Use as `style={{ borderRadius:
// CARD_RADIUS_CSS }}` on the wrapper that owns overflow-hidden.
export const CARD_RADIUS_CSS = `${CARD_RADIUS_PCT}% / ${CARD_RADIUS_PCT_Y}%`
