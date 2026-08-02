Here is the implementation-grade spec for the "Mirror" holofoil pattern, based on the provided frames and narration.

## Cards Shown
*   **Raw Foil Sheet / Blank Card**: Frames 1-8 show a completely blank, unprinted rectangular sheet of reflective material. No specific Pokémon card is shown in this segment.

## Static Appearance
*   **Element Shapes**: None. The surface is completely uniform and devoid of any printed or embossed patterns, stars, orbs, or lines.
*   **Colors**: Silver/metallic grayscale. The color is entirely dependent on the light source and the environment it reflects.
*   **Location**: Covers the entire surface of the blank sheet shown. (According to the narration, on actual cards like Neo series Shining Pokémon, this foil is exposed only on the Pokémon subject itself, with the background printed opaque).

## Tilt Animation
*   **Highlight Movement**: Between frame 1 and frame 4, as the sheet is tilted, a broad, soft, white specular highlight from the primary light source travels smoothly across the surface.
*   **Environmental Reflection**: Between frame 5 and frame 8, the angle of the sheet catches the reflection of the person holding the camera/phone. This reflection moves and distorts slightly as the sheet's angle continues to change, behaving exactly like a standard mirror.
*   **Lack of Color Shift**: There is no hue rotation or rainbow effect visible at any angle in these frames (the narration explicitly distinguishes this from a "rainbow mirror").
*   **Lack of Sparkle**: No elements pop in or out; the surface remains a continuous, unbroken reflective plane.

## Layer Structure Hypothesis
*   **Base Layer**: A single, flat layer of highly reflective metallic foil with no embossing or texture.
*   **Ink Layer (Hypothetical)**: While not visible on this blank sheet, on a finished card, opaque ink would be printed directly on top of this foil layer. The "mirror" effect is achieved simply by leaving specific areas (like the character art) completely unprinted, exposing the raw foil beneath.

## Distinguishing Features
*   **Zero Pattern**: The defining characteristic is the complete absence of any holographic pattern, texture, or structural design.
*   **True Reflection**: It is reflective enough to act as a mirror, showing clear shapes from the surrounding environment (like the camera in frames 6-8), rather than just catching abstract light glints.
*   **Monochrome**: Differentiated from "Rainbow Mirror" by its strict silver/metallic appearance with no iridescent color shifts.

## Shader Notes
*   This is the simplest pattern to implement, requiring no custom holographic logic. A standard Physically Based Rendering (PBR) material is sufficient.
*   **Metallic**: Set to 1.0 (fully metallic).
*   **Roughness**: Set very low (e.g., 0.05 - 0.1). It is highly reflective but slightly diffused, not a mathematically perfect mirror.
*   **Environment Map**: The shader *must* sample an environment map (HDRI or reflection probe). The visual interest of this foil comes entirely from reflecting its surroundings.
*   **Albedo/Base Color**: White or very light gray.
*   **Tilt Uniform**: The tilt uniform simply rotates the mesh's normals relative to the virtual camera and environment map, which will naturally drive the movement of the specular highlight and the environmental reflections. No custom UV math is needed.

## Confidence
*   **Cards Shown**: High. It is clearly a blank sheet.
*   **Static Appearance**: High. The lack of features is unambiguous.
*   **Tilt Animation**: High. The reflection of the camera is clearly visible and behaves as expected.
*   **Layer Structure Hypothesis**: High. Supported by the visual evidence of the raw sheet and standard card manufacturing processes.
*   **Distinguishing Features**: High. Easily separated from patterned foils.
*   **Shader Notes**: High. Standard PBR perfectly replicates this physical material.