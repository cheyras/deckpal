## Cards Shown
*   **Grand Tree** (Trainer - Stadium, ACE SPEC): A modern Scarlet & Violet era card. Visible in frames 1 through 5.
*   **Raw Foil Sheet / Blank Card**: A physical sample showing only the holographic foil layer without any printed ink. Visible in frames 6 through 8.

## Static Appearance
The foil consists of a rigid, repeating geometric pattern made of diagonal squares (diamonds). These squares are arranged such that clusters of them form larger cross or "plus" shapes. The lines forming these shapes are thin, sharp, and highly reflective, while the interior of the shapes and the background remain relatively dark or silver. The scale of the individual squares is moderately large, with a single square being roughly 1/15th to 1/20th the width of the card. 

On the printed "Grand Tree" card (frames 1-5), this pattern is visible across the entire card face, showing through the pink border, the "ACE SPEC" text areas, and the background of the art window, though it is obscured by opaque ink in the foreground elements of the illustration and the text boxes. The raw sheet (frames 6-8) reveals the full, uninterrupted pattern. The reflective lines display vibrant, full-spectrum rainbow colors.

## Tilt Animation
The animation is driven entirely by color shifting (hue rotation) across the static geometric grid; the shapes themselves do not move or change size. 
*   As the card is tilted, bands of rainbow colors sweep across the grid lines. 
*   Between frame 6 and frame 7, observe the cross shape slightly above the center: its lines shift from bright orange/red in frame 6 to a cooler green/yellow in frame 7. 
*   Simultaneously, the shapes in the top left corner shift from cyan/green (frame 6) to deep blue/purple (frame 7).
*   Moving from frame 7 to frame 8, the colors continue to travel. The central cross shifts from green/yellow to cyan/blue, while the top left moves from purple back towards red/orange.
*   The effect is a smooth, continuous flow of a rainbow gradient across the fixed metallic lines, with the colors appearing to travel diagonally across the card surface as the angle of incident light changes.

## Layer Structure Hypothesis
This appears to be a standard two-layer construction:
1.  **Base Foil Layer:** A metallic substrate with the diagonal square and cross pattern physically etched or embossed into it. The microscopic structure of these etched lines acts as a diffraction grating, splitting light into rainbow colors.
2.  **Printed Ink Layer:** Standard CMYK ink printed over the foil. Areas meant to be holographic (like the pink borders and sky in the art) use semi-transparent ink, allowing the foil pattern and its color shifts to show through. Text, borders, and solid art elements are printed with opaque ink (often with a white underprint) to block the foil entirely.

## Distinguishing Features
This pattern is highly distinctive due to its large, rigid, geometric nature. It is easily distinguished from "Cosmos" or "Galaxy" foils which use scattered, organic orbs and stars, and from standard "line" or "sheen" holos. The creator notes it looks like a "zoomed-in radiant pattern"; while Radiant collection cards also use a diagonal grid, the Ace Spec pattern is significantly larger, bolder, and features the distinct cross motifs rather than a simple uniform crosshatch.

## Shader Notes
*   **Base UV Grid:** Create a UV coordinate system rotated by 45 degrees to form the diagonal basis.
*   **Pattern Generation:** Use a combination of fractional UVs (`fract(uv * scale)`) and step functions to draw the grid of squares. You will need logic to selectively mask out certain squares to create the repeating cross motifs.
*   **Line Thickness:** Use `smoothstep` on the edges of the generated shapes to create thin, sharp lines that represent the reflective etched areas.
*   **Color Gradient:** Define a 1D texture or a function that outputs a full rainbow spectrum (red to violet).
*   **Tilt Interaction:** Calculate a tilt value based on the dot product of the view vector and the surface normal. 
*   **Hue Shifting:** Add the tilt value to the base UV coordinates (or a separate sweeping gradient) to sample the rainbow color. This will cause the colors to flow across the static grid lines as the view angle changes.
*   **Masking:** Multiply the final foil output by a texture mask representing the card's ink opacity, ensuring the foil only appears where intended.

## Confidence
*   **Cards Shown:** High. The card name is clearly legible, and the raw sheet is obvious.
*   **Static Appearance:** High. The raw foil frames (6-8) provide an unobstructed view of the pattern's geometry.
*   **Tilt Animation:** High. The sequence of frames clearly demonstrates the hue shift across the static lines.
*   **Layer Structure Hypothesis:** Medium. This is the standard manufacturing process for such cards, though the exact etching technique is inferred.
*   **Distinguishing Features:** High. The pattern is unique and easily identifiable.
*   **Shader Notes:** Medium. The geometric pattern is straightforward to generate mathematically, but perfectly tuning the rainbow diffraction sweep requires iteration.