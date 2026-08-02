## Cards Shown
*   **Raw Foil Sheet**: A blank, unprinted piece of the holographic foil material. Visible in frames 1-3.
*   **Rhyperior**: Stage 2, 160 HP. Based on the card layout and the narrator's mention of the "Sun and Moon holo pattern," this is from the Sun & Moon era. Visible in frames 4-8.

## Static Appearance
The foil pattern consists of large, organic, fluid shapes that resemble rippling water, flowing liquid, or an "oil slick" (as noted in the narration). There are no distinct geometric shapes like stars or dots. The "waves" or "pools" are relatively large, with major contours spanning roughly 1/4 to 1/2 of the card's width. The colors observed are a full, vibrant rainbow spectrum (bright greens, pinks, yellows, blues) that pool and stretch along the contours of the fluid shapes. On the printed Rhyperior card, this foil pattern is restricted entirely to the background of the art window, behind the character and action lines.

## Tilt Animation
As the card is tilted, the physical structure of the "waves" remains stationary, but the rainbow colors flow smoothly across them, highlighting different contours. 
*   On the raw sheet (frames 1-3), a prominent bright green/yellow band shifts from the center-right (frame 1) up towards the top edge (frame 2), and then the colors redistribute as the angle changes further (frame 3). The colors appear to slide along the ridges and valleys of the pattern.
*   On the printed card (frames 4-8), the effect is similar but constrained to the art window. In frame 4, the foil is relatively dark. By frame 5, a bright green/yellow reflection appears on the right side. As the tilt continues (frames 6-8), this reflection shifts in hue (becoming pink/red in frame 7) and moves across the background, revealing a sweeping rainbow band (blue to green to yellow) in frame 8. The animation is a smooth, continuous color shift across a fixed topographical map, rather than elements popping in and out.

## Layer Structure Hypothesis
1.  **Base Foil Layer**: A metallic foil layer embossed or structured with the wavy, fluid "water web" pattern. This structure dictates how light reflects off different parts of the surface.
2.  **Opaque Ink Layer**: Printed over the foil. This layer forms the yellow card border, text areas, and the Rhyperior character itself, completely blocking the foil underneath.
3.  **Transparent/Semi-Transparent Ink Layer**: In the background of the art window, ink is either absent or printed semi-transparently to allow the foil pattern to shine through and interact with the printed background colors.

## Distinguishing Features
This pattern is highly distinct due to its organic, fluid nature. It is easily distinguished from particle-based patterns (like Cosmos or Starlight, which use dots and stars) and geometric patterns (like straight horizontal/vertical lines or shattered ice). Its closest lookalike might be a generic "swirl" pattern, but the Water Web is characterized by broader, more interconnected, and less uniform ripples, truly resembling a disturbed liquid surface.

## Shader Notes
*   **Base Structure**: Use a low-frequency, smooth noise function (like Simplex noise or domain-warped noise) to generate the underlying fluid topography.
*   **Surface Normals**: Calculate normals based on the gradient of this noise function to simulate the ridges and valleys of the "water."
*   **Iridescence**: Implement a color ramp (rainbow spectrum) that is sampled based on the dot product of the view vector, the light vector, and the calculated surface normal.
*   **Tilt Uniform**: The tilt uniform (representing the physical rotation of the card) should rotate the simulated light vector or view vector. This will cause the iridescent colors to sweep smoothly across the noise-generated contours.
*   **Masking**: A texture mask is required to confine the shader effect strictly to the background of the art window, leaving the character and card borders unaffected.

## Confidence
*   **Cards Shown**: High. The text on the Rhyperior card is clearly legible.
*   **Static Appearance**: High. The fluid shapes and colors are very clear on both the raw sheet and the printed card.
*   **Tilt Animation**: High. The sequence of frames provides a clear view of how the light interacts with the pattern during a tilt.
*   **Layer Structure Hypothesis**: High. This follows the standard, well-understood manufacturing process for this era of Pokemon cards.
*   **Distinguishing Features**: High. The pattern is unique and easily identifiable.
*   **Shader Notes**: Medium. While the general approach (noise-based normals + iridescence) is correct, tuning the specific noise parameters to exactly match the "Water Web" look will require iteration.