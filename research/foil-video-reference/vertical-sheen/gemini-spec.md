Here is a specification for the "Vertical Sheen" holographic foil pattern, based on the provided frames and narration.

## Cards Shown
*   **Raw Foil Sheet/Blank**: A blank, unprinted piece of foil material demonstrating the raw pattern (Frames 1-3).
*   **Ninetales**: HeartGold & SoulSilver set. Visible in Frame 4.
*   **Seeker (Supporter)**: Triumphant set (HeartGold & SoulSilver era). Visible in Frames 5-7.
*   **Yanma**: Triumphant set (HeartGold & SoulSilver era). Visible in Frame 8.
*   *Note: Several other cards with the same pattern are visible in the background of Frames 4-8.*

## Static Appearance
The foil pattern consists exclusively of sharp, continuous vertical bands of light. There are no distinct shapes like stars, dots, or geometric figures. The bands span the entire vertical height of the foiled area. The width of the bands varies, creating a barcode-like or curtain-like appearance. The colors within the bands are highly saturated rainbow hues (red, green, blue, yellow, magenta). 

On the printed cards shown (Frames 4-8), this pattern is applied as a "reverse holo." The foil covers the entire face of the card—including the borders, text box, and background—*except* for the main artwork window, which remains non-holographic.

## Tilt Animation
As the card is tilted horizontally (yaw), the vertical bands of light sweep smoothly across the surface from left to right or right to left. 
*   **Frames 1-3**: As the raw foil is tilted, a prominent bright green/blue band travels from the left side of the sheet towards the center.
*   **Frames 5-7**: As the Seeker card is tilted slightly, the bright vertical highlight shifts horizontally across the text box and the left border.
The movement is strictly horizontal; tilting the card vertically (pitch) does not cause the bands to move up or down, though it may shift the hues within the bands due to the diffraction grating effect. The animation is smooth and continuous, directly tied to the angle of the light source relative to the viewer.

## Layer Structure Hypothesis
1.  **Foil Substrate**: The base layer is a metallic foil stamped with a linear, vertical diffraction grating. This physical structure is what splits the light into vertical rainbow bands.
2.  **Opaque White Ink (Mask)**: A layer of opaque white ink is printed exactly over the artwork window area to completely block the foil from showing through.
3.  **CMYK Ink Layer**: The card's design is printed on top. The artwork is printed over the opaque white mask, rendering it non-holographic. The rest of the card (borders, text box, background) is printed directly onto the foil (or over a semi-transparent white base), allowing the vertical sheen to shine through the colored inks.

## Distinguishing Features
*   **Strictly Vertical**: The bands of light are perfectly straight and vertical, distinguishing it from diagonal sheens or horizontal bands.
*   **Continuous Lines**: The pattern consists of unbroken lines from top to bottom, unlike patterns made of discrete shapes (stars, orbs) or scattered glitter.
*   **Full-Face Application**: In the examples shown, it is used as a reverse holo pattern covering the majority of the card face, rather than being confined to the artwork window.

## Shader Notes
*   **UV Coordinates**: The pattern is driven almost entirely by the X-axis of the UV coordinates.
*   **Stripe Generation**: Use a 1D noise function (e.g., a high-frequency sine wave combined with value noise) based on the `uv.x` coordinate to generate vertical bands of varying widths and intensities.
*   **Tilt Uniform**: Introduce a `tiltX` uniform (representing horizontal rotation). Add this uniform to the `uv.x` coordinate before passing it to the stripe generation function. This will cause the bands to pan horizontally across the card.
*   **Color Mapping**: Map the output of the stripe function to a 1D color ramp texture or a procedural rainbow gradient (e.g., using `cos(frequency * x + phase)` for RGB channels) to simulate the diffraction colors.
*   **Masking**: Use a texture mask to define the artwork window. Multiply the foil effect by the inverse of this mask so the foil only appears on the borders and text areas.
*   **Blending**: Blend the resulting foil color with the base card texture using an additive or screen blend mode in the unmasked areas.

## Confidence
*   **Cards Shown**: High. The card names and artwork are clearly legible.
*   **Static Appearance**: High. The vertical bands are the most prominent feature in all frames.
*   **Tilt Animation**: High. The horizontal panning of the bands is clearly visible across consecutive frames.
*   **Layer Structure Hypothesis**: High. This is the standard manufacturing process for reverse holographic Pokemon cards of this era.
*   **Distinguishing Features**: High. The pattern is visually distinct and easy to categorize.
*   **Shader Notes**: High. The mathematical representation of moving vertical stripes is straightforward to implement in a fragment shader.