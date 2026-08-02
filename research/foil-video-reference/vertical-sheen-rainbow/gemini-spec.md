## Cards Shown
*   **Medicham** (EX Crystal Guardians set). Visible in frames 1-7.
*   *Note: Frame 8 shows the video creator and background props, not a card demonstration.*

## Static Appearance
The foil effect is confined to the background of the illustration window, behind the character and foreground elements. The pattern itself consists of a smooth, continuous vertical band of light (a "sheen"). There are no distinct geometric shapes, stars, or dots within the foil. The sheen band exhibits a smooth rainbow color gradient across its width.

## Tilt Animation
The core animation is the horizontal translation of the vertical sheen band across the art window, driven by the card's angle relative to the light source.
*   **Frames 1-2:** The card is held relatively flat. A vertical band of light is visible on the left side of the art window, showing predominantly yellow and green hues.
*   **Frames 3-4:** As the card is tilted, the sheen band sweeps towards the center of the image. The colors shift dramatically; in frame 4, the center of the band shows strong pink, purple, and orange hues.
*   **Frames 5-6:** With further tilting, the band continues its movement towards the right edge of the art window. The colors shift again, returning to mostly yellow and orange tones.
*   **Frame 7:** The card is tilted back slightly, and the band moves back towards the left, displaying a broad spectrum of green, yellow, orange, and pink.
The movement is a smooth, continuous sweep, and the hue rotation is directly tied to the position of the band and the angle of the light.

## Layer Structure Hypothesis
1.  **Base Foil Layer:** A highly reflective metallic layer, likely manufactured with a microscopic vertical linear grating. This grating causes light to diffract into a vertical band and separates it into a rainbow spectrum.
2.  **Ink Layer:** Opaque CMYK ink is printed over the foil for the card borders, text, the Medicham character, and foreground terrain. The background sky area in the art window is left unprinted or printed with highly transparent ink, allowing the vertical sheen to shine through.

## Distinguishing Features
This pattern is easily distinguished by its single, smooth vertical band of light. It lacks the scattered, discrete elements found in "Cosmos" or "Starlight" foils. It differs from other sheen patterns by being strictly vertical and featuring a full, smooth rainbow color spectrum rather than a single metallic color or a diagonal sweep.

## Shader Notes
*   **Band Generation:** The core effect can be modeled using a 1D function based on the horizontal UV coordinate (`uv.x`). A Gaussian or smoothstep function can create the soft edges of the vertical band.
*   **Tilt Uniform:** A uniform representing the horizontal tilt angle (yaw) should be added to `uv.x` to drive the horizontal sweeping motion of the band.
*   **Color Gradient:** The color of the band should be determined by a hue ramp. The hue value can be calculated as a function of the local position within the band and the overall tilt uniform, simulating the diffraction of light.
*   **Masking:** A mask texture is essential to restrict the foil effect to the background of the art window, keeping the character and borders matte.
*   **Blending:** The generated rainbow sheen should be added to or screened over the base artwork color in the unmasked areas.

## Confidence
*   **Cards Shown:** High. The card name and set logo are clearly legible.
*   **Static Appearance:** High. The visual properties of the foil are distinct and unobscured.
*   **Tilt Animation:** High. The sweeping motion and color shifts are clearly visible across the sequence of frames.
*   **Layer Structure Hypothesis:** Medium. This is the standard construction for such cards, though the exact microscopic nature of the foil grating is assumed based on the visual output.
*   **Distinguishing Features:** High. The vertical rainbow sheen is a very specific and recognizable effect.
*   **Shader Notes:** High. The visual effect maps cleanly to standard shader techniques for linear gradients and hue shifting.