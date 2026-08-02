Here is the implementation-grade specification for the "Prism" holofoil pattern based on the provided frames and transcript.

## Cards Shown
*   **Raticate BREAK** (XY era BREAK evolution card): Visible in frames 1 and 2.
*   **Charizard** (Carddass Vending series, graded PSA 7): Visible in frame 8.
*   *Note: Frames 3 through 7 show the creator talking with background items (Squirtle plush, Pokeball, booster box, base set Charizard on a shelf) and do not contain a tilt demonstration of the subject foil.*

## Static Appearance
The "Prism" pattern is characterized by a dense, uniform grid of small, repeating geometric cells. These cells appear as tiny squares or diamonds, depending on the card's orientation. 
*   **Scale:** The cells are very small; hundreds of them fit across the width of the card.
*   **Colors:** The cells reflect a full spectrum of rainbow colors (red, green, blue, yellow, pink) depending on the light angle.
*   **Placement:** On the Raticate BREAK card (frames 1-2), the foil appears to cover the entire card face, acting as a background for the gold character art. On the Carddass Charizard (frame 8), the foil is restricted to the background behind the character illustration and text boxes.

## Tilt Animation
The animation is driven by the changing angle of light hitting the grid of cells.
*   **Between frame 1 and frame 2:** As the Raticate BREAK card is tilted slightly, the areas of active reflection shift. In frame 1, the left side shows scattered green/yellow reflections. In frame 2, a broader band of bright, multi-colored (blue, pink, green) reflection becomes visible across the left and center of the card.
*   The physical grid of cells remains completely stationary; there is no parallax or movement of the shapes themselves.
*   Instead, the *color and brightness* of individual cells change rapidly as the angle changes. The cells act like tiny, individual prisms or diffraction gratings, cycling through a hue ramp (rainbow spectrum) as the light sweeps across them.

## Layer Structure Hypothesis
1.  **Foil Base:** A metallic foil layer that has been mechanically stamped, etched, or embossed with a microscopic grid pattern. This physical texture is what creates the diffractive "prism" effect, breaking white light into its component colors.
2.  **Ink Layer:** Standard CMYK printing applied over the foil. 
    *   Opaque white ink is likely used as a base under the character art (like the Charizard) to block the foil from shining through.
    *   Transparent or semi-transparent inks are used in areas where the foil is meant to be visible, tinting the rainbow reflections or allowing them to shine through completely.

## Distinguishing Features
*   **Rigid Grid Structure:** This is the defining feature. Unlike smooth rainbow foils or scattered "cosmos" stars, the Prism pattern is a strict, repeating geometric grid.
*   **Uniform Cell Size:** The squares/diamonds are all identical in size and shape, unlike "cracked ice" or "shatter" patterns which use irregular polygons.
*   **No Floating Elements:** There are no distinct shapes (like stars, orbs, or logos) floating within the pattern; the pattern *is* the texture of the background itself.

## Shader Notes
*   **Grid Generation:** Use a fractional function on the UV coordinates scaled up significantly (e.g., `fract(uv * 100.0)`) to create the base grid of cells.
*   **Cell ID:** Calculate a unique ID for each cell (e.g., `floor(uv * 100.0)`) to ensure the effect is evaluated per-cell rather than smoothly across the surface.
*   **View/Light Angle:** Calculate the dot product of the view vector and the light vector (`NdotH` or similar) to drive the reflection.
*   **Hue Ramp:** Map the reflection intensity to a 1D texture or procedural function containing a full rainbow spectrum (red -> green -> blue -> red).
*   **Macro Sheen:** Apply a broader, smooth noise or gradient across the entire card UV to modulate the brightness of the cells, simulating a light source sweeping across the card, so not all cells are fully illuminated simultaneously.
*   **No Parallax:** Do not apply any view-dependent UV offsets to the grid itself; the pattern must appear completely flat and locked to the card surface.

## Confidence
*   **Cards Shown:** High. Names are clearly legible.
*   **Static Appearance:** High. The grid pattern is very distinct in frames 2 and 8.
*   **Tilt Animation:** Medium. Only frames 1 and 2 show a change in angle for the BREAK card, but the diffractive nature of the grid is clear.
*   **Layer Structure Hypothesis:** High. This is the standard construction for diffractive grid foils.
*   **Distinguishing Features:** High. The grid is easily distinguishable from other common patterns.
*   **Shader Notes:** High. The geometric nature of the pattern translates well to standard shader techniques.