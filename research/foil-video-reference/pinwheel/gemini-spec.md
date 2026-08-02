## Cards Shown
*   **Shroomish** (EX Deoxys set, English). Visible in frames 1-3.
*   **Sylveon** (Simplified Chinese, Sun & Moon era layout). Visible in frames 4-8.

## Static Appearance
*   **Shroomish (Frames 1-3):** The foil is restricted to the character art window. It features a dense, repeating pattern of small, circular pinwheels or faceted gem shapes. It appears relatively flat and monochromatic (silver/greenish due to the card color).
*   **Sylveon (Frames 4-8):** The foil covers the entire card body outside the art window, acting as a "Reverse Holo". The pattern is a strict, regular grid of squares. Each square cell contains a "pinwheel" design made of alternating triangular wedges radiating from the center of the cell. Each square cell is approximately 1/10th the width of the card. The foil reflects strong, distinct rainbow colors (magenta, gold, green, blue).

## Tilt Animation
*   **Shroomish (Frames 1-3):** As the narration suggests, this older iteration is very static. Across the slight tilt in these frames, the pattern mostly just shifts in overall brightness without much internal animation.
*   **Sylveon (Frames 4-8):** The animation is highly dynamic. As the card tilts, a broad, diagonal rainbow sheen sweeps across the surface. Crucially, the individual wedges within each pinwheel cell react independently to the light angle. Because the wedges act like differently angled micro-facets, some wedges will brightly catch the rainbow light while adjacent wedges in the same cell remain dark. For example, between frame 5 and frame 7, as the rainbow band moves, the brightly illuminated wedges within specific cells shift to neighboring wedges, creating a flashing or "spinning" effect within the stationary grid.

## Layer Structure Hypothesis
1.  **Card Stock:** The physical paper base.
2.  **Holographic Foil Layer:** A metallic layer embossed or etched with the grid and pinwheel pattern. The etching creates distinct structural orientations for each wedge, resulting in anisotropic reflections (different parts reflect light at different angles). The foil itself is holographic, generating the rainbow spectrum.
3.  **Printed Ink Layer:** CMYK ink applied over the foil. Opaque white underprinting is used to block the foil entirely in areas like the text boxes and the main character art. The foil shines through the unprinted or transparently printed areas.

## Distinguishing Features
*   Defined by a rigid, repeating square grid.
*   Each grid cell contains a segmented, radiating pinwheel design.
*   Easily distinguished from smooth sheens or random glitter by the sharp, geometric flashing of the individual wedges within the cells as the light angle changes.

## Shader Notes
*   **Grid Coordinate System:** Multiply the base UV coordinates by a scale factor and use `fract()` to create the repeating square cells.
*   **Radial Segmentation:** Within each cell's local UV space (-0.5 to 0.5), use `atan(y, x)` to find the angle of the current pixel from the center.
*   **Wedge Indexing:** Quantize the angle (e.g., using `floor(angle / wedge_width)`) to assign an integer index to each wedge of the pinwheel.
*   **Anisotropic Normals:** Map each wedge index to a different simulated surface normal or reflection vector offset.
*   **Lighting & Color:** Calculate the reflection based on the tilt uniform and the wedge's specific normal. Use this reflection intensity to sample a rainbow color ramp (gradient texture or procedural palette) that moves diagonally across the global UV space based on the tilt.

## Confidence
*   **Cards Shown:** High. Text is clearly legible.
*   **Static Appearance:** High. The geometric structure is very clear, especially on the Sylveon card.
*   **Tilt Animation:** High. The independent flashing of the wedges is obvious across frames 4-8.
*   **Layer Structure Hypothesis:** Medium. This is the standard construction for such cards, but the exact micro-embossing technique is inferred from the visual behavior.
*   **Distinguishing Features:** High. The pattern is highly specific and recognizable.
*   **Shader Notes:** High. The mathematical approach to generating radial segments in a grid is standard shader practice.