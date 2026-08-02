Here is the implementation-grade spec for the "Horizontal sheen" foil pattern based on the provided frames.

*Note: Frame 8 shows the presenter and unrelated items; it is excluded from the foil analysis.*

## Cards Shown
- **Gengar** (Scarlet & Violet era standard holo): Visible in frames 1, 2, and 3.
- **Kyogre** (Scarlet & Violet era standard holo): Visible in frames 4, 5, 6, and 7.

## Static Appearance
The foil pattern is characterized by a smooth, mirror-like metallic surface devoid of any discrete shapes, particles, or textures (no stars, dots, or cosmos elements). Instead, it features a distinct, straight horizontal band of bright, prismatic light (a "sheen") that stretches across the width of the card. The foil effect is visible in the background of the artwork window (behind the Pokemon subject) and along the outer borders of the card (the silver borders typical of the Scarlet & Violet era). The sheen band displays a rainbow color gradient, typically showing distinct bands of red, green, and blue.

## Tilt Animation
The defining characteristic of this pattern is the vertical translation of the horizontal sheen band in response to vertical tilting (pitch). 
- **Between frame 4 and frame 7**, as the Kyogre card is tilted, the horizontal band of light travels smoothly from the lower portion of the art box (frame 4), up through the center of the art (frames 5 and 6), and finally up to the top silver border of the card (frame 7).
- The sheen remains strictly horizontal throughout the movement.
- As the band moves, the rainbow colors within it shift slightly in intensity and hue, but the overall structure of the band remains intact. The unlit portions of the foil remain a flat, dark metallic silver.

## Layer Structure Hypothesis
1.  **Cardstock Base:** The physical paper layer.
2.  **Foil Layer:** A uniform metallic foil layer embossed with a microscopic linear diffraction grating oriented horizontally. This grating catches the light to create the straight horizontal band of prismatic reflection.
3.  **Ink Layer:** 
    *   **Opaque Ink:** Used for the card text, HP, attacks, and the Pokemon subject itself, completely blocking the foil underneath.
    *   **Transparent/No Ink:** Used for the background of the art window and the outer borders, allowing the foil layer to shine through completely.

## Distinguishing Features
This pattern is easily distinguished by its extreme simplicity: it is a single, straight horizontal band of light. It can be differentiated from "Cosmos" or "Starlight" patterns because it completely lacks any particulate shapes or sparkles. It differs from diagonal or vertical sheen patterns strictly by its horizontal orientation. It is the standard, default holographic pattern for the Scarlet & Violet era of the TCG.

## Shader Notes
- **Sheen Function:** The core effect can be driven by a 1D function based on the fragment's `uv.y` coordinate and a vertical tilt uniform (e.g., `tilt.y`).
- **Band Generation:** Use a `smoothstep` or Gaussian function to create a horizontal band with soft, fading edges: `float sheen = smoothstep(width, 0.0, abs(uv.y - tilt.y));`.
- **Color Mapping:** Map a 1D rainbow gradient texture or a procedural hue function across the width of the generated sheen band to create the prismatic effect.
- **Masking:** A dedicated mask texture is required. The mask should be white (1.0) in the art background and card borders, and black (0.0) over the Pokemon subject and text areas. Multiply the final sheen output by this mask.
- **Base Reflection:** Add a base, low-intensity metallic reflection (e.g., a dark grey/silver tint) to the masked foil areas so they don't appear completely black when the sheen band is not passing over them.

## Confidence
- **Cards Shown:** High. The names "Gengar" and "Kyogre" are clearly legible.
- **Static Appearance:** High. The lack of particles and the presence of the horizontal band are very clear.
- **Tilt Animation:** High. The vertical movement of the band is perfectly demonstrated across frames 4-7.
- **Layer Structure:** High. This aligns with standard modern Pokemon card manufacturing techniques.
- **Distinguishing Features:** High. The pattern is distinct in its simplicity.
- **Shader Notes:** High. The mathematical approach to rendering a moving horizontal band is straightforward.