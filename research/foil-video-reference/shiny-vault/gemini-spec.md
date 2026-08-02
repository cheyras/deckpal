## Cards Shown
*   **Left:** Buzzwole (SV24/SV94), Hidden Fates Shiny Vault. This is a "baby shiny" with standard yellow borders. Visible in frames 1-8.
*   **Right:** Ho-Oh GX (SV50/SV94), Hidden Fates Shiny Vault. This is a full-art GX card. Visible in frames 1-8.

## Static Appearance
The foil treatment consists of a smooth, continuous diagonal rainbow gradient (sheen) overlaid with scattered, soft-edged 4-point stars (or flares). 
*   **Elements:** The stars have a bright, dense core with four tapering arms (top, bottom, left, right) that fade smoothly into the background. They are relatively large, with the arm-to-arm span taking up roughly 15-20% of the card's width.
*   **Placement:** On the left card (Buzzwole), the foil is strictly confined to the rectangular art window. On the right card (Ho-Oh GX), the foil covers the entire card face, though it is most visible in the background behind the character art.
*   **Colors:** The background reflects a full spectrum of colors (red, orange, yellow, green, blue, purple) in broad, diagonal bands.

## Tilt Animation
As the cards tilt, the primary movement is the sweeping of the diagonal rainbow bands across the surface, which in turn illuminates the static star elements.
*   **Sheen Sweep:** The rainbow gradient shifts smoothly across the card. For example, in **frame 1**, a blue/green band is visible across the middle of the Ho-Oh card. By **frame 4**, this band has shifted downward and to the right, replaced by warmer orange/yellow tones at the top. By **frame 8**, both cards are dominated by orange and yellow hues.
*   **Star Illumination:** The stars themselves do not move (no parallax or floating); they are fixed to the background. However, they change color and apparent brightness as the rainbow sheen passes over them. 
*   **Specific Examples:** In **frame 3**, the prominent star in the top-left background of the Ho-Oh card is illuminated in a light blue/cyan. As the tilt progresses to **frame 5**, that exact same star transitions to a bright yellow/green. On the Buzzwole card, a star in the bottom right of the art window is barely visible initially, but brightens significantly by **frame 6** as the sheen hits it.

## Layer Structure Hypothesis
1.  **Base Foil:** A flat, highly reflective silver holographic layer that naturally produces the broad, diagonal rainbow diffraction.
2.  **Etched Pattern:** The 4-point stars are likely etched or stamped directly into the foil layer. This alters the angle of reflection at those specific coordinates, causing the stars to "catch" the light and appear brighter than the surrounding flat foil when the angle is right.
3.  **Ink Layer (Opaque):** Heavy, opaque inks are printed over the foil to create the yellow borders, text boxes, and the core body of the Buzzwole character (left).
4.  **Ink Layer (Transparent/Semi-transparent):** The backgrounds of both cards (the pale, stylized environments) are printed with semi-transparent inks, allowing the foil's rainbow sheen and etched stars to shine through.

## Distinguishing Features
*   **Soft 4-Point Stars:** Unlike the sharp, dense, multi-pointed stars of the classic "Cosmos" foil, or the tiny speckles of modern reverse holos, this pattern uses large, sparse, soft-edged 4-point flares.
*   **Smooth Diagonal Sheen:** The background rainbow effect is a smooth, broad diagonal sweep, distinguishing it from shattered glass (Ice foil) or vertical pillar patterns.
*   **Fixed Position:** The stars do not float or exhibit parallax; they are anchored to the card surface and simply act as localized brightness/color multipliers.

## Shader Notes
*   **Base Gradient:** Implement a diagonal linear gradient across the `uv` space to sample a 1D rainbow color ramp texture (or calculate procedurally via `cos` functions).
*   **Tilt Uniform:** Use a `vec2 tilt` uniform to offset the phase of the diagonal gradient, simulating the sweeping sheen.
*   **Star Mask (SDF):** Generate the stars using a 2D Signed Distance Field (SDF) for 4-point crosses. Use `smoothstep` to create the soft, fading arms and bright cores. Alternatively, use a static grayscale texture mask.
*   **Blending:** Multiply the star mask by a brightness scalar and add it to the base rainbow gradient. The stars should sample the *same* color ramp as the background but at an amplified intensity.
*   **Application Masking:** Require a separate `foil_mask` texture to define where the shader is active (e.g., 1.0 in the art window, 0.0 on the borders for the baby shiny; 1.0 on the background, 0.2 on the character for the full art).

## Confidence
*   **Cards Shown:** High. Explicitly identified in the prompt and visually confirmed.
*   **Static Appearance:** High. The stars and diagonal sheen are clearly visible across all frames.
*   **Tilt Animation:** High. The color shifting on specific stars (e.g., frames 3 to 5) provides clear evidence of the animation mechanics.
*   **Layer Structure Hypothesis:** Medium. While standard for Pokemon cards, the exact physical etching method for the stars is an educated guess based on visual behavior.
*   **Distinguishing Features:** High. The visual signature of the Hidden Fates Shiny Vault background is distinct and well-documented.
*   **Shader Notes:** High. The mathematical approach to recreating this specific visual effect (SDF stars + sweeping gradient) is standard graphics programming practice.