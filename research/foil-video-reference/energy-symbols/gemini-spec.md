## Cards Shown
*   **Steven's Advice** (Trainer - Supporter), EX Hidden Legends set.
*   Visible in all frames (1-8).

## Static Appearance
*   **Foil Location:** The holographic effect is restricted entirely to the background of the art window, behind the character (Steven). The character himself and the card borders are opaque.
*   **Elements:** The pattern consists of various distinct Pokémon Energy symbols (Grass leaf, Fire flame, Water drop, Lightning bolt, Psychic eye, Fighting fist, Colorless star, Darkness crescent, Metal triangle).
*   **Scale:** The symbols are relatively small, each taking up approximately 1/15th to 1/20th of the card's total width.
*   **Colors:** In any single frame, active symbols appear in bright, highly saturated colors (red, orange, yellow, green, blue, purple). The background space between the symbols remains dark and mostly unreflective.

## Tilt Animation
*   **Lighting and Masking:** As the card tilts, different areas of the art window background catch the light, revealing the energy symbols. The symbols act like windows to a bright, colorful layer, while the space between them remains dark.
*   **Color Shifting (Hue Rotation):** The color of the illuminated symbols changes dynamically based on the viewing angle and their position on the card. This is a classic holographic rainbow effect.
    *   Between **frame 3 and frame 5**, the Grass symbols on the left side transition from red (frame 3) to yellow/green (frame 4) to bright green (frame 5).
    *   Between **frame 6 and frame 8**, a clear spatial color gradient is visible. In frame 6, the left side is blue (Water), the middle is yellow/orange (Fire/Fighting), and the right is red (Metal). As the card tilts to frame 8, this gradient shifts: the left becomes orange (Lightning), the middle becomes red (Fire), and the right becomes purple (Psychic).
*   **Movement:** The symbols themselves do not move or exhibit parallax relative to each other; they are fixed in place. The *illumination* and *color bands* sweep across the surface of the card as the angle changes.

## Layer Structure Hypothesis
1.  **Card Stock:** The physical base of the card.
2.  **Holographic Foil Layer:** A specialized, bespoke foil layer. It is likely that the diffraction grating is stamped specifically in the shapes of the energy symbols, leaving the negative space flat/unreflective, OR the entire foil is a uniform rainbow grating.
3.  **Opaque Ink Layer (Base):** If the foil is uniform, a dark, opaque ink is printed over the foil to create the negative space, leaving the symbol shapes transparent. Given the crispness and the "bespoke" nature mentioned in the narration, it is highly probable the foil itself was manufactured with the pattern embedded.
4.  **Printed Art & Text:** The character (Steven), the card borders, and all text are printed with opaque inks on top of the foil/base layers, blocking the holographic effect in those areas.

## Distinguishing Features
*   **IP-Specific Shapes:** The most defining feature is the use of recognizable Pokémon Energy symbols, making it instantly distinguishable from generic foil patterns like stars, dots, or cracked ice.
*   **Discrete Elements vs. Continuous Sheen:** The foil effect is broken up into discrete, recognizable icons rather than a continuous field of glitter or a smooth, unbroken metallic sheen.
*   **High Contrast:** There is a very high contrast between the brightly lit, colorful symbols and the dark, unreflective background between them.

## Shader Notes
*   **Masking Texture:** The shader requires a mask texture (or a procedural SDF setup, though a texture is easier for complex shapes) containing the tiled layout of the various Energy symbols. The alpha channel of this texture will dictate where the foil effect is visible.
*   **Rainbow Gradient:** Implement a 1D color ramp (rainbow spectrum) to simulate the holographic color shifting.
*   **UV Distortion/Mapping:** Map the rainbow gradient across the card's UV space.
*   **Tilt Uniform:** Use a uniform representing the tilt angle (e.g., derived from the dot product of the view vector and the surface normal, or a simulated light vector) to offset the UV coordinates of the rainbow gradient. As the tilt value changes, the gradient should slide across the mask, causing the symbols to change color.
*   **Intensity Control:** Multiply the output of the rainbow gradient by the symbol mask. You may also want to modulate the overall brightness based on the tilt angle to simulate the symbols fading into darkness when not catching the light directly.

## Confidence
*   **Cards Shown:** High. The card name is clearly legible.
*   **Static Appearance:** High. The shapes and colors are distinct and easily identifiable.
*   **Tilt Animation:** High. The color shifting and spatial gradients are clearly visible across the sequence of frames.
*   **Layer Structure Hypothesis:** Medium. While the visual result is clear, the exact manufacturing technique (stamped foil vs. printed negative space mask) is an educated guess based on standard TCG printing practices and the visual evidence.
*   **Distinguishing Features:** High. The pattern is unique and explicitly identified by the creator.
*   **Shader Notes:** High. The visual behavior maps perfectly to standard shader techniques for masked holographic effects.