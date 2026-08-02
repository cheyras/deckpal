Here is the implementation-grade specification for the "Energy symbols II" holofoil pattern.

## Cards Shown
*   **Marowak** (e-Reader era, likely Expedition Base Set or Aquapolis): Visible in Frame 1, used as an introductory shot with text overlay.
*   **Weedle** (e-Reader era, Expedition Base Set): Visible in Frames 2-8, used for the primary tilt demonstration.

## Static Appearance
*   **Location:** The foil pattern is confined to the background of the artwork window. The character (Weedle) and the rest of the card frame are printed opaquely over the foil.
*   **Elements:** The pattern consists of scattered Pokémon Energy symbols (e.g., Fighting, Fire, Psychic, Lightning, Grass, Colorless).
*   **Scale & Variation:** The symbols vary significantly in size, ranging from roughly 2% to 8% of the card's width. They appear to be randomly rotated.
*   **Secondary Elements:** Interspersed among the energy symbols are smaller, simple circular dots or "sparkles."
*   **Colors:** In a static frame, the illuminated symbols appear in bright, saturated colors (pink, orange, green, gold) against a darker, less reflective background.

## Tilt Animation
*   **Hue Shifting:** As the card tilts (observed sequentially from Frame 2 to Frame 8), the primary animation is a smooth hue rotation across the illuminated symbols. 
    *   Frame 3 shows symbols predominantly in pink/red/orange.
    *   Frame 4 shifts to yellow/orange/green.
    *   Frame 5 shifts to green/yellow.
    *   Frame 6 shifts to green/blue.
    *   Frame 7 shifts to blue/purple/pink.
    *   Frame 8 returns towards red/orange/yellow.
*   **Stationary Elements:** The symbols and dots themselves do not move or change size; they are fixed in place.
*   **Illumination Band:** The brightness of the symbols depends on the angle of the light. Rather than all symbols lighting up uniformly, there appears to be a broad "sweet spot" of reflection that sweeps across the card, illuminating different clusters of symbols as the angle changes.

## Layer Structure Hypothesis
1.  **Cardboard Base:** The physical substrate.
2.  **Foil Layer:** A flat metallic foil layer. The pattern of multi-sized energy symbols and dots is likely etched or stamped into this foil, creating microscopic ridges that diffract light into different spectrums based on the viewing angle.
3.  **Ink Layer:** Opaque CMYK ink printed over the foil. The background of the art window is left unprinted or printed with transparent ink, allowing the foil pattern to show through, while the Pokémon and card borders block the foil.

## Distinguishing Features
*   **Varying Sizes:** The key differentiator from the standard "Energy symbols" pattern (often seen in earlier sets) is that these symbols vary in size and rotation, rather than being a uniform, repeating grid.
*   **Inclusion of Dots:** The presence of smaller, simple dots mixed in with the complex energy symbols.
*   **Smooth Hue Shift:** The color changes smoothly across the spectrum as the card tilts, rather than flashing on and off in a single color.

## Shader Notes
*   **Pattern Mask:** You will need a texture mask containing the scattered, multi-sized energy symbols and dots. This mask should ideally have an alpha channel to isolate the shapes.
*   **Tilt Uniform:** A `u_tilt` uniform (vec2 or float depending on how you handle the light vector) is required to drive the animation.
*   **Color Ramp:** Use a 1D texture or a procedural function (like `hsv2rgb`) to generate a rainbow color spectrum.
*   **UV Offset for Color:** Map the `u_tilt` value to an offset on the color ramp. To simulate the physical effect, you can add a slight spatial gradient to this offset (e.g., `color_offset = u_tilt + uv.x * 0.5`) so that the color varies slightly across the width of the card at any given angle.
*   **Brightness Modulation:** Multiply the final color by a brightness factor that peaks at certain tilt angles to simulate the specular highlight of the foil catching the light.

## Confidence
*   **Cards Shown:** High. The card names and eras are clearly identifiable.
*   **Static Appearance:** High. The shapes and variations are clearly visible in the high-quality frames.
*   **Tilt Animation:** High. The frame sequence provides a clear view of the hue shifting behavior.
*   **Layer Structure Hypothesis:** Medium. This is the standard construction for this era of Pokémon cards, though the exact physical etching method is inferred from the visual result.
*   **Distinguishing Features:** High. Based directly on the visual evidence and the creator's narration.
*   **Shader Notes:** Medium. This is a standard approach to faking diffraction foil in a fragment shader, but exact tuning is required to match the specific look.