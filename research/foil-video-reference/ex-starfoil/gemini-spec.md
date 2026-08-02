## Cards Shown
- Alakazam ex (Scarlet & Violet era, likely 151 set based on the card number 065/165 visible in frame 1). Visible in all frames (1-8).

## Static Appearance
The foil pattern covers the entire face of the card, including the art box, text box, and borders. It consists of two main visual components:
1.  **Diagonal Sheen:** A broad, straight, diagonal band of rainbow-colored light that stretches across the card.
2.  **Star Pattern:** A dense field of small, four-pointed stars scattered across the entire card face. The stars appear to be printed on top of the foil layer, as they are visible even outside the main sheen band, though they catch the light most intensely when the sheen passes over or near them. The stars are relatively small, perhaps 1-2% of the card width.

## Tilt Animation
As the card is tilted (frames 1-8):
-   **Sheen Movement:** The primary diagonal rainbow sheen band sweeps across the card. In frame 1, it's near the top left. By frame 4, it has moved down to the middle right. In frames 5-8, a second, parallel sheen band enters from the top left and moves towards the center right. The sheen bands maintain a consistent diagonal angle (roughly 45 degrees).
-   **Star Illumination:** The stars themselves do not move relative to the card surface. Instead, they light up and change color as the diagonal sheen bands pass behind/underneath them. In frame 1, stars near the top left are illuminated. In frame 4, stars in the middle right are bright. In frame 8, stars in the bottom right and top left are catching the light from the two visible sheen bands.
-   **Color Shift:** The colors within the sheen bands shift through the rainbow spectrum (red, yellow, green, blue, purple) as the angle changes, which in turn dictates the color of the illuminated stars.

## Layer Structure Hypothesis
1.  **Base Foil Layer:** A smooth, highly reflective metallic layer that produces the broad, diagonal rainbow sheen bands.
2.  **Printed Star Layer:** A layer of opaque or semi-opaque ink printed *on top* of the base foil, forming the dense pattern of four-pointed stars. The narration explicitly states the pattern is "on the top" and "almost like the pattern is triple printed," suggesting a dense, overlaid print rather than an embossed foil texture.
3.  **Opaque Ink Layer:** The standard card artwork, text, and borders, printed over the foil and star layers, with varying levels of opacity to allow the foil and stars to shine through in specific areas (like the background of the art and the text box).

## Distinguishing Features
-   **Dense Star Field:** The sheer density of the stars distinguishes it from older, sparser star foil patterns (like the classic Cosmos or early ex era foils).
-   **Diagonal Sheen:** The underlying foil effect is a simple, straight diagonal sheen, unlike the swirling or localized holographic effects of other patterns.
-   **Static Stars:** The stars do not move or parallax; they are fixed in place and only change brightness/color based on the underlying sheen.

## Shader Notes
-   **Base Sheen:** Implement a diagonal gradient or sine wave function driven by the tilt uniform to create the broad rainbow sheen bands.
-   **Color Ramp:** Use a standard rainbow color ramp (HSV hue rotation) mapped to the sheen function.
-   **Star Mask:** Create a static texture mask or procedural noise function (like a Voronoi variant or a grid with jitter) to generate the dense field of four-pointed stars.
-   **Composite:** Multiply or screen the star mask against the base sheen layer. The stars should only be brightly colored where the sheen intersects them; otherwise, they should be subtle or invisible.
-   **No Parallax:** Do not apply parallax offsets to the star mask; it should remain locked to the card's UV coordinates.

## Confidence
-   **Cards Shown:** High. The card name and general era are clearly visible.
-   **Static Appearance:** High. The diagonal sheen and dense star pattern are distinct.
-   **Tilt Animation:** High. The movement of the sheen and the static nature of the stars are clear across the frames.
-   **Layer Structure Hypothesis:** Medium. The visual evidence strongly supports the narration's claim that the stars are printed on top of a basic diagonal sheen foil, but exact manufacturing details are inferred.
-   **Distinguishing Features:** High. The combination of dense, static stars and a diagonal sheen is unique.
-   **Shader Notes:** High. The visual components translate straightforwardly into standard shader techniques.