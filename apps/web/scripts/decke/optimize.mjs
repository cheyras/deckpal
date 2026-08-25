/**
 * Optimize the Deck-E glb — the second pass, on top of `shrink.mjs`.
 *
 *   node apps/web/scripts/decke/optimize.mjs \
 *     apps/web/public/models/decke/decke.glb \
 *     apps/web/public/models/decke/decke.opt.glb [--tier=b]
 *
 * `shrink.mjs` takes the raw Blender export from 7.48 MB to 2.92 MB and stops,
 * because it deliberately leaves the geometry as float32 — see its header, and
 * the "never quantize" note in `decke/README.md`. This script is what happens
 * when that ban is re-examined rather than inherited.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE 2.92 MB ACTUALLY IS  (decoded, unique accessors)
 *
 *   TARGET_POSITION  1239.9 KB     POSITION    198.4 KB     images   857 KB
 *   TARGET_NORMAL    1239.9 KB     NORMAL      198.4 KB     JSON     119 KB
 *                                  TEXCOORD_0   98.3 KB     INDICES  115.7 KB
 *
 * The morph targets are 78% of the geometry. Two things that look like the
 * answer are not, and both were measured before being dropped:
 *
 *  - **Sparse accessors do not help.** 86.7% of morph cells actually move
 *    (`Body_*` deform every vertex of the shells by construction). Sparse
 *    encoding would cost 1432 KB against 1240 KB dense — it makes it BIGGER.
 *
 *  - **The paired body morphs are not negations of each other.** `Body_Bend_Fwd`
 *    vs `Body_Bend_Back` carry identical max magnitudes, which looks like a
 *    mirror and is not one: the negation residual is 7.9e-2 against a scale of
 *    0.399 on the lid. Only three NORMAL pairs on the flat cards negate exactly.
 *    Storing one and driving it with a negative influence would be visibly wrong.
 *
 * What IS true is that float32 is absurd precision for this asset. The largest
 * mesh spans 2.198 blender units; at 14 bits that is a 1.3e-4 BU step, and he
 * renders about 0.01 BU per pixel, so the quantisation error is a hundredth of a
 * pixel. The old ban was never about visual quality.
 *
 * ---------------------------------------------------------------------------
 * WHY "NEVER QUANTIZE" WAS RIGHT, AND HOW IT IS FIXED
 *
 * `quantize()` normalises each mesh's positions and parks the inverse transform
 * on the mesh's NODE. In this glb the mesh nodes ARE the rig nodes —
 * `Hinge_Pin_R_anim`, `Card_Deck_anim`, `Stash_Card_1` all carry both a mesh and
 * a TRS that the runtime overwrites every frame (`riders.ts` decomposes a solved
 * world matrix straight onto them; `cards.ts` writes their scale). The
 * de-quantisation is thrown away on frame one, which is the `Hinge_Pin_R`
 * "cylinder wider than the character".
 *
 * The fix is to stop making those two things the same node. After quantising we
 * measure the transform `quantize()` added — `D = M_before^-1 * M_after`, which
 * is pure translation and scale — put the ORIGINAL TRS back on the rig node, and
 * move the mesh onto a new child node carrying `D`. The rig node is then free to
 * be overwritten exactly as before, and the de-quantisation rides underneath it
 * where nothing writes to it.
 *
 * Two runtime call sites assumed "the rig node IS the mesh" and are patched to
 * resolve the mesh by traversal instead (`DeckE.ts`'s eye material binding and
 * `eyeSocket.ts`'s vertex reads). Everything else already traverses —
 * `cardArt.ts`, `materials.ts`, `rig.ts` and `eyeSocket.ts`'s own mesh lookup
 * were written that way, and `eyeSocket.ts`'s comment already anticipated a
 * quantised glb.
 *
 * `eyeSocket.ts` additionally READS vertex positions and compares them against
 * rest constants in blender units. Under quantisation the attribute is
 * normalised-integer, so those reads are composed with the mesh node's own
 * matrix — which, because of the wrapper above, is exactly the de-quantisation.
 *
 * ---------------------------------------------------------------------------
 * TIERS
 *
 *   a  Control. No quantisation, no runtime change — textures and dead UVs
 *      only. Useful for bisecting; not worth shipping (2.88 MB).
 *   b  THE SHIPPED RECIPE. 592 KB on disk, 337 KB over the wire, against
 *      2850 KB / 1963 KB for the asset it replaced.
 *   c  Tier b with the morph normals DROPPED. Smaller again, and the only tier
 *      that is visibly worse — do not ship it. It is kept so the regression
 *      stays reproducible on `/dev/decke-compare`.
 *
 * (There was briefly a `bx` between `b` and `c`. It is now `b`, because that is
 * what the owner called it after looking at it, and a tier named `bx` sitting
 * next to a different tier named `b` is a mistake waiting to be made. The old
 * conservative `b` — 14-bit positions, 512² grain, 934 KB — is retired: it was
 * strictly larger for no measurable fidelity gain.)
 *
 * MEASURED, on `/dev/decke-compare`'s own harness: 15 poses rendered from each
 * glb in its own page and diffed per pixel over the character. Two runs of the
 * SAME file come back bit-exact, so the instrument has no noise floor to hide
 * behind.
 *
 *   tier   raw     wire     worst mean Δ   worst % of pixels off by >8/255
 *   ----   ------  ------   ------------   -------------------------------
 *   b      592 KB  337 KB   1.76 / 255     2.0%   (card_stash)
 *   c      491 KB  ~280 KB  8.50 / 255     31.5%  (bend_back)
 *
 * THE WIRE COLUMN IS BROTLI q=3, NOT q=11, and the difference is not academic.
 * Vercel compresses `model/gltf-binary` on the fly at a low quality level:
 * `Content-Encoding: br` is confirmed on deckpal.app, and a real GET of the old
 * asset returned 2010812 bytes, which q=3 reproduces to within 25 bytes while
 * q=11 (node's default, and the obvious thing to measure with) claims 1852498.
 * Compressing locally with the default and quoting that number overstates every
 * saving by about 13%.
 *
 * Tier c is the whole argument for keeping morph normals. Dropping them leaves
 * shading frozen at the base pose while the shell deforms, and on a body that is
 * metallic 0.85 that repaints a third of him. Note WHERE it shows: the mouth
 * poses stay under 5, and it is `bend_fwd` / `bend_back` — the whole-body
 * deformations — that fall apart. Keeping them at 8 bits costs 182 KB raw and is
 * indistinguishable from 10 or 16 (1.687 vs 1.679 worst mean).
 *
 * `@gltf-transform/*`, `meshoptimizer` and `sharp` are required and are
 * deliberately not repo dependencies — same policy as `shrink.mjs` and
 * Playwright. Install them where you run this.
 */
import { NodeIO, PropertyType } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { dedup, prune, quantize, reorder, textureCompress } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import { createRequire } from 'node:module'
import { statSync } from 'node:fs'

const sharp = createRequire(import.meta.url)('sharp')
await MeshoptEncoder.ready
await MeshoptDecoder.ready

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith('--'))
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const [inPath, outPath] = positional
if (!inPath || !outPath) {
  console.error('usage: optimize.mjs <in.glb> <out.glb> [--tier=a|b|c]')
  process.exit(1)
}

const tier = flag('tier', 'b').toLowerCase()
if (!['a', 'b', 'c'].includes(tier)) {
  console.error(`unknown tier "${tier}" — expected a, b or c`)
  process.exit(1)
}

/** Every knob, per tier. Overridable individually for bisecting a regression. */
const TIERS = {
  a: { quantize: false, pos: 14, morphNormals: 'keep', grain: 1024, grainLossless: true, card: 800, cardQuality: 95 },
  // THE SHIPPED RECIPE. Every number here was chosen by measuring, not by taste
  // — see the table in the header.
  b: { quantize: true, pos: 12, morphNormals: 8, grain: 256, grainLossless: false, card: 320, cardQuality: 80 },
  c: { quantize: true, pos: 12, morphNormals: 'drop', grain: 256, grainLossless: false, card: 320, cardQuality: 75 },
}
const cfg = { ...TIERS[tier] }
if (flag('grain')) cfg.grain = Number(flag('grain'))
if (flag('card')) cfg.card = Number(flag('card'))
if (flag('morph-normals')) cfg.morphNormals = flag('morph-normals')
if (flag('quantize')) cfg.quantize = flag('quantize') !== 'false'
if (flag('pos')) cfg.pos = Number(flag('pos'))

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const doc = await io.read(inPath)
const root = doc.getRoot()
const log = []
const note = (s) => { log.push(s); console.log(s) }

note(`tier ${tier}: ${JSON.stringify(cfg)}`)

// ---------------------------------------------------------------------------
// 1. Dead UVs.
//
// Ten meshes carry TEXCOORD_0 for a material with no texture of any kind
// (`Deck_Edge`, `DeckBox_Rose400`). glTF keeps them because Blender exported
// them; nothing can ever sample them.
// ---------------------------------------------------------------------------
{
  let dropped = 0
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()
      if (!mat) continue
      const textured =
        mat.getBaseColorTexture() || mat.getNormalTexture() || mat.getEmissiveTexture() ||
        mat.getMetallicRoughnessTexture() || mat.getOcclusionTexture()
      if (textured) continue
      for (const sem of prim.listSemantics()) {
        if (!sem.startsWith('TEXCOORD_')) continue
        prim.setAttribute(sem, null)
        dropped++
      }
      for (const t of prim.listTargets()) {
        for (const sem of t.listSemantics()) if (sem.startsWith('TEXCOORD_')) t.setAttribute(sem, null)
      }
    }
  }
  note(`dead UV sets dropped: ${dropped}`)
}

// ---------------------------------------------------------------------------
// 2. Morph normals.
//
// 1239.9 KB raw — as much as the morph positions. At 8 bits they are 310 KB
// before compression and the error is under half a degree, which nothing in
// this shading model can show. Dropping them entirely is tier c: three.js then
// leaves normals at the base pose, so an open mouth lights as a closed one.
// ---------------------------------------------------------------------------
if (cfg.morphNormals === 'drop') {
  let dropped = 0
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const t of prim.listTargets()) {
        if (t.getAttribute('NORMAL')) { t.setAttribute('NORMAL', null); dropped++ }
      }
    }
  }
  note(`morph NORMAL targets dropped: ${dropped}`)
}

// ---------------------------------------------------------------------------
// 3. Textures.
//
// The grain map is a NORMAL map and `shrink.mjs`'s "lossless only" rule holds —
// lossy compression on a normal map covering a large flat surface shows up as
// shading bands. Resolution is a different knob from precision, and this map is
// tiling grain: halving it halves the grain's world size, not its correctness.
// Tier c goes to near-lossless, which is still a per-pixel bound rather than
// the frequency-domain smear that ordinary lossy webp applies.
//
// The card art is a FALLBACK. `cardArt.ts` puts the user's real cards on every
// face he shows; these six textures are what he holds before that resolves, and
// what a deployment with no catalog sees.
// ---------------------------------------------------------------------------
{
  /** Std-dev of each channel away from the flat normal (128, 128, 255) — the
   *  amplitude of the grain, which is the only thing about a noise field anyone
   *  can actually see. */
  const amplitude = async (buf) => {
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
    const flat = [128, 128, 255]
    const out = []
    for (let c = 0; c < 3; c++) {
      let s2 = 0, n = 0
      for (let i = c; i < data.length; i += info.channels) { const d = data[i] - flat[c]; s2 += d * d; n++ }
      out.push(Math.sqrt(s2 / n))
    }
    return out
  }

  for (const tex of root.listTextures()) {
    const name = tex.getName() || '?'
    if (name.includes('symbol_sdf_atlas')) continue // already a 1x1 stub
    const isNormal = name.includes('grain_normal')
    const size = isNormal ? cfg.grain : cfg.card
    const original = Buffer.from(tex.getImage())
    const [w, h] = tex.getSize() ?? [0, 0]
    if (!w || !h) continue

    const scale = Math.min(1, size / Math.max(w, h))
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))

    let pipe = sharp(original)
    if (scale < 1) pipe = pipe.resize(tw, th, { fit: 'fill', kernel: 'lanczos3' })
    const opts = isNormal
      ? (cfg.grainLossless ? { lossless: true } : { quality: 90 })
      : { quality: cfg.cardQuality }
    const buf = await pipe.webp(opts).toBuffer()

    // Re-encoding can INFLATE. The shipped grain map is 526.9 KB of lossy webp
    // (a `VP8 ` chunk — despite `shrink.mjs` asking for lossless, which is worth
    // knowing before trusting that rule); a true lossless re-encode of its
    // decoded pixels is 1769 KB, 3.4x larger. Never take a worse deal.
    if (buf.byteLength >= original.byteLength) {
      note(`  texture ${name.padEnd(22)} ${w}x${h} kept as-is (re-encode would be ${(buf.byteLength / 1024).toFixed(1)} KB)`)
      continue
    }

    tex.setImage(buf).setMimeType('image/webp')
    note(`  texture ${name.padEnd(22)} ${w}x${h} -> ${tw}x${th}  ${(original.byteLength / 1024).toFixed(1)} KB -> ${(buf.byteLength / 1024).toFixed(1)} KB`)

    // ---- the grain map's two compensations -------------------------------
    //
    // This map is per-pixel NOISE: neighbouring texels are near-uncorrelated
    // (mean |centre - 4-neighbour mean| is 4.72 against an amplitude of 11.18).
    // Two consequences, and both are correctable rather than fatal:
    //
    //  - Shrinking AVERAGES uncorrelated samples, so the grain gets quieter.
    //    Measured, not assumed: rescale `normalTexture.scale` by the amplitude
    //    ratio and the surface keeps the strength it was authored with.
    //  - Fewer texels over the same UVs makes each grain feature bigger. The
    //    map already tiles (`KHR_texture_transform.scale` 2.5), so multiplying
    //    that by the same factor keeps the grain the size it was on screen.
    //
    // What is NOT recoverable is per-pixel identity, and for a stochastic grain
    // that is not a thing anyone can see — one random field looks like another.
    if (!isNormal) continue
    const a0 = await amplitude(original)
    const a1 = await amplitude(buf)
    const xy0 = (a0[0] + a0[1]) / 2
    const xy1 = (a1[0] + a1[1]) / 2
    const ratio = xy1 > 1e-6 ? xy0 / xy1 : 1

    for (const mat of root.listMaterials()) {
      const info = mat.getNormalTextureInfo?.()
      if (mat.getNormalTexture() !== tex) continue
      const was = mat.getNormalScale()
      mat.setNormalScale(was * ratio)
      const xform = info?.getExtension?.('KHR_texture_transform')
      let sx = 1
      if (xform) {
        const s = xform.getScale()
        sx = w / tw
        xform.setScale([s[0] * sx, s[1] * (h / th)])
      }
      note(
        `    grain amplitude ${xy0.toFixed(2)} -> ${xy1.toFixed(2)}; ` +
        `normalScale ${was.toFixed(3)} -> ${(was * ratio).toFixed(3)}; ` +
        `tile scale x${sx.toFixed(2)}`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Hygiene. Identical stash-card geometry is five separate meshes.
//
// NOTE: nodes are NEVER pruned, and this is not caution for its own sake. The
// rig is mostly CHILDLESS EMPTIES — `Ctrl_Pupil_L_anim`, `Ctrl_Symbol_R`,
// `Ctrl_Blink_anim` and 26 others carry no mesh and no children, and every one
// of them is driven by name from `rig.ts`. A default `prune()` deletes all 29 of
// them as dead leaves and the character loads with no face.
// ---------------------------------------------------------------------------
await doc.transform(
  // MATERIAL is deliberately absent. `Eye_L_Face_anim` and `Eye_R_Face_anim` are
  // byte-identical (both point at the 1x1 atlas stub) and dedup merges them —
  // which is a silent identity change on the two materials `DeckE.ts` replaces
  // per side, for no bytes, since both are overwritten at load anyway.
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
  prune({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE], keepAttributes: false }),
)

// ---------------------------------------------------------------------------
// 5. Quantisation, and keeping the de-quantisation off the rig nodes.
//
// The wrapper is inserted BEFORE quantising, not after. Doing it after means
// recovering what `quantize()` added as `M_before^-1 * M_after`, and that
// inverse does not exist here: `Card_Loose_Rose_anim` and all five
// `Stash_Card_*` nodes rest at scale ZERO, because on this character existence
// IS scale (a despawned card is scale 0, not alpha 0). Their matrices are
// singular by design.
//
// Inserting first sidesteps the arithmetic entirely. The wrapper owns the mesh
// when `quantize()` runs, so `quantize()` writes the de-quantisation onto the
// wrapper and never touches the rig node at all.
// ---------------------------------------------------------------------------
if (cfg.quantize) {
  doc.createExtension(KHRMeshQuantization).setRequired(true)

  let wrapped = 0
  for (const node of root.listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const wrapper = doc.createNode(`${node.getName()}__qmesh`).setMesh(mesh)
    node.setMesh(null)
    // First child, so anything that takes the first mesh it finds under a rig
    // node (`eyeSocket.ts` does) keeps finding the same one.
    const kids = node.listChildren()
    node.addChild(wrapper)
    for (const k of kids) { node.removeChild(k); node.addChild(k) }
    wrapped++
  }
  note(`de-quantisation wrappers created: ${wrapped}`)

  await doc.transform(
    quantize({
      quantizePosition: cfg.pos,
      // Applies to base AND morph normals. `morphNormals` is the knob because
      // the morph deltas are the ones worth arguing about — they are half the
      // geometry, and dropping them entirely (tier c) is measurably visible:
      // `bend_fwd` moves 29% of his pixels by more than 8/255, because the
      // shell deforms while the shading stays at the base pose on a body that
      // is metallic 0.85. At 10 bits nothing moves more than 1.3/255.
      quantizeNormal: cfg.morphNormals === 'drop' ? 10 : Number(cfg.morphNormals),
      quantizeTexcoord: 12,
      quantizeGeneric: 12,
      quantizationVolume: 'mesh',
    }),
  )
}

// ---------------------------------------------------------------------------
// 6. Vertex-cache ordering, then meshopt.
// ---------------------------------------------------------------------------
await doc.transform(reorder({ encoder: MeshoptEncoder }))
doc
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  // QUANTIZE in both cases — this is meshopt's encoder mode, not the
  // `quantize()` transform, and it is what `shrink.mjs` already ships. FILTER
  // measured WORSE here (tier a came out larger than its own input).
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })

await io.write(outPath, doc)

const beforeSize = statSync(inPath).size
const afterSize = statSync(outPath).size
note('')
note(`${inPath}  ${(beforeSize / 1e6).toFixed(3)} MB`)
note(`${outPath}  ${(afterSize / 1e6).toFixed(3)} MB  (${((1 - afterSize / beforeSize) * 100).toFixed(1)}% smaller)`)
