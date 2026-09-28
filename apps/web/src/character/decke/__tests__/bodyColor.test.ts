/**
 * He renders in his true colours, and that has to stay true when either side moves.
 *
 * The owner saw him "like someone ran a desaturate filter over him entirely":
 * eye whites grey, bolts and mouth muted, the body a grayed teal. The cause was
 * the app rendering through Blender's AgX curve (`stage.ts`); the app is now on
 * Neutral, and AgX is kept for the parity harness only. The body additionally
 * takes the brand colour and a painted-shell metalness (`brandBody`). These pin
 * the pieces a later edit could quietly undo; the rendered-pixel checks live in
 * the browser suite, because only a real renderer can say what colour he came out.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Color, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, BoxGeometry } from 'three'
import { BODY_MATERIAL, BODY_METALNESS, BRAND_CYAN, fixupMaterials } from '../materials'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const THEME = read('../../../theme.css')

test('his cyan is the brand token, not a copy that drifted', () => {
  const m = /--color-brand-primary-400:\s*(#[0-9a-fA-F]{6})/.exec(THEME)
  assert.ok(m, '--color-brand-primary-400 is gone from theme.css')
  assert.equal(BRAND_CYAN.toLowerCase(), m[1].toLowerCase(), 'the brand cyan moved and he did not')
})

function body(): { root: Group; mat: MeshPhysicalMaterial; other: MeshStandardMaterial } {
  const root = new Group()
  const mat = new MeshPhysicalMaterial({ name: BODY_MATERIAL, color: new Color('#22d3ee'), metalness: 0.85 })
  const other = new MeshStandardMaterial({ name: 'DeckBox_Rose400', color: new Color('#fb7185') })
  root.add(new Mesh(new BoxGeometry(), mat), new Mesh(new BoxGeometry(), other))
  return { root, mat, other }
}

test('the body takes the brand colour and a painted shell, and nothing more', () => {
  const { root, mat, other } = body()
  const { bodyFixed } = fixupMaterials(root)
  assert.equal(bodyFixed, true, 'the body material was not found by name — was the glb re-exported?')
  assert.equal('#' + mat.color.getHexString(), BRAND_CYAN)
  assert.equal(mat.metalness, BODY_METALNESS)
  assert.ok(BODY_METALNESS < 0.5, 'a mostly metallic shell is a tint on grey reflections: his faces go dark again')
  // No per-material boost: same curve, no emissive, same program as the rest.
  assert.equal(mat.emissive.getHex(), 0, 'the body glows')
  assert.equal(mat.toneMapped, true, 'the body skips the tone curve the rest of him is on')
  const shader = { fragmentShader: '#include <tonemapping_fragment>', vertexShader: '', uniforms: {} }
  mat.onBeforeCompile(shader as never, undefined as never)
  assert.equal(shader.fragmentShader, '#include <tonemapping_fragment>', 'the body swaps its own tone curve again')
  assert.equal('#' + other.color.getHexString(), '#fb7185', 'another material was recoloured')
})

test('the Blender look keeps the authored body for the parity harness', () => {
  const { root, mat } = body()
  const { bodyFixed } = fixupMaterials(root, { brand: false })
  assert.equal(bodyFixed, false)
  assert.equal('#' + mat.color.getHexString(), '#22d3ee')
  assert.equal(mat.metalness, 0.85)
})

test('the app renders through Neutral; only the parity harness asks for AgX', () => {
  const stage = read('../stage.ts')
  assert.match(stage, /toneMapping = 'neutral',/, "createStage's default is no longer the Neutral curve")
  const decke = read('../DeckE.ts')
  assert.match(decke, /toneMapping: opts\.look === 'blender' \? 'agx' : 'neutral'/, 'DeckE no longer maps its look to a curve')
  const dev = read('../../../routes/dev/Decke.tsx')
  assert.match(dev, /look: parity \? 'blender' : 'app'/, 'the parity harness no longer compares like for like')
})
