Here is an implementation-grade specification of the "Pokeball hologram" foil pattern based on the provided frames and narration.

## Cards Shown
*   **Cyclone Energy**: Special Energy card from the EX Unseen Forces set (indicated by the set symbol in the bottom right corner of the art box and confirmed by narration). Visible in all frames (1-8).

## Static Appearance
*   **Elements**: The pattern consists entirely of Pokeball shapes of varying sizes.
*   **Scale**: The largest Pokeballs are approximately 1/15th the width of the card, while the smallest appear as tiny specks.
*   **Colors**: The Pokeballs exhibit iridescent colors, primarily bright greens, blues, and reds/oranges, depending on the light angle.
*   **Location**: This is a "reverse holo" style treatment where the foil pattern covers the entire face of the card, showing through the background art (the swirling vortex) but masked out by the opaque text boxes at the top and bottom. The foil also shows through the "ENERGY" text at the top left.

## Tilt Animation
*   **Visibility & Brightness**: As the card tilts from a steep angle (Frame 1) to a more direct angle (Frame 3), the Pokeballs transition from mostly invisible/dark to brightly illuminated. A broad, soft sheen passes over the card (visible in Frame 2) before the individual elements pop.
*   **Color Shift**: The colors of individual Pokeballs shift as the angle changes. For example, the large Pokeball just above and to the left of the central star symbol is mostly green with a red bottom in Frame 3, but shifts to a cooler green/blue mix by Frame 5.
*   **Parallax/Depth**: The narration explicitly states this is a true hologram with a 3D effect, where some Pokeballs appear "deep inside" and others "floating above." While difficult to fully appreciate in 2D stills, the varying sizes and the way different Pokeballs catch the light at slightly different angles (e.g., comparing the cluster in the top right between Frames 4 and 6) supports this multi-layered depth effect.
*   **Seam Line**: As highlighted in the narration, a distinct horizontal "seam" or line is visible running across the middle of the card (clearly visible in Frames 4-8, passing through the central energy symbol). This is an artifact of the foil manufacturing process for this specific set.

## Layer Structure Hypothesis
1.  **Card Stock**: The base physical material.
2.  **Holographic Foil Layer**: A true holographic foil layer containing the 3D Pokeball pattern. This layer has actual optical depth encoded into it, creating the parallax effect. It also contains the horizontal seam artifact.
3.  **Opaque Ink Layer (Base)**: White ink printed to block the foil in areas like the text boxes and the central black star symbol.
4.  **Translucent Ink Layer (Art)**: The swirling purple, blue, and green vortex art is printed with semi-transparent inks directly over the foil, tinting the light that reflects off the Pokeballs beneath.
5.  **Opaque Ink Layer (Text/Details)**: Black text, borders, and set symbols printed on top.

## Distinguishing Features
*   **Specific Motif**: The use of recognizable Pokeball shapes rather than generic geometric shapes (stars, dots, cosmos).
*   **True 3D Depth**: Unlike standard flat foil patterns that just reflect light, this pattern has optical depth (parallax) where elements appear to exist on different Z-planes.
*   **Manufacturing Seam**: The presence of a horizontal print line/seam across the foil, which the creator notes is characteristic of this specific EX Unseen Forces pattern.

## Shader Notes
*   **Parallax Mapping**: The core of this shader requires a multi-layered approach. You need to define several "planes" of Pokeballs at different virtual Z-depths.
*   **Tilt-Driven Offset**: Use the tilt uniform (derived from the view vector) to offset the UV coordinates of each layer differently. Layers "deep inside" move less, while layers "floating above" move more relative to the camera movement.
*   **SDF Pokeballs**: Generate the Pokeball shapes using Signed Distance Fields (SDFs) to keep the shader procedural and resolution-independent.
*   **Iridescence/Color Ramp**: Map the view angle (dot product of normal and view vector) to a color ramp (red -> green -> blue) to colorize the Pokeballs.
*   **Masking**: Implement a mask texture to ensure the foil effect only appears in the background art areas and the "ENERGY" text, leaving the text boxes matte.
*   **Seam Artifact (Optional)**: To be perfectly accurate to the physical card, add a subtle, static horizontal line across the middle of the UV space that slightly disrupts the foil reflection.

## Confidence
*   **Cards Shown**: High. The card name and set are clearly visible and confirmed by narration.
*   **Static Appearance**: High. The shapes, scale, and location are clearly visible across multiple frames.
*   **Tilt Animation**: Medium. The color shifts and brightness changes are visible, but the true 3D parallax effect is hard to verify purely from stills, relying heavily on the creator's narration.
*   **Layer Structure Hypothesis**: High. Standard reverse holo construction combined with the visual evidence of opaque vs. translucent areas.
*   **Distinguishing Features**: High. The Pokeball shapes and the seam are unique identifiers.
*   **Shader Notes**: High. The required techniques (parallax, SDFs, iridescence) directly map to the observed visual phenomena.