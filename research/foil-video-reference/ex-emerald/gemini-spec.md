## Cards Shown
- **Swalot** (EX Emerald set, indicated by the set stamp in the art window). Visible in all frames (1-8).

## Static Appearance
- **Foil Location:** The holographic effect is confined entirely to the background of the art window, behind the character (Swalot) and the set stamp.
- **Elements:** The pattern consists of distinct, scattered icons:
  - **Pokéballs:** Standard Pokéball designs, some appearing with concentric rings or energy bursts around them.
  - **Stars/Bursts:** Multi-pointed starbursts or sun-like shapes.
- **Scale:** The individual icons (Pokéballs and stars) are relatively large, roughly 1/10th to 1/8th the width of the art window.
- **Sheen:** A prominent, vertical band of light (sheen) is visible, spanning the full height of the art window.
- **Colors:** The foil reflects a full rainbow spectrum (red, orange, yellow, green, blue, purple) depending on the light angle.

## Tilt Animation
- **Vertical Sheen Movement:** As the card tilts, a strong vertical band of rainbow light sweeps horizontally across the foil area. 
  - Between frame 1 and frame 2, a bright sheen appears on the left side.
  - Between frame 2 and frame 3, this sheen band shifts slightly to the right.
  - In frame 8, the sheen is visible again on the left side, indicating a change in tilt direction.
- **Element Color Shift & Visibility:** The Pokéballs and stars do not physically move (no parallax), but they dramatically change color and brightness (fade in and out) as the angle changes.
  - Observe the Pokéball on the middle-left edge: It is dark in frame 1, bright orange/yellow in frame 3, green in frame 4, faint in frame 5, and bright orange again in frame 7.
  - The elements seem to have their own specific angles of reflection, causing them to "pop" independently of the main vertical sheen, though they are often highlighted when the sheen passes over them.

## Layer Structure Hypothesis
1.  **Card Stock:** The base physical layer.
2.  **Foil Layer:** A metallic layer containing the holographic properties. This layer has the Pokéball and star shapes etched or stamped into it to reflect light at specific angles, alongside a broader structural pattern that creates the sweeping vertical sheen.
3.  **Ink Layer:** Opaque ink printed over the foil. The character (Swalot), the card borders, text, and the "EX Emerald" logo are printed opaquely, blocking the foil. The background of the art window is left unprinted or printed with transparent ink to let the foil shine through.

## Distinguishing Features
- The specific combination of Pokéball and starburst icons is unique to this era/set.
- The presence of a strong, sweeping vertical sheen band combined with scattered, independently flashing icons distinguishes it from simpler "cosmos" or "starlight" patterns that lack the sweeping band.
- The "EX Emerald" set logo stamped directly onto the foil area is a hallmark of reverse holos or specific holo variants from this set.

## Shader Notes
- **Masking:** Use a texture mask to confine the holographic effect to the art window background, excluding the character and the set stamp.
- **Vertical Sheen:** Implement a vertical gradient band that translates along the X-axis based on the horizontal tilt uniform (e.g., `tilt.x`). Map this band to a rainbow color ramp.
- **Icon Layer:** Create a texture containing the Pokéball and star shapes. 
- **Icon Activation:** To simulate the icons fading in and out at different angles, assign a random or pseudo-random "activation angle" to each icon in the texture (perhaps using a separate channel or a data texture). Compare this activation angle against the current tilt uniform to modulate the icon's brightness and color.
- **Color Mapping:** Both the sheen and the icons should sample from a spectral color ramp based on the view angle and their specific normal/activation values.

## Confidence
- **Cards Shown:** High. The card name and set stamp are clearly legible.
- **Static Appearance:** High. The shapes and sheen are distinct and easily identifiable.
- **Tilt Animation:** High. The movement of the sheen and the color shifting of the elements are clearly visible across the frame sequence and corroborated by the narration.
- **Layer Structure Hypothesis:** High. This aligns with standard Pokémon card manufacturing techniques for this era.
- **Distinguishing Features:** High. The pattern is highly specific and recognizable.
- **Shader Notes:** Medium. While the visual effect is clear, the exact mathematical implementation for the independent icon activation angles might require some iteration to look perfectly authentic.