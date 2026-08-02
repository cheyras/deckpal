## Cards Shown
*   **Pidgeot**: Base Set 2 (indicated by the Pokeball '2' symbol visible in the bottom right of the art window in frame 5). Shown in frames 1, 2, 3, 4, and 5.
*   **Transition Frame**: Frame 6 shows a white background with faint logos, not a card.
*   **Dragonite**: Fossil set (confirmed by the PSA grading label which reads "1999 POKEMON FOSSIL DRAGONITE-HOLO COSMOS"). Shown in frames 7 and 8.

## Static Appearance
The holographic foil is restricted to the background of the art window, sitting behind the opaque printed Pokemon character. The pattern consists of distinct, solid circular shapes described in the narration as "pixelated orbs," along with smaller, scattered four-pointed stars or cross shapes. The orbs vary in size, with the largest being roughly 1/15th to 1/20th the width of the art window, down to tiny dots. The background behind the orbs appears dark and somewhat cloudy or space-like. When illuminated, the orbs exhibit bright, saturated colors like red, green, and yellow.

## Tilt Animation
As the card tilts, the primary effect is that specific clusters of orbs brighten and dim in place; they do not translate or move across the card surface. 
*   Between **frame 1 and frame 2**, a cluster of bright red/orange orbs located above Pidgeot's left wing fades out as the angle changes.
*   Between **frame 2 and frame 3**, a new cluster of orbs begins to light up in bright green above the center/right wing area.
*   Between **frame 3 and frame 4**, this green cluster reaches its peak brightness.
*   Between **frame 4 and frame 5**, the green cluster dims significantly, while other smaller, scattered dots begin to catch the light.
The animation feels like distinct layers or facets of the foil are catching the light at different, specific angles, causing elements to pop in and out smoothly rather than flashing abruptly.

## Layer Structure Hypothesis
1.  **Card Stock Base**: The physical cardboard.
2.  **Holographic Foil Layer**: A continuous sheet applied over the card base. This layer contains the physical micro-embossing that creates the "Cosmos" pattern (the orbs, stars, and potential swirls mentioned in the narration). The embossing is structured so that different discrete shapes reflect light at different angles.
3.  **Opaque Ink Layer**: Printed on top of the foil. This includes the yellow card borders, text, and the solid character art (Pidgeot/Dragonite).
4.  **Transparent/Semi-Transparent Ink Layer**: The dark, cloudy space background in the art window is likely printed with semi-transparent inks directly over the foil, allowing the holographic pattern to shine through while tinting the overall area.

## Distinguishing Features
The defining characteristic of the "Cosmos" pattern is the presence of distinct, solid "pixelated orbs" or circles of varying sizes. This distinguishes it from the older "star" pattern (which the narration notes is mistakenly called Galaxy), which primarily features scattered stars and a more uniform, grainy glitter effect without the prominent circular orbs. The narration also notes the presence of "swirls," which are highly sought after by collectors, though none are prominently visible in these specific frames.

## Shader Notes
*   **Orb Generation**: Use a cellular noise function (like Voronoi) to generate the centers of the orbs. Map the distance to the center to create solid circles rather than gradients.
*   **Activation Angles**: Assign a random 2D vector (representing an activation angle) to each generated orb cell.
*   **Tilt Interaction**: Pass a `u_tilt` uniform (2D vector) to the shader. Calculate the dot product between `u_tilt` and each orb's activation angle. Use this result to drive the opacity/brightness of the orb, creating the pop-in/pop-out effect.
*   **Color Mapping**: Assign a color to each orb. This could be random per cell or sampled from a color ramp based on the cell's activation angle, mimicking how the physical foil diffracts light into specific hues.
*   **Star Layer**: Add a secondary, sparser layer of small cross/star shapes with their own independent activation angles, overlaid on the orbs.
*   **Background**: Blend the holographic layers over a dark, cloudy base texture to represent the printed space background.

## Confidence
*   **Cards Shown**: High. Text and grading labels are clearly legible.
*   **Static Appearance**: High. The shapes and locations are clearly visible in the high-resolution frames.
*   **Tilt Animation**: High. The frame-by-frame progression clearly shows the stationary brightening and dimming of specific orb clusters.
*   **Layer Structure Hypothesis**: High. This is the standard manufacturing process for WotC-era holographic cards, consistent with visual evidence.
*   **Distinguishing Features**: Medium. Relies on the provided narration to contrast it with the "star" pattern and to note the existence of "swirls" not clearly seen here.
*   **Shader Notes**: High. The visual behavior maps well to standard procedural noise and angle-based activation techniques.