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
 *  - **NEVER quantize.** This is the expensive one. `quantize()` normalises each
 *    mesh's positions and parks the inverse transform on the mesh's NODE — and
 *    the runtime's rider system (`riders.ts`) computes an absolute placement and
 *    writes the whole TRS of those same nodes, which throws the de-quantisation
 *    away. The visible result is `Hinge_Pin_R` inflating into a cylinder wider
 *    than the character; the measurable one is every parity frame losing 5-10
 *    points of IoU at a uniform area ratio of 1.08. Quantizing would take the
 *    asset to 1.39 MB. It is not worth it.
 *
 *  - **never `optimize` wholesale**: `--simplify` defaults on and would average
 *    away exactly the facial detail the character is made of.
 *
 *  - **the grain map is a NORMAL map: lossless only.** Lossy compression on a
 *    normal map shows up as shading artefacts across a large flat surface, which
 *    is exactly what this one covers.
 *
 * The SDF glyph atlas is embedded here AND shipped standalone at
 * `models/decke/symbol_sdf_atlas.png`. The runtime replaces both eye materials
 * with an analytic shader that loads the standalone file, so the embedded copy
 * is 1.04 MB of dead weight. We swap it for a 1x1 stub rather than deleting the
 * texture, so the glb stays valid on its own.
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
