## Cards Shown
*   **Radiant Venusaur** (Pokémon GO set, Sword & Shield era). Visible in frames 1-7.
*   Frame 8 shows the presenter and background objects (a Squirtle plush, a Pokéball, a Charizard card on a shelf, and a deck box) and does not demonstrate the foil pattern.

## Static Appearance
The foil pattern consists of a distinct, diagonal crisscross or diamond grid. The lines forming this grid are relatively thick and appear "pixelated," as if constructed from small, closely packed squares or short line segments rather than smooth, continuous strokes. The scale of the diamond cells is moderately large, with perhaps 8-10 cells fitting across the width of the card. The foil effect covers the entire face of the card (full-card holo), shining through the background, the borders, and the character art itself, though it is blocked by opaque text boxes. The colors observed in the foil reflections are vibrant and span the rainbow spectrum (greens, yellows, oranges, and cyans are visible).

## Tilt Animation
As the card is tilted (observed across frames 1 through 7), the underlying diagonal grid remains static in its position on the card, but the *illumination* of the grid changes dramatically. 
*   A broad, soft-edged band of light (a sheen) sweeps across the card surface.
*   When this sheen intersects the embossed grid pattern, the pixelated lines of the grid catch the light brilliantly, revealing the crisscross structure.
*   Between frame 2 and frame 3, as the angle changes, the bright yellow-green reflection on the central grid lines shifts slightly and changes hue, indicating that the color is dependent on the viewing angle relative to the light source.
*   The effect is not of the grid moving, but of a light source passing over a textured, static surface, causing different facets of the pixelated lines to flare up and cycle through rainbow hues.

## Layer Structure Hypothesis
1.  **Card Stock Base:** The physical paper layer.
2.  **Foil Layer:** A full-surface metallic foil layer. This layer is embossed or etched with the "pixelated crisscross" pattern. The texture of this pattern acts like a complex normal map, causing the diagonal lines to reflect light at specific angles.
3.  **Opaque White Ink (Mask):** Printed over the foil in areas where the foil should not show through (e.g., behind the text boxes, HP, and attack text).
4.  **CMYK Ink Layer:** The actual artwork and card borders are printed on top. The ink is translucent in areas like the background and the Pokémon itself, allowing the textured foil to shine through and interact with the printed colors.

## Distinguishing Features
This pattern is uniquely identifiable by its large, diagonal, "pixelated" crisscross grid. It is easily distinguished from smooth sheen patterns, scattered glitter, or orb/star-based holos. The texture on the grid lines gives it a slightly rough, digital, or "radiant" look, setting it apart from simple flat geometric foils.

## Shader Notes
*   **Grid Generation:** Use a fragment shader to generate a diagonal 2D grid (e.g., using `fract` on rotated UV coordinates).
*   **Pixelation/Noise:** Apply a step function or high-frequency blocky noise to the grid lines to create the "pixelated" or segmented texture described in the narration.
*   **Normal Mapping:** Treat the pixelated grid as a normal map. The lines should have normals angled slightly away from the flat card surface to catch the light differently.
*   **Sheen Band:** Implement a broad, soft specular highlight (sheen) driven by the tilt uniform (`vec2 tilt`).
*   **Masking:** Multiply the sheen effect by the grid pattern so that only the crisscross lines light up intensely when the sheen passes over them.
*   **Iridescence:** Map the angle between the view vector, the modified normal, and the light vector to a 1D color ramp texture to produce the rainbow hue shifting on the illuminated grid lines.

## Confidence
*   **Cards Shown:** High. The card name and set logo are clearly legible.
*   **Static Appearance:** High. The crisscross pattern is very distinct and well-lit in the frames.
*   **Tilt Animation:** High. The interaction between the light and the static grid is clearly visible across the sequential frames.
*   **Layer Structure Hypothesis:** Medium. This is the standard manufacturing process for modern full-art foil cards, though exact ink opacities are inferred.
*   **Distinguishing Features:** High. The pattern is highly specific and matches the creator's description.
*   **Shader Notes:** High. The visual effect translates well to standard shader techniques for textured, iridescent surfaces.