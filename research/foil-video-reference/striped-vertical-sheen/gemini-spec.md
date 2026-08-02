## Cards Shown
*   **Leon** (Trainer - Supporter): Visible in all frames (1-8). Based on the card layout and the narration mentioning "Sword and Shield series", this is a Sword & Shield era holographic card.

## Static Appearance
The holographic effect is confined to the background of the art window, behind the character (Leon). It consists of very fine, continuous vertical stripes running from the top edge of the art window to the bottom edge. Where the light catches the foil, these stripes are illuminated with bright, saturated rainbow colors (red, yellow, green, blue, purple). The stripes are densely packed, with each individual stripe being extremely thin relative to the card width.

## Tilt Animation
As the card is tilted, the vertical stripes themselves remain stationary in their positions, but a band of rainbow-colored sheen travels horizontally across them. 
*   In frames 1-4, a distinct rainbow band is visible on the left side of the art window, shifting slightly as the angle changes.
*   Between frame 4 and frame 5, the card is tilted significantly, causing the bright rainbow band to disappear, leaving a dimmer, mostly reddish reflection on the left.
*   In frame 6, the tilt angle changes again, and a blue/green sheen appears on the right side of the art window.
*   In frames 7 and 8, the card is tilted back, and a strong, multi-colored rainbow band reappears on the left side. The fine vertical structure of the stripes is most clearly visible within these illuminated bands of color. The animation is essentially a smooth, horizontal sweeping of a color gradient across a static, vertically striated surface.

## Layer Structure Hypothesis
1.  **Card Stock Base**: The standard paper backing.
2.  **Foil Layer**: A metallic layer embossed or etched with very fine, continuous vertical striations. This layer is responsible for the physical light-catching properties and the striped texture.
3.  **Opaque Ink Layer**: The character (Leon), the card borders, text, and other UI elements are printed with opaque ink, blocking the foil entirely.
4.  **Transparent/Semi-Transparent Ink Layer**: The background of the art window is either left unprinted or printed with semi-transparent inks, allowing the vertically striped foil and its rainbow reflections to show through.

## Distinguishing Features
This pattern is defined by its continuous, fine vertical stripes combined with a smooth, sweeping rainbow sheen. As the narration notes, it differs from a standard "vertical sheen" (which would be smooth without stripes) and "vertical tinsel" (which typically consists of broken, dashed, or glittery vertical lines rather than continuous stripes). The stripes here go all the way from top to bottom without breaking.

## Shader Notes
*   **Stripe Generation**: Use a high-frequency sine wave or 1D noise function based purely on `uv.x` to generate the fine vertical stripes: `float stripes = sin(uv.x * stripe_density) * 0.5 + 0.5;`.
*   **Sheen Band**: Create a moving band based on the horizontal tilt uniform: `float sheen_pos = fract(uv.x + tilt.x * speed);`.
*   **Color Mapping**: Map the `sheen_pos` to a 1D rainbow gradient texture or a procedural hue function to get the base color of the reflection.
*   **Combination**: Multiply the stripe intensity by the sheen band intensity to ensure the stripes are most visible where the light is catching: `vec3 final_foil = stripes * rainbow_color * sheen_intensity;`.
*   **Masking**: Apply a mask so the effect only renders in the background of the art window, leaving the character and borders opaque.

## Confidence
*   **Cards Shown**: High. The card name "Leon" and the Trainer/Supporter text are clearly legible.
*   **Static Appearance**: High. The fine vertical stripes and rainbow colors are clearly visible, especially in frames 7 and 8.
*   **Tilt Animation**: High. The movement of the colored sheen across the static stripes is well demonstrated across the sequence of frames.
*   **Layer Structure Hypothesis**: High. This is the standard construction for modern Pokemon holo cards of this type.
*   **Distinguishing Features**: High. The continuous nature of the stripes is visible and explicitly confirmed by the narration.
*   **Shader Notes**: High. The visual effect is a straightforward combination of a static 1D pattern and a moving 1D gradient.