/**
 * He is DeckPal's cyan, and that has to stay true when either side moves.
 *
 * The owner saw him "desaturated, slightly grayed out": the renderer's AgX curve
 * and an 85% metallic shell turned #22d3ee into #4c95a1 on screen. The fix
 * (`brandBody` in materials.ts) sets the brand colour, a lacquer-grade metalness
 * and a colour-preserving tone curve on the body alone. These pin the pieces a
 * later edit could quietly undo; the rendered-pixel check lives in the browser
 * suite, because only a real renderer can say what colour he came out.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Color, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, BoxGeometry } from 'three'
import { BODY_MATERIAL, BODY_METALNESS, BRAND_CYAN, fixupMaterials } from '../materials'

const THEME = readFileSync(new URL('../../../theme.css', import.meta.url), 'utf8')

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

test('the body takes the brand colour and sheds most of its metal', () => {
  const { root, mat } = body()
  const { bodyFixed } = fixupMaterials(root)
  assert.equal(bodyFixed, true, 'the body material was not found by name — was the glb re-exported?')
  assert.equal('#' + mat.color.getHexString(), BRAND_CYAN)
  assert.equal(mat.metalness, BODY_METALNESS)
  assert.ok(BODY_METALNESS < 0.5, 'a mostly metallic shell is a tint on grey reflections: the gray is back')
})

test('the body swaps the tone curve in its own shader, and nothing else does', () => {
  const { root, mat, other } = body()
  fixupMaterials(root)
  const shader = { fragmentShader: 'void main() {\n#include <tonemapping_fragment>\n}', vertexShader: '', uniforms: {} }
  mat.onBeforeCompile(shader as never, undefined as never)
  assert.match(shader.fragmentShader, /NeutralToneMapping\(/, 'the body is back on the renderer-wide AgX curve')
  assert.doesNotMatch(shader.fragmentShader, /#include <tonemapping_fragment>/)
  assert.equal(mat.customProgramCacheKey(), 'decke-body-neutral', 'shares a program with an AgX material')
  // The rest of him keeps the calibrated curve: its palette was chosen for it.
  const plain = { fragmentShader: '#include <tonemapping_fragment>', vertexShader: '', uniforms: {} }
  other.onBeforeCompile(plain as never, undefined as never)
  assert.equal(plain.fragmentShader, '#include <tonemapping_fragment>')
})
