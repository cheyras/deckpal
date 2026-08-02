## Cards Shown
*   **Blastoise** (Base Set prototype): Frame 1
*   **Charizard** (Base Set prototype): Frames 2, 3, 4
*   **Mewtwo** (Base Set prototype): Frames 5, 6, 7
*   **Zapdos** (Base Set prototype): Frame 8
*   *Note: The narration identifies these as unreleased factory prototypes from the late '90s.*

## Static Appearance
The foil pattern is confined strictly to the background of the character art window. It consists of a dense, regular grid of small, distinct squares (resembling pixels or a mosaic). Each square is roughly 1/40th to 1/50th the width of the card. In any single frame, the squares display a scattered, randomized assortment of vibrant colors (reds, greens, golds, blues, purples), giving the appearance of a multi-colored disco ball or a pixelated surface. There are no smooth gradients, stars, or organic shapes; the pattern is entirely geometric and rigid.

## Tilt Animation
As the card tilts, the grid itself remains perfectly stationary; the squares do not move, scale, or warp. Instead, the change occurs entirely within the color and brightness of the individual squares. 
*   Between frames 2, 3, and 4 (Charizard), you can observe the overall color palette of the grid shifting. Areas that were predominantly green/yellow in frame 2 shift towards red/orange in frame 3, and then to a more mixed palette in frame 4.
*   Between frames 5, 6, and 7 (Mewtwo), individual squares that are bright blue in one frame may dim or shift to purple/pink in the next. 
*   The animation behaves as if each square is a tiny, independent reflector with a slightly different angle, catching the light and cycling through a spectrum of colors at different tilt thresholds. The transition is abrupt between adjacent squares but smooth within a single square as the angle changes.

## Layer Structure Hypothesis
1.  **Base Card Stock**: The physical paper layer.
2.  **Holographic Foil Layer**: A specialized foil sheet embossed with a microscopic grid pattern. Each cell in the grid likely contains a diffraction grating oriented at a different, randomized angle, causing them to reflect different wavelengths of light at any given viewing angle.
3.  **Opaque Ink Layer**: The standard card printing (borders, text, and the Pokémon character itself) is printed opaquely over the foil.
4.  **White Underprint (Mask)**: A layer of opaque white ink sits between the foil and the color ink for the character and borders to block the foil from showing through, leaving only the background transparent to reveal the grid.

## Distinguishing Features
This pattern is instantly recognizable by its strict, uniform grid of small squares. It is completely devoid of the organic shapes, stars, or smooth sheen bands found in standard Pokémon foil patterns (like Starlight or Cosmos). It looks distinctly like a digital pixel grid or a mosaic tile pattern.

## Shader Notes
*   **Grid Generation**: Use `floor(uv * grid_scale)` to create a stepped coordinate system, ensuring the effect is evaluated per-square rather than per-pixel.
*   **Randomization**: Pass the stepped coordinates into a 2D hash/noise function to generate a random static value (0.0 to 1.0) for each square.
*   **Tilt Interaction**: Combine the square's random value with a uniform representing the tilt angle (e.g., `dot(viewDir, normal)`).
*   **Color Mapping**: Use the combined value to sample a 1D color ramp texture (a rainbow spectrum) or drive a hue rotation function. This will cause each square to cycle through colors independently as the tilt uniform changes.
*   **Masking**: The shader must use a mask texture to restrict the grid effect strictly to the background of the art window, rendering the character and borders normally.

## Confidence
*   **Cards Shown**: High. The Pokémon and card layouts are clearly identifiable.
*   **Static Appearance**: High. The grid pattern is very distinct and unambiguous in all frames.
*   **Tilt Animation**: Medium-High. The color shifting is visible across the frame sequences, though the exact mathematical nature of the shift (hue cycle vs. specific angle reflection) is inferred from the visual behavior.
*   **Layer Structure Hypothesis**: High. This aligns with standard trading card manufacturing techniques for masked holofoils.
*   **Distinguishing Features**: High. The pattern is highly unique compared to released sets.
*   **Shader Notes**: High. The visual effect maps very cleanly to standard grid-based shader techniques.