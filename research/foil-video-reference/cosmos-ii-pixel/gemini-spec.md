## Cards Shown
*   **Pachirisu**: A Basic Lightning-type Pokémon card. Based on the narration, this is likely from the Platinum era or a later promo card. Visible in all frames (1-8).

## Static Appearance
The foil effect is confined to the background of the artwork window, behind the Pachirisu character and the dark, swirling energy effects. The pattern consists of two main components:
1.  **Pixel Field**: A very dense, continuous background of tiny, silvery dots or "pixels" that fill almost all the empty space.
2.  **Geometric Shapes**: Larger, distinct shapes scattered sparsely across the field. These appear as sharp diamonds, four-pointed stars, or small orbs. When illuminated, they show bright, distinct colors like cyan, lime green, and magenta. The scale of these larger shapes is roughly 1-2% of the card's width.

## Tilt Animation
As the card is tilted, the two components behave differently:
*   **Twinkling Pixels**: The dense background field of tiny dots sparkles continuously. Individual pixels brighten and dim rapidly as the angle changes, creating a static-like or fine glitter effect. This is visible throughout the entire sequence.
*   **Popping Shapes**: The larger geometric shapes do not move across the card; instead, they abruptly pop into visibility at specific tilt angles and disappear just as quickly. For example, between frame 2 and frame 3, a cluster of bright cyan, green, and magenta shapes suddenly appears on the right side of the art window. By frame 4, as the tilt continues, they vanish. They reappear in frame 6 at a similar angle.
*   **Color Behavior**: The larger shapes seem to have fixed colors when they activate (e.g., a specific diamond always flashes cyan). There is no obvious hue shifting or traveling sheen band; the animation is entirely driven by elements turning "on" and "off" based on the light angle.

## Layer Structure Hypothesis
1.  **Card Stock**: The physical paper base.
2.  **Foil Layer**: A highly reflective, silvery metallic layer.
3.  **Embossing/Stamping**: The foil is physically stamped with a micro-texture. The dense "pixels" are likely a fine, randomized texture, while the larger shapes are distinct, angled facets stamped into the foil so they only reflect light towards the viewer at specific, narrow angles.
4.  **Ink Layer**: The printed artwork. The Pachirisu character and the darkest parts of the background are printed with opaque ink, blocking the foil. The areas where the foil is visible are either unprinted or printed with semi-transparent ink to tint the underlying silver foil.

## Distinguishing Features
According to the narration and visual evidence, this "Cosmos II" or "Pixel Cosmos" is distinguished from the classic Wizards of the Coast-era Cosmos foil by its density. The classic pattern has more empty, mirror-like space between the larger shapes. This newer version fills that empty space with a dense field of tiny "pixels," giving it a more silvery, textured, and slightly less deep appearance.

## Shader Notes
*   **Masking**: Use a texture mask to restrict the foil effect strictly to the background of the art window.
*   **Pixel Field**: Generate a high-frequency, dense noise texture (like white noise or very fine Voronoi). Use the dot product of the view vector and the surface normal to threshold or animate this noise, creating a twinkling effect.
*   **Shape Layer**: Create a separate sparse texture containing the larger geometric shapes (diamonds, orbs).
*   **Angle Activation**: Assign a random "activation normal" vector to each large shape. Calculate the dot product between the current view/light half-vector and the shape's activation normal. Use a tight threshold (e.g., `smoothstep(0.98, 1.0, dot_product)`) to make the shapes pop in and out abruptly.
*   **Color Assignment**: Assign a fixed, vibrant color (cyan, magenta, yellow, green) to each large shape in the sparse texture. Multiply the shape's visibility by this color.
*   **Composite**: Add the twinkling pixel field and the popping shape layer together, then multiply by the underlying artwork color (if simulating transparent ink) or add it as an additive blend over the dark background.

## Confidence
*   Cards Shown: High. The card name is clearly legible.
*   Static Appearance: High. The distinct elements (pixels vs. larger shapes) are clearly visible in the high-quality frames.
*   Tilt Animation: High. The popping behavior of the shapes is very clear when comparing frames 2, 3, and 4.
*   Layer Structure Hypothesis: Medium. This is the standard manufacturing process for such cards, but the exact physical nature of the "pixels" (whether stamped texture or printed resist) is an educated guess.
*   Distinguishing Features: High. Directly supported by the creator's narration and observable density.
*   Shader Notes: High. The described logic is a standard and effective way to simulate this specific type of angle-dependent anisotropic reflection in a real-time shader.