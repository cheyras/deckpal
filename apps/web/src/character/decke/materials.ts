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
 *
 * TONE MAPPING IS A THIRD DEFECT, and it is not this file's fault but it is
 * this file's fix. The stage runs a Blender-matched AgX curve (`stage.ts`)
 * because the CHARACTER is calibrated against Blender's own AgX render, and
 * that calibration must not move. But AgX desaturates hard BY DESIGN — that is
 * the whole filmic look — and a 3x3 sRGB patch chart measured through it comes
 * back at a mean ΔE76 of 38.4 against the source art, with saturated primaries
 * losing 25-65 points of HSV saturation and bleeding 90-140/255 into their
 * "off" channels (pure red measured 223,104,90). Isolating the stage's other
 * knobs one at a time — `environmentIntensity = 0`, this card's own emissive
 * zeroed — moved that number by under 2%. Only removing tone mapping did:
 * `toneMapped = false` on the CARD FRONTS ALONE (never on the character —
 * that is the parity-critical part) drops the mean ΔE76 to 5.6 and the mean
 * saturation loss to 0.04, with the rest of him untouched.
 *
 * Skipping the curve also skips its highlight ROLLOFF, so a lit card that used
 * to compress gracefully toward white now clips there instead — measured at
 * 4.6% of the card's pixels blown to a flat 255 on at least one channel at the
 * old 0.25 emissive strength. Nothing else moves that number: environment
 * intensity swept 1.0 -> 0.4 changed it not at all, because the emissive term
 * is ADDITIVE and uncapped once the curve that used to absorb it is gone. Only
 * the emissive strength itself does, and 0.06 — not 0.25 — is what buys the
 * clip rate down to 0.44% (the residual is a sliver of the reddest patch
 * catching the key light dead-on, not a flaw a card ever presents edge-on) while
 * still holding the ΔE76 win at 8.8, and the "washed to a blank slab" failure
 * this constant was raised to fix, above, does not reopen at a lower value —
 * that bug was the emissive drowning the map at intensity 1.0 on top of
 * the OLD desaturating curve; with the curve gone the base albedo alone already
 * carries the artwork, so the emissive is doing much less work than it was.
 */
const CARD_EMISSION_STRENGTH = 0.06
/**
 * Despite the name, this is not a "holo pull" branch — every `Card_Front_*`
 * this fixup touches gets it, because the glb carries no rarity or foil signal
 * to branch on (checked live: all nine bound front materials, across every
 * slot and every stash clone, come back with identical `emissive [1,1,1]`, so
 * all nine take this same path). `CardArt` (this character's per-card input,
 * see `cardArt.ts`) has no foil field either — that lives on the 2D catalog's
 * `rarity`/variant data (`lib/format.ts`, `variantStyle.ts`), which nothing
 * here reads. So "foil" names what this treatment IS (thin-film + a laminate
 * clearcoat), not a subset of cards it is reserved for. A real foil/plain split
 * would be a `CardArt` change (out of scope here — see the file header), not a
 * materials.ts one, and until that exists these constants are the one look
 * every card gets.
 *
 * clearcoat's contribution against these RectAreaLights is real but small at
 * this magnitude — measured by pushing it to an extreme (1.0 / 0.02) against a
 * matched clearcoat-0 render: a genuine, angle-dependent 15-24/255 luminance
 * lift on a dark patch over roughly a 40deg turn, not the 80-100/255 swing a
 * separate base-layer event produces elsewhere in the same sweep. At 0.35 that
 * scales down further and reads as a gentle brightening rather than a
 * travelling glint. Left as-authored rather than tuned down for a "plain card"
 * bucket that does not exist yet.
 */
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

      // Skip the stage's AgX curve for the CARD FRONTS ONLY — see the header
      // comment above `CARD_EMISSION_STRENGTH` for the measurement. The
      // character himself keeps it (nothing outside this `if` block is
      // touched), because the stage's whole calibration is against Blender's
      // AgX render and that parity must not move.
      std.toneMapped = false

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
