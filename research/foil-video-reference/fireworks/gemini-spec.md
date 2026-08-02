## Cards Shown
*   **Zapdos** (Legendary Collection, 2002). The narration explicitly identifies this as the "Legendary Collection set from the Wizards of the Coast era back in 2002" and notes it as a "fireworks variation" (reverse holo). Visible in all frames (1-8).

## Static Appearance
*   **Element Shapes**: The pattern consists of large, overlapping "firework" bursts. These bursts are composed of jagged, radiating lines extending outward from central points, resembling explosions.
*   **Scale**: The individual firework bursts are quite large, with diameters roughly spanning 1/3 to 1/2 the width of the card.
*   **Colors**: The foil exhibits a full, vibrant rainbow spectrum (red, orange, yellow, green, blue, violet).
*   **Location**: This is a "reverse holo" pattern, meaning the foil covers the entire face of the card *except* for the main artwork window containing the Pokémon illustration, which remains non-holographic. The foil is visible through the borders, text box, and around the energy symbols.

## Tilt Animation
*   As the card is tilted, the firework bursts do not move physically across the card; their positions are static.
*   Instead, the *illumination* and *color* of the bursts change dramatically based on the angle of the light. A band of bright reflection sweeps across the card as it tilts.
*   **Frame 1 to 4**: As the card tilts upward, a prominent firework burst in the lower-center of the card catches the light. In frame 2, it displays a full rainbow gradient (red near the center, shifting to green and blue at the edges). By frame 4, this same burst has shifted to a brilliant, almost uniform green/yellow as the angle changes.
*   **Frame 5 to 8**: As the tilt continues, the lower-center burst fades into darker reds and oranges, while bursts on the outer edges and upper portions of the card sequentially catch the light and flare up in bright greens and blues (e.g., left edge in frame 5, lower right in frame 6, top left in frame 7).
*   The color shift appears to be a hue rotation that is dependent on both the overall light angle and the specific orientation of the radiating lines within each firework burst, characteristic of a complex diffraction grating.

## Layer Structure Hypothesis
1.  **Base Foil Layer**: A metallic foil layer stamped or etched with the intricate, radiating firework diffraction pattern.
2.  **Semi-Opaque Ink Layer**: The card's yellow border, text box background, and other structural elements are printed over the foil with semi-transparent inks, allowing the holographic pattern to shine through while tinting it slightly.
3.  **Opaque Ink Layer**: The main Pokémon artwork (Zapdos) and the black text/symbols are printed with opaque ink, completely blocking the foil underneath.

## Distinguishing Features
*   This pattern is uniquely identifiable by its large, distinct "firework" or explosion shapes.
*   It is easily distinguished from standard "Cosmos" or "Starlight" patterns, which use scattered dots and orbs, and from simple linear or smooth sheen holos.
*   The full-card coverage (excluding the art box) is a hallmark of this specific era's reverse holos, contrasting with standard holos where only the art box is foiled.

## Shader Notes
*   **Pattern Generation**: The core challenge is generating the firework shapes. This could be approached using a scattered point grid (like Voronoi centers) where each point generates radiating, jagged lines (perhaps using noise mapped to polar coordinates around each center).
*   **Diffraction Simulation**: The color of the foil should be driven by a view-dependent rainbow color ramp.
*   **Anisotropic Highlights**: To simulate the way different parts of the firework light up, the shader needs to calculate the angle of the radiating lines relative to the light source. A tangent vector pointing outward from the center of each firework burst could be used in an anisotropic lighting model.
*   **Masking**: A texture mask is required to apply the foil effect only to the borders and text areas, keeping the main art window matte and opaque.
*   **Tilt Uniform**: The tilt uniform should drive the primary light vector, causing the bright "activation" band to sweep across the card and shifting the hues of the activated fireworks.

## Confidence
*   **Cards Shown**: High. The narration explicitly names the set and year, and the card art is clearly Zapdos.
*   **Static Appearance**: High. The firework shapes and reverse holo nature are very clearly visible.
*   **Tilt Animation**: High. The sequence of frames clearly shows the color shifting and the static nature of the shapes.
*   **Layer Structure Hypothesis**: High. This is the standard construction for reverse holofoil cards of this type.
*   **Distinguishing Features**: High. The pattern is famously unique to this specific set.
*   **Shader Notes**: Medium. While the visual effect is clear, mathematically generating convincing, jagged firework bursts procedurally in a shader is complex and might require texture lookups for the base pattern rather than pure math for optimal performance.