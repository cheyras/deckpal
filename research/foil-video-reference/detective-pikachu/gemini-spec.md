## Cards Shown
*   **Charizard** (Detective Pikachu 5/18, 2019 movie set). Visible in all frames (1-8).

## Static Appearance
*   **Location:** The holographic effect is strictly confined to the rectangular artwork window at the top half of the card. The yellow borders, text areas, and the physical body of the Charizard character within the art appear mostly opaque and non-holographic.
*   **Shapes:** There are no discrete shapes, particles, stars, or cells. The pattern consists entirely of broad, soft, diagonal bands of light (a "sheen").
*   **Scale:** The bands of light are wide, with a single band covering approximately 30% to 50% of the artwork window's width at any given time. The angle of the diagonal sheen is roughly 45 degrees (bottom-left to top-right).
*   **Colors:** The bands display a smooth, continuous iridescent rainbow spectrum, prominently featuring magenta, cyan, bright green, and yellow.

## Tilt Animation
*   **Movement:** As the card tilts, a broad diagonal band of iridescent light sweeps horizontally across the background of the artwork window.
*   **Direction & Speed:** The light band moves smoothly from the right side of the art window to the left side across the sequence.
    *   In **Frames 1-2**, a strong pink/purple and orange reflection sits on the far right side of the art box.
    *   Between **Frame 3 and Frame 5**, this band shifts toward the center, transitioning in color to reveal bright cyan, green, and yellow trailing behind it.
    *   Between **Frame 6 and Frame 8**, the primary band of light continues its sweep to the left edge of the artwork, dominated by bright green and yellow hues, while the right side of the art window returns to its darker, unlit printed state.
*   **Parallax:** None observed. The light sweeps flatly across the 2D plane of the card.
*   **Subject Masking:** The foil effect appears to pass *behind* the Charizard figure. The character itself does not reflect the rainbow sheen, indicating the foil is masked by opaque ink printed over the subject.

## Layer Structure Hypothesis
1.  **Base Foil Layer:** A flat holographic foil substrate featuring a linear/diagonal diffraction grating that produces a smooth rainbow sheen when light hits it at varying angles.
2.  **White Ink Mask (Opaque):** Printed over the foil to block the holographic effect on the card borders, text areas, and the main body of the Charizard.
3.  **CMYK Print Layer:** The actual artwork and card text. The background of the artwork window is printed with semi-transparent inks (or halftones with no white under-base) to allow the foil layer to shine through.
4.  **Gloss/Finish Layer:** A standard smooth topcoat.

## Distinguishing Features
*   **Smooth Diagonal Sheen:** This is a classic "line holo" or "sheen" effect, distinct from "cosmos" (stars/orbs), "cracked ice" (geometric shards), or "pixel" patterns. It lacks any granular or particulate texture.
*   **Windowed:** The effect is strictly bounded by the art box, distinguishing it from "reverse holo" (where everything *but* the art is foil) or "full art" cards.

## Shader Notes
*   **UV Masking:** Require a rectangular mask based on UV coordinates to restrict the shader effect exclusively to the artwork window.
*   **Subject Masking (Alpha):** Provide a grayscale texture mask where the Charizard is black (0.0) and the background is white (1.0) to multiply against the foil output, keeping the character matte.
*   **Base Sheen Function:** Use a dot product of the UV coordinates and a diagonal vector (e.g., `vec2(0.707, 0.707)`) to create a slanted linear gradient.
*   **Tilt Integration:** Add the tilt uniform (representing the angle of incidence) to the output of the diagonal gradient. This will cause the gradient to slide across the UV space as the uniform changes.
*   **Color Mapping:** Pass the animated gradient value (wrapped using `fract()`) into a 1D texture lookup (or a procedural cosine-based color palette function) to generate the rainbow spectrum.
*   **Blending:** Blend the resulting rainbow sheen over the base card texture using an `Additive` or `Screen` blend mode, modulated by the subject mask.

## Confidence
*   **Cards Shown:** High. Explicitly identified in the prompt and clearly legible.
*   **Static Appearance:** High. The lack of particles and presence of a smooth sheen is obvious.
*   **Tilt Animation:** High. The 8-frame sequence provides a very clear, smooth left-to-right sweep of the light band.
*   **Layer Structure Hypothesis:** Medium. Based on standard TCG manufacturing techniques consistent with the visual evidence (opaque subject, shiny background).
*   **Distinguishing Features:** High. Easily categorized among standard foil types.
*   **Shader Notes:** High. This is a standard, well-documented approach for rendering diagonal holographic sheens in real-time graphics.