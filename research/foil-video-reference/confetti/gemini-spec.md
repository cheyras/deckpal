## Cards Shown
*   **Charizard** (Celebrations Classic Collection, 25th Anniversary): Frames 1-7. The foil is restricted to the art window background.
*   **Bulbasaur** (McDonald's Collection 2021, 25th Anniversary): Frame 8. The foil covers the entire card face, including the borders and text areas.

## Static Appearance
The foil pattern consists of densely packed, irregular, small shapes resembling scattered confetti, shattered glass, or irregular polygons. The narration explicitly notes they are not square "pixels". The shapes vary slightly in size but are generally small (roughly 1-2% of the card width). In any single frame, a subset of these shapes is brightly illuminated in various rainbow colors (red, gold, green, blue, pink), while the rest remain dark or faintly silver. On the Charizard card, the pattern is confined to the background of the art window, behind the character. On the Bulbasaur card, the pattern is applied across the entire card face.

## Tilt Animation
As the card is tilted, the illumination of the confetti pieces changes dynamically. 
*   **Flashing/Sparkling:** Individual confetti pieces pop in and out of visibility abruptly rather than fading smoothly. For instance, between frame 2 and frame 4, a bright cluster of gold/green pieces near Charizard's left wing dims, while new pieces near the top right corner light up.
*   **Color Shifting:** When a piece is illuminated, its color shifts through the rainbow spectrum as the angle changes. A piece might appear green in frame 3 and shift to yellow/orange by frame 5 before going dark.
*   **Scattered Activation:** The pattern does not move as a cohesive wave or band. Instead, random, scattered pieces across the foil area light up simultaneously based on the light angle, creating a chaotic, glittering effect.

## Layer Structure Hypothesis
1.  **Foil Base:** A holographic foil layer where the "confetti" pattern is physically embossed or etched. Each irregular shape likely contains a diffraction grating oriented at a slightly different, randomized angle.
2.  **Opaque Ink Layer:** Printed on top of the foil. For the Charizard, opaque ink is used for the card borders, text areas, and the Charizard character itself, completely blocking the foil.
3.  **Transparent/Semi-Transparent Ink Layer:** For the Charizard's background, no ink or transparent ink is used, allowing the foil to shine through. For the Bulbasaur, semi-transparent inks are likely used across the whole card to tint the foil while letting the pattern remain visible everywhere.

## Distinguishing Features
*   **Irregular Shapes:** The defining feature is the irregular, non-geometric shape of the individual flakes, distinguishing it from uniform dot patterns, square pixel patterns, or distinct icons like stars or energy symbols.
*   **Chaotic Sparkle:** The lack of a unified sheen band or sweeping gradient; the light activates scattered, discrete flakes independently.
*   **Rainbow Spectrum:** The flakes reflect full rainbow hues rather than just silver or a single color.

## Shader Notes
*   **Cellular Noise:** Use a Voronoi or cellular noise function to generate the irregular, non-overlapping confetti shapes.
*   **Randomized Flake Angles:** Assign a random, constant value (e.g., a hash based on the cell ID) to each Voronoi cell to represent its unique "tilt angle" or grating orientation.
*   **Activation Threshold:** Compare the dot product of the view vector and light vector against the cell's random value. Use a tight `step` or `smoothstep` function to make the flakes pop on and off abruptly.
*   **Color Mapping:** When a cell is activated, map the view/light angle combined with the cell's random value into a 1D rainbow texture or an HSV-to-RGB function to determine its color.
*   **Masking:** Use a texture mask to define where the foil is visible (e.g., only the art window for Charizard, or full card with varying opacity for Bulbasaur).

## Confidence
*   **Cards Shown:** High. The names and 25th-anniversary stamps are clearly legible, and the narration confirms the sets.
*   **Static Appearance:** High. The irregular shapes and colors are clearly visible in the high-resolution frames.
*   **Tilt Animation:** High. The frame sequence provides a clear view of how the flakes activate and change color.
*   **Layer Structure:** High. This aligns with standard, well-documented trading card manufacturing processes.
*   **Distinguishing Features:** High. The narration specifically contrasts it with pixel patterns, confirming the visual evidence.
*   **Shader Notes:** High. Voronoi noise is the standard mathematical approach for generating this type of irregular, faceted glitter effect.