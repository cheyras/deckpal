Here is the implementation-grade specification for the "Diagonal Sheen (Left)" holofoil pattern based on the provided frames and narration.

## Cards Shown
*   **Raw Foil Sheet**: A blank, unprinted rectangular piece of holographic material demonstrating the pure foil effect. (Frames 1-6)
*   **Fomantis**: A reverse-holographic Pokémon card. Based on the card design and the narration, this is from the Sun & Moon era. (Frames 7-8)

## Static Appearance
The foil pattern consists of smooth, continuous, straight bands of light that stretch across the entire surface. These bands are oriented diagonally, running from the top-left down to the bottom-right (resembling a backslash `\`). The bands exhibit a full rainbow spectrum of colors (red, orange, yellow, green, blue, purple) that transition smoothly into one another. On the raw sheet, this covers the entire surface. On the Fomantis card, this acts as a "reverse holo," meaning the foil effect is applied to the background of the card (behind the text and type symbols) while the main character art window remains non-holographic.

## Tilt Animation
As the surface is tilted relative to the light source, the diagonal bands of colored light sweep laterally across the face of the card. 
*   Between **Frame 1 and Frame 3**, as the raw sheet is tilted, a prominent bright green/blue band moves from the left edge towards the center of the sheet.
*   Between **Frame 4 and Frame 6**, the bands continue to shift across the surface, with new colors (like pinks and purples) emerging and replacing the previous colors in the center as the angle changes. The movement is a smooth translation perpendicular to the angle of the lines.
*   Between **Frame 7 and Frame 8**, a subtle tilt of the Fomantis card causes the broad, yellowish-green sheen band across the bottom half of the card to shift slightly, confirming the same sweeping behavior under the printed ink.

## Layer Structure Hypothesis
1.  **Foil Base**: A metallic foil layer embossed with a microscopic linear grating angled diagonally (top-left to bottom-right). This grating diffracts light into the smooth, sweeping rainbow bands.
2.  **Opaque Ink Layer**: Printed over the foil to block it entirely in specific areas, such as the main art window, the yellow borders, and the text.
3.  **Semi-Transparent Ink Layer**: Printed over the foil in the background areas (like the green grass-type pattern on the Fomantis card). This layer tints the underlying rainbow sheen, restricting its brightness and altering its perceived color depending on the ink color above it.

## Distinguishing Features
*   **Smooth Diagonal Bands**: Unlike patterns with discrete shapes (stars, orbs, pixels), this pattern is characterized by continuous, straight lines of light.
*   **Top-Left to Bottom-Right Orientation**: The bands specifically angle downwards from left to right (`\`), distinguishing it from patterns that might angle the opposite way (`/`) or run perfectly vertically/horizontally.
*   **Reverse Holo Application**: In the context of the cards shown, it is used as a background treatment rather than over the main artwork.

## Shader Notes
*   **UV Rotation**: Rotate the base UV coordinates by approximately -45 degrees (or whatever angle matches the `\` slope) to align the effect along the correct diagonal axis.
*   **Sheen Function**: Use a sine wave or a smooth periodic function (like `sin(rotated_uv.x * frequency + tilt_uniform)`) to generate the repeating bands of light.
*   **Color Mapping**: Map the output of the sheen function to a 1D rainbow gradient texture or a procedural hue-shifting function to create the spectral colors.
*   **Tilt Uniform**: Drive the phase shift of the sheen function using a uniform based on the device's gyroscope or a simulated light angle to make the bands sweep across the surface.
*   **Masking**: Use a texture mask to apply the shader only to the reverse holo areas (background) and exclude the art window and borders.
*   **Blend Mode**: Multiply or Add the foil output with the base card texture, ensuring the semi-transparent printed areas tint the foil appropriately.

## Confidence
*   **Cards Shown**: High. The raw sheet is obvious, and the Fomantis card is clearly legible.
*   **Static Appearance**: High. The diagonal lines and rainbow colors are very clear on the raw sheet.
*   **Tilt Animation**: High. The sweeping motion is easily tracked across the first 6 frames.
*   **Layer Structure Hypothesis**: High. The standard construction of reverse holo cards is well-documented and matches the visual evidence.
*   **Distinguishing Features**: High. The specific angle and smoothness are the defining traits shown.
*   **Shader Notes**: High. The mathematical approach to generating sweeping diagonal lines is standard graphics programming.