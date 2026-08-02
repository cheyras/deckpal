Here is the implementation-grade spec for the "Cracked Ice" foil pattern based on the provided frames and transcript.

## Cards Shown
*   **Raichu LV.39** (Diamond & Pearl era, likely a theme deck exclusive based on the transcript): Frames 1-5.
*   **Crobat** (Skyridge set, Crystal Type): Frames 6-8. The transcript notes this pattern was first used on "acrylic oversized box toppers from Skyridge"; this may be one of those oversized cards, though scale is difficult to judge definitively from the hands alone.

## Static Appearance
The foil pattern consists of irregular, sharp-edged, polygonal shapes that resemble shards of shattered glass or cracked ice. 
*   **Scale:** The shards vary significantly in size; some of the larger shards span roughly 10-15% of the card's width, while others are much smaller slivers.
*   **Colors:** The active shards reflect bright, saturated iridescent colors, primarily greens, oranges, reds, and blues, against a generally silver/metallic background.
*   **Location:** On the Raichu (Frames 1-5), the foil covers the entire background of the card, including behind the attack text, leaving only the Pokémon illustration and the card borders opaque. On the Crobat (Frames 6-8), the foil is visible in the art window background and throughout the lower text box.

## Tilt Animation
As the card is tilted, the individual shards do not move across the surface; rather, they act as static, faceted mirrors that catch the light at different angles.
*   **Brightening/Dimming:** Entire individual shards flash "on" (brightly colored) and "off" (dark or neutral silver) abruptly as the angle changes. 
*   **Frame Comparisons:** 
    *   Between Frame 1 and Frame 2, a cluster of shards in the lower right of the Raichu card shifts from bright orange/green to a dimmer state, while a shard slightly higher up catches the light.
    *   Between Frame 3 and Frame 4, a large shard near the center of the Raichu's text box flashes brightly with green and orange, then dims as the tilt continues.
    *   On the Crobat, between Frame 6 and Frame 7, the active reflections shift from the bottom right corner of the text box towards the center, illuminating different polygonal facets.
*   **Color Shift:** The color of an active shard can shift slightly (e.g., from green to orange) as the angle changes before the shard goes dark, indicating a hue-dependent reflection angle.

## Layer Structure Hypothesis
*   **Base Layer:** A foil substrate embossed or imprinted with a faceted, polygonal pattern. Each "shard" in the pattern likely has a slightly different, uniform microscopic grating angle or physical tilt relative to the card's flat plane.
*   **Ink Layer:** Opaque CMYK ink is printed over the foil to create the borders, text, and the main Pokémon subject, completely blocking the foil effect in those areas. Semi-transparent inks may be used in the background areas to tint the underlying silver foil.

## Distinguishing Features
*   This pattern is easily distinguished by its sharp, straight-edged, irregular polygonal shapes.
*   It lacks the smooth curves of orb/bubble patterns, the continuous gradients of sheen bands, and the tiny, scattered points of starlight/glitter patterns.
*   The animation is characterized by discrete, flat areas flashing on and off, rather than a continuous wave of light moving across the card.

## Shader Notes
*   **Cell Noise / Voronoi:** The core of the shader should rely on a Voronoi or cell noise function to generate the irregular polygonal shards. Use the cell ID (rather than the distance field) to assign properties to each shard.
*   **Randomized Normals:** Assign a random, constant normal vector to each individual cell ID. This simulates the faceted nature of the cracked ice.
*   **Lighting Calculation:** Calculate the reflection based on the dot product of the view vector, the light vector, and the cell's assigned normal.
*   **Thresholding:** Apply a tight threshold to the reflection calculation so that shards appear to flash "on" abruptly when the angle is just right, rather than fading in smoothly.
*   **Iridescence:** Map the reflection intensity or the angle of incidence to a color ramp (rainbow gradient) to produce the observed green/orange/blue flashes.
*   **Masking:** Use a texture mask to define where the foil effect is visible (backgrounds) versus where it is blocked by opaque ink (character, borders).

## Confidence
*   **Cards Shown:** High. Card names are clearly legible.
*   **Static Appearance:** High. The shard shapes are very distinct in the high-resolution frames.
*   **Tilt Animation:** High. The flashing behavior of individual facets is clearly visible across the frame sequences.
*   **Layer Structure:** Medium. This is the standard construction for such cards, though the exact physical method of creating the facets (embossing vs. holographic film) cannot be determined purely visually.
*   **Distinguishing Features:** High. The "cracked ice" look is highly specific.
*   **Shader Notes:** High. Voronoi cell noise is the standard and most effective mathematical approach to replicating this specific geometric pattern.