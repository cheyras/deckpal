/**
 * Structural diff between the shipped Deck-E glb and an optimized one.
 *
 *   node apps/web/scripts/decke/verify-opt.mjs <original.glb> <optimized.glb>
 *
 * Everything this checks has already gone wrong once while building
 * `optimize.mjs`, and every one of them fails SILENTLY at runtime — the
 * character loads, renders, and is subtly or completely wrong:
 *
 *  - A default `prune()` deleted 29 nodes. The rig is mostly childless empties
 *    (`Ctrl_Pupil_L_anim`, `Ctrl_Symbol_R`, `Ctrl_Blink_anim`, …) that carry no
 *    mesh and no children and are driven BY NAME from `rig.ts`. Losing them
 *    costs the face, and nothing throws.
 *  - Morph targets are driven by NAME through `morphTargetDictionary`, so the
 *    per-mesh `targetNames` order is load-bearing. A reordered target list
 *    silently maps "mouth open" onto "lean left".
 *  - `riders.ts` and `cards.ts` write the whole TRS of the nodes they own. Those
 *    nodes must keep the transform they were authored with — a `quantize()` that
 *    leaves its de-quantisation on them is the `Hinge_Pin_R` cylinder bug.
 *
 * Exits non-zero on any structural difference.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
await MeshoptDecoder.ready
await MeshoptEncoder.ready

const [, , aPath, bPath] = process.argv
if (!aPath || !bPath) {
  console.error('usage: verify-opt.mjs <original.glb> <optimized.glb>')
  process.exit(1)
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const A = await io.read(aPath)
const B = await io.read(bPath)

const problems = []
const fail = (s) => problems.push(s)
const ok = (s) => console.log(`  ok   ${s}`)

/** The wrapper nodes `optimize.mjs` inserts to keep the de-quantisation off the
 *  rig nodes. They are additive and expected. */
const isWrapper = (name) => name.endsWith('__qmesh')

// --- 1. every original node still exists, by name --------------------------
{
  const an = new Set(A.getRoot().listNodes().map((n) => n.getName()))
  const bn = new Set(B.getRoot().listNodes().map((n) => n.getName()))
  const missing = [...an].filter((n) => !bn.has(n))
  const added = [...bn].filter((n) => !an.has(n) && !isWrapper(n))
  if (missing.length) fail(`${missing.length} node(s) missing: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}`)
  else ok(`all ${an.size} nodes present`)
  if (added.length) fail(`${added.length} unexpected node(s): ${added.slice(0, 12).join(', ')}`)
}

// --- 2. node parentage and local TRS are unchanged -------------------------
//
// A mesh may have moved onto a `__qmesh` child; the rig node itself must not
// have moved, scaled or rotated by so much as a float.
{
  const parentOf = (doc) => {
    const m = new Map()
    for (const n of doc.getRoot().listNodes()) for (const c of n.listChildren()) m.set(c.getName(), n.getName())
    return m
  }
  const pa = parentOf(A), pb = parentOf(B)
  const byName = (doc) => new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]))
  const na = byName(A), nb = byName(B)

  let trsBad = 0, parentBad = 0
  for (const [name, a] of na) {
    const b = nb.get(name)
    if (!b) continue
    if (pa.get(name) !== pb.get(name)) {
      fail(`node "${name}" reparented: ${pa.get(name) ?? '(root)'} -> ${pb.get(name) ?? '(root)'}`)
      parentBad++
    }
    const near = (x, y, tol) => x.every((v, i) => Math.abs(v - y[i]) <= tol)
    if (
      !near([...a.getTranslation()], [...b.getTranslation()], 1e-6) ||
      !near([...a.getRotation()], [...b.getRotation()], 1e-6) ||
      !near([...a.getScale()], [...b.getScale()], 1e-6)
    ) {
      fail(`node "${name}" TRS changed — anything that overwrites it will now disagree with the rig`)
      trsBad++
    }
  }
  if (!trsBad) ok('every original node keeps its authored TRS')
  if (!parentBad) ok('node parentage unchanged')
}

// --- 3. the nodes the runtime overwrites must not carry a de-quantisation ---
//
// `riders.ts` decomposes a solved world matrix onto these; `cards.ts` writes
// their scale. If quantisation left its transform here it is discarded on the
// first frame.
if (!B.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_mesh_quantization')) {
  ok('not quantized — rig nodes may hold geometry directly, as in the original')
} else {
  const WRITTEN = [
    'Card_Deck_anim', 'Card_Single_anim', 'Hinge_Pin_L_anim', 'Hinge_Pin_R_anim', 'Hinge_Pin_C_anim',
    'Card_Loose_Rose_anim', 'Card_Loose_Amber_anim',
    'Stash_Card_1', 'Stash_Card_2', 'Stash_Card_3', 'Stash_Card_4', 'Stash_Card_5',
  ]
  const nb = new Map(B.getRoot().listNodes().map((n) => [n.getName(), n]))
  let bad = 0
  for (const name of WRITTEN) {
    const n = nb.get(name)
    if (!n) { fail(`runtime-written node "${name}" is missing`); bad++; continue }
    if (n.getMesh()) {
      fail(`"${name}" still carries the mesh directly — quantisation would be overwritten every frame`)
      bad++
    }
  }
  if (!bad) ok(`all ${WRITTEN.length} runtime-written nodes are free of geometry`)
}

// --- 4. morph target names and ORDER, per mesh -----------------------------
{
  const names = (doc) => {
    const m = new Map()
    for (const mesh of doc.getRoot().listMeshes()) {
      const t = mesh.getExtras()?.targetNames
      if (t) m.set(mesh.getName(), t.join('|'))
    }
    return m
  }
  const ma = names(A), mb = names(B)
  let bad = 0
  for (const [mesh, list] of ma) {
    if (!mb.has(mesh)) continue // may have been deduped into another mesh
    if (mb.get(mesh) !== list) { fail(`mesh "${mesh}" morph target order changed:\n    was ${list}\n    now ${mb.get(mesh)}`); bad++ }
  }
  if (!bad) ok(`morph target names and order preserved on ${ma.size} mesh(es)`)
}

// --- 5. materials still exist by name, and card materials stay distinct -----
//
// `cardArt.ts` asserts material names (`Card_Front_*`) and clones per node.
// Deduping two card fronts into one material would put the same art everywhere.
{
  const ma = new Set(A.getRoot().listMaterials().map((m) => m.getName()))
  const mb = new Set(B.getRoot().listMaterials().map((m) => m.getName()))
  const missing = [...ma].filter((m) => !mb.has(m))
  if (missing.length) fail(`material(s) missing: ${missing.join(', ')}`)
  else ok(`all ${ma.size} materials present`)

  const fronts = B.getRoot().listMaterials().filter((m) => (m.getName() || '').startsWith('Card_Front_'))
  const distinct = new Set(fronts.map((m) => m))
  if (fronts.length && distinct.size !== fronts.length) fail('Card_Front_* materials were merged')
  else ok(`${fronts.length} Card_Front_* materials remain distinct`)
}

// --- 6. vertex counts unchanged (nothing was simplified away) --------------
{
  const count = (doc) => doc.getRoot().listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getAttribute('POSITION')?.getCount() ?? 0), 0)
  const ca = count(A), cb = count(B)
  // Dedup merges identical meshes, so the optimized total may be legitimately
  // lower; what must never happen is a mesh losing vertices to simplification.
  const byMesh = (doc) => {
    const m = new Map()
    for (const mesh of doc.getRoot().listMeshes()) {
      m.set(mesh.getName(), mesh.listPrimitives().reduce((n, p) => n + (p.getAttribute('POSITION')?.getCount() ?? 0), 0))
    }
    return m
  }
  const va = byMesh(A), vb = byMesh(B)
  let bad = 0
  for (const [name, n] of va) {
    if (!vb.has(name)) continue
    if (vb.get(name) !== n) { fail(`mesh "${name}" vertex count ${n} -> ${vb.get(name)} (simplification is banned: it averages away the face)`); bad++ }
  }
  if (!bad) ok(`vertex counts intact (${ca} -> ${cb}; any drop is mesh dedup, not simplification)`)
}

// --- 7. GEOMETRIC equivalence, in the rig node's own space -----------------
//
// The checks above are structural: they prove the graph still has the right
// shape. This one proves the SURFACE is still where it was, which is the thing
// quantisation actually risks.
//
// Compared in the RIG NODE's space, not world space, and that is deliberate.
// Five stash cards and both loose cards rest at scale ZERO — existence is scale
// on this character — so in world space their vertices all collapse onto a point
// and would compare as perfect on any asset at all. In the rig node's space the
// de-quantisation is the entire difference between the two files, which is
// exactly what needs measuring.
//
// Vertex ORDER is not comparable: `reorder()` runs on both files and optimises
// for the vertex cache, so index i is a different corner in each. This measures
// the one-sided Hausdorff distance instead — for every vertex in the optimized
// mesh, how far is the nearest vertex of the original — via a spatial hash.
{
  const localMatrix = (node) => {
    const [x, y, z, w] = node.getRotation()
    const [sx, sy, sz] = node.getScale()
    const t = node.getTranslation()
    const x2 = x + x, y2 = y + y, z2 = z + z
    const xx = x * x2, xy = x * y2, xz = x * z2
    const yy = y * y2, yz = y * z2, zz = z * z2
    const wx = w * x2, wy = w * y2, wz = w * z2
    return [
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz,
      t[0], t[1], t[2],
    ]
  }
  const apply = (m, p) => [
    m[0] * p[0] + m[3] * p[1] + m[6] * p[2] + m[9],
    m[1] * p[0] + m[4] * p[1] + m[7] * p[2] + m[10],
    m[2] * p[0] + m[5] * p[1] + m[8] * p[2] + m[11],
  ]
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

  /** mesh name -> points in the space of the rig node that owns it. */
  const pointsByMesh = (doc) => {
    const out = new Map()
    for (const node of doc.getRoot().listNodes()) {
      // A rig node either holds the mesh itself, or holds a `__qmesh` wrapper
      // that does. Either way we want the points in THIS node's space.
      const direct = node.getMesh()
      const wrapper = node.listChildren().find((c) => isWrapper(c.getName()) && c.getMesh())
      const mesh = direct ?? wrapper?.getMesh()
      if (!mesh) continue
      const m = direct ? IDENTITY : localMatrix(wrapper)
      const pts = []
      for (const prim of mesh.listPrimitives()) {
        const a = prim.getAttribute('POSITION')
        if (!a) continue
        const arr = a.getArray()
        const norm = a.getNormalized()
        // A normalized integer accessor reads back as raw ints; scale to [-1,1]
        // the way the spec (and three.js) does before the node transform.
        const denom = norm
          ? (arr.BYTES_PER_ELEMENT === 2 ? 32767 : arr.BYTES_PER_ELEMENT === 1 ? 127 : 1)
          : 1
        for (let i = 0; i < a.getCount(); i++) {
          const p = [arr[i * 3] / denom, arr[i * 3 + 1] / denom, arr[i * 3 + 2] / denom]
          pts.push(apply(m, p))
        }
      }
      if (pts.length) out.set(node.getName(), pts)
    }
    return out
  }

  const pa = pointsByMesh(A)
  const pb = pointsByMesh(B)

  let worstMesh = null
  let worstD = 0
  let checked = 0
  for (const [name, bPts] of pb) {
    const aPts = pa.get(name)
    if (!aPts) continue
    checked++
    // Spatial hash over the original's points.
    let cell = 0
    for (const p of aPts) cell = Math.max(cell, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]))
    cell = Math.max(cell / 32, 1e-4)
    const grid = new Map()
    const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
    for (const p of aPts) {
      const k = key(p[0], p[1], p[2])
      let bucket = grid.get(k)
      if (!bucket) grid.set(k, (bucket = []))
      bucket.push(p)
    }
    let maxD = 0
    for (const p of bPts) {
      let best = Infinity
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell)
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`)
        if (!bucket) continue
        for (const q of bucket) {
          const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2
          if (d < best) best = d
        }
      }
      if (best !== Infinity) maxD = Math.max(maxD, Math.sqrt(best))
    }
    if (maxD > worstD) { worstD = maxD; worstMesh = name }
  }

  // He is about 3 blender units tall and renders around 300 px, so 0.01 BU is
  // roughly one pixel. A 14-bit quantum on the largest mesh is 1.3e-4 BU.
  const TOL = 2e-3
  if (worstD > TOL) {
    fail(`geometry moved by up to ${worstD.toFixed(6)} BU on "${worstMesh}" (tolerance ${TOL}) — that is visible`)
  } else {
    ok(`surface within ${worstD.toExponential(2)} BU of the original across ${checked} mesh(es) (worst: ${worstMesh}); ~0.01 BU is one pixel`)
  }
}

// --- 8. report -------------------------------------------------------------
console.log('')
if (problems.length) {
  console.error(`FAIL — ${problems.length} structural problem(s):`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('PASS — the optimized glb is structurally equivalent to the original.')
