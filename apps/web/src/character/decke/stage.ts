/**
 * Deck-E's stage: renderer, camera, colour management and lighting.
 *
 * Everything here is calibrated against the live .blend rather than the wiki,
 * because several wiki numbers turned out to be stale. See the Values notes on
 * each constant for which is which.
 *
 * THE LIGHTING IS NOT OPTIONAL. His body is metallic 0.85, and a metal surface
 * is almost entirely reflection — with nothing to reflect it renders near-black.
 * The Blender scene lights him with an HDRI *and* three area lights, and the
 * area lights were deliberately trimmed when the HDRI was added, so using only
 * one of the two renders him visibly wrong with otherwise-correct numbers.
 */
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Color,
  ColorManagement,
  CustomToneMapping,
  DataUtils,
  EquirectangularReflectionMapping,
  Euler,
  FloatType,
  HalfFloatType,
  MathUtils,
  Matrix4,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  RectAreaLight,
  Scene,
  ShaderChunk,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Texture,
  type ToneMapping,
} from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { BLENDER_CAMERA, blenderCameraQuaternion, blenderToThree, BODY_H, DEG } from './constants'

/** Measured off the world node tree: `Background.Strength = 0.6` exactly, with
 *  NO multiply node between the Environment Texture and the Background. The
 *  wiki's body-materials page says 2.6; that is wrong for this file. */
export const ENV_INTENSITY = 0.6

/**
 * Blender's Render > Clamping > Surface > **Indirect Light**, read off the live
 * file: `scene.eevee.clamp_surface_indirect = 10.0`, with
 * `clamp_surface_direct = 0.0` — so the direct half is OFF and only light-probe
 * (i.e. environment) contributions are capped. Blender's tooltip: "the maximum
 * value for indirect lighting on surface. Higher values will be **scaled down to
 * avoid too much noise and slow convergence**... Used by ray-tracing and
 * light-probes."
 *
 * IT IS A FIREFLY CLAMP, SO IT APPLIES PER SAMPLE, NOT TO THE RESULT. That
 * distinction is the whole fix, and getting it the wrong way round makes the
 * setting look irrelevant: capping the finished IBL lookup at 10 changes this
 * scene by 0.1%, because the lookups rarely reach 10. Capping the TEXELS that
 * feed the lookup changes it enormously, because a handful of them are in the
 * hundreds. See `clampEnvironmentTexels`.
 */
export const ENV_INDIRECT_CLAMP = 10.0

/** Measured: the HDRI yaw is DRIVEN by facing, not static.
 *    ENV_rot.z = 4.55530935 + (1 - facing) * 0.5 * 1.40307019
 *  = 261.0deg at facing +1, 341.4deg at facing -1. The 80.39deg sweep is exactly
 *  the facing yaw, which is what stops the turn reading as a lighting change. */
export const ENV_ROT_BASE_DEG = 261.0
export const ENV_ROT_SWEEP_DEG = 80.39

/**
 * NOTE THE MINUS SIGN. Blender and three rotate the environment in OPPOSITE
 * directions for the same number, and getting this backwards is silent — he
 * stays lit, just lit from the wrong side.
 *
 * Blender's `ENV_rot` Mapping node rotates the LOOKUP VECTOR: `d' = Rz(t)*d`.
 * three rotates it too, but with the INVERSE of what you hand it —
 * `WebGLMaterials` builds the matrix from `scene.environmentRotation` and then
 * calls `.transpose()`, and the shader samples `envMapRotation * worldNormal`.
 * So three's `d' = Ry(rotY)^-1 * d`, and matching Blender needs `rotY = -t`.
 * (Blender +Z maps to three +Y, and the two equirect UV conventions agree
 * exactly once the axes are remapped, so there is no other correction.)
 *
 * Measured: at +261deg the port lit his RIGHT side and Blender lit his LEFT —
 * the shadow-side body pixels came out 85/255 too bright and the transfer curve
 * against Blender ran with a NEGATIVE slope. At -261deg the slope is 0.96.
 */
export function envRotationForFacing(facing: number): number {
  return -(ENV_ROT_BASE_DEG + ((1 - facing) / 2) * ENV_ROT_SWEEP_DEG) * DEG
}

/**
 * The flat backdrop Blender shows to CAMERA rays only (a Light Path ->
 * Is Camera Ray mix keeps the HDRI itself invisible). Linear RGB.
 *
 * The app never uses this — the canvas is transparent and composites over the
 * DOM. It exists because any Blender-vs-browser frame comparison must clear the
 * browser canvas to exactly this colour, or the diff is dominated by background.
 */
export const BLENDER_BACKDROP_LINEAR = [
  0.054999999701976776, 0.057999998331069946, 0.06499999761581421,
] as const

/**
 * The three area lights and their mirrored twins, read off the live .blend
 * (`Light_anim`, `Fill_anim`, `FaceLight_anim` and the matching `_mir`
 * objects). The twin is dark at facing +1 and full at -1; each pair cross-fades
 * as `base * (1 +/- facing) / 2`, which is exactly the driver Blender uses
 * (`198.399994*(1.0+f)*0.5` and so on, verified on all six).
 *
 * CROSS-FADE THEM, NEVER YAW THEM. Yawing the rig with him swings the key light
 * behind him relative to a fixed camera — measured as a 4.3% brightness delta
 * and visibly darker, against 0.68% for the cross-fade.
 *
 * THE TWINS ARE NOT X-MIRRORS. `Light_mir` sits at (2.813, -4.508, 6.0), not at
 * (-4, -3.5, 6); Blender mirrors them about the camera axis, not about world X.
 * They are transcribed here rather than derived.
 *
 * `width`/`height` are the dimensions BLENDER ACTUALLY USES, which are not what
 * the UI shows: `Fill_anim` and `FaceLight_anim` are shape SQUARE, and a SQUARE
 * area light ignores `size_y` entirely. Their real footprints are 6x6 and 7x7,
 * not the 6x0.25 and 7x0.25 the `size_y` field reads — a 24x and 28x area error,
 * and area is what turns watts into radiance below. Only the key is a RECTANGLE.
 *
 * `dir` is the emission direction (Blender's local -Z) and `axisX` is the
 * rectangle's own width axis; both are the normalised columns of the object's
 * world matrix. `axisX` matters as much as `dir` for the key, which is a 5.0 x
 * 0.1 strip — get the roll wrong and a slot light becomes a bar in the wrong
 * plane. All Blender-frame; `blenderLightQuaternion` converts.
 *
 * There are three MORE area lights in the file (`FaceLight` 240 W, `Fill` 300 W
 * red, `Fill.001` 300 W cyan). They do NOT render: they live in `Collection.001`,
 * which is not linked into the scene's view layer. Do not port them.
 */
export const AREA_LIGHTS = [
  {
    name: 'key',
    watts: 198.4,
    width: 5.0,
    height: 0.1,
    pos: [4, -3.5, 6],
    dir: [-0.55853, 0.48871, -0.67023],
    axisX: [0.6585, 0.75258, 0],
    mirror: {
      pos: [2.81319, -4.50804, 6.0],
      dir: [-0.39189, 0.63025, -0.67023],
      axisX: [-0.84922, -0.52804, 0],
    },
  },
  {
    name: 'fill',
    watts: 60.5,
    width: 6.0,
    height: 6.0,
    pos: [-4.5, -3, 2.5],
    dir: [0.80901, 0.53934, -0.23371],
    axisX: [0.5547, -0.83205, 0],
    mirror: {
      pos: [3.69529, 3.96084, 2.5],
      dir: [-0.66315, -0.71107, -0.23371],
      axisX: [0.73132, -0.68203, 0],
    },
  },
  {
    name: 'face',
    watts: 100.0,
    width: 7.0,
    height: 7.0,
    pos: [-0.6, -5, 2.6],
    dir: [0.11686, 0.97386, -0.19477],
    axisX: [0.99288, -0.11915, 0],
    mirror: {
      pos: [5.03781, -0.2114, 2.6],
      dir: [-0.97994, 0.04227, -0.19477],
      axisX: [-0.0431, -0.99907, 0],
    },
  },
] as const

/**
 * Blender `energy` (watts) -> three `RectAreaLight.intensity`.
 *
 * These are DIFFERENT PHYSICAL QUANTITIES and the conversion depends on the
 * light's area, so there is no single scalar. Blender's watts are radiant power
 * spread over the whole emitting surface; three's intensity is radiance. A
 * Lambertian emitter of area A radiating P watts into a hemisphere has radiance
 * P/(A*pi), which is exactly what EEVEE does with `energy` (its area-light
 * factor is `1/(sizex*sizey*4*pi)` on HALF sizes, i.e. `1/(A*pi)`), and three's
 * LTC integrator consumes radiance in the same units as the environment map.
 *
 * The previous single scalar `1/(4*pi)` was a guess, and because it ignored area
 * it got the BALANCE wrong as well as the level: it made the 0.5 sq-unit key
 * 8x too weak while making the 36 and 49 sq-unit softboxes 9x and 12x too
 * strong in radiance. Net effect, measured, was that the environment did nearly
 * all the work — with all three lights zeroed the frame barely changed — and a
 * prefiltered environment is low-frequency, so the render came out flat. See
 * `PRESERVING THE RATIO` below.
 *
 * PRESERVING THE RATIO: the authored ratio is 198.4 : 60.5 : 100.0 WATTS, and
 * that is preserved exactly — it is the input to this function. The resulting
 * RADIANCES are 126.3 : 0.535 : 0.650, which look nothing alike, and should not:
 * the key is a thin bright slot and the other two are large dim softboxes. Equal
 * watts over unequal areas cannot mean equal radiance.
 */
export function wattsToRadiance(watts: number, width: number, height: number): number {
  return watts / (width * height * Math.PI)
}

/**
 * Apply Blender's indirect-light clamp to the environment, by capping the HDRI's
 * own texels before they are prefiltered.
 *
 * Blender clamps PER SAMPLE (it is a noise clamp), so for a prefiltered probe
 * the equivalent is a cap on the texels the prefilter integrates — not on the
 * value it returns. The difference is the entire effect: `studio_small_09` runs
 * to a radiance of 560 in the ceiling softboxes against a 0.86 whole-sphere
 * mean, so a GGX lobe that merely CLIPS a softbox comes back enormous even
 * though the direction it is centred on is dim.
 *
 * Measured on his lid top, which points straight up into one of those
 * softboxes. All figures below are HDRI radiance, before the 0.6 world strength.
 * The raw sample along its reflection vector is 0.24, yet the roughness-0.30
 * lobe around it integrates to 6.37 — and inverting AgX on the Blender
 * reference puts Blender at about 1.5. Capping the texels here brings the lobe
 * to 1.09, while leaving his front face (1.127 -> 1.122) and his right face
 * (0.073 -> 0.072) alone, because neither of those lobes contains anything near
 * the cap.
 *
 * That selectivity is the evidence. The residual this removes had exactly the
 * same shape: bucketed by surface normal, his up-facing lid top was +44% and
 * his front face +5%, and after the cap they are +6.6% and +4.2%.
 *
 * The cap is in HDRI units, so it is Blender's limit divided by the world
 * strength that is applied on top of it. Do this BEFORE `PMREMGenerator`, or the
 * mip chain is built from the unclamped data and the cap does nothing.
 *
 * Cost: one pass over the source texels at load (2 MB for the 1k HDRI, a couple
 * of ms), zero per frame, and no extra texture memory — the prefiltered cube is
 * the same size either way.
 */
export function clampEnvironmentTexels(texture: Texture, cap: number): boolean {
  const data = (texture.image as { data?: ArrayLike<number> } | undefined)?.data
  if (!data) return false
  // Half float is what HDRLoader produces by default; full float is the other
  // documented option. Anything else (a byte texture) has no headroom to clamp
  // and must not be silently "handled".
  if (texture.type === HalfFloatType && data instanceof Uint16Array) {
    const half = DataUtils.toHalfFloat(cap)
    for (let i = 0; i < data.length; i += 4) {
      // Alpha carries no radiance; leave it. RGB only.
      if (DataUtils.fromHalfFloat(data[i]) > cap) data[i] = half
      if (DataUtils.fromHalfFloat(data[i + 1]) > cap) data[i + 1] = half
      if (DataUtils.fromHalfFloat(data[i + 2]) > cap) data[i + 2] = half
    }
  } else if (texture.type === FloatType && data instanceof Float32Array) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > cap) data[i] = cap
      if (data[i + 1] > cap) data[i + 1] = cap
      if (data[i + 2] > cap) data[i + 2] = cap
    }
  } else {
    return false
  }
  // Harmless on a texture that has never been uploaded (the usual case, straight
  // out of the loader) and necessary on one that has.
  texture.needsUpdate = true
  return true
}

const _lx = new Vector3()
const _ly = new Vector3()
const _lz = new Vector3()
const _lm = new Matrix4()

/**
 * A Blender area light's orientation, from its emission direction and its own
 * width axis, as a three.js quaternion.
 *
 * Both renderers emit along the light's local -Z, so three's +Z is the reverse
 * of Blender's emission direction. `lookAt()` cannot substitute for this: it
 * picks the roll from a world-up vector, which for the 5.0 x 0.1 key is the
 * difference between a horizontal slot and an arbitrarily tilted one.
 *
 * The three `_mir` objects carry scale (-1, -1, -1), so their Blender basis is
 * LEFT-handed. Rebuilding Y as Z x X quietly flips the rectangle's local Y,
 * which is harmless — the rectangle is symmetric about its own centre, so the
 * emitting surface is identical either way.
 */
export function blenderLightQuaternion(
  dir: readonly number[],
  axisX: readonly number[],
  out = new Quaternion(),
): Quaternion {
  blenderToThree(-dir[0], -dir[1], -dir[2], _lz).normalize()
  blenderToThree(axisX[0], axisX[1], axisX[2], _lx).normalize()
  _ly.crossVectors(_lz, _lx).normalize()
  return out.setFromRotationMatrix(_lm.makeBasis(_lx, _ly, _lz))
}

/**
 * three's `AgXToneMapping` is NOT Blender's AgX, and the gap is not a rounding
 * error. Measured by pushing an identical 130-point linear ramp through both —
 * three's real shader in a browser, Blender's via its own OCIO config
 * (`Linear Rec.709` -> `AgX Base sRGB`, which is what view transform AgX with
 * Look None resolves to) — three comes out up to **13/255 brighter**, worst
 * around linear 0.04..0.13, i.e. squarely in the shadows. That alone lifts every
 * shadow and is a large part of the contrast compression this file was auditing.
 *
 * Two differences, both real:
 *
 *  1. THE LINEARISATION EXPONENT. three does `pow(color, 2.2)`. Blender's view
 *     transform is `AgX Base Rec.1886`, and Rec.1886 is a pure 2.4 gamma; the
 *     sRGB display conversion then re-encodes it. 2.2 is the wrong decode.
 *     Fixing just this halves the mean error, 5.17/255 -> 2.77/255.
 *  2. THE SIGMOID. three ships the cheap 6th-order fit of AgX's tone scale.
 *     The 7th-order fit from the same source is closer to the LUT Blender
 *     actually evaluates. 2.77 -> 2.62/255.
 *
 * Everything else — the inset/outset matrices, the Rec.2020 hop, the log2 range
 * — is left exactly as three has it, and `agxLook()` stays out, matching
 * Blender's Look: None.
 *
 * Residual against Blender's own curve is 2.62/255 mean, 7.2/255 worst, down
 * from 5.17 / 13.8. Simulated on real frames (apply the residual as a LUT), a
 * perfect AgX would buy ~1 further point of curveErr over this one.
 *
 * This mutates a three ShaderChunk, which is global. It only REPLACES the
 * `CustomToneMapping` stub — every stock tone mapper is untouched — and it is
 * idempotent, so a second stage does not double-apply it.
 */
const CUSTOM_TONE_MAPPING_STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }'

const BLENDER_AGX_GLSL = /* glsl */ `
// 7th-order fit of the AgX tone scale (three ships the 6th-order one).
vec3 deckeAgxSigmoid( vec3 x ) {

	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	vec3 x6 = x4 * x2;

	return - 17.86 * x6 * x
		+ 78.01 * x6
		- 126.7 * x4 * x
		+ 92.06 * x4
		- 28.72 * x2 * x
		+ 4.361 * x2
		- 0.1718 * x
		+ 0.002857;

}

vec3 CustomToneMapping( vec3 color ) {

	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;
	const float AgxMaxEv = 4.026069;

	// Every tone mapper applies the exposure itself; the stub we replace did not.
	color *= toneMappingExposure;

	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;

	color = max( color, 1e-10 );
	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );

	color = deckeAgxSigmoid( color );

	color = AgXOutsetMatrix * color;

	// Rec.1886, not sRGB's approximate 2.2. This is the bigger of the two fixes.
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.4 ) );

	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;

	return clamp( color, 0.0, 1.0 );

}
`

let blenderAgxInstalled = false

/** @returns whether the patch is in place; false means three's chunk no longer
 *  contains the stub we key off, and the caller must fall back to stock AgX
 *  rather than render through a no-op tone mapper. */
function installBlenderAgX(): boolean {
  if (blenderAgxInstalled) return true
  const src = ShaderChunk.tonemapping_pars_fragment
  if (!src.includes(CUSTOM_TONE_MAPPING_STUB)) return false
  ShaderChunk.tonemapping_pars_fragment = src.replace(CUSTOM_TONE_MAPPING_STUB, BLENDER_AGX_GLSL)
  blenderAgxInstalled = true
  return true
}

export type StageOptions = {
  canvas: HTMLCanvasElement
  /** Transparent by default so he composites over the DOM. Set a linear colour
   *  (e.g. BLENDER_BACKDROP_LINEAR) for parity screenshots. */
  clearColor?: readonly [number, number, number] | null
  /** `agx` is Blender's AgX, reproduced (see BLENDER_AGX_GLSL) — not three's
   *  stock `AgXToneMapping`, which is measurably brighter in the shadows. ACES
   *  is the nearest common alternative and is offered only so the difference can
   *  be compared side by side. */
  toneMapping?: 'agx' | 'aces'
  maxPixelRatio?: number
  /** Dolly the camera so he is this tall on screen, in CSS pixels. `null` keeps
   *  Blender's exact staging distance, which is what the parity harness wants. */
  characterHeightPx?: number | null
}

export type Stage = {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  lights: RectAreaLight[]
  setEnvironment(hdr: Texture): void
  setFacing(facing: number): void
  setSize(width: number, height: number): void
  setCharacterHeight(px: number | null): void
  dispose(): void
}

export function createStage(opts: StageOptions): Stage {
  const {
    canvas,
    clearColor = null,
    toneMapping = 'agx',
    maxPixelRatio = 2,
  } = opts

  // Must be on before any Color is constructed from a hex string, otherwise the
  // sRGB->linear conversion does not happen and every colour is too bright.
  ColorManagement.enabled = true

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: clearColor === null,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio))
  renderer.outputColorSpace = SRGBColorSpace
  // Blender's view transform is AgX. The symbol palette was deliberately chosen
  // deeper and more saturated BECAUSE AgX desaturates hard, so swapping to a
  // different operator does not just shift the look — it invalidates the palette.
  // If three ever renames the CustomToneMapping stub the patch cannot apply, and
  // CustomToneMapping would then be an identity pass — far worse than stock AgX.
  // Fall back to stock rather than silently rendering untone-mapped.
  const agx = installBlenderAgX() ? CustomToneMapping : AgXToneMapping
  renderer.toneMapping = (toneMapping === 'agx' ? agx : ACESFilmicToneMapping) as ToneMapping
  // NOT a tuning knob. Blender's Exposure is 0.0, so this is 1.0, and any parity
  // gap must be closed at the thing that is actually wrong — nudging this would
  // only trade one end of the transfer curve for the other.
  renderer.toneMappingExposure = 1.0

  if (clearColor) {
    // setClearColor takes an sRGB-ish Color; we have linear values, so build the
    // colour in linear space explicitly rather than letting it convert.
    const c = new Color()
    c.setRGB(clearColor[0], clearColor[1], clearColor[2])
    renderer.setClearColor(c, 1)
  } else {
    renderer.setClearAlpha(0)
  }

  const scene = new Scene()
  // Never show the environment. In the app he composites over the DOM, and in
  // Blender the same thing is done with the Is Camera Ray mix.
  scene.background = null
  scene.environmentIntensity = ENV_INTENSITY
  scene.environmentRotation = new Euler(0, envRotationForFacing(1), 0)

  // Reproduce Blender's staging camera exactly. This matters for more than
  // screenshots: the facing system is defined RELATIVE to the camera (at either
  // end he sits 40.195deg off camera-forward, a 3/4 view), and the flight timing
  // metric is measured in this camera's NDC. Move the camera and both change.
  const camera = new PerspectiveCamera(BLENDER_CAMERA.fovDeg, 1, BLENDER_CAMERA.near, BLENDER_CAMERA.far)
  const camPos = blenderToThree(
    BLENDER_CAMERA.position.x,
    BLENDER_CAMERA.position.y,
    BLENDER_CAMERA.position.z,
  )
  // Use Blender's ACTUAL camera rotation, not a lookAt at his midpoint. They are
  // not the same: a lookAt at (0, 1.2, 0) put him 76 px too high in a 720px
  // frame, because the real camera is aimed slightly below his centre.
  camera.position.copy(camPos)
  camera.quaternion.copy(
    blenderCameraQuaternion(
      BLENDER_CAMERA.rotationEuler.x,
      BLENDER_CAMERA.rotationEuler.y,
      BLENDER_CAMERA.rotationEuler.z,
    ),
  )
  // The dolly slides along the camera's own view axis, so the aim is untouched.
  const viewAxis = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion)
  const baseDistance = camPos.length()
  let characterHeightPx: number | null =
    opts.characterHeightPx === undefined ? null : opts.characterHeightPx

  RectAreaLightUniformsLib.init()
  const lights: RectAreaLight[] = []
  const mirrors: RectAreaLight[] = []
  for (const spec of AREA_LIGHTS) {
    const make = (t: { pos: readonly number[]; dir: readonly number[]; axisX: readonly number[] }) => {
      const l = new RectAreaLight(
        0xffffff,
        wattsToRadiance(spec.watts, spec.width, spec.height),
        spec.width,
        spec.height,
      )
      l.position.copy(blenderToThree(t.pos[0], t.pos[1], t.pos[2]))
      l.quaternion.copy(blenderLightQuaternion(t.dir, t.axisX))
      scene.add(l)
      return l
    }
    lights.push(make(spec))
    mirrors.push(make(spec.mirror))
  }

  function setFacing(facing: number) {
    const w = (1 + facing) / 2
    for (let i = 0; i < lights.length; i++) {
      const spec = AREA_LIGHTS[i]
      const base = wattsToRadiance(spec.watts, spec.width, spec.height)
      lights[i].intensity = base * w
      mirrors[i].intensity = base * (1 - w)
    }
    scene.environmentRotation.y = envRotationForFacing(facing)
  }

  function setEnvironment(hdr: Texture) {
    hdr.mapping = EquirectangularReflectionMapping
    // Blender's indirect clamp, applied to the texels because that is where it
    // acts (see clampEnvironmentTexels). MUST precede the PMREM pass. The cap is
    // divided by ENV_INTENSITY because that strength is applied on top at sample
    // time, and Blender's limit is on the product.
    if (!clampEnvironmentTexels(hdr, ENV_INDIRECT_CLAMP / ENV_INTENSITY)) {
      console.warn(
        "decke stage: environment is not a float texture; Blender's indirect clamp was NOT applied",
      )
    }
    // PREFILTER IT. Handing the raw equirect straight to `scene.environment`
    // leaves a near-mirror surface point-sampling one texel per pixel, and the
    // eye is the one surface smooth enough to show it: at small screen sizes the
    // 1k HDRI aliased into a fine woven moire across the sclera. That was
    // isolated by elimination — it vanished with `scene.environment = null` and
    // survived turning every area light off, so it was the environment and not
    // the lights, the masks, the atlas or the bump.
    //
    // PMREM builds the roughness mip chain the PBR shader actually wants, so a
    // low-roughness sample becomes a filtered lookup instead of a point sample.
    const pmrem = new PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    const target = pmrem.fromEquirectangular(hdr)
    scene.environment?.dispose()
    scene.environment = target.texture
    // Both the source and the generator are dead weight once the cube map
    // exists, and a resident HDR source is real memory on mobile.
    hdr.dispose()
    pmrem.dispose()
  }

  function setSize(width: number, height: number) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio))
    renderer.setSize(width, height, false)
    // Keep the VERTICAL fov fixed so he stays the same height regardless of
    // viewport shape. Blender's 38.187deg is a square-frame figure, where
    // horizontal and vertical coincide.
    camera.aspect = width / height
    camera.fov = BLENDER_CAMERA.fovDeg
    camera.updateProjectionMatrix()
    applyDolly(height)
  }

  /**
   * Dolly the camera ALONG ITS OWN AXIS to make him a chosen height on screen.
   *
   * Moving the camera sideways would be wrong: the facing system is defined
   * relative to the camera (at either end he sits 40.195deg off camera-forward,
   * which is what makes the 3/4 "standing beside it, facing inward" read), and
   * the authored near/far asymmetry is resolved against that angle. Dollying
   * along the view axis changes only his apparent size and leaves every one of
   * those relationships intact — so parity with Blender is preserved by simply
   * setting `characterHeightPx` back to its framing distance.
   */
  function applyDolly(viewportHeight: number) {
    if (!characterHeightPx) {
      camera.position.copy(camPos)
      return
    }
    const vFov = (camera.fov * Math.PI) / 180
    const dist =
      (BODY_H * viewportHeight) / (2 * characterHeightPx * Math.tan(vFov / 2))
    // Slide along the view axis only — the orientation, and therefore the 3/4
    // angle the whole facing system is defined against, stays exactly as Blender
    // staged it. Only his apparent size changes.
    camera.position.copy(viewAxis).multiplyScalar(dist - baseDistance).add(camPos)
  }

  function setCharacterHeight(px: number | null) {
    characterHeightPx = px
    applyDolly(renderer.domElement.height / renderer.getPixelRatio())
  }

  function dispose() {
    for (const l of [...lights, ...mirrors]) l.dispose?.()
    renderer.dispose()
  }

  setFacing(1)
  return {
    renderer, scene, camera, lights,
    setEnvironment, setFacing, setSize, setCharacterHeight, dispose,
  }
}

export const degToRad = MathUtils.degToRad
