## Cards Shown
*   **Phoebe** (Trainer - Supporter, Secret Rare / "Rainbow Rare", Sword & Shield era). Visible in frames 1-5.
*   **Raw foil sheet / transparent foil layer** (referred to as "nude form" in the narration). Visible in frames 6-8.

## Static Appearance
The foil consists of two distinct visual components. The base is a broad, smooth, highly reflective surface that displays a full-spectrum rainbow gradient (red, orange, yellow, green, blue, purple). Overlaid on this is a very fine, dense "glitter" texture. The individual glitter particles are tiny, almost pixel-like, with no distinct geometric shapes (unlike stars or orbs in other patterns). On the Phoebe card, the foil covers the entire full-art face, though its visibility is heavily modulated by the printed ink and the physical, fingerprint-like texture ridges embossed into the card surface. On the raw sheet, the pattern covers the entire visible area uniformly.

## Tilt Animation
*   **Rainbow Gradient Shift:** As the card is tilted, broad bands of rainbow colors sweep smoothly across the surface. Between frame 1 and frame 5, as the Phoebe card is tilted slightly, the dominant rainbow band shifts diagonally across the character's body. On the raw sheet (frames 6-8), a very distinct, intense rainbow band moves horizontally across the center of the sheet as the angle changes.
*   **Glitter Sparkle:** The fine glitter particles do not move across the surface; instead, they sparkle in place. As the viewing angle changes (e.g., between frame 6 and frame 7), different tiny points of the glitter texture catch the light and flare up brightly, while others dim, creating a dynamic, twinkling effect independent of the smooth rainbow sweep beneath it.
*   **Texture Interaction:** On the finished card (frames 1-5), the physical texture ridges cause the light to catch unevenly, breaking up the smooth rainbow gradient and sometimes obscuring the fine glitter, as noted in the narration.

## Layer Structure Hypothesis
Based on the visual evidence and the narration ("glitter on top of a rainbow mirror"), the physical construction likely involves:
1.  **Base Foil:** A smooth, highly reflective metallic layer treated to create broad, angle-dependent iridescent (rainbow) gradients.
2.  **Glitter Layer:** A layer containing very fine, dense, reflective particles or a micro-embossed texture that scatters light to create the tiny sparkles, sitting on top of the base foil.
3.  **Print Layer (Card only):** Translucent inks printed over the foil to define the artwork, allowing the foil to shine through.
4.  **Embossing (Card only):** A physical stamping process applied last, creating the tactile ridges that interact heavily with the light reflection.

## Distinguishing Features
This pattern is defined by the combination of a smooth, broad rainbow gradient and a very fine, dense, shapeless glitter. It is easily distinguished from "Cosmos" or "Galaxy" foils because it lacks distinct shapes like stars or orbs. It differs from standard flat foils by the presence of the sparkling glitter texture. The glitter is much finer and denser than the "starlight" or "confetti" patterns seen in other eras.

## Shader Notes
*   **Base Iridescence:** Implement a smooth rainbow gradient based on the dot product of the view vector and the surface normal (or a simulated light vector). A 1D texture lookup or a procedural color ramp (e.g., using sine functions for RGB channels) can generate the spectrum.
*   **Glitter Noise:** Use a high-frequency, high-density noise function (like white noise or a very fine cellular noise) to represent the glitter particles.
*   **Sparkle Animation:** To make the glitter sparkle, modulate the noise output based on the tilt uniform. For example, take the dot product of the view vector and a slightly perturbed normal map (representing the glitter flakes), and apply a sharp threshold so only a few "flakes" are bright at any given angle.
*   **Blending:** Add or screen the sparkling glitter layer on top of the smooth rainbow base layer.
*   **Card Texture (Optional):** To simulate the finished card (like Phoebe), apply a normal map representing the fingerprint-like ridges. This normal map should perturb the vectors used to calculate both the rainbow gradient and the glitter sparkle, breaking up the uniformity.

## Confidence
*   Cards Shown: High. The card name is clearly legible and the raw sheet is distinct.
*   Static Appearance: High. The fine glitter and broad rainbow are clearly visible, especially on the raw sheet.
*   Tilt Animation: High. The sweeping rainbow and twinkling glitter are evident across the frame sequences.
*   Layer Structure Hypothesis: High. Supported by visual evidence and explicitly confirmed by the creator's narration.
*   Distinguishing Features: High. The specific combination of elements is unique and clearly identifiable.
*   Shader Notes: High. The visual components translate directly into standard shader techniques for iridescence and sparkle.