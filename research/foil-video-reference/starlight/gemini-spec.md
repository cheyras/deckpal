Here is the implementation-grade specification for the "Starlight" holographic foil pattern based on the provided video frames and narration.

## Cards Shown
*   **Frame 1:** A physical Pokémon card is shown: **Flareon** from the **Jungle** set (identifiable by the set symbol and artwork). The foil is visible in the background of the character art.
*   **Frames 2-8:** A demonstration piece is shown. It appears to be a raw holographic foil sheet cut to card size with only the standard yellow card border printed on it, isolating the foil pattern for clear viewing. A reflection of the camera/filmer (resembling a dog's face) is visible in the bottom right corner of the foil.

## Static Appearance
*   **Placement:** On the actual card (Frame 1), the foil is restricted to the art window, specifically acting as the background behind the opaque character (Flareon). In the demonstration (Frames 2-8), it fills the entire area inside the yellow border.
*   **Elements:** The pattern consists entirely of scattered, sharp-edged stars. There are three distinct shapes: tiny dots, 4-point stars (crosses), and 8-point stars (bursts).
*   **Scale:** The stars are small. The largest 8-point stars are approximately 1/20th to 1/25th of the card's width. The dots are mere specks.
*   **Colors:** The foil reflects highly saturated, distinct colors across the full spectrum: bright greens, deep blues, vibrant reds, oranges, and purples. The background between the stars appears dark/black in these frames due to the lighting angle.

## Tilt Animation
*   **Color Shifting:** As the card tilts, individual stars undergo dramatic hue and brightness changes. For example, tracking the prominent star in the upper-middle: it is a dim blue in Frame 4, flashes a brilliant, bright green in Frame 5, and shifts to a dimmer blue/purple by Frame 6.
*   **Flashing/Popping:** The stars do not breathe smoothly; they tend to "pop" into bright, saturated colors at specific angles and then quickly dim back to darker, cooler tones (like deep blue or purple) or disappear into the dark background as the angle changes further.
*   **Parallax (3D Effect):** The narration explicitly states this is a "true hologram" with a "3D effect" where "stars in the front move side to side." While subtle in still frames, comparing the relative positions of stars between Frame 2 and Frame 8 reveals that some stars shift slightly more than others relative to the card border, confirming multiple depth layers.

## Layer Structure Hypothesis
1.  **Card Stock:** The physical paper base.
2.  **Holographic Foil Layer:** A true multi-layer holographic foil applied over the stock. The star patterns are physically encoded into the foil at different virtual depths to create the parallax effect.
3.  **Opaque White Ink Layer:** Printed over the foil to block it out completely where the character (Flareon), card text, and borders are located.
4.  **CMYK Color Ink Layer:** Printed on top. In the art window background, the ink is semi-transparent, allowing the foil's stars to shine through the printed environment.

## Distinguishing Features
*   This pattern is defined by its sharp, distinct **star shapes** (4-point and 8-point), unlike the "Cosmos" pattern which uses soft orbs and circles.
*   It features a genuine **parallax depth effect**, distinguishing it from modern flat foils or simple glitter patterns. The stars appear to exist in a 3D space inside the card.
*   The elements are scattered randomly with no discernible repeating grid or sweeping sheen bands.

## Shader Notes
*   **Multi-Layer Starfield:** The shader requires generating at least 3 distinct layers of star patterns to achieve the parallax effect.
*   **Parallax UV Offset:** Use the tilt uniform (derived from the view vector) to offset the UV coordinates of each star layer differently. The "deepest" layer should move the most relative to the surface.
*   **Star Shape Generation:** Use Signed Distance Fields (SDFs) or a texture atlas to generate the sharp 4-point and 8-point star shapes, rather than simple noise.
*   **Angle-Dependent Color:** The color of a star should be a function of its UV position and the current tilt angle. Use a hash function based on the star's ID to assign a base hue, and then shift that hue and spike the brightness when the view angle aligns with the star's specific "activation" angle.
*   **Dark Background:** The base color of the foil area should be dark, allowing the additive blending of the bright, saturated stars to pop effectively.

## Confidence
*   **Cards Shown:** High. The Flareon card is clearly legible, and the demonstration piece is explicitly described by the creator.
*   **Static Appearance:** High. The isolated foil frames provide a perfect, unobstructed view of the shapes and colors.
*   **Tilt Animation:** Medium-High. The color popping is very clear across the frames. The parallax is harder to measure precisely from stills but is confirmed by the narration and visible upon close inspection of relative star distances.
*   **Layer Structure Hypothesis:** High. This is the standard, well-documented printing process for early Wizards of the Coast Pokémon cards.
*   **Distinguishing Features:** High. The star shapes are the defining characteristic of this specific era's foil.
*   **Shader Notes:** High. These are standard and effective graphics programming techniques for replicating multi-layer holographic effects.