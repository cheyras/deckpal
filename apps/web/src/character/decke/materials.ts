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
import type { Material, Mesh, MeshStandardMaterial, Object3D } from 'three'

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
 * We cannot reproduce the ramp (it is view-dependent procedural noise), but we
 * can restore the two things that actually matter: the sheen is WEAK, and it is
 * tinted by the artwork rather than by white. Driving the emissive from the base
 * colour map at Blender's own 0.25 does both.
 */
const CARD_EMISSION_STRENGTH = 0.25

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
      std.needsUpdate = true
      cardsFixed++
    }
  })

  return { cardsFixed }
}
