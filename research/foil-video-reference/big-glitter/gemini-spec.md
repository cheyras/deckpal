## Cards Shown
- Scizor (Aquapolis set, e-Reader era). Visible in all frames (1-8).

## Static Appearance
The foil pattern covers the text box background and the left/bottom borders of the card (the e-Reader dot code area). The art window and the main yellow border are not foiled. The pattern consists of a dense, uniform field of small, distinct, circular dots or "glitter" flakes. These dots are homogeneous in size and shape, unlike scattered confetti. They are quite small, perhaps 1-2% of the card width each. In any single frame, the dots reflect various colors (red, green, gold, blue) depending on their angle relative to the light source.

## Tilt Animation
As the card is tilted slightly back and forth (frames 1 through 8):
- The dots do not move across the surface; they are fixed in place.
- Instead, individual dots "twinkle" or flash on and off. For example, a cluster of dots near the bottom right of the text box is bright green/gold in frame 1, dims in frame 2, and is dark by frame 3.
- As the card tilts, the color of the reflecting dots shifts. A dot might flash red, then shift to green or gold as the angle changes (e.g., dots near the "Heavy Metal" attack text shift colors between frames 4, 5, and 6).
- The overall effect is a sparkling, glittering field where different subsets of dots catch the light at different angles, creating a dynamic, twinkling texture rather than a sweeping sheen or moving shapes.

## Layer Structure Hypothesis
1.  **Base Foil:** A metallic foil layer embossed with a very fine, dense pattern of tiny circular indentations or facets (the "big glitter" dots). Each facet is angled slightly differently.
2.  **Ink Layer:** Opaque ink is printed over the foil to create the card borders, text, and character art. The ink is omitted (or printed transparently) in the text box background and the e-Reader border areas, allowing the foil to show through.

## Distinguishing Features
- Characterized by a dense field of uniform, small circular dots.
- Distinct from "confetti" foil, which has irregular, scattered shapes.
- Distinct from smooth, sweeping sheen foils (like base set Cosmos or plain mirror foils); this pattern twinkles and sparkles locally.
- The creator notes it is made of "small homogeneous dots" and calls it "big glitter" to distinguish it from other glitter patterns.

## Shader Notes
- Use a high-frequency Voronoi or cellular noise texture to generate the dense field of dots.
- Threshold the noise to create distinct, circular "flakes."
- Assign a random normal vector (or a random phase offset) to each flake.
- In the fragment shader, calculate the dot product between the view vector, the light vector, and the flake's normal.
- Use this dot product to drive both the intensity (twinkle effect) and a lookup into a color ramp (iridescence) for each flake.
- Mask the foil effect using a texture map so it only appears in the designated areas (text box, specific borders) and is blocked by opaque ink.

## Confidence
- Cards Shown: High. The card name and e-Reader layout are clearly visible.
- Static Appearance: High. The dot pattern is clearly visible in the text box.
- Tilt Animation: High. The twinkling effect is obvious across the frame sequence.
- Layer Structure Hypothesis: Medium. Standard TCG foil construction, though the specific embossing technique is inferred.
- Distinguishing Features: High. Based on visual evidence and creator narration.
- Shader Notes: High. Standard approach for rendering glitter/flake car paint or foil effects.