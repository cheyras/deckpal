## Cards Shown
*   **Arceus VSTAR** (Brilliant Stars 123/172): Visible in all frames (1-8).

## Static Appearance
The foil effect is characterized by a broad, smooth, diagonal rainbow sheen that covers the entire card face, though its visibility is modulated by the printed artwork. The foil is most prominent in the background behind the Pokémon, within the "VSTAR Power" text box at the bottom, and along the borders. The Pokémon character (Arceus) appears mostly opaque, blocking the underlying foil, while the golden aura surrounding it is semi-transparent, allowing the foil to shine through. The prompt notes the card is etched; while fine ridges are difficult to resolve at this distance, the way the light catches the surface suggests a micro-textured finish rather than a perfectly smooth gloss. The colors visible in the sheen span the full rainbow spectrum (pink, orange, yellow, green, blue).

## Tilt Animation
As the card is tilted slightly in the hand across the frames, a wide diagonal band of rainbow color sweeps across the surface.
*   **Frames 1 to 3:** A bright band of light, initially concentrated on the left edge (showing yellow and green), moves towards the center of the card. By frame 3, a strong pink/red hue dominates the left side of the art box, transitioning into yellow and green towards the center.
*   **Frames 4 to 6:** The sheen continues its diagonal progression. The bright highlight moves across Arceus's body, illuminating the right side of the art box and the right side of the VSTAR Power box. The colors shift smoothly; areas that were pink become orange/yellow, and areas that were green become blue.
*   **Frames 7 to 8:** The angle stabilizes, and the sheen rests with a prominent pink/orange band across the lower-middle section of the card, highlighting the VSTAR Power area and the lower part of the golden aura.
The animation is a smooth, continuous translation of a color gradient across the 2D plane of the card, driven by the tilt angle. There are no popping sparkles or discrete moving shapes, just a sweeping band of light.

## Layer Structure Hypothesis
1.  **Card Stock / Base:** The physical paper base.
2.  **Foil Substrate:** A metallic foil layer covering the entire card, designed to reflect light with a continuous rainbow gradient.
3.  **Etched Texture (Normal Map):** A physical stamping process applied to the foil, creating fine ridges (fingerprint-like texture) that scatter light and give the card a premium tactile feel.
4.  **Ink Layer:**
    *   **Opaque Ink:** Used for the Pokémon character, text, and solid graphic elements to block the foil completely.
    *   **Semi-Transparent Ink:** Used for the background, the golden aura, and the pearlescent borders, tinting the reflected foil light without blocking it entirely.
5.  **Gloss Coating:** A final protective layer, likely conforming to the etched texture.

## Distinguishing Features
This pattern is distinguished by its broad, smooth, diagonal rainbow sheen, lacking any discrete holographic shapes (like stars, dots, or shattered glass). It is a continuous gradient reflection. It is differentiated from standard holofoil (which often has vertical bands or specific patterns) by the presence of the etched texture (as noted in the prompt) and the specific pearlescent white/gold border treatment characteristic of VSTAR cards.

## Shader Notes
*   **Base Sheen:** Implement a broad, diagonal linear gradient across the UV space to represent the primary light reflection.
*   **Color Ramp:** Map the gradient to a full-spectrum rainbow color ramp (HSV hue rotation based on the gradient value).
*   **Tilt Uniform:** Pass a `tilt` vector (derived from the camera/light angle relative to the card normal) to offset the phase of the diagonal gradient, causing the rainbow band to sweep across the card.
*   **Masking:** Use a texture mask to define opaque areas (Arceus, text) where the foil effect should be multiplied by zero or a very low value, and transparent areas where it should be fully visible.
*   **Texture/Normals:** Apply a high-frequency, low-amplitude normal map to simulate the etched ridges. This will break up the perfect smoothness of the sheen and cause slight localized scattering of the rainbow colors.
*   **Blend Mode:** Add the resulting foil color to the base albedo texture using an additive or screen blend mode in the unmasked areas.

## Confidence
*   **Cards Shown:** High. The card is clearly legible and matches the prompt's description.
*   **Static Appearance:** High. The broad sheen and masked areas are clearly visible.
*   **Tilt Animation:** High. The sweeping motion of the rainbow band is easily tracked across the consecutive frames.
*   **Layer Structure Hypothesis:** Medium. The standard construction of modern Pokémon TCG ultra-rares is well documented, but the exact physical etching depth cannot be perfectly measured from this video.
*   **Distinguishing Features:** High. The visual characteristics are distinct and match known VSTAR properties.
*   **Shader Notes:** High. The proposed implementation directly addresses the observed visual phenomena (diagonal sweeping gradient, masking, normal mapping).