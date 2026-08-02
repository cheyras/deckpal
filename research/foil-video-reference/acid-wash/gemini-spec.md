## Cards Shown
*   **Water Energy**: The card is a basic Water Energy. The narration mentions this pattern is from "around 2006" and was "only ever applied to energy cards". This aligns with the EX series or Diamond & Pearl era energy cards. Visible in frames 1-7.
*   **Note**: Frame 8 shows the presenter and unrelated background items; it is excluded from the foil analysis.

## Static Appearance
The foil effect covers the entire background of the card, behind the central Water Energy symbol and text. The pattern itself does not consist of distinct geometric shapes (like stars or orbs). Instead, it looks like a continuous, fine-grained, irregular texture resembling etched metal, a sponge, or a mottled "acid wash" surface. The scale of the texture details is very small, creating a noisy, almost frosted appearance. The colors visible are highly iridescent, spanning blues, greens, yellows, and purples, depending on the light angle.

## Tilt Animation
As the card is tilted (observed across frames 1 through 7), the underlying mottled texture remains completely static relative to the card surface. What changes is a broad, soft sheen of light and color that sweeps across the texture. 
*   Between frame 1 and frame 2, a strong band of yellow and green light sweeps into the center of the card from the right.
*   Between frame 2 and frame 4, this bright band shifts leftward and transitions into cooler blue and purple hues.
*   Between frame 4 and frame 5, a new, intense band of green, yellow, and red appears on the right side.
*   By frame 7, a bright, almost white specular highlight hits the left side of the card.
The animation is characterized by smooth, broad color gradients moving across a static, rough-looking surface, rather than individual elements popping in and out. The texture acts like a complex surface normal map catching a directional light.

## Layer Structure Hypothesis
1.  **Card Stock**: The base physical layer.
2.  **Foil Layer**: A continuous metallic foil layer embossed or treated with a fine, high-frequency noise pattern to create the "acid wash" texture.
3.  **Ink Layer**: The card border, the word "ENERGY", and the central black and blue Water Energy symbol are printed opaquely over the foil, masking the effect in those areas. The background likely has a semi-transparent blue ink layer printed over the foil to give the card its base color, though the iridescent foil reflection often overpowers it.

## Distinguishing Features
This pattern is easily distinguished by its lack of discrete shapes. Unlike the Cosmos (stars/orbs) or Pixel patterns, the Acid Wash is a continuous, noisy texture. It differs from a flat mirror foil by having this distinct, fine-grained mottling that scatters the light, creating a frosted or etched look rather than a clean reflection.

## Shader Notes
*   **Texture Generation**: Use a high-frequency noise function, such as Fractional Brownian Motion (fBm) based on Simplex noise, to generate the base "acid wash" texture.
*   **Surface Normals**: Use the gradient of the noise function to perturb the surface normals of the card. This simulates the physical roughness of the foil.
*   **Lighting Model**: Implement a specular lighting model (like Blinn-Phong) using the perturbed normals and a directional light source driven by the tilt uniform.
*   **Iridescence**: Map the dot product of the view direction and the perturbed normal (or the reflection vector) to a 1D color ramp texture containing a full spectrum (red, yellow, green, blue, purple) to create the shifting iridescent colors.
*   **Roughness**: The specular highlight should be relatively broad (lower shininess exponent) to match the soft, scattered sheen seen in the frames, rather than a sharp, mirror-like reflection.
*   **Masking**: Use a texture mask to ensure the foil effect is only applied to the background, leaving the opaque printed elements (border, text, energy symbol) unaffected.

## Confidence
*   **Cards Shown**: High. The card is clearly legible as an Energy card.
*   **Static Appearance**: High. The continuous, noisy texture is clearly visible in all card frames.
*   **Tilt Animation**: High. The movement of the broad color sheen across the static texture is easily tracked across frames 1-7.
*   **Layer Structure**: Medium. Standard assumption for Pokemon cards, but the exact opacity of the background ink is inferred.
*   **Distinguishing Features**: High. The lack of geometric shapes makes it highly distinct.
*   **Shader Notes**: High. The visual behavior strongly maps to standard normal-mapping and iridescence shader techniques.