Here is the implementation-grade specification for the "Tinsel" holofoil pattern, based on the provided frames and narration.

## Cards Shown
*   **Raw Foil Sample:** The object shown in all frames (1-8) is a blank, card-sized piece of holographic material with rounded corners. There is no printed artwork, text, or card frame visible. It serves as a raw demonstration of the foil pattern itself.

## Static Appearance
*   **Element Shapes:** The pattern consists entirely of dense, fine horizontal striations or lines. Along these lines are short, bright, elongated dashes or specks of light.
*   **Scale:** The horizontal lines are extremely fine, numbering in the hundreds from top to bottom. The bright dashes vary in length but are generally very short, roughly 1% to 4% of the card's width.
*   **Colors:** The dashes exhibit highly saturated, distinct colors across the spectrum, prominently featuring bright greens, blues, purples, reds, and oranges. The colors appear as discrete specks rather than smooth, continuous gradients across large areas.
*   **Placement:** In the provided sample, the foil covers the entire surface. On a finished card, this would likely be applied to the background or specific art elements depending on the era's masking style.

## Tilt Animation
*   **Horizontal Movement:** As the card is tilted, the primary animation is the horizontal movement of the bright dashes along the striations. The narration accurately describes this as "stripes that seem to bounce left and right."
*   **Parallax / Multi-Plane Effect:** The movement is not uniform. Different dashes move at different speeds and sometimes in opposite directions relative to the tilt. For example, observing the lower-middle section between frame 1 and frame 4, some green specks shift right while adjacent blue/purple specks seem to shift left or remain relatively stationary. This creates the "3D effect where two planes are moving" mentioned in the narration.
*   **Color Shifting and Popping:** The dashes do not just move; they also pop in and out of visibility and change color as they move through the optimal reflection angle. A speck that is bright green in frame 2 might dim and shift to blue or disappear entirely by frame 5, while a new speck lights up further along the line.
*   **Speed:** The horizontal movement is highly responsive to the tilt, appearing fast and dynamic ("bouncing") due to the contrasting directions of the simulated layers.

## Layer Structure Hypothesis
*   **Physical Construction:** The foil is likely created using a micro-embossed master plate with extremely fine horizontal ridges.
*   **Holographic Mechanism:** The ridges are likely broken up into tiny, angled segments. Different segments are angled to catch light from different directions. The "two planes" effect suggests there are at least two distinct sets of microscopic angles interleaved along the horizontal lines. When tilted left/right, one set of angles catches the light and appears to move one way, while the other set catches the light differently, creating the opposing movement or parallax.
*   **Ink Layer:** On a finished card, opaque ink would be printed over this foil to define the non-holographic areas (like text boxes or characters), leaving the foil exposed only in the intended regions.

## Distinguishing Features
*   **Strictly Horizontal:** Unlike patterns with stars, orbs, or diagonal shards, this pattern is rigidly defined by horizontal lines.
*   **Dashed/Speckled Appearance:** It differs from smooth "sheen" patterns (which have broad, continuous bands of light) by breaking the light into tiny, discrete, colorful dashes, resembling horizontal static or tinsel.
*   **Opposing Movement:** The distinct parallax effect where dashes appear to slide past each other horizontally on different planes is a key identifier.

## Shader Notes
*   **Base UVs:** Scale the `uv.y` coordinate significantly (e.g., `fract(uv.y * 300.0)`) to create the fine horizontal striations.
*   **Noise Generation:** Use a high-frequency 2D noise function, stretched horizontally (scale X much lower than scale Y), to generate the positions of the bright dashes along the lines.
*   **Multi-Layer Parallax:** To achieve the "two planes" effect, sample the noise function at least twice.
    *   Layer 1 UV offset: `uv.x + (tilt.x * speed1)`
    *   Layer 2 UV offset: `uv.x - (tilt.x * speed2)` (Note the opposing direction or significantly different speed).
*   **Masking and Popping:** Use the noise values to threshold the visibility of the dashes, so they appear as discrete specks rather than continuous lines. Modulate this threshold slightly with the tilt to make them pop in and out.
*   **Color Mapping:** Map the output of the noise (or a separate noise layer offset by tilt) to a 1D texture or procedural rainbow gradient to assign distinct, saturated colors to the dashes.
*   **Lighting:** Multiply the final holographic output by a broad, soft specular highlight based on the overall card normal and light direction to ensure the foil is only visible where light is actively reflecting.

## Confidence
*   **Cards Shown:** High. The object is clearly a blank foil sample across all frames.
*   **Static Appearance:** High. The horizontal lines and colorful dashes are very distinct.
*   **Tilt Animation:** High. The horizontal movement and parallax are observable and perfectly match the creator's description.
*   **Layer Structure Hypothesis:** Medium. This is an educated deduction based on the visual behavior of the light and standard holographic manufacturing techniques.
*   **Distinguishing Features:** High. The pattern is highly unique compared to standard cosmos or smooth sheen foils.
*   **Shader Notes:** High. The described techniques are standard and directly address the observed visual phenomena.