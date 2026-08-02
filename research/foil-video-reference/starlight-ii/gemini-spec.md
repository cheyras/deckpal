## Cards Shown
*   **Charizard (11/108)**: Pokémon TCG, XY Evolutions set (2016). Visible in all frames (1-8). Frames 1-3 show the card encased in a CGC graded slab (grade 8.5), which clearly identifies the set and year. Frames 4-8 show a closer, unslabbed view of the same card type to demonstrate the foil.

## Static Appearance
*   **Elements**: The pattern consists of distinct, sharp-edged shapes: primarily four-pointed stars (some with longer vertical/horizontal axes), smaller multi-pointed bursts, and tiny circular dots or orbs scattered throughout.
*   **Scale**: The largest stars are roughly 1/15th to 1/20th the width of the card. The dots are much smaller, appearing as tiny specks.
*   **Colors**: The foil elements exhibit vibrant, saturated colors including bright greens, yellows, reds, and blues. The background between the distinct shapes has a darker, slightly metallic sheen.
*   **Location**: The holographic effect is confined strictly to the background of the art window, behind the Charizard character. The character itself, the card borders, and the text areas are printed with opaque ink and show no foil effect.

## Tilt Animation
*   **Movement**: The star and dot shapes are completely static; they do not move, scroll, or exhibit any parallax relative to the card surface or each other as the card is tilted. The narration explicitly notes it is "missing that 3D depth that the original cards had."
*   **Color and Brightness Shift**: As the viewing angle changes, the individual static elements dramatically change color and brightness in place. They "pop" in and out of visibility.
*   **Frame Evidence**:
    *   Observe the large star near the top left of the art window (above Charizard's right wing): In frame 4, it is a dim yellowish-green. By frame 6, as the card tilts, it flares up to a bright, saturated green. In frame 8, it dims significantly and shifts towards a bluish hue.
    *   Observe the cluster of dots near the bottom left of the art window: In frame 4, they are mostly dark. In frame 5, several light up bright yellow. By frame 7, they dim again.
*   **Overall Effect**: The tilt drives a hue rotation and a sharp specular highlight across the static pattern mask, causing different stars to flash brightly in different colors at different angles.

## Layer Structure Hypothesis
*   **Base Layer**: Standard card stock.
*   **Foil Layer**: A single, flat metallic foil layer. The "Starlight II" pattern (stars and dots) is likely etched or stamped into this foil, creating microscopic variations in the surface angle that reflect light differently. Because there is no parallax, it is a single 2D plane.
*   **Ink Layer**: Opaque CMYK ink is printed over the foil to create the card borders, text, and the Charizard character. The ink is omitted (or printed very transparently) only in the background of the art window, allowing the foil pattern to show through.

## Distinguishing Features
*   **Versus Original Starlight (Base Set)**: As noted in the narration, this "Starlight II" pattern is "bold, colorful, and pops a lot more" but lacks "3D depth." The shapes are sharper and more distinct, whereas the original pattern was described as "blurry" or "milky" with a sense of layers moving against each other.
*   **Versus Cosmos/Galaxy Foil**: It lacks the large, smooth, overlapping circular orbs and the continuous, flowing color gradients typical of Cosmos foil. The elements here are discrete, sharp stars and tiny dots.

## Shader Notes
*   **Pattern Mask**: Use a static 2D texture (or a procedural noise function generating sharp star/dot shapes) mapped to the card's UV coordinates. This mask should not scroll with the view angle.
*   **View Angle Calculation**: Calculate the dot product between the view vector and the surface normal to determine the tilt angle.
*   **Color Mapping**: Use the tilt angle to sample a 1D color ramp (rainbow gradient) to determine the base color of the foil at that specific angle.
*   **Specular Highlights**: To make the stars "pop," apply a narrow specular reflection model. The normal of the foil layer might need slight, localized perturbations based on the pattern mask so that different stars catch the light at slightly different angles.
*   **No Parallax**: Do not implement any UV offset based on the view vector; the pattern must remain locked to the surface.
*   **Masking**: Multiply the final foil output by an art-window mask texture so the effect only appears behind the character.

## Confidence
*   **Cards Shown**: High. The CGC label in the early frames explicitly identifies the card and set.
*   **Static Appearance**: High. The shapes and colors are clearly visible in the close-up frames.
*   **Tilt Animation**: High. The sequence of frames (4-8) clearly demonstrates the color shifting and lack of movement.
*   **Layer Structure Hypothesis**: Medium. This is the standard construction for this era of Pokémon cards, supported by visual evidence and narration, but cannot be physically verified without destroying a card.
*   **Distinguishing Features**: High. The narration directly compares it to its predecessor, and the visual differences are clear.
*   **Shader Notes**: High. The observed behavior maps directly to standard, relatively simple shader techniques for static, color-shifting masks.