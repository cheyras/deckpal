## Cards Shown
- Raw uncut foil sheet (Frames 1-6)
- Mega Venusaur EX (XY Evolutions, 2/108) (Frames 7-8)

## Static Appearance
The foil pattern consists of a fine, dense field of glitter-like specks. These specks are very small, appearing almost like a textured surface rather than distinct, large shapes. The foil covers the entire card face, though on the printed card (Frames 7-8), it is most visible in the background areas and less prominent over the character art and text boxes. The colors observed are a full spectrum rainbow, typically manifesting as a broad, sweeping band or arc of color across the surface, with the glitter specks catching the light within that band.

## Tilt Animation
As the card/sheet is tilted, the most prominent feature is a wide, sweeping band of rainbow colors that moves across the surface. 
- Between frame 1 and frame 3, as the sheet is tilted, the rainbow band shifts from a curved shape on the left side towards the center, changing its angle and the specific colors visible at any given point.
- The glitter specks themselves do not appear to move; rather, they light up with the colors of the rainbow band as it passes over them. The specks twinkle or sparkle as the angle of light changes, turning on and off rapidly.
- In frames 4 and 5, the angle of the light creates a more washed-out, silvery appearance with a sharp, linear rainbow reflection, showing how the overall sheen reacts to direct light.
- On the printed card (frames 7-8), the rainbow band sweeps across the background, illuminating the glitter texture behind the printed elements.

## Layer Structure Hypothesis
1.  **Base Layer:** A holographic foil substrate with a fine, dense, glitter-like texture embossed or etched into it. This texture scatters light to create the sparkling effect.
2.  **Color Layer (Structural):** The holographic effect creates the broad, sweeping rainbow bands that move across the surface based on the viewing angle.
3.  **Ink Layer:** The card artwork, text, and borders are printed on top of the foil. The ink appears to be somewhat opaque in areas like the character art, but transparent enough in the background to let the foil pattern and rainbow sheen show through clearly.

## Distinguishing Features
This pattern is characterized by the combination of a very fine, dense glitter texture and a broad, sweeping rainbow sheen. It differs from patterns with distinct, larger shapes (like stars or orbs) and from smooth, untextured rainbow foils. The "glitter" is much finer than the chunky glitter seen in some other patterns.

## Shader Notes
- Use a high-frequency noise function (like a fine Voronoi or simplex noise) to generate the static glitter texture.
- Implement a broad, sweeping gradient or band for the rainbow sheen. The position and angle of this band should be driven by the tilt uniform (e.g., dot product of view vector and normal).
- The color of the rainbow band can be generated using a hue ramp based on the tilt angle.
- Multiply the glitter noise texture by the rainbow sheen to make the specks light up with the appropriate colors.
- Add a threshold or power function to the noise to create the sharp, twinkling effect of the glitter as the light moves across it.
- Use a mask based on the card artwork to control the opacity of the foil effect, making it stronger in the background and weaker over the subject.

## Confidence
- Cards Shown: High. The raw sheet is obvious, and the Mega Venusaur EX is clearly legible.
- Static Appearance: High. The fine glitter texture and rainbow sheen are clearly visible.
- Tilt Animation: High. The movement of the rainbow band and the twinkling of the glitter are well-demonstrated across the frames.
- Layer Structure Hypothesis: Medium. Standard foil card construction, but the exact method of creating the fine glitter texture is inferred.
- Distinguishing Features: High. The combination of fine glitter and sweeping rainbow is distinct.
- Shader Notes: High. Standard techniques for simulating this type of holographic effect.