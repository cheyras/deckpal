Here is a specification for the "Crosshatch" holofoil pattern based on the provided frames.

## Cards Shown
*   **Pokémon Fan Club** (Supporter card): Features a "Pokémon League" stamp. Visible in frames 1 through 7.
*   **Dusknoir FB LV.50** (Basic Pokémon): Features an "SP" logo and a "Frontier Brain's Pokémon" tag. Visible in frame 8.

## Static Appearance
The foil pattern consists of a dense, uniform grid of fine, intersecting diagonal lines, creating a continuous "crosshatch" or woven diamond texture across the foiled areas. The lines are extremely thin and closely spaced. The foil is visible in the background of the illustration window (behind the characters/Pokémon) and throughout the lower text box area. The foil reflects a vibrant rainbow spectrum (red, orange, yellow, green, blue, violet) that overlays the printed colors of the card.

## Tilt Animation
As the card is tilted, a broad, soft-edged band of rainbow colors sweeps across the surface of the card. 
*   Between frame 1 and frame 3, as the card is tilted slightly, the primary band of rainbow light moves from the left side of the text box towards the center.
*   In frame 4, a strong white glare hits the top of the card, while the rainbow sheen shifts to the right side of the text box.
*   Between frame 5 and frame 7, the card is tilted back, and the rainbow sheen sweeps back from the center towards the left side.
The crosshatch lines themselves remain static in their positions relative to the card; they do not move or scale. Instead, the lines act as a textured surface that catches the moving rainbow sheen. The lines appear brightest when the sheen passes over them, highlighting the geometric grid.

## Layer Structure Hypothesis
1.  **Card Stock Base:** The physical paper layer.
2.  **Foil Layer:** A metallic foil layer that has been physically embossed or etched with the fine crosshatch texture. This texture acts as a diffraction grating, breaking incident light into the rainbow spectrum.
3.  **Opaque Ink Layer:** Printed over the foil to create the card borders, text, and the main subjects of the artwork (the characters and Dusknoir), blocking the foil entirely.
4.  **Semi-Transparent Ink Layer:** Used in the text box and the background of the art window. This allows the textured foil and its rainbow reflections to show through while still providing a base color (like the purple background on the Dusknoir card).

## Distinguishing Features
This pattern is immediately identifiable by its strict, geometric grid of intersecting diagonal lines. Unlike smooth holofoils that just show a sheen, or "cosmos" foils that use scattered dots/stars, the Crosshatch pattern has a distinct, almost fabric-like texture. The rainbow effect is bound to this texture, making the lines themselves appear to glow with different colors.

## Shader Notes
*   **Foil Mask:** Require a mask texture to define where the foil effect is active (art background, text box) and where it is blocked by opaque ink.
*   **Crosshatch Generation:** Generate the base texture procedurally using UV coordinates. Combine two high-frequency sine waves or fractional functions along diagonal axes (e.g., `sin((uv.x + uv.y) * scale)` and `sin((uv.x - uv.y) * scale)`) to create the intersecting lines.
*   **Tilt Uniform:** Use a uniform (e.g., `u_tilt`) representing the light angle or camera angle to drive the movement of the sheen.
*   **Rainbow Sheen:** Create a broad gradient band that moves across the UV space based on the tilt uniform. Map this band to a rainbow color palette (using a 1D texture or a procedural hue function).
*   **Blending:** Multiply or add the rainbow sheen to the procedural crosshatch pattern. The lines should be the primary elements displaying the rainbow colors.
*   **Base Color Integration:** Blend the resulting colored crosshatch pattern with the underlying card artwork, using the foil mask to control the opacity of the effect.

## Confidence
*   **Cards Shown:** High. The text on both cards is clearly legible.
*   **Static Appearance:** High. The crosshatch texture and its placement are very distinct in the high-resolution frames.
*   **Tilt Animation:** High. The movement of the rainbow sheen across the static texture is clearly visible across the sequential frames.
*   **Layer Structure Hypothesis:** Medium. This is a standard assumption for modern TCG foil manufacturing, but the exact physical process (embossing vs. etching) cannot be definitively proven from video alone.
*   **Distinguishing Features:** High. The pattern is highly unique compared to other standard foil types.
*   **Shader Notes:** High. The geometric nature of the pattern makes it straightforward to describe mathematically for a shader.