Here is the implementation-grade specification for the "Cosmos III" (Smooth/HD Cosmos) holofoil pattern, based on the provided frames and narration.

## Cards Shown
*   **Raw Foil Sheet / Blank Card:** Frames 1-3 show a blank, unprinted card or raw foil sheet demonstrating the pattern. Frames 6-8 show an extreme macro close-up of this same material.
*   **Presenter / B-Roll:** Frames 4-5 show the presenter talking, with a Base Set Charizard on the wall and a generic Pokémon TCG box on the desk. These frames do not demonstrate the foil pattern being analyzed.

## Static Appearance
The pattern is a full-field holographic effect (demonstrated on a blank sheet, so it would cover the entire card or designated foil areas). It consists entirely of smooth, perfectly circular "orbs" and smaller dots. The pixelated edges and star shapes seen in older Cosmos variations are completely absent. The orbs vary in size, with the largest being roughly 2-3% of a standard card's width, down to tiny specks. In a static frame (like frame 1 or 6), only a subset of these orbs is illuminated, showing bright, saturated colors (greens, blues, yellows, reds) against a darker, slightly textured metallic background.

## Tilt Animation
The animation is driven by the angle of light hitting the fixed orbs. The orbs themselves do not translate across the surface; rather, their brightness and color change as the card tilts.
*   **Flashing/Popping:** Between frames 1, 2, and 3, different clusters of orbs light up and then dim. For example, a bright green cluster on the right side in frame 1 fades significantly by frame 3, while other dots become more prominent.
*   **Sweeping Highlight:** In the macro sequence (frames 6 to 8), a vertical band of specular reflection sweeps from right to left across the foil surface. As this band passes over the orbs, they "activate," flashing brightly with rainbow colors.
*   **Color Shift:** The color of an individual orb changes depending on the viewing angle. In frame 6, an orb might appear blue, but as the light shifts in frames 7 and 8, it may transition through the spectrum or fade out entirely. The transition is smooth, matching the "HD" description.

## Layer Structure Hypothesis
1.  **Base Layer:** A reflective, metallic substrate that provides the underlying dark/silver sheen and the sweeping specular highlight seen in the macro shots.
2.  **Holographic Embossing:** A layer containing the microscopic structures that create the orb patterns. Each orb likely consists of a specific diffraction grating angled differently from its neighbors, causing them to catch the light and diffract specific wavelengths (colors) at different macroscopic tilt angles.
3.  **Printed Ink (Not shown):** On a real card, opaque and semi-transparent inks would be printed over this foil sheet to create the card art, borders, and text, masking out the foil where it shouldn't be visible.

## Distinguishing Features
*   **Smooth Orbs:** The defining feature is the perfectly round, smooth edges of the circles, lacking any of the blocky, pixelated look of earlier Cosmos patterns.
*   **No Stars:** Unlike Galaxy Foil or Cosmos I/II, there are no four-pointed or multi-pointed star shapes mixed in.
*   **High Density:** The pattern is densely packed with dots and orbs of varying sizes.
*   **Lookalikes:** It is an evolution of "Pixel Cosmos" (Cosmos I/II), distinguished entirely by the smoothness of the shapes.

## Shader Notes
*   **Base Sheen:** Implement a standard anisotropic or metallic specular highlight that sweeps across the UV space based on the tilt uniform (simulating the light band in frames 6-8).
*   **Orb Generation:** Use a Voronoi or cellular noise function to generate the positions and radii of the circles. Ensure the distance metric creates perfectly smooth circles (Euclidean distance).
*   **Tilt Offset Map:** Assign a random scalar value (0.0 to 1.0) to each generated circle. This acts as an angular offset.
*   **Activation Logic:** An orb "lights up" when the global tilt uniform aligns with its specific random offset. Use a `smoothstep` function to make the orbs fade in and out smoothly rather than snapping on/off.
*   **Color Mapping:** When an orb is active, map its color using a 1D rainbow gradient texture or a procedural hue function (like `hsv2rgb`), driven by the difference between the tilt uniform and the orb's offset.
*   **Anti-aliasing:** Ensure the edges of the circles are calculated using `fwidth` or smoothstep based on screen-space derivatives to maintain the "HD/Smooth" look and prevent jagged edges.

## Confidence
*   **Cards Shown:** High. The blank sheet is clearly visible.
*   **Static Appearance:** High. The smooth orbs are very distinct in the macro shots.
*   **Tilt Animation:** High. The sweeping light and popping orbs are clearly demonstrated in the frame sequences.
*   **Layer Structure Hypothesis:** Medium. Standard holographic printing techniques apply, but exact physical manufacturing is inferred.
*   **Distinguishing Features:** High. The narration explicitly points out the differences, which are corroborated by the visuals.
*   **Shader Notes:** High. The visual behavior translates well to standard procedural shader techniques for circles and noise.