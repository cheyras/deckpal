# Striped vertical sheen — R3 Gemini re-spec (2026-08-03)

> Second vision pass over the corpus (8 keyframes + 10 dense clip frames), run with Chey's
> canon-lab critique (issue b4he65) embedded verbatim — his 'group reveal' and 'pivot toward
> each other toward the bottom' observations. Ringer run `foil-gemini-verification`, task
> `spec-striped-vertical-sheen-r3`, google/gemini-3.1-pro-preview. TWO rolls were made (the
> first failed a validator regex bug, since fixed — both are genuine model output and agree
> on phenomenology: grouped reveal through wide overlapping windows, hue across the lit
> group, constant hue along a stripe, visible lean pivoting '\' -> '|' -> '/' as groups hand
> off. They differ on mechanism: roll 1 read a static fanned/radial stripe array; roll 2
> (below) reads parallel stripes + perspective keystone revealed sequentially. The R3 shader
> implements a subtle authored fan + moving windows — both readings' on-screen behavior.
> Supersedes gemini-spec.md for tilt behavior; the original stays for layer structure.

Based on a close re-examination of the footage and the owner's specific feedback, here is the refined mechanical shader spec for the Sword & Shield 'Line' holofoil.

## Cards Shown
- Leon (SWSH Trainer Supporter)

## Static Appearance
The foil pattern consists of a regular array of vertical stripes spanning the full height of the artwork box. The stripes have uniform width and spacing. When unlit (e.g., the right side of the artwork in **Frame 9** or the left side in **Frame 16**), the stripes remain faintly visible as dark or silvery vertical segments, heavily dependent on the ambient light and the opacity of the printed ink above them.

## Tilt Animation
The animation is driven by changes in the viewing angle, revealing the underlying diffraction grating.

**Group Reveal Sequencing:**
The footage confirms the owner's first claim: the stripes do not light up as one single, continuous sweeping band. Instead, they light up in distinct "groups" or "windows" that sweep across the card.
- In **Frame 9**, a strong group of stripes is lit on the far left (red/orange), while a fainter, separate group is visible on the right (purple/red).
- As the card tilts (**Frame 11** to **Frame 13**), the left group shifts hue and begins to fade, while a new group in the middle becomes the dominant bright area.
- By **Frame 17**, the left group is entirely dark, the middle group is bright blue, and a new group on the right is lighting up red/orange.
- This indicates multiple, overlapping activation windows (likely corresponding to different diffraction orders) that move horizontally across the card as it tilts.

**The Pivot/Convergence Effect:**
The footage also explains the owner's second claim regarding the stripes "pivoting toward each other toward the bottom."
- This is an optical illusion caused by the interaction of **perspective keystoning** and the **sweeping activation groups**.
- The physical stripes on the card are perfectly parallel. We can see this in **Frame 14**, where the card is held relatively flat to the camera, and the lit stripes in the center are vertical.
- However, when the card is tilted such that the bottom edge is further from the camera than the top edge (as seen in **Frame 9**), perspective causes all parallel vertical lines to appear to converge toward a vanishing point below the card.
- Because the activation window only illuminates a small subset of these lines at a time, the *visible* angle changes. When the left group is lit (**Frame 9**), the visible lines lean slightly right (`\`). As the light sweeps to the middle (**Frame 13**), the visible lines become vertical (`|`). As the light sweeps to the right (**Frame 17**), the visible lines lean slightly left (`/`).
- This sequential revealing of differently-angled segments of a keystoned parallel array creates the animated "pivoting" effect the owner described.

**Hue Variation:**
- **Across the lit region:** Hue varies horizontally across a lit group (e.g., in **Frame 11**, the left group transitions from yellow on its left edge to green on its right edge).
- **Along a single stripe:** The hue remains constant from top to bottom of any individual stripe at a given moment. The stripes act as solid vertical bars of color.

## Layer Structure Hypothesis
1.  **Card Stock:** Base layer.
2.  **Foil Layer:** A diffraction grating etched with uniform, parallel vertical lines.
3.  **Opaque Ink Layer:** White underprint and standard CMYK inks that block the foil in non-holographic areas (like the text box and borders).
4.  **Transparent/Translucent Ink Layer:** CMYK inks printed directly over the foil in the artwork box, tinting the reflected light but allowing the foil effect to shine through.

## Distinguishing Features
- Uniform, full-height vertical stripes.
- Illumination occurs in distinct, horizontally sweeping groups rather than a single continuous gradient.
- A pronounced "pivoting" illusion during tilt, caused by the sweeping illumination revealing different segments of a perspective-distorted parallel array.

## Shader Notes
To recreate this effect accurately, the shader must handle the discrete stripes, the grouped activation windows, and the perspective distortion (if not handled natively by a 3D camera).

```glsl
// UV coordinates (0.0 to 1.0)
vec2 uv = vUv;

// 1. Fake Perspective (if rendering on a flat 2D UI element)
// If rendering in a true 3D scene with a perspective camera, skip this step.
// This simulates the bottom of the card being tilted away.
float tiltDepth = 0.2; // Adjust based on simulated pitch
uv.x += (uv.x - 0.5) * (1.0 - uv.y) * tiltDepth;

// 2. Generate the discrete stripes
float numStripes = 40.0; // Approximate count across the card
float stripeIndex = floor(uv.x * numStripes);
// Snap UVx to the center of the current stripe so the whole stripe is one color
float snappedX = (stripeIndex + 0.5) / numStripes;

// 3. Grouped Activation Windows
// Use a repeating sine wave to create multiple "bands" of light
float tiltOffset = u_tiltAngle * 2.0; // Driven by device gyro or animation
float windowFrequency = 3.0; // Controls how many groups appear across the card
float activation = sin((snappedX + tiltOffset) * windowFrequency * 3.14159);

// Sharpen the windows to create distinct groups with dark gaps
activation = smoothstep(0.2, 0.8, activation);

// 4. Color Mapping
// Map the position to a rainbow spectrum.
// The color shifts as the tilt changes.
vec3 baseColor = getRainbowColor(fract(snappedX * 1.5 + tiltOffset));

// 5. Final Output
// Multiply the color by the activation window and a base intensity
vec3 finalFoil = baseColor * activation * 1.5;

// Unlit stripes remain faintly visible (base reflectivity)
vec3 unlitFoil = vec3(0.1); 
finalFoil = max(finalFoil, unlitFoil);
```

## Confidence
- **Cards Shown:** High
- **Static Appearance:** High
- **Tilt Animation:** High. The dense frame sequence (9-18) clearly confirms the owner's observation of grouped reveals (Claim 1). It also provides the necessary visual evidence to explain the "pivoting" (Claim 2) as an interaction between perspective keystoning and the sweeping activation windows, rather than physically non-parallel lines.
- **Layer Structure Hypothesis:** High
- **Distinguishing Features:** High
- **Shader Notes:** High. The provided logic directly addresses the grouped reveal and the perspective-driven pivot illusion.