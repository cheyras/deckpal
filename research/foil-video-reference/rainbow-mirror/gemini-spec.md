Here is the implementation-grade spec for the "Rainbow mirror" holofoil pattern.

## Cards Shown
*   **Crystal Energy** (Aquapolis set, e-Series era): Visible in frames 1-6. This is a reverse holo variant.
*   **Pokémon Nurse** (Expedition Base Set, e-Series era): Visible in frames 7-8. This is also a reverse holo variant.

## Static Appearance
The foil pattern itself contains no distinct shapes, cells, or textures. It appears as a perfectly smooth, mirror-like surface that reflects broad, continuous bands of the full rainbow spectrum (red, orange, yellow, green, blue, indigo, violet). 

Because these are "reverse holo" cards, the foil spans the entire face of the card. The printed artwork and text are layered on top. Opaque elements (like the yellow e-reader borders and black text) completely block the foil. Semi-transparent or unprinted areas (like the background of the art window and the text box) allow the rainbow foil to shine through brightly.

## Tilt Animation
As the card is tilted relative to the light source, the broad bands of rainbow colors sweep smoothly across the surface of the foil. 
*   Between frame 1 and frame 3, as the top of the Crystal Energy card is tilted away, a distinct, concentrated band of rainbow colors (blue, green, yellow, red) slides from the bottom edge up into the center of the art window.
*   Between frame 3 and frame 5, as the tilt continues, this rainbow band expands and shifts further up and to the right, changing the dominant color in the center of the art window from green/yellow to a broader wash of red and purple.
*   In frames 7 and 8 (Pokémon Nurse), a slight tilt causes the lower text box to shift from a reddish-orange hue to a deeper purple-blue, while the left border area shifts from orange to yellow-green.
The colors do not pop in or out; they transition continuously, acting like a smooth diffraction grating reacting to the angle of incident light.

## Layer Structure Hypothesis
1.  **Cardstock Base:** The physical paper backing.
2.  **Foil Layer:** A completely smooth, unembossed holographic film applied across the entire card. This film acts as a diffraction grating, splitting white light into a continuous rainbow spectrum based on the viewing angle.
3.  **White Ink Mask:** Printed over the foil in areas that need to be completely opaque (like the yellow borders).
4.  **CMYK Ink Layer:** The final printed layer containing the art, text, and borders. Areas with no white ink backing (like the art background) act as colored filters over the rainbow foil.

## Distinguishing Features
This pattern is defined by its *lack* of internal structure. It is distinguished from other patterns by having absolutely no geometric shapes, stars, dots, or noise patterns. It is a pure, smooth color gradient. It differs from a standard "silver mirror" foil by reflecting the full spectrum of rainbow colors rather than just a metallic sheen.

## Shader Notes
*   **No Base Texture:** The foil effect does not require a noise texture or pattern map.
*   **Iridescence Calculation:** The core effect is an iridescent color shift. Calculate the dot product of the view vector and the surface normal (NdotV), and potentially the light vector (NdotL) or half-vector.
*   **Color Ramp:** Use the result of the angle calculation to sample a 1D gradient texture containing a full rainbow spectrum, or generate the spectrum procedurally using an HSV to RGB conversion function where the angle drives the Hue.
*   **Smooth Banding:** To replicate the broad bands seen in the frames, the mapping from angle to hue should be relatively low-frequency, avoiding tight, repeating rainbow stripes.
*   **Masking:** A dedicated mask texture is required to separate opaque printed areas (where the foil is invisible) from translucent areas (where the foil color is multiplied or additively blended with the base art).

## Confidence
*   **Cards Shown:** High. Card names and set symbols are clearly legible.
*   **Static Appearance:** High. The lack of texture and presence of rainbow colors is obvious.
*   **Tilt Animation:** High. The smooth sweeping motion of the colors is clearly demonstrated across the frame sequence.
*   **Layer Structure Hypothesis:** High. This is the standard, well-documented manufacturing process for e-Series reverse holos.
*   **Distinguishing Features:** High. The defining characteristic is the absence of a pattern.
*   **Shader Notes:** High. A standard iridescence approach is the direct mathematical equivalent of the physical phenomenon shown.