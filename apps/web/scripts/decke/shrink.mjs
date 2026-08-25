/**
 * Shrink the Deck-E glb.  7.48 MB -> 2.92 MB.
 *
 *   node apps/web/scripts/decke/shrink.mjs <raw-export.glb> apps/web/public/models/decke/decke.glb
 *
 * The raw export is not kept in the repo — it is re-exported from
 * `~/Documents/DeckPal Character/DeckPal_character_rig_v1.blend`, which is the
 * authority for everything about this character.
 *
 * Four constraints, each of which cost a debugging pass:
 *
 *  - **meshopt, NEVER Draco.** `KHR_draco_mesh_compression` structurally cannot
 *    carry morph targets, and every body deformation on this character is one.
 *
 *  - **Do not quantize HERE.** Everything this note used to say about the damage
 *    is still true — `quantize()` parks the inverse transform on the mesh's
 *    NODE, `riders.ts` overwrites the whole TRS of those same nodes, and the
 *    result is `Hinge_Pin_R` inflating into a cylinder wider than the character
 *    at a uniform area ratio of 1.08. What was wrong was the conclusion. The
 *    damage comes from the mesh and the rig SHARING a node, not from
 *    quantisation, and `scripts/decke/optimize.mjs` fixes that by moving each
 *    mesh onto a wrapper child before quantising. It runs on this script's
 *    output and takes it to 592 KB. See DECISIONS.md, 2026-08-24.
 *
 *  - **never `optimize` wholesale**: `--simplify` defaults on and would average
 *    away exactly the facial detail the character is made of.
 *
 *  - **the grain map is a NORMAL map**, and the `lossless: true` below has never
 *    actually taken effect: the shipped texture is a `VP8 ` chunk, which is
 *    lossy webp. Verified by reading the RIFF chunk id, and corroborated by size
 *    — a true lossless encode of its decoded pixels is 1769 KB against the
 *    526.9 KB that ships. So the rule this line asserts has not been in force,
 *    and the character has looked fine throughout. Treat it as unproven rather
 *    than as a constraint. (It is moot downstream: `optimize.mjs` replaces this
 *    texture with a 256² tile and compensates both its amplitude and its tiling
 *    factor, because the map is per-pixel noise rather than structure.)
 *
 * The SDF glyph atlas is embedded here AND shipped standalone at
 * `models/decke/symbol_sdf_atlas.png`. The runtime replaces both eye materials
 * with an analytic shader that loads the standalone file, so the embedded copy
 * is 1.04 MB of dead weight. We swap it for a 1x1 stub rather than deleting the
 * texture, so the glb stays valid on its own.
 *
 * `@gltf-transform/*` and `meshoptimizer` are required and are deliberately not
 * repo dependencies — nothing else in the repo needs them, and this script runs
 * once per re-export, not in CI. Install them where you run it
 * (`npm i @gltf-transform/core @gltf-transform/extensions
 * @gltf-transform/functions meshoptimizer`), or run it with a global copy —
 * same policy as Playwright in `parity/README.md`.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { textureCompress, reorder } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import { createRequire } from 'node:module'
import { statSync } from 'node:fs'

const sharp = createRequire(import.meta.url)('sharp')
await MeshoptEncoder.ready
await MeshoptDecoder.ready

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('usage: shrink.mjs <in.glb> <out.glb>')
  process.exit(1)
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(inPath)
const root = doc.getRoot()

// --- 1. stub out the embedded atlas ----------------------------------------
const stub = await sharp({
  create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
}).png().toBuffer()

let stubbed = 0
for (const tex of root.listTextures()) {
  if ((tex.getName() || '').includes('symbol_sdf_atlas')) {
    tex.setImage(stub).setMimeType('image/png')
    stubbed++
  }
}

// --- 2. textures ------------------------------------------------------------
// Card art is background detail seen small and at an angle, but `card_present`
// puts one of them front and centre, so q95 rather than the usual q82.
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /baseColorTexture/, quality: 95 }),
)
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /normalTexture/, lossless: true }),
)

// --- 3. geometry ------------------------------------------------------------
// `reorder` alone (vertex cache + overdraw ordering); NO `quantize`. See above.
await doc.transform(reorder({ encoder: MeshoptEncoder }))
doc
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })

await io.write(outPath, doc)

const before = statSync(inPath).size
const after = statSync(outPath).size
console.log(
  `stubbed ${stubbed} atlas texture(s)\n` +
    `${inPath}  ${(before / 1e6).toFixed(2)} MB\n` +
    `${outPath}  ${(after / 1e6).toFixed(2)} MB  (${((1 - after / before) * 100).toFixed(1)}% smaller)`,
)
