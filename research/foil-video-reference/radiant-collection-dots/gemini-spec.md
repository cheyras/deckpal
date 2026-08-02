## Cards Shown
*   **Pikachu** (60 HP, Basic). Set: Generations Radiant Collection (RC29/RC32). Visible in all frames (1-8).

## Static Appearance
The foil effect on this card is a composite of two distinct visual elements covering the entire card face (full art style):
1.  **Top-Layer Dots:** Small, scattered, shiny dots or sparkles applied over the entire surface of the card, including over the printed artwork and borders. These dots are very small (roughly 1% of the card width) and appear randomly distributed.
2.  **Ink Cutouts:** Larger, thematic shapes (Pikachu silhouettes, hearts, lightning bolts, and stars) are visible in the yellow lower half of the card. These are not holographic shapes themselves, but rather transparent "windows" in the printed ink that reveal a plain, flat mirror foil layer underneath. 

## Tilt Animation
As the card is tilted under the light source:
*   **Top-Layer Dots:** The small scattered dots act like individual tiny mirrors or glitter particles. They pop in and out of visibility abruptly as the angle changes. For example, between frame 1 and frame 2, dots on the left side dim while dots in the center brighten. In frame 6, a large cluster of dots catches the light simultaneously across the lower half of the card. They do not appear to move or travel; they simply turn on and off based on the specular angle.
*   **Ink Cutouts:** The larger shapes (Pikachu heads, hearts) behave like a single, flat mirror surface. When the card is angled so the light reflects directly into the camera (most notably in frame 6), all these cutout shapes flash brightly at the same time with a uniform metallic sheen. When not catching the direct reflection (e.g., frame 3), they appear dark or take on the ambient color of the room.
*   There is no complex hue rotation or traveling sheen band inherent to the foil pattern itself; the animation is purely specular reflection from the flat base layer and the scattered top-layer dots.

## Layer Structure Hypothesis
Based on the visual evidence and the creator's narration, the physical construction consists of three main layers:
1.  **Base Foil:** A plain, unpatterned mirror holographic card stock.
2.  **Ink Layer with Masks:** An opaque white ink layer (followed by colored inks) printed on top of the base foil. This layer has specific shapes (Pikachu heads, hearts, etc.) left unprinted, acting as transparent windows to the mirror foil below.
3.  **Top Foil Layer:** A separate application of holographic material (the scattered dots) printed *on top* of the colored ink layer. This is why the dots can be seen overlapping both the printed art and the mirror cutouts.

## Distinguishing Features
This pattern is unique because it relies heavily on the printed ink layer to create the primary visual shapes (the cutouts), rather than having the shapes embossed into the foil itself. It is distinguished from standard "glitter" or "starlight" patterns by the combination of the top-layer scattered dots and the thematic, flat-mirror cutouts in the background. It lacks the traveling bands of light seen in standard diagonal or horizontal foil patterns.

## Shader Notes
*   **Layer 1 (Base Mirror):** Implement a standard metallic/mirror reflection for the base layer.
*   **Layer 2 (Ink Mask):** Use a texture mask to define the cutout shapes (Pikachu heads, hearts). 
    *   `if (mask == 0.0)` -> render Base Mirror.
    *   `if (mask == 1.0)` -> render Card Art (diffuse).
*   **Layer 3 (Top Dots):** Generate a high-frequency, sparse noise texture (or use a pre-baked dot texture) for the top layer.
*   **Dot Specular:** Apply a sharp specular highlight calculation to the dot layer based on the view vector and light vector. The dots should only be visible when the specular reflection is very high.
*   **Composite:** Add the specular output of the dot layer on top of the masked base/art layers. The dots should occlude the layers below them when lit.
*   **Tilt Uniform:** The tilt uniform should drive the normal vector used in the specular calculations for both the base mirror layer and the top dot layer, causing the cutouts to flash and the dots to sparkle as the angle changes.

## Confidence
*   **Cards Shown:** High. The card text and set symbol are clearly legible.
*   **Static Appearance:** High. The two distinct elements (dots and cutouts) are clearly visible in the high-quality frames.
*   **Tilt Animation:** High. The frames capture the specular popping of the dots and the flat reflection of the cutouts well.
*   **Layer Structure Hypothesis:** High. The visual evidence perfectly aligns with the detailed explanation provided in the video narration.
*   **Distinguishing Features:** High. The combination of techniques is highly specific to this set.
*   **Shader Notes:** High. The layered physical structure translates directly into standard shader masking and specular techniques.