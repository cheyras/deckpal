## Cards Shown
- **Moltres EX** (Black & White era, specifically Plasma Storm based on the card design and borders). Two copies are shown: one with a vertical sheen variant (left side, frames 4-8) and one with the diagonal sheen variant (right side, frames 4-8, and standalone in frames 1-3).
- **Raw Uncut Foil Sheets**: Two pieces of raw, unprinted foil are shown to demonstrate the underlying pattern. One has a vertical sheen (left side, frames 4-8) and one has a diagonal sheen (right side, frames 2-8).

## Static Appearance
- **Shapes & Structure:** This pattern contains no discrete shapes, stars, orbs, or glitter. It is a completely smooth, continuous reflective surface.
- **Sheen Band:** The foil manifests as a broad, straight band of rainbow colors (red, yellow, green, blue, purple). 
- **Angle:** For the "Diagonal Sheen (Right)" variant, this band is angled diagonally across the card. Based on the raw sheet on the right in frames 5-8, the band runs roughly from the top-left to the bottom-right.
- **Coverage:** The foil is applied to the entire card face (a "full art" or EX style treatment). It is visible in the background, borders, and energy symbols, but is blocked by opaque ink over the main character art (Moltres) and the text box backgrounds.

## Tilt Animation
- **Movement:** As the card is tilted (observed between frames 4 and 8 on the right-hand side), the diagonal rainbow band sweeps smoothly across the surface of the card.
- **Direction:** The band translates perpendicular to its angle. If the band runs top-left to bottom-right, tilting causes it to slide towards the top-right or bottom-left depending on the tilt angle.
- **Color Behavior:** The colors within the band maintain their relative spectrum order as the band moves. There is no localized hue rotation or popping of individual elements; it is a strict translation of a static gradient.
- **Smoothness:** The animation is perfectly smooth and linear, with no parallax or secondary layers moving at different speeds.

## Layer Structure Hypothesis
- **Base Foil Layer:** A flat, metallic layer stamped with a microscopic, linear diffraction grating. For this specific variant, the grating lines are rotated diagonally relative to the card's edges, causing the diffracted light to form a diagonal band.
- **Ink Layer:** Standard CMYK printing applied directly over the foil. 
- **Masking:** Opaque white ink is printed under the main subject (Moltres) and text areas to completely block the foil. Translucent inks in the background and borders allow the diagonal foil sheen to show through and interact with the printed colors.

## Distinguishing Features
- **Angle:** The primary distinguishing feature is the diagonal orientation of the sheen, which sets it apart from the standard vertical sheen (clearly contrasted on the left side of frames 4-8).
- **Smoothness:** It is easily distinguished from patterns like Cosmos, Cracked Ice, or Stars because it lacks any discrete shapes, facets, or glittery textures. It is a pure, uninterrupted gradient.

## Shader Notes
- **Rotated UVs:** The core of the shader requires rotating the UV coordinates used to sample the rainbow gradient. A rotation matrix applied to the UVs (e.g., by ~45 degrees) will angle the band correctly.
- **1D Gradient Map:** Use a 1D texture or a procedural color ramp (sine waves with offset phases for RGB) to generate the rainbow spectrum.
- **Tilt Offset:** The tilt uniform (derived from camera angle or device gyroscope) should be added as a scalar offset to the rotated UV coordinate before sampling the gradient, causing the band to slide.
- **Masking Texture:** A greyscale mask texture is needed to define the foil's visibility (1.0 in borders/background, 0.0 over the character/text boxes).
- **Blend Mode:** Multiply the resulting rainbow color by the base card texture in the unmasked areas, or use an additive blend depending on the desired intensity of the foil effect.

## Confidence
- Cards Shown: High. The Moltres EX and raw sheets are clearly visible and identifiable.
- Static Appearance: High. The smooth, diagonal nature of the band is obvious, especially on the raw sheet.
- Tilt Animation: High. The sweeping motion is clearly demonstrated across the consecutive frames.
- Layer Structure: High. This is the standard, well-understood manufacturing process for this era of foil cards.
- Distinguishing Features: High. The video explicitly compares it side-by-side with the vertical variant.
- Shader Notes: High. A rotated gradient with a uniform offset is the standard, straightforward way to implement this effect in a shader.