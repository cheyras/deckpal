## Cards Shown
*   **Turbopflaster** (German print of Turbopatch), Darkness Ablaze 200/189, Gold Secret Rare. 
*   Appears in frames 1-8.

## Static Appearance
*   **Foil Location:** The foil treatment covers the entire face of the card, serving as the background for the text and central artwork.
*   **Base Texture:** The background has a fine, grainy, almost sand-blasted gold texture.
*   **Radial Lines:** A prominent "sunburst" pattern of thick, straight rays emanates from the bottom center of the card (behind the effect text) and extends outward to the edges.
*   **Sparkles:** Scattered across the gold background are distinct holographic sparkles. These consist of small dots and larger, sharp four-pointed stars.
*   **Central Art:** The central graphic (a ring of energy symbols) lacks the grainy gold texture and instead features a smooth, iridescent rainbow gradient overlay.

## Tilt Animation
*   **Broad Sheen:** A large, soft-edged specular highlight (glare) sweeps across the card surface based on the angle to the light. Between frame 1 and frame 4, as the card tilts up, this intense white/gold glare moves from the bottom edge to the dead center of the card. By frame 6 (tilted left), the glare shifts to the left edge.
*   **Radial Line Modulation:** The sunburst lines do not physically move or parallax, but their contrast changes dynamically. Between frame 3 and frame 4, the lines intersecting the central glare become intensely bright, while lines outside the glare remain darker and more subtle.
*   **Sparkle Activation:** The scattered stars and dots pop in and out of visibility abruptly. When they catch the light, they flash with intense, saturated chromatic colors (pink, green, blue, gold). For example, between frame 3 and frame 5, a cluster of sparkles in the bottom right corner transitions from nearly invisible to bright, multi-colored points of light.
*   **Central Art Iridescence:** The rainbow sheen on the central energy symbols shifts smoothly. Between frame 3 and frame 7, the distribution of pink, yellow, and blue hues across the symbols gently rotates and changes intensity as the viewing angle changes.

## Layer Structure Hypothesis
1.  **Foil Substrate:** A holographic foil base layer that contains the fine grainy texture and the physical embossing/etching for the scattered four-pointed stars and dots. This layer provides the chromatic sparkle effect.
2.  **Translucent Ink Layer (Gold/Rays):** A layer of translucent yellow/gold ink printed over the foil. The radial sunburst pattern is likely created by varying the opacity of this gold ink (thinner ink for bright rays, thicker for dark gaps), allowing the foil underneath to shine through to different degrees.
3.  **Opaque/Semi-Opaque Ink Layer:** The text, borders, and the base colors of the central energy symbols. The central symbols are printed with semi-opaque inks to allow a smooth holographic sheen to show through, but they block the grainy texture and sunburst pattern.
4.  **Gloss Coating:** A standard glossy finish on top, responsible for the broad, soft white glare seen in frame 4.

## Distinguishing Features
*   **Gold Dominance:** Unlike standard rainbow or silver secret rares, the entire background is heavily tinted gold.
*   **Sunburst + Sparkle Combo:** The specific combination of a static radial sunburst pattern overlaid with scattered, chromatically flashing four-pointed stars is the hallmark of Sword & Shield era Gold Secret Rares.
*   **Lookalikes:** This pattern is identical to other SWSH Gold Secret Rares (e.g., Quick Ball, Path to the Peak). It differs from Sun & Moon era gold cards, which typically featured a more uniform, fingerprint-like ridge texture rather than the sunburst/sparkle combination.

## Shader Notes
*   **Base Color & Texture:** Use a base gold color (e.g., `vec3(0.9, 0.75, 0.2)`). Multiply this by a high-frequency noise function to simulate the fine, grainy foil texture.
*   **Radial Rays:** Generate the sunburst using `atan(uv.y - origin.y, uv.x - origin.x)` where `origin` is roughly `vec2(0.5, 0.1)`. Pass the result through a `sin` function and a `smoothstep` to create alternating thick rays and gaps. Multiply this over the base gold texture.
*   **Sparkle Mask:** Use a cellular noise (Voronoi) function with a high threshold to isolate small points. For the stars, stretch the UVs along the X and Y axes before applying the noise to create four-pointed shapes.
*   **Sparkle Color:** For pixels inside the sparkle mask, apply a view-dependent hue shift. Use `fract(dot(viewDir, normal) * frequency + randomOffset)` to map to a rainbow color palette, ensuring they flash pink/green/blue as the tilt uniform changes.
*   **Central Art Mask:** Require a separate texture mask for the central art window. In this area, bypass the gold color, radial rays, and grainy texture, and instead apply a smooth, low-frequency iridescent gradient (`uv.x + uv.y + tilt`) multiplied by the base texture color.
*   **Specular Sheen:** Add a broad, soft specular highlight (Phong or Blinn-Phong) driven by the tilt uniform to simulate the glossy surface glare sweeping across the card.

## Confidence
*   **Cards Shown:** High. Explicitly identified in the prompt and clearly visible.
*   **Static Appearance:** High. The visual elements are large, distinct, and well-lit across multiple frames.
*   **Tilt Animation:** High. The 8 frames provide a clear, consecutive sweep of motion that perfectly demonstrates the glare movement and sparkle activation.
*   **Layer Structure Hypothesis:** Medium. While standard for TCG manufacturing, determining exactly what is embossed in the foil vs. printed in translucent ink requires physical inspection, though the visual evidence strongly supports this stack.
*   **Distinguishing Features:** High. The SWSH gold pattern is highly standardized and easily recognizable.
*   **Shader Notes:** High. The observed phenomena map directly to standard, well-understood shader techniques (radial math, Voronoi noise, view-dependent iridescence).