## Cards Shown
*   **Water Energy**: Printed with "ENERGY" and a water symbol. Copyright text reads "©2023 Pokemon / Nintendo / Creatures / GAME FREAK". The text overlay "TCG Classic" strongly indicates this is from the 2023 Pokémon Trading Card Game Classic premium collection. Visible in frames 1-3.
*   **Raw Foil Sheet**: An uncut, unprinted rectangular piece of the holographic foil material used for this pattern. Visible in frames 4-8.

## Static Appearance
The foil consists of a dense, highly reflective field of tiny, granular "glitter" specks. Interspersed randomly within this glitter field are distinct, slightly larger star shapes (mostly four-pointed sparkles). The glitter specks are extremely small, perhaps 1/200th of the card width, while the stars are slightly larger, around 1/50th of the card width. 
On the printed Water Energy card (frames 1-3), the foil is applied to the entire background, while the central black water drop, the blue border, and the text appear to be printed with opaque ink that blocks the foil. The raw foil sheet (frames 4-8) shows the pattern in its pure form, revealing a strong, sweeping rainbow spectrum (red, green, blue, purple) that overlays the glitter and stars.

## Tilt Animation
The animation is driven by two distinct behaviors as the viewing angle changes:
1.  **Rainbow Sheen Sweep**: A broad, distinct band of rainbow colors travels across the surface of the foil. Between frame 4 and frame 5, as the raw sheet is tilted, a curved rainbow band on the right side shifts leftward and straightens. Between frame 6 and frame 7, a new, intense rainbow band sweeps up from the bottom right towards the center. The colors transition smoothly through the spectrum (red to green to blue to purple).
2.  **Glitter/Star Twinkle**: The individual glitter specks and stars do not move their physical positions on the card. Instead, they "twinkle" by abruptly popping in and out of maximum brightness. As the rainbow band passes over an area, the specks and stars within that band catch the light and reflect the specific color of the band at that location. For example, between frame 7 and frame 8, the cluster of stars in the lower-left quadrant shifts from reflecting green/yellow to reflecting blue/purple as the angle changes slightly.

## Layer Structure Hypothesis
1.  **Base Foil**: A metallic, highly reflective substrate.
2.  **Diffraction/Embossing Layer**: The foil surface is likely micro-embossed with two distinct patterns: a high-frequency noise pattern creating the "glitter" facets, and specific stamped shapes for the "stars". These micro-facets act as diffraction gratings, splitting incident light into a rainbow spectrum that shifts with the viewing angle.
3.  **Ink Layer (on finished cards)**: Opaque inks are printed on top to form the card borders, text, and central symbols, masking out the foil entirely in those areas. The blue background of the Water Energy card might be a semi-transparent ink layer that tints the underlying foil, though the raw sheet suggests the foil itself is quite silvery/neutral.

## Distinguishing Features
This pattern is characterized by the combination of a very fine, dense "glitter" base with scattered, distinct "star" shapes, overlaid with a strong, sweeping rainbow sheen. It can be distinguished from standard "Cosmos" holo patterns because it lacks the large, smooth, circular "orbs" typical of Cosmos, relying instead on the granular glitter and sharp stars. It differs from simple "sheen" holos by having the distinct twinkling particulate elements rather than just a smooth color gradient.

## Shader Notes
*   **Glitter Base**: Use a high-frequency 2D hash or Voronoi noise to generate the dense field of tiny specks.
*   **Star Layer**: Use a separate, lower-frequency noise to scatter a star-shaped texture (e.g., a procedural 4-pointed SDF cross) across the UV space.
*   **Twinkle Mask**: Calculate the dot product of the view direction and the surface normal. Add the noise values to this dot product and apply a sharp step function (`step(threshold, dot + noise)`) to make the specks and stars pop in and out abruptly rather than fading smoothly.
*   **Rainbow Sheen**: Create a 1D color ramp texture containing a full rainbow spectrum. Map this ramp across the card using a combination of UV coordinates and the tilt uniform (e.g., `uv.x + uv.y + tilt * speed`).
*   **Compositing**: Multiply the twinkling glitter/star mask by the rainbow sheen color. Add this result to a base metallic reflection color.

## Confidence
*   **Cards Shown**: High. The text and overlay are clear.
*   **Static Appearance**: High. The raw sheet provides an unobstructed view of the elements.
*   **Tilt Animation**: High. The sequence of raw sheet frames clearly demonstrates the movement of the sheen and the twinkling of the particles.
*   **Layer Structure Hypothesis**: Medium. The physical construction is inferred from standard foil manufacturing techniques and visual evidence, but cannot be definitively proven without physical inspection.
*   **Distinguishing Features**: High. The visual differences from other common patterns are clear.
*   **Shader Notes**: High. The visual effects translate well to standard shader techniques.