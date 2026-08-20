/**
 * Material fixups for things the glTF exporter flattened.
 *
 * glTF's material model is a fixed PBR shape, so any Blender node graph richer
 * than that gets reduced to the nearest factor set — sometimes to something that
 * renders very wrong rather than merely approximate. These are the cases where
 * the flattening is visibly incorrect and can be corrected from data we have.
 *
 * (The eyes are the extreme case of the same problem — a 215-node analytic graph
 * that exports as a flat untextured material — but they are large enough to have
 * their own rebuilt shader in `eyes/`.)
 */
import type {
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
} from 'three'

/**
 * Blender's card fronts carry a holographic foil sheen: a 58-node graph whose
 * Emission has **Strength 0.25** and takes its colour from a Color Ramp (pink
 * through amber). None of that survives export — glTF keeps only an
 * `emissiveFactor`, which came out as **[1, 1, 1] at full intensity**.
 *
 * The result is a card emitting pure white at strength 1: the artwork washes out
 * completely and the card reads as a blank slab. Against Blender's render the
 * card is unmistakable — theirs shows legible art, ours a white rectangle.
 *
 * Restoring the emissive alone got the card back to legible but not to
 * holographic, which is how it was reviewed: "it doesn't seem like the cards
 * kept their holographic sheen, or if they did, it's very hard to see." A flat
 * emissive cannot be a foil, because the entire read of foil is that it CHANGES
 * WITH THE VIEWING ANGLE. A constant glow is the one thing it never does.
 *
 * So there are two halves here now.
 *
 * The emissive half is unchanged: weak (Blender's own 0.25) and tinted by the
 * artwork rather than by white, which is what stops the card washing out.
 *
 * The sheen half is `KHR_materials_iridescence`'s thin-film model, which three
 * implements natively on `MeshPhysicalMaterial`. This is not an approximation of
 * holographic foil — thin-film interference is the physics foil actually works
 * by, so the hue sweep across the card as it turns comes out of the BRDF rather
 * than out of a texture we would have had to invent. It also means the effect is
 * strongest exactly when the reviewer would look for it: on the cards tumbling
 * through the stash flight and orbiting during `loading`, where the angle to the
 * light is changing every frame.
 *
 * The thickness range is the visible band: 180 nm reads gold-green at grazing
 * angles, 520 nm magenta-blue face-on, which is the pink-through-amber sweep the
 * Blender ramp was doing by hand.
 *
 * ROUGHNESS IS PART OF THE FIX, and it is the same class of defect as the
 * emissive. `Card_Front_*` carries NO `roughnessFactor` in the glb at all, so
 * three takes glTF's default of 1.0 — perfectly diffuse, which no printed card
 * is and a foil card least of all. That default is why the first attempt at this
 * washed the artwork out instead of sharpening it: at roughness 1 the specular
 * lobe covers the entire hemisphere, so tinting it spreads the iridescence flat
 * across the whole card as a haze. Tightening the lobe is what turns the same
 * tint into a BAND that travels as the card turns, which is what foil looks
 * like. Compared side by side on the five stash cards in open air.
 */
const CARD_EMISSION_STRENGTH = 0.25
const CARD_FOIL = {
  iridescence: 0.9,
  /** Above the 1.5 of the card stock, so the film reads as a coating ON it. */
  iridescenceIOR: 1.35,
  thicknessRange: [180, 520] as [number, number],
  /** Card stock under a gloss laminate, not a matte sheet. See above. */
  roughness: 0.38,
  clearcoat: 0.35,
  clearcoatRoughness: 0.08,
} as const

export function fixupMaterials(root: Object3D): { cardsFixed: number } {
  let cardsFixed = 0
  const seen = new Set<Material>()

  root.traverse((o) => {
    const mesh = o as Mesh
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []

    for (const mat of mats) {
      if (seen.has(mat)) continue
      seen.add(mat)

      const std = mat as MeshStandardMaterial
      const name = std.name ?? ''

      // Only the FRONTS glow. The backs already export with a black emissive,
      // which is correct — the foil is printed on the face.
      if (!name.startsWith('Card_Front_')) continue
      if (!std.emissive) continue

      const white =
        std.emissive.r > 0.99 && std.emissive.g > 0.99 && std.emissive.b > 0.99
      if (!white) continue

      std.emissiveMap = std.map
      std.emissiveIntensity = CARD_EMISSION_STRENGTH

      // `KHR_materials_specular` is on every card front, so the loader has
      // already given them a MeshPhysicalMaterial and the thin-film uniforms
      // exist. The guard is there because the assertion is about the ASSET, and
      // an asset can be re-exported without the extension.
      const phys = std as MeshPhysicalMaterial
      if ('iridescence' in phys) {
        phys.iridescence = CARD_FOIL.iridescence
        phys.iridescenceIOR = CARD_FOIL.iridescenceIOR
        phys.iridescenceThicknessRange = CARD_FOIL.thicknessRange
        phys.clearcoat = CARD_FOIL.clearcoat
        phys.clearcoatRoughness = CARD_FOIL.clearcoatRoughness
      }
      std.roughness = CARD_FOIL.roughness
      std.needsUpdate = true
      cardsFixed++
    }
  })

  return { cardsFixed }
}
